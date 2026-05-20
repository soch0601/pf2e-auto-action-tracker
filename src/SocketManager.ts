import { SCOPE } from "./globals.ts";
import { SettingsManager } from "./SettingsManager.ts";
import { logError, notifyWarn } from "./logger.ts";

declare const socketlib: any;

export class SocketsManager {
    static socket: any;

    static initSockets() {
        if (typeof socketlib === 'undefined') {
            logError("socketlib not found! Multi-user synchronization will be disabled.");
            return;
        }
        // @ts-ignore
        this.socket = socketlib.registerModule(SCOPE);

        // Register Sustain (Player -> GM)
        this.socket.register("processSustain", this._handleSustainRequest.bind(this));
        // Register Whisper (GM -> Everyone)
        this.socket.register("attemptWhisper", this.handleSocketWhisper.bind(this));
        // Register Movement (Player -> GM)
        this.socket.register("processMovement", this._handleMovementRequest.bind(this));
        // Register Remove Action (Player -> GM)
        this.socket.register("removeAction", this._handleRemoveActionRequest.bind(this));
        // Register Reset History (Any -> Everyone)
        this.socket.register("resetMovementHistory", this._handleResetHistoryRequest.bind(this));
        // Register Add Action (Player -> GM)
        this.socket.register("addAction", this._handleAddActionRequest.bind(this));
        // Register Edit Action (Player -> GM)
        this.socket.register("editAction", this._handleEditActionRequest.bind(this));
        // Register Complete Complex Action (Player -> GM)
        this.socket.register("completeComplexAction", this._handleCompleteComplexActionRequest.bind(this));
        // Register Queue Reroll (Player -> GM)
        this.socket.register("queueReroll", this._handleQueueRerollRequest.bind(this));
    }

    /**
     * The actual logic that runs ON THE GM'S MACHINE
     */
    private static async _handleSustainRequest(data: any) {

        const msg = game.messages.get(data.messageId);
        if (msg) {
            await (msg as any).setFlag(SCOPE, "sustainChoice", {
                choice: data.choice,
                itemName: data.itemName,
                combatantId: data.combatantId
            });
        }

        const actor = (game.actors as any).get(data.actorId);
        if (actor) {
            const { ChatCardRenderer } = await import("./ChatCardRenderer.ts");
            if (data.choice === "yes") {
                await ChatCardRenderer.processSustainYes(actor, data.itemId, data.itemName, data.combatantId);
            } else {
                const combatant = game.combat?.combatants.get(data.combatantId);
                await ChatCardRenderer.processSustainNo(actor, data.itemId, combatant);
            }
        }
    }

    /**
     * GM-side handler for movement data sent from a player client
     */
    private static async _handleMovementRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = game.combat?.combatants.get(data.combatantId);
        const tokenDoc = game.scenes.active?.tokens.get(data.tokenId);
        if (!combatant || !tokenDoc) return;

        const { MovementManager } = await import("./MovementManager.ts");
        // Process the movement with the data provided by the player
        await MovementManager.processMovementFromData(combatant as any, tokenDoc, data);
    }

    /**
     * GM-side handler for action removal sent from a player client
     */
    private static async _handleRemoveActionRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = game.combat?.combatants.get(data.combatantId);
        if (!combatant) return;

        const { ActionManager } = await import("./ActionManager.ts");
        await ActionManager.removeAction(combatant as any, data.msgId, data.isRecursive);
    }

    /**
     * GM-side handler for adding an action sent from a player client
     */
    private static async _handleAddActionRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = game.combat?.combatants.get(data.combatantId);
        if (!combatant) return;

        const { ActionManager } = await import("./ActionManager.ts");
        await ActionManager.addAction(combatant as any, data.action);
    }

    /**
     * GM-side handler for editing an action sent from a player client
     */
    private static async _handleEditActionRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = game.combat?.combatants.get(data.combatantId);
        if (!combatant) return;

        const { ActionManager } = await import("./ActionManager.ts");
        await ActionManager.editAction(combatant as any, data.msgId, data.updates);
    }

    /**
     * GM-side handler for completing a complex action sent from a player client
     */
    private static async _handleCompleteComplexActionRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = game.combat?.combatants.get(data.combatantId);
        if (!combatant) return;

        const { ActionManager } = await import("./ActionManager.ts");
        await ActionManager.completeComplexAction(combatant as any, data.action);
    }

    /**
     * GM-side handler for adding a reroll to the queue sent from a player client
     */
    private static async _handleQueueRerollRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const { ChatManager } = await import("./ChatManager.ts");
        ChatManager.addToRerollQueue(data.combatantId, data.msgId);
    }

    /**
     * Handler for history reset sent from another client
     */
    private static async _handleResetHistoryRequest(data: any) {
        const { MovementManager } = await import("./MovementManager.ts");
        MovementManager.resetCapturedHistory(data.tokenId);
    }

    /**
     * Called by the player's UI
     */
    static emitSustainChoice(payload: any) {
        // This automatically finds the active GM and runs the function there
        this.socket.executeAsGM("processSustain", payload);
    }

    static async handleSocketWhisper(data: { targetPlayerIds: string[], header: string, message: string, setting: string }) {
        const { targetPlayerIds, header, message, setting } = data;
        const user = (game as any).user;

        const isTarget = targetPlayerIds.includes(user.id);
        const isGM = user.isGM;

        if (!isTarget && !isGM) return; // Ignore if current client is not a GM or not the target

        const isEnabled = SettingsManager.get(setting);
        if (setting && !isEnabled) return; // Setting is turned off, ignore

        // Trigger the UI notification popup
        notifyWarn(`${header}: ${message}`);

        // Create a LOCAL-ONLY chat message. 
        // Because this runs on the recipient's machine, only they see it.
        await ChatMessage.create({
            content: `<div class="pf2e-auto-action-tracker-alert"><strong>${header}:</strong> ${message}</div>`,
            whisper: [user.id],
            speaker: { alias: "PF2E Action Tracker" },
            flags: {
                [SCOPE]: { isAutoAlert: true }
            } as any
        });
    }
}