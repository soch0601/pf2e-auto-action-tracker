import { SCOPE } from "./globals";
import { ActorManager } from "./ActorManager";
import { SettingsManager } from "./SettingsManager";
import { isCurrentUserActiveGM } from "./foundryCompat";
import type { ActionLogEntry } from "./ActionLogTypes";
import type { CombatantPF2e } from "module-helpers";

export class DBManager {
    /**
     * Get the internal logs from the combatant
     */
    static getLog(combatant: CombatantPF2e): ActionLogEntry[] {
        return ((combatant as any).getFlag(SCOPE, "log") as ActionLogEntry[]) || [];
    }

    /**
     * Check if the combatant has a quickened snapshot
     */
    static isQuickened(combatant: CombatantPF2e): boolean {
        return !!(combatant as any).getFlag(SCOPE, "isQuickenedSnapshot");
    }

    /**
     * Get the sustain data from the combatant
     */
    static getSustainData(combatant: CombatantPF2e): Record<string, string> {
        return ((combatant as any).getFlag(SCOPE, "sustainData") as Record<string, string>) || {};
    }

    /**
     * Handle filing data to the database and rerendering the combat UI to show the updates
     */
    static async updateLogs(
        combatant: CombatantPF2e,
        newLogs: ActionLogEntry[],
        skipOverspendCheck: boolean,
        removeSustainId?: string,
        extraFlags?: Record<string, any>
    ) {
        if (!isCurrentUserActiveGM()) return;

        const c = combatant as any;
        const { ActionManager } = await import("./ActionManager");

        const actionsSpent = newLogs.filter(e => e.type !== 'reaction').reduce((sum, e) => sum + ActionManager.getEntryCost(e, newLogs), 0);
        const reactionsSpent = newLogs.filter(e => e.type === 'reaction').reduce((sum, e) => sum + ActionManager.getEntryCost(e, newLogs), 0);

        const hasQuickenedSnapshot = ActorManager.hasQuickenedSnapshot(combatant);

        const updateData: Record<string, any> = {
            [`flags.${SCOPE}.log`]: newLogs,
            [`flags.${SCOPE}.actionsSpent`]: actionsSpent,
            [`flags.${SCOPE}.reactionsSpent`]: reactionsSpent,
            [`flags.${SCOPE}.isQuickenedSnapshot`]: hasQuickenedSnapshot
        };

        if (extraFlags) {
            Object.assign(updateData, extraFlags);
        }

        // 1. Get the PERSISTENT registry
        let sustainMap = { ...(c.getFlag(SCOPE, "sustainData") || {}) };

        // 2. Handle Removal
        if (removeSustainId) {
            delete sustainMap[removeSustainId];
        }

        // 3. Handle Sustain additions
        newLogs.forEach(entry => {
            if (entry.sustainItem && entry.sustainItem.id !== removeSustainId) {
                sustainMap[entry.sustainItem.id] = entry.sustainItem.name;
            }
        });

        // 4. Always update the registry
        updateData[`flags.${SCOPE}.sustainData`] = sustainMap;

        // --- Overspend Logic ---
        if (!skipOverspendCheck) {
            const economyUpdate = await this.checkOverspend(combatant, newLogs);
            if (economyUpdate) {
                updateData[`flags.${SCOPE}.lastOverspendAlert`] = economyUpdate.lastOverspendAlert;
            }
            await this.checkReactionOverspend(combatant, newLogs);
        }

        await c.update(updateData, { diff: false, recursive: false });
    }

    /**
      * Logic to determine if an over spending alert should be sent for actions.
      */
    static async checkOverspend(combatant: CombatantPF2e, newLogs: ActionLogEntry[]): Promise<{ lastOverspendAlert: number } | null> {
        const c = combatant as any;
        const actor = c.actor;
        if (!actor || !SettingsManager.get("whisperOverspend") || !isCurrentUserActiveGM()) return null;

        const { overspent } = ActorManager.allocateSlots(combatant, newLogs, 'action');

        const { ActionManager } = await import("./ActionManager");
        const actionLog = newLogs.filter(e => e.type !== 'reaction');
        const rawTotalSpent = actionLog.reduce((sum, e) => sum + ActionManager.getEntryCost(e, newLogs), 0);

        if (overspent.length > 0) {
            const reason = `Spent actions that exceeded available slots (${overspent.map(o => o.label).join(', ')}).`;
            const lastAlert = (c.getFlag(SCOPE, "lastOverspendAlert") as number) || 0;
            if (rawTotalSpent > lastAlert) {
                const { ChatManager } = await import("./ChatManager");
                await ChatManager.triggerAlert(actor, "Economy Alert", `**${actor.name}**: ${reason}`, 'whisperOverspend');
            }
            return { lastOverspendAlert: rawTotalSpent };
        }
        return null;
    }

    /**
      * Logic to determine if an over spending alert should be sent for reactions. 
      */
    static async checkReactionOverspend(combatant: CombatantPF2e, newLogs: ActionLogEntry[]) {
        const c = combatant as any;
        const actor = c.actor;
        if (!actor || !SettingsManager.get("whisperReactionOverspend") || !isCurrentUserActiveGM()) return;

        const { overspent } = ActorManager.allocateSlots(combatant, newLogs, 'reaction');

        if (overspent.length > 0) {
            const reason = `Spent reactions that exceeded available slots (${overspent.map(o => o.label).join(', ')}).`;
            const { ChatManager } = await import("./ChatManager");
            await ChatManager.triggerAlert(actor, "Economy Alert", `**${actor.name}**: ${reason}`, 'whisperReactionOverspend');
        }
    }
}
