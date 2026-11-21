import { logError } from "../logger.ts";

export class ChatMessageService {
    /**
     * Delete a single chat message by ID safely.
     */
    static async deleteMessage(msgId: string): Promise<void> {
        const msg = game.messages.get(msgId);
        if (msg) {
            try {
                await (msg as any).delete({});
            } catch (err) {
                logError(`ChatMessageService | FAILED to delete message ${msgId}:`, err);
            }
        }
    }

    /**
     * Delete multiple chat messages by IDs.
     */
    static async deleteMessages(msgIds: string[]): Promise<void> {
        await Promise.allSettled(msgIds.map(id => this.deleteMessage(id)));
    }
}
