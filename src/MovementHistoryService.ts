import { ActorManager } from "./ActorManager.ts";
import { SocketSender } from "./sockets/SocketSender.ts";
import type { ActorPF2e } from "module-helpers";

export class MovementHistoryService {
    // Synchronous local storage for history length to prevent race conditions
    private static _historyLengths = new Map<string, number>();
    private static _capturedHistory = new Map<string, any[]>();
    // Tracks the distance covered in the current movement interaction to calculate deltas
    private static _lastInteractionDistance = new Map<string, number>();
    private static _lastCoords = new Map<string, any[]>();

    static broadcastReset(tokenId?: string) {
        SocketSender.broadcastResetMovementHistory(tokenId);
    }

    /**
     * Resets the manual history capture for a token.
     */
    static resetCapturedHistory(tokenId?: string) {
        if (tokenId) {
            MovementHistoryService._capturedHistory.delete(tokenId);
            MovementHistoryService._lastInteractionDistance.delete(tokenId);
            MovementHistoryService._historyLengths.delete(tokenId);
            MovementHistoryService._lastCoords.delete(tokenId);
        } else {
            MovementHistoryService._capturedHistory.clear();
            MovementHistoryService._lastInteractionDistance.clear();
            MovementHistoryService._historyLengths.clear();
            MovementHistoryService._lastCoords.clear();
        }
    }

    /**
     * Retrieves the manual history capture for a token.
     */
    static getCapturedHistory(tokenId: string) {
        return MovementHistoryService._capturedHistory.get(tokenId);
    }

    static setCapturedHistory(tokenId: string, captured: any[]) {
        MovementHistoryService._capturedHistory.set(tokenId, captured);
    }

    static getLastInteractionDistance(tokenId: string): number {
        return MovementHistoryService._lastInteractionDistance.get(tokenId) || 0;
    }

    static setLastInteractionDistance(tokenId: string, distance: number) {
        MovementHistoryService._lastInteractionDistance.set(tokenId, distance);
    }

    static getLastCoords(tokenId: string): any[] {
        return MovementHistoryService._lastCoords.get(tokenId) || [];
    }

    static getHistoryLength(tokenId: string): number {
        return MovementHistoryService._historyLengths.get(tokenId) || 0;
    }

    static storeMovement(tokenDoc: any, coordList: any[]) {
        MovementHistoryService._lastCoords.set(tokenDoc.id, coordList);
        MovementHistoryService._historyLengths.set(tokenDoc.id, coordList.length);
    }

    static checkDifficultTerrain(token: any, coordList: any[]): boolean {
        if (!canvas.regions) return false;
        const lastPoint = coordList[coordList.length - 1];
        if (!lastPoint) return false;

        return (canvas.regions as any).placeables.some((r: any) =>
            r.document.behaviors.some((b: any) => !b.disabled && b.type === "environmentFeature") &&
            token.testInsideRegion(r, lastPoint)
        );
    }

    static getMovementLabel(distance: number, cost: number, mode: string, isDifficult: boolean) {
        if (distance === 5 && cost === 1 && !isDifficult && mode === "stride") {
            return 'Step';
        }
        const capitalized = mode.charAt(0).toUpperCase() + mode.slice(1);
        return `${capitalized}: ${distance}ft`;
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
}
