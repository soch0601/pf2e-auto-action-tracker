import type { ActorPF2e, CombatantPF2e } from "module-helpers";
import type { ActionLogEntry } from "./ActionLogTypes.ts";
import { ActorManager } from "./ActorManager.ts";
import { ComplexActionEngine } from "./complexActions/ComplexActionEngine.ts";
import { logError } from "./logger.ts"
import { GlobalConfig } from "./globals.ts";
import { isCurrentUserActiveGM } from "./foundryCompat.ts";

const MOVEMENT_FLAG = "movementHistorySnapshot";

export class MovementManager {

    // Synchronous local storage for history length to prevent race conditions
    private static _historyLengths = new Map<string, number>();
    private static _capturedHistory = new Map<string, any[]>();
    // Tracks the distance covered in the current movement interaction to calculate deltas
    private static _lastInteractionDistance = new Map<string, number>();
    private static _lastCoords = new Map<string, any[]>();

    static async broadcastReset(tokenId?: string) {
        const { SocketsManager } = await import("./SocketManager.ts");
        if (!SocketsManager.socket) return;
        SocketsManager.socket.executeForEveryone("resetMovementHistory", { tokenId });
    }

    /**
     * Resets the manual history capture for a token.
     */
    static resetCapturedHistory(tokenId?: string) {
        if (tokenId) {
            MovementManager._capturedHistory.delete(tokenId);
            MovementManager._lastInteractionDistance.delete(tokenId);
            MovementManager._historyLengths.delete(tokenId);
            MovementManager._lastCoords.delete(tokenId);
        } else {
            MovementManager._capturedHistory.clear();
            MovementManager._lastInteractionDistance.clear();
            MovementManager._historyLengths.clear();
            MovementManager._lastCoords.clear();
        }
    }

    /**
     * Retrieves the manual history capture for a token.
     */
    static getCapturedHistory(tokenId: string) {
        return MovementManager._capturedHistory.get(tokenId);
    }


    static async handlePreUpdateToken(tokenDoc: any, update: any, options: any) {
        if (!GlobalConfig.noHistoryConflict) return;

        if ("x" in update || "y" in update) {
            const tokenId = tokenDoc.id;
            let captured = MovementManager._capturedHistory.get(tokenId) || [];

            // If this is the VERY first capture for this token, add the start point
            if (captured.length === 0) {
                captured.push({ x: tokenDoc.x, y: tokenDoc.y, elevation: tokenDoc.elevation ?? 0 });
            }

            MovementManager._capturedHistory.set(tokenId, captured);
        }
    }

