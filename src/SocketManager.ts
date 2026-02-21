import { SCOPE } from "./globals";
import { ChatManager } from "./ChatManager";
import { SettingsManager } from "./SettingsManager";

export class SocketsManager {
    static socket: any;

    static initSockets() {
        // @ts-ignore
        this.socket = socketlib.registerModule(SCOPE);

        // Register Sustain (Player -> GM)
        this.socket.register("processSustain", this._handleSustainRequest.bind(this));
        // Register Whisper (GM -> Everyone)
        this.socket.register("ATTEMPT_WHISPER", this.handleSocketWhisper.bind(this));
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
        if (setting && !SettingsManager.get(setting)) return; // Setting is turned off, ignore

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