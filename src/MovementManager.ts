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

        // Use tokenDoc.id as the primary key for physical movement history
        const tokenId = tokenDoc.id;
        const existingPromise = MovementManager._processingQueue.get(tokenId) || Promise.resolve();

        const newPromise = existingPromise.then(async () => {
            const history = tokenDoc._movementHistory || [];
            const coordList = history.map((p: any) => ({ x: p.x, y: p.y, elevation: p.elevation ?? 0 }));
            try {
                await MovementManager._processMovement(combatant, tokenDoc, coordList, false);
            } catch (err) {
                logError("Movement Processing Error:", err);
            }
        });

        MovementManager._processingQueue.set(tokenId, newPromise);
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
        const actor: ActorPF2e = c.actor;
        if (!actor) return;

        // --- 1. HANDLE COMPLETE CLEAR (Undo to zero) ---
        if (coordList.length === 0) {
            let foundMove = false;
            while (currentActions.length > 0 && !foundMove) {
                const action = currentActions.pop();
                if (!action) break;
                if (MovementManager.isMoveAction(action.msgId)) {
                    foundMove = true;
                } else {
                    ChatManager.triggerAlert(actor, 'Undo Correction', `Movement undo detected. Reverted: ${action.label}`, '');
                }
                await ActionManager.removeAction(combatant, action.msgId);
            }
            MovementManager._historyLengths.delete(tokenDoc.id);
            return;
        }

        const path = coordList.map(p => ({ x: p.x, y: p.y }));
        // This takes into account rough terrain and adds appropriate distance as needed
        const { distance } = (canvas.grid as any).measurePath(path);

        // Jitter/GM Drag Checks
        if (distance === 0 || distance > 200) return;

        const activeSpeed = ActorHandler.getActiveSpeed(actor, (tokenDoc.elevation || 0) > 0);
        const isDifficult = MovementManager.checkDifficultTerrain(tokenDoc.object, coordList);

        const getDist = (act: any) => {
            if (!act?.label) return 0;
            if (act.label === 'Step') return 5;
            const match = act.label.match(/\d+/);
            return match ? parseInt(match[0]) : 0;
        };

        // Calculate previously recorded movement
        const moveActions = currentActions.filter(a => MovementManager.isMoveAction(a.msgId));
        const totalRecorded = moveActions.reduce((acc, a) => acc + getDist(a), 0);

        // --- 2. EVALUATE CHANGES ---

        // A. NO CHANGE
        if (distance === totalRecorded) return;

        const lastAction = currentActions[currentActions.length - 1];
        // B. UNDO (Ruler is shorter than Log)
        // B. ACTUAL UNDO (Ctrl+Z detected via history length)
        if (MovementManager.isUndoMovement(tokenDoc, coordList)) {
            if (lastAction) {
                await ActionManager.removeAction(combatant, lastAction.msgId);
                if (!MovementManager.isMoveAction(lastAction.msgId)) {
                    ChatManager.triggerAlert(actor, 'Undo Correction', `Movement undo detected. Reverted: ${lastAction.label}`, 'undoAlert');
                }
                // Sync the history length after the pop
                MovementManager.storeMovement(tokenDoc, coordList);
                // Recurse to see if we need to undo more
                await MovementManager._processMovement(combatant, tokenDoc, coordList, true);
            }
            return;
        }

        // C. MOUSE MOVEMENT (Adjusting the current ruler)
        if (distance !== totalRecorded) {
            if (lastAction && MovementManager.isMoveAction(lastAction.msgId)) {
                // Just edit the existing move label/cost, don't delete anything!
                const distBeforeThisMove = totalRecorded - getDist(lastAction);
                const newDistance = distance - distBeforeThisMove;

                const newCost = Math.ceil(newDistance / activeSpeed);
                const label = MovementManager.getMovementLabel(newDistance, newCost, tokenDoc, isDifficult);
                await ActionManager.editAction(combatant, lastAction.msgId, { label, cost: newCost });
            } else {
                // New movement segment
                const newDistance = distance - totalRecorded;
                if (newDistance > 0) {
                    const moveMsgId = `move-${tokenDoc.id}-${Date.now()}`;
                    const cost = Math.ceil(newDistance / activeSpeed);
                    const label = MovementManager.getMovementLabel(newDistance, cost, tokenDoc, isDifficult);
                    await ActionManager.addAction(combatant, { cost, msgId: moveMsgId, label, type: 'action', isQuickenedEligible: true });
                }
            }
        }
        if (!recursiveCall) MovementManager.storeMovement(tokenDoc, coordList);
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
    private static storeMovement(tokenDoc: any, coordList: any[]) {
        MovementManager._historyLengths.set(tokenDoc.id, coordList.length);
    }

    /**
     * Compares the current coordList length against local memory.
     */
    private static isUndoMovement(tokenDoc: any, coordList: any[]): boolean {
        const lastHistoryLength = MovementManager._historyLengths.get(tokenDoc.id) || 0;
        return coordList.length < lastHistoryLength;
    }
}