    static async handleTokenUpdate(tokenDoc: any, update: any, options: any = {}) {
        const combatant = tokenDoc.combatant;
        if (!combatant) return;

        // Use tokenDoc.id as the primary key for physical movement history
        const tokenId = tokenDoc.id;

        let history: any[] = [];
        const captured = MovementManager._capturedHistory.get(tokenId);

        if (GlobalConfig.noHistoryConflict) {
            const endX = update.x !== undefined ? update.x : tokenDoc.x;
            const endY = update.y !== undefined ? update.y : tokenDoc.y;
            const endElev = update.elevation !== undefined ? update.elevation : (tokenDoc.elevation ?? 0);

            if (captured) {
                // Manually build the path
                captured.push({ x: endX, y: endY, elevation: endElev });
                history = [...captured];
            } else {
                history = [];
            }
        } else {
            history = tokenDoc._movementHistory || [];
        }

        const coordList = history.map((p: any) => ({ x: p.x, y: p.y, elevation: p.elevation ?? 0 }));
        try {
            await MovementManager._processMovement(combatant, tokenDoc, coordList, false);
        } catch (err) {
            logError("Movement Processing Error:", err);
        }

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

    static measurePath(actor: any, token: any, path: any[], movementMode: string) {
        const { distance } = (canvas.grid as any).measurePath(path, { token });
        const mode = movementMode || "stride";
        const activeSpeed = ActorManager.getActiveSpeed(actor, mode) || 30;
        const cost = Math.ceil(distance / activeSpeed);
        const isDifficult = this.checkDifficultTerrain(token, path);
        const label = this.getMovementLabel(distance, cost, mode, isDifficult);

        return { distance, cost, isDifficult, label };
    }

    static getPathData(actor: ActorPF2e, tokenDoc: any, coordList: any[], mode: string) {
        const path = coordList.map(p => ({ x: p.x, y: p.y }));
        const { distance } = (canvas.grid as any).measurePath(path, { token: tokenDoc.object });
        const activeSpeed = ActorManager.getActiveSpeed(actor, mode) || 30;
        const cost = Math.ceil(distance / activeSpeed);
        const isDifficult = this.checkDifficultTerrain(tokenDoc.object, coordList);
        const label = this.getMovementLabel(distance, cost, mode, isDifficult);

        return { distance, cost, isDifficult, label };
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
    private static async _processMovement(combatant: CombatantPF2e, tokenDoc: any, providedCoordList?: any[], isRecursive: boolean = false, overrideMode?: 'native' | 'captured') {
        const mode = overrideMode || (GlobalConfig.noHistoryConflict ? 'captured' : 'native');
        const activeId = (game as any).combat?.combatant?.id;

        const c = combatant as any as Combatant;
        if (!c?.id || !combatant) return;

        const coordList = providedCoordList ?? tokenDoc._movementHistory;
        const lastLength = MovementManager._historyLengths.get(tokenDoc.id) || 0;

        // If we've already processed this exact history length, skip to avoid double-processing
        // between preUpdate and update hooks unless it's a recursive call.
        if (!isRecursive && coordList && coordList.length > 0 && coordList.length === lastLength) {
            return;
        }

        // Verify active turn for native mode (captured mode is session-based and more lenient)
        if (mode === 'native' && activeId !== c.id) {
            return;
        }

        // If this is a player client, they must delegate the actual processing to the GM
        // because only the GM can reliably update the combatant's flags.
        if (!isCurrentUserActiveGM()) {
            const payload = {
                combatantId: c.id,
                tokenId: tokenDoc.id,
                coordList: providedCoordList,
                recursiveCall: isRecursive,
                mode: mode // Send the player's mode to the GM
            };
            const { SocketsManager } = await import("./SocketManager.ts");
            // @ts-ignore
            SocketsManager.socket.executeAsGM("processMovement", payload);
            return;
        }

        const actor = (combatant as any as Combatant).actor as any as ActorPF2e;
        if (!actor) return;

        if (!coordList || coordList.length === 0) {
            await this._performUndo(combatant, actor, tokenDoc);
            return;
        }

        // Delegate to the specialized processor
        if (mode === 'captured') {
            await MovementManager._processCapturedMovement(combatant, tokenDoc, coordList);
        } else {
            await MovementManager._processNativeMovement(combatant, tokenDoc, coordList);
        }

        if (!isRecursive) MovementManager.storeMovement(tokenDoc, coordList);
    }

    /**
     * NATIVE MODE: History is Turn-Cumulative.
     * Logic: Always subtract totalRecorded distance to find the current delta.
     * Logic: Simply trust the coordList for native mode.
     */
    private static async _processNativeMovement(combatant: CombatantPF2e, tokenDoc: any, coordList: any[]): Promise<void> {
        const c = combatant as any;
        const actor: ActorPF2e = c.actor;
        if (!actor) return;

        const path = coordList.map(p => ({ x: p.x, y: p.y }));
        // This takes into account rough terrain and adds appropriate distance as needed
        const { distance } = (canvas.grid as any).measurePath(path);
        const { ActionManager } = await import("./ActionManager.ts");
        const allActions = ActionManager.getFlattenedActions(combatant);
        const moveActions = allActions.filter(a => MovementManager.isMoveAction(a.msgId));

        const getDist = (act: ActionLogEntry) => {
            if (act.distance !== undefined) return act.distance;
            if (act.label === 'Step') return 5;
            const match = act.label.match(/\d+/);
            return match ? parseInt(match[0]) : 0;
        };
        const totalRecorded = moveActions.reduce((acc, a) => acc + getDist(a), 0);

        // Jitter/GM Drag Checks - only return if distance is 0 and we have no recorded movement to undo
        if (distance > 200) return;
        if (distance === 0 && totalRecorded === 0) return;
        const movementMode = tokenDoc.movementAction === "walk" ? "stride" : (tokenDoc.movementAction || 'stride');
        const activeSpeed = ActorManager.getActiveSpeed(actor, movementMode) || 30;
        const isDifficult = MovementManager.checkDifficultTerrain(tokenDoc.object, coordList);

        // --- 2. EVALUATE CHANGES ---
        if (!GlobalConfig.noHistoryConflict && distance === totalRecorded) return;

        const lastResult = ActionManager.getLastAction(combatant);
        let activeMsgId = lastResult?.isSubAction ? lastResult.subAction?.msgId : lastResult?.entry.msgId;
        const isActiveMove = activeMsgId ? MovementManager.isMoveAction(activeMsgId) : false;

        // If the last action wasn't a move, check if we're in an interruptible complex move
        if (activeMsgId && !isActiveMove) {
            const state = lastResult?.entry.ComplexActionState;
            if (state) {
                const interruptedId = ComplexActionEngine.getInterruptibleMoveId(state);
                if (interruptedId) activeMsgId = interruptedId;
            }
        }

        // Detect if this movement is a continuation of the previous drag session
        const lastCoords = MovementManager._lastCoords.get(tokenDoc.id) || [];
        const isContinuation = coordList.length > 0 && lastCoords.length > 0 &&
            coordList.length >= lastCoords.length &&
            lastCoords.every((p, i) => p.x === coordList[i].x && p.y === coordList[i].y);

        // Detect if this is an "Undo" (user dragged back along the same path)
        const isUndo = coordList.length > 0 && lastCoords.length > 0 &&
            coordList.length < lastCoords.length &&
            coordList.every((p, i) => p.x === lastCoords[i].x && p.y === lastCoords[i].y);

        // B. ACTUAL UNDO (Ctrl+Z detected)
        if (isUndo) {
            if (lastResult && activeMsgId) {
                const { ActionManager } = await import("./ActionManager.ts");
                await ActionManager.removeAction(combatant, activeMsgId);
                const { ChatManager } = await import("./ChatManager.ts");
                ChatManager.triggerAlert(actor, 'Undo Correction', `Movement undo detected. Reverted: ${lastResult.actionLabel ?? lastResult.entry.label}`, 'undoAlert');
                MovementManager.storeMovement(tokenDoc, coordList);
                await MovementManager._processNativeMovement(combatant, tokenDoc, coordList);
            }
            return;
        }

        // C. TOKEN MOVEMENT (Adjusting current ruler or adding new segment)
        if (distance !== totalRecorded) {
            // Calculate how much distance is allocated to previous segments to find the current segment's contribution
            const currentMoveDist = isActiveMove ? (lastResult?.isSubAction ? lastResult.subAction?.distance : lastResult?.entry.distance) || 0 : 0;
            const previousSegmentsDistance = totalRecorded - currentMoveDist;
            const segmentDistance = distance - previousSegmentsDistance;

            // If it's a continuation of the same drag, we update the last move action with the new total distance for THIS segment
            if (isContinuation && lastResult && activeMsgId && isActiveMove) {
                const newCost = Math.ceil(segmentDistance / activeSpeed);
                const label = MovementManager.getMovementLabel(segmentDistance, newCost, movementMode, isDifficult);
                const { ActionManager } = await import("./ActionManager.ts");
                await ActionManager.editAction(combatant, activeMsgId, { label, cost: newCost, slug: movementMode, distance: segmentDistance });
            } else {
                // If it's a new drag starting from a fresh history, we treat its distance relative to what's already recorded.
                const newDistance = isContinuation ? distance - totalRecorded : segmentDistance;
                if (newDistance > 0) {
                    const moveMsgId = `move-${tokenDoc.id}-native-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                    const cost = Math.ceil(newDistance / activeSpeed);
                    const label = MovementManager.getMovementLabel(newDistance, cost, movementMode, isDifficult);

                    const { ActionManager } = await import("./ActionManager.ts");
                    await ActionManager.addAction(combatant, {
                        cost,
                        msgId: moveMsgId,
                        label,
                        type: 'action',
                        category: "move",
                        slug: movementMode,
                        linkedMessages: [],
                        isQuickenedEligible: true,
                        distance: newDistance
                    });
                }
            }
        }
    }

    /**
     * CAPTURED MODE: History is Session-Based (resets on Strike/Drop).
     * Logic: Distance is already discrete, no subtraction needed.
     */
    private static async _processCapturedMovement(combatant: CombatantPF2e, tokenDoc: any, coordList: any[]) {
        const tokenId = tokenDoc.id;
        const movementMode = tokenDoc.movementAction || 'stride';
        const speed = ActorManager.getActiveSpeed((combatant as any as Combatant).actor as any as ActorPF2e, movementMode);
        // Calculate distance covered in the current coordinate set
        const currentPathDistance = MovementManager._calculateTotalDistance(tokenDoc.object, coordList);
        const lastPathDist = MovementManager._lastInteractionDistance.get(tokenId) || 0;

        let delta = 0;
        if (currentPathDistance < lastPathDist) {
            // Path reset or shrunk - treat the entire new path as new distance
            delta = currentPathDistance;
        } else {
            // Path grew - only add the new segment
            delta = currentPathDistance - lastPathDist;
        }

        MovementManager._lastInteractionDistance.set(tokenId, currentPathDistance);

        if (delta <= 0) return;

        const { ActionManager } = await import("./ActionManager.ts");
        const lastResult = ActionManager.getLastAction(combatant);
        const activeMsgId = lastResult?.isSubAction ? lastResult.subAction?.msgId : lastResult?.entry.msgId;
        const isActiveMove = activeMsgId ? MovementManager.isMoveAction(activeMsgId) : false;

        const isDifficult = MovementManager.checkDifficultTerrain(tokenDoc.object, coordList);
        if (lastResult && isActiveMove && activeMsgId && lastPathDist > 0) {
            // Extend existing move action
            const oldDist = (lastResult.isSubAction ? lastResult.subAction?.distance : lastResult.entry.distance) || 0;
            const newDist = oldDist + delta;
            const newCost = Math.ceil(newDist / speed);
            const label = MovementManager.getMovementLabel(newDist, newCost, movementMode, isDifficult);

            const { ActionManager } = await import("./ActionManager.ts");
            await ActionManager.editAction(combatant, activeMsgId, {
                label,
                cost: newCost,
                distance: newDist
            });
        } else {
            // Start new move action
            const cost = Math.ceil(delta / speed);
            const label = MovementManager.getMovementLabel(delta, cost, movementMode, isDifficult);


            const { ActionManager } = await import("./ActionManager.ts");
            await ActionManager.addAction(combatant, {
                cost,
                msgId: `move-${tokenId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                label,
                type: 'action',
                category: 'move',
                slug: movementMode,
                linkedMessages: [],
                isQuickenedEligible: true,
                distance: delta
            });
        }
    }

    static isMoveAction(msgId: string): boolean {
        if (!msgId) return false;
        const lower = msgId.toLowerCase();
        return lower.startsWith('move-') ||
            lower.includes('-stride') ||
            lower.includes('-step') ||
            lower.includes('-fly') ||
            lower.includes('-walk') ||
            lower.includes('-burrow') ||
            lower.includes('-climb') ||
            lower.includes('-swim');
    }

    /**
     * Dedicated Undo Handler for readability.
     * Pops actions until a movement action is found and removed.
     */
    private static _calculateTotalDistance(token: any, coordList: { x: number, y: number }[]): number {
        if (!coordList || coordList.length < 2) return 0;
        // This takes into account rough terrain and adds appropriate distance as needed
        const result = (canvas.grid as any).measurePath(coordList, { token });
        return result.distance ?? 0;
    }

    private static _calculateMovementActions(distance: number, speed: number): number {
        if (speed <= 0) return 0;
        return Math.ceil(distance / speed);
    }

    private static async _removeMoveAction(combatant: CombatantPF2e) {
        const { ActionManager } = await import("./ActionManager.ts");
        const lastResult = ActionManager.getLastAction(combatant);
        const activeMsgId = lastResult?.isSubAction ? lastResult.subAction?.msgId : lastResult?.entry.msgId;

        if (lastResult && activeMsgId && MovementManager.isMoveAction(activeMsgId)) {
            await ActionManager.removeAction(combatant, activeMsgId);
        }
    }

    private static async _performUndo(combatant: CombatantPF2e, actor: any, tokenDoc: any) {
        let safety = 0;
        while (safety < 50) {
            const { ActionManager } = await import("./ActionManager.ts");
            const lastResult = ActionManager.getLastAction(combatant);
            if (!lastResult) {
                break;
            }

            const targetId = lastResult.isSubAction ? lastResult.subAction?.msgId : lastResult.entry.msgId;
            const label = lastResult.isSubAction ? lastResult.actionLabel : lastResult.entry.label;

            if (targetId) {
                const { ActionManager } = await import("./ActionManager.ts");
                const wasMove = MovementManager.isMoveAction(targetId);
                await ActionManager.removeAction(combatant, targetId);

                if (!wasMove) {
                    const { ChatManager } = await import("./ChatManager.ts");
                    ChatManager.triggerAlert(actor, 'Undo Correction', `Movement undo detected. Reverted: ${label}`, 'undoAlert');
                } else {
                    break; // Successfully removed the movement segment
                }
            }
            safety++;
        }
        MovementManager._historyLengths.delete(tokenDoc.id);
        MovementManager._lastInteractionDistance.delete(tokenDoc.id);
        MovementManager.resetCapturedHistory(tokenDoc.id);
    }

    /**
     * Entry point for the GM to process movement data sent from a player's client
     */
    static async processMovementFromData(combatant: CombatantPF2e, tokenDoc: any, data: any) {
        // Ensure we're using the fresh list of coords provided by the player
        // Use the mode provided by the player client
        await this._processMovement(combatant, tokenDoc, data.coordList, data.recursiveCall, data.mode);
    }

    static getMovementLabel(distance: number, cost: number, mode: string, isDifficult: boolean) {
        if (distance === 5 && cost === 1 && !isDifficult && mode === "stride") {
            return 'Step';
        }
        const capitalized = mode.charAt(0).toUpperCase() + mode.slice(1);
        return `${capitalized}: ${distance}ft`;
    }

    private static checkDifficultTerrain(token: any, coordList: any[]): boolean {
        if (!canvas.regions) return false;
        const lastPoint = coordList[coordList.length - 1];
        if (!lastPoint) return false;

        return (canvas.regions as any).placeables.some((r: any) =>
            r.document.behaviors.some((b: any) => !b.disabled && b.type === "environmentFeature") &&
            token.testInsideRegion(r, lastPoint)
        );
    }

    private static storeMovement(tokenDoc: any, coordList: any[]) {
        MovementManager._lastCoords.set(tokenDoc.id, coordList);
        MovementManager._historyLengths.set(tokenDoc.id, coordList.length);
    }
}
