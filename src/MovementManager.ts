import { SCOPE } from "./globals.ts";
import { ActorPF2e, CombatantPF2e } from "module-helpers";
import { ActionManager } from "./ActionManager.ts";
import { ActorHandler } from "./ActorHandler.ts";
import { ChatManager } from "./ChatManager.ts";
import { logError } from "./logger.ts"

const MOVEMENT_FLAG = "movementHistorySnapshot";

export class MovementManager {

    // Ensure we only process one movement (and one movement fully) before the next one
    private static _processingQueue = new Map<string, Promise<void>>();
    // Synchronous local storage for history length to prevent race conditions
    private static _historyLengths = new Map<string, number>();
    /**
     * Checks if a specific msgId belongs to a movement action
     */
    static isMoveAction(msgId: string | undefined): boolean {
        return !!msgId?.startsWith('move-');
    }

    static async handleTokenUpdate(tokenDoc: any, update: any) {
        const combatant = tokenDoc.combatant;
        if (!combatant) return;

        const combatantId = combatant.id;
        const existingPromise = MovementManager._processingQueue.get(combatantId) || Promise.resolve();

        // Chain the new movement task onto the existing one
        const newPromise = existingPromise.then(async () => {

            const history = tokenDoc._movementHistory || [];
            const coordList = history.map((p: any) => ({ x: p.x, y: p.y, elevation: p.elevation ?? 0 }));
            try {
                await MovementManager._processMovement(combatant, tokenDoc, coordList, false);
            } catch (err) {
                logError("Movement Processing Error:", err);
            }
        });

        MovementManager._processingQueue.set(combatantId, newPromise);
    }

    /**
     * Logic for movement cost calculation across regions (difficult terrain)
     */
    static calculateMovementCost(token: any, distance: number, toPoint: { x: number, y: number }): number {
        const regions = (canvas.regions as any).placeables.filter((r: any) =>
            r.document.behaviors.some((b: any) => !b.disabled && b.type === "environmentFeature") &&
            token.testInsideRegion(r, toPoint)
        );

        if (regions.length > 0) {
            const behaviors = regions.flatMap((r: any) =>
                r.document.behaviors.filter((b: any) => b.type === "environmentFeature")
            );
            const hasGreatDifficult = behaviors.some((b: any) => b.system?.terrain?.difficult === 2);
            return hasGreatDifficult ? distance + 10 : distance + 5;
        }
        return distance;
    }

    /**
     *  Check for difficult terrain during a movement
     */
    private static checkDifficultTerrain(token: any, coordList: any[]): boolean {
        if (!canvas.regions) return false;

        // Check the last point in the move
        const lastPoint = coordList[coordList.length - 1];
        if (!lastPoint) return false;

        return (canvas.regions as any).placeables.some((r: any) =>
            r.document.behaviors.some((b: any) => !b.disabled && b.type === "environmentFeature") &&
            token.testInsideRegion(r, lastPoint)
        );
    }

