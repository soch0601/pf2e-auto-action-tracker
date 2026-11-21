import type { CombatantPF2e } from "module-helpers";
import { SCOPE } from "../globals.ts";
import { SettingsManager } from "../SettingsManager.ts";
import { DBManager } from "../DBManager.ts";
import { renderHandlebarsTemplate } from "../foundryCompat.ts";

export class SustainReminderService {
    /**
     * Checks if any sustained items exist on this combatant and renders reminder cards in chat.
     */
    static async checkSustainReminder(combatant: CombatantPF2e): Promise<void> {
        if (!SettingsManager.get("whisperSustain")) return;

        const c = combatant as any;
        const actor = c.actor;
        if (!actor?.name) return;

        const sustainData = DBManager.getSustainData(combatant);

        if (Object.keys(sustainData).length > 0) {
            for (const [itemId, itemName] of Object.entries(sustainData)) {
                const content = await renderHandlebarsTemplate(`modules/${SCOPE}/templates/sustain-reminder.hbs`, {
                    combatantId: c.id,
                    actorId: actor.id,
                    itemId: itemId,
                    itemName: itemName
                });

                const gmUserIds = game.users.filter((u: any) => u.isGM).map((u: any) => u.id);
                const ownerUserIds = Object.entries(actor.ownership || {})
                    .filter(([id, level]) => level === 3 && id !== "default")
                    .map(([id]) => id);
                const whisperUserIds = Array.from(new Set([...gmUserIds, ...ownerUserIds]));

                await ChatMessage.create({
                    content: content,
                    whisper: whisperUserIds,
                    speaker: ChatMessage.getSpeaker({ actor: actor })
                });
            }
        }
    }
}
