import type { ActorPF2e } from "module-helpers";
import { SocketSender } from "../sockets/SocketSender.ts";

export class AlertService {
    /**
     * Broadcasts an economy or action alert (whisper or banner) to relevant owners and GM.
     */
    static async triggerAlert(actor: ActorPF2e, header: string, message: string, settingKey: string): Promise<void> {
        const playerIds = Object.entries(actor.ownership || {})
            .filter(([id, level]) => level === 3 && id !== "default")
            .map(([id]) => id);

        const payload = {
            targetPlayerIds: playerIds,
            header,
            message,
            setting: settingKey
        };

        SocketSender.broadcastWhisper(payload);
    }
}
