import { SCOPE } from "./globals";
import { ChatManager } from "./ChatManager";

export class SocketsManager {
    static socket: any;

    static initSockets() {
        // @ts-ignore
        this.socket = socketlib.registerModule(SCOPE);

        // Register the function the GM will execute
        this.socket.register("processSustain", this._handleSustainRequest.bind(this));
    }

    /**
     * The actual logic that runs ON THE GM'S MACHINE
     */
    private static async _handleSustainRequest(data: any) {

        const msg = game.messages.get(data.messageId);
        if (msg) {
            await (msg as any).setFlag(SCOPE, "sustainChoice", {
                choice: data.choice,
                itemName: data.itemName
            });
        }

        const actor = (game.actors as any).get(data.actorId);
        if (actor) {
            if (data.choice === "yes") {
                await ChatManager.processSustainYes(actor, data.itemId, data.itemName);
            } else {
                await ChatManager.processSustainNo(actor, data.itemId);
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
}