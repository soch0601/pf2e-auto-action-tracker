import { SocketUtils } from "./socketUtils.ts";

export class SocketSender {
    /**
     * Outgoing call to GM to add an action
     */
    static async sendAddAction(combatantId: string, action: any): Promise<any> {
        if (!SocketUtils.socket) return;
        return await SocketUtils.socket.executeAsGM("addAction", { combatantId, action });
    }

    /**
     * Outgoing call to GM to edit an action
     */
    static async sendEditAction(combatantId: string, msgId: string, updates: any): Promise<any> {
        if (!SocketUtils.socket) return;
        return await SocketUtils.socket.executeAsGM("editAction", { combatantId, msgId, updates });
    }

    /**
     * Outgoing call to GM to remove an action
     */
    static async sendRemoveAction(combatantId: string, msgId: string, isRecursive = false): Promise<any> {
        if (!SocketUtils.socket) return;
        return await SocketUtils.socket.executeAsGM("removeAction", { combatantId, msgId, isRecursive });
    }

    /**
     * Outgoing call to GM to complete a complex action
     */
    static async sendCompleteComplexAction(combatantId: string, action: any): Promise<any> {
        if (!SocketUtils.socket) return;
        return await SocketUtils.socket.executeAsGM("completeComplexAction", { combatantId, action });
    }

    /**
     * Outgoing call to GM to process movement
     */
    static sendMovement(payload: any): void {
        if (!SocketUtils.socket) return;
        SocketUtils.socket.executeAsGM("processMovement", payload);
    }

    /**
     * Outgoing call to GM to queue a reroll
     */
    static sendQueueReroll(combatantId: string, msgId: string): void {
        if (!SocketUtils.socket) return;
        SocketUtils.socket.executeAsGM("queueReroll", { combatantId, msgId });
    }

    /**
     * Outgoing call to GM to process sustain choice
     */
    static emitSustainChoice(payload: any): void {
        if (!SocketUtils.socket) return;
        SocketUtils.socket.executeAsGM("processSustain", payload);
    }

    /**
     * Outgoing call to GM to reset sustain choice
     */
    static emitResetSustainChoice(payload: any): void {
        if (!SocketUtils.socket) return;
        SocketUtils.socket.executeAsGM("resetSustainChoice", payload);
    }

    /**
     * Outgoing broadcast to everyone to reset movement history
     */
    static broadcastResetMovementHistory(tokenId?: string): void {
        if (!SocketUtils.socket) return;
        SocketUtils.socket.executeForEveryone("resetMovementHistory", { tokenId });
    }

    /**
     * Outgoing broadcast to everyone to whisper/alert
     */
    static broadcastWhisper(payload: any): void {
        if (!SocketUtils.socket) return;
        SocketUtils.socket.executeForEveryone("attemptWhisper", payload);
    }

    /**
     * Outgoing call to GM to toggle manual action grant on a summoned minion
     */
    static async sendToggleMinionGrant(combatantId: string): Promise<any> {
        if (!SocketUtils.socket) return;
        return await SocketUtils.socket.executeAsGM("toggleMinionGrant", { combatantId });
    }
}