    /**
     * Handles movements for a token.  Will use the PF2E rules class to properly measure the distance based on the coordinates
     * provided by Foundry, and find the appropriate number of actions needed to move that distance
     * Note: Also handles Ctrl + Z "undo", removing actions to get to the move action if needed -> This is in case
     *       a move -> strike -> move occurs, and the first move is needed to hit the strike.  Will undo the strike and send a whisper
     *       to the actor and GM so they can do what is needed to finish undoing the strike as that is not automated (yet?)
     * @param recursiveCall - If set to false, will store the movement coordinates list on the combatant.
     * @returns 
     */
    private static async _processMovement(combatant: CombatantPF2e, tokenDoc: any, coordList: any[], recursiveCall: boolean): Promise<void> {
        const c = combatant as any;
        if (!(game as any).combat?.active) return;
        // 80/20 rule - 80% of actions not on a turn are either forced or free actions from trigger.  If there is movement by the
        // combatant during someone else's turn, just ignore it... and let a manual addition handle if desired
        if ((game as any).combat.combatant?.id !== c.id) return;

        const currentActions = [...ActionManager.getActions(combatant)];
        const lastAction = currentActions[currentActions.length - 1];

        const actor: ActorPF2e = c.actor;
        if (!actor) return;

        // --- 1. HANDLE COMPLETE CLEAR ---
        if (coordList.length === 0) {
            let foundMove = false;
            while (currentActions.length > 0 && !foundMove) {
                const action = currentActions.pop();
                if (!action) break;
                if (MovementManager.isMoveAction(action.msgId)) foundMove = true;
                else ChatManager.whisperAlert(actor, 'Undo Correction', `Movement undo detected. To maintain turn integrity, the following action was reverted: ${action.label}`);
                await ActionManager.removeAction(combatant, action.msgId);
            }
            // Clean up the map for this combatant
            const cId = (combatant as any).id;
            if (cId) MovementManager._historyLengths.delete(cId);
            return;
        }

        const path = coordList.map(p => ({ x: p.x, y: p.y }));
        // This takes into account rough terrain and adds appropriate distance as needed
        const { distance } = (canvas.grid as any).measurePath(path);
        if (distance === 0) return;
        // If over 200 feet, likely a GM drag and drop, do not log it.
        if (distance > 200) return;

        const activeSpeed = ActorHandler.getActiveSpeed(actor, (tokenDoc.elevation || 0) > 0);
        const isDifficult = MovementManager.checkDifficultTerrain(tokenDoc.object, coordList);

        // Helper to get distance from an action
        const getDist = (act: any) => {
            if (!act || !act.label) return 0;
            if (act.label === 'Step') return 5;
            const match = act.label.match(/\d+/); // Finds the number in "Stride: 10ft"
            return match ? parseInt(match[0]) : 0;
        };

        // Calculate previously recorded movement
        const moveActions = currentActions.filter(a => MovementManager.isMoveAction(a.msgId));
        const totalRecorded = moveActions.reduce((acc, a) => acc + getDist(a), 0);

        // --- 2. EVALUATE CHANGES ---

        // A. NO CHANGE (Jitter)
        if (distance === totalRecorded) return;

        // B. UNDO (Ruler is shorter than Log)
        if (distance < totalRecorded) {
            if (lastAction) {
                await ActionManager.removeAction(combatant, lastAction.msgId);
                if (!MovementManager.isMoveAction(lastAction.msgId)) {
                    ChatManager.whisperAlert(actor, 'Undo Correction', `Movement undo detected. Reverted: ${lastAction.label}`);
                }
                // Recurse to see if we need to undo more
                await MovementManager._processMovement(combatant, tokenDoc, coordList, true);
            }
            return;
        }

        // C. NEW MOVEMENT OR EDIT LAST MOVE
        if (lastAction && MovementManager.isMoveAction(lastAction.msgId)) {
            const distBeforeThisMove = totalRecorded - getDist(lastAction);
            const newDistance = distance - distBeforeThisMove;
            const newCost = Math.ceil(newDistance / activeSpeed);
            const label = MovementManager.getMovementLabel(newDistance, newCost, tokenDoc, isDifficult);

            await ActionManager.editAction(combatant, lastAction.msgId, { label, cost: newCost });
        } else {
            // New movement segment
            const newDistance = distance - totalRecorded;
            if (newDistance > 0) {
                const moveMsgId = `move-${c.id}-${Date.now()}`;
                const cost = Math.ceil(newDistance / activeSpeed);
                const label = MovementManager.getMovementLabel(newDistance, cost, tokenDoc, isDifficult);
                await ActionManager.addAction(combatant, { cost, msgId: moveMsgId, label, type: 'action', isQuickenedEligible: true });
            }
        }

        // At the very end of the function:
        if (!recursiveCall) MovementManager.storeMovement(combatant, coordList);
    }

    /**
     * Centralized place to get our movement label
     */
    static getMovementLabel(distance: number, cost: number, tokenDoc: any, isDifficult: boolean) {
        if (tokenDoc.elevation > 0) return `Fly: ${distance}ft`;

        // In PF2e, you can't Step into difficult terrain.
        // Also, a Step is always exactly 5ft and 1 action.
        if (distance === 5 && cost === 1 && !isDifficult) {
            return 'Step';
        }

        return `Stride: ${distance}ft`;
    }

    /**
      * Stores the current coordList length into local memory.
      */
    private static storeMovement(combatant: CombatantPF2e, coordList: any[]) {
        const cId = (combatant as any).id;
        if (cId) MovementManager._historyLengths.set(cId, coordList.length);
    }

    /**
     * Compares the current coordList length against local memory.
     */
    private static isUndoMovement(combatant: CombatantPF2e, coordList: any[]): boolean {
        const cId = (combatant as any).id;
        const lastHistoryLength = cId ? (MovementManager._historyLengths.get(cId) || 0) : 0;

        return coordList.length < lastHistoryLength;
    }
}