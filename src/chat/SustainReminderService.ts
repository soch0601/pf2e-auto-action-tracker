import type { CombatantPF2e } from "module-helpers";
import { SCOPE } from "../globals.ts";
import { SettingsManager } from "../SettingsManager.ts";
import { DBManager } from "../DBManager.ts";
import { renderHandlebarsTemplate } from "../foundryCompat.ts";
import { SummonManager } from "../summons/index.ts";

export class SustainReminderService {
    /**
     * Checks if any sustained items exist on this combatant and renders reminder cards in chat.
     * When Summons Tracking is enabled, if one or more summoned minions on the scene were summoned by
     * a sustained spell (even if the same spell was cast twice, e.g. two Summon Undead castings),
     * generates an individual Sustain Reminder card per minion token
     */
    static async checkSustainReminder(combatant: CombatantPF2e): Promise<void> {
        if (!SettingsManager.get("whisperSustain")) return;

        const c = combatant as any;
        const actor = c.actor;
        if (!actor?.name) return;

        const sustainData = DBManager.getSustainData(combatant);
        const minions = SummonManager.isEnabled()
            ? SummonManager.getSummonedMinionsForCombatant(combatant)
            : [];

        const gmUserIds = game.users.filter((u: any) => u.isGM).map((u: any) => u.id);
        const ownerUserIds = Object.entries(actor.ownership || {})
            .filter(([id, level]) => level === 3 && id !== "default")
            .map(([id]) => id);
        const whisperUserIds = Array.from(new Set([...gmUserIds, ...ownerUserIds]));

        const emittedMinionTokenIds = new Set<string>();

        if (Object.keys(sustainData).length > 0) {
            const sustainEntries = Object.entries(sustainData);
            for (const [itemId, itemName] of sustainEntries) {
                const lowerItemName = (itemName || "").toLowerCase();
                const isExplicitMatch = (m: any) => {
                    const mItemId = m.getFlag(SCOPE, "summonedByItemId");
                    const mItemName = ((m.getFlag(SCOPE, "summonedByItemName") as string) || "").toLowerCase();
                    if (mItemId && mItemId === itemId) return true;
                    if (!mItemId && mItemName && lowerItemName && (mItemName === lowerItemName || lowerItemName.includes(mItemName) || mItemName.includes(lowerItemName))) {
                        return true;
                    }
                    return false;
                };

                // If every minion summoned by this spell is defeated (0 HP) or its token is gone, the summon has been
                // banished and there is nothing left to sustain: drop the spell from the sustain list and don't prompt
                // auser to sustain (because there is no point, but not strictly RAW)
                const linkedTokenIds = SummonManager.isEnabled()
                    ? SummonManager.getLinkedMinionTokenIdsForSpell(combatant, itemId, itemName)
                    : new Set<string>();
                const explicitMatches = minions.filter(m => isExplicitMatch(m) || linkedTokenIds.has(m.tokenId));
                if (linkedTokenIds.size > 0 || explicitMatches.length > 0) {
                    const aliveLinked = explicitMatches.filter(m => !m.isDefeated);
                    if (aliveLinked.length === 0) {
                        await DBManager.updateLogs(combatant, DBManager.getLog(combatant), true, itemId);
                        continue;
                    }
                }

                // Check if any active summoned minions on the scene were summoned by this spell itemId or spell name
                let matchingMinions = minions.filter(m =>
                    !emittedMinionTokenIds.has(m.tokenId) && !m.isDefeated && (isExplicitMatch(m) || linkedTokenIds.has(m.tokenId))
                );

                // Fallback: if there is only 1 sustained spell entry in sustainData and we have summoned minions
                // whose summonedByItemId/Name was not captured (e.g. summoned before reload), associate them with this sustained spell!
                if (matchingMinions.length === 0 && sustainEntries.length === 1 && minions.length > 0) {
                    matchingMinions = minions.filter(m => !emittedMinionTokenIds.has(m.tokenId) && !m.isDefeated);
                }

                if (matchingMinions.length > 0) {
                    for (const minion of matchingMinions) {
                        emittedMinionTokenIds.add(minion.tokenId);
                        const baseSpellName = itemName.replace(/\s*\([^)]*\)\s*$/, "");
                        const displayItemName = `${baseSpellName} (${minion.name})`;
                        const content = await renderHandlebarsTemplate(`modules/${SCOPE}/templates/sustain-reminder.hbs`, {
                            combatantId: c.id,
                            actorId: actor.id,
                            itemId: itemId,
                            itemName: displayItemName,
                            minionTokenId: minion.tokenId
                        });

                        await ChatMessage.create({
                            content: content,
                            whisper: whisperUserIds,
                            speaker: ChatMessage.getSpeaker({ actor: actor })
                        });
                    }
                } else {
                    const content = await renderHandlebarsTemplate(`modules/${SCOPE}/templates/sustain-reminder.hbs`, {
                        combatantId: c.id,
                        actorId: actor.id,
                        itemId: itemId,
                        itemName: itemName
                    });

                    await ChatMessage.create({
                        content: content,
                        whisper: whisperUserIds,
                        speaker: ChatMessage.getSpeaker({ actor: actor })
                    });
                }
            }
        }
    }
}
