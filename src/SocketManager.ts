import { SCOPE } from "./globals.ts";
import { ChatManager } from "./ChatManager.ts";
import { SettingsManager } from "./SettingsManager.ts";
import { notifyWarn } from "./logger.ts";
import { MovementManager } from "./MovementManager.ts";
import { logInfo } from "./logger.ts";

export class SocketsManager {
    static socket: any;

    static initSockets() {
        // @ts-ignore
        this.socket = socketlib.registerModule(SCOPE);

        // Register Sustain (Player -> GM)
        this.socket.register("processSustain", this._handleSustainRequest.bind(this));
        // Register Whisper (GM -> Everyone)
        this.socket.register("ATTEMPT_WHISPER", this.handleSocketWhisper.bind(this));
        // Register Movement (Player -> GM)
        this.socket.register("processMovement", this._handleMovementRequest.bind(this));
        // Register Remove Action (Player -> GM)
        this.socket.register("removeAction", this._handleRemoveActionRequest.bind(this));
        // Register Reset History (Any -> Everyone)
        this.socket.register("resetMovementHistory", this._handleResetHistoryRequest.bind(this));
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
            if (data.choice === "yes") {
                await ChatManager.processSustainYes(actor, data.itemId, data.itemName, data.combatantId);
            } else {
                const combatant = game.combat?.combatants.get(data.combatantId);
                await ChatManager.processSustainNo(actor, data.itemId, combatant);
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
        await ActionManager.removeAction(combatant as any, data.msgId);
    }

    /**
     * Handler for history reset sent from another client
     */
    private static _handleResetHistoryRequest(data: any) {
        logInfo(`[Socket] Received History Reset | Token: ${data.tokenId || "ALL"} | Current User: ${game.user?.name}`);
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