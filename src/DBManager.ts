import { SCOPE } from "./globals.ts";
import { ActorManager } from "./ActorManager.ts";
import { SettingsManager } from "./SettingsManager.ts";
import { isCurrentUserActiveGM } from "./foundryCompat.ts";
import { type ActionLogEntry, getEntryCost } from "./ActionLogTypes.ts";
import { AlertService } from "./chat/AlertService.ts";
import { SummonManager } from "./summons/index.ts";
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

        const actionsSpent = newLogs.filter(e => e.type !== 'reaction').reduce((sum, e) => sum + getEntryCost(e, newLogs), 0);
        const reactionsSpent = newLogs.filter(e => e.type === 'reaction').reduce((sum, e) => sum + getEntryCost(e, newLogs), 0);

        const hasQuickenedSnapshot = ActorManager.hasQuickenedSnapshot(combatant);

        const updateData: Record<string, any> = {
            [`flags.${SCOPE}.log`]: newLogs,
            [`flags.${SCOPE}.actionsSpent`]: actionsSpent,
            [`flags.${SCOPE}.reactionsSpent`]: reactionsSpent,
            [`flags.${SCOPE}.isQuickenedSnapshot`]: hasQuickenedSnapshot
        };

        // Because c.update(updateData, { diff: false, recursive: false }) replaces the entire `flags[SCOPE]` object
        // in Foundry when top-level keys are updated, preserve any existing minion-specific flags on the document!
        const existingScopeFlags = c.flags?.[SCOPE];
        if (existingScopeFlags && typeof existingScopeFlags === "object") {
            for (const [key, val] of Object.entries(existingScopeFlags)) {
                const fullKey = `flags.${SCOPE}.${key}`;
                if (!(fullKey in updateData) && key !== "sustainData") {
                    updateData[fullKey] = val;
                }
            }
        } else if (typeof c.getFlag === "function") {
            const preservedKeys = [
                "minions",
                "grantedActions",
                "grantedByMsgId",
                "summonerActorId",
                "summonedByItemId",
                "summonedByItemName",
                "stunnedDecrement",
                "lastOverspendAlert",
                "lastReactionOverspendAlert"
            ];
            for (const key of preservedKeys) {
                const val = c.getFlag(SCOPE, key);
                if (val !== undefined) {
                    updateData[`flags.${SCOPE}.${key}`] = val;
                }
            }
        }

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

        // If this is a minion, filter out any reaction entries (minions have 0 reaction slots and cannot use reactions)
        if (SummonManager.isMinion(combatant)) {
            newLogs = newLogs.filter(e => e.type !== 'reaction');
            updateData[`flags.${SCOPE}.log`] = newLogs;
            updateData[`flags.${SCOPE}.reactionsSpent`] = 0;
        }

        // --- Overspend Logic ---
        if (!skipOverspendCheck) {
            const economyUpdate = this.checkOverspend(combatant, newLogs);
            if (economyUpdate) {
                updateData[`flags.${SCOPE}.lastOverspendAlert`] = economyUpdate.lastOverspendAlert;
            }
            const reactionEconomyUpdate = this.checkReactionOverspend(combatant, newLogs);
            if (reactionEconomyUpdate) {
                updateData[`flags.${SCOPE}.lastReactionOverspendAlert`] = reactionEconomyUpdate.lastReactionOverspendAlert;
            }
        }

        await c.update(updateData, { diff: false, recursive: false });
    }

    /**
      * Logic to determine if an over spending alert should be sent for actions.
      */
    static checkOverspend(combatant: CombatantPF2e, newLogs: ActionLogEntry[]): { lastOverspendAlert: number } | null {
        const c = combatant as any;
        const actor = c.actor;
        if (!actor || !SettingsManager.get("whisperOverspend") || !isCurrentUserActiveGM()) return null;

        const { overspent } = ActorManager.allocateSlots(combatant, newLogs, 'action');

        const actionLog = newLogs.filter(e => e.type !== 'reaction');
        const rawTotalSpent = actionLog.reduce((sum, e) => sum + getEntryCost(e, newLogs), 0);

        if (overspent.length > 0) {
            const isMinion = SummonManager.isMinion(combatant);
            const isUncommanded = isMinion && SummonManager.getGrantedActions(combatant) === 0;
            const reason = isUncommanded
                ? `Spent actions before being Sustained or Commanded (${overspent.map(o => o.label).join(', ')}).`
                : `Spent actions that exceeded available slots (${overspent.map(o => o.label).join(', ')}).`;
            const lastAlert = (c.getFlag(SCOPE, "lastOverspendAlert") as number) || 0;
            if (rawTotalSpent > lastAlert) {
                const alertActor = SummonManager.getAlertTargetActor(combatant) ?? actor;
                AlertService.triggerAlert(alertActor, "Economy Alert", `**${c.name || actor.name}**: ${reason}`, 'whisperOverspend');
            }
            return { lastOverspendAlert: rawTotalSpent };
        }
        return null;
    }

    /**
      * Logic to determine if an over spending alert should be sent for reactions. 
      */
    static checkReactionOverspend(combatant: CombatantPF2e, newLogs: ActionLogEntry[]): { lastReactionOverspendAlert: number } | null {
        const c = combatant as any;
        const actor = c.actor;
        if (!actor || !SettingsManager.get("whisperReactionOverspend") || !isCurrentUserActiveGM()) return null;
        if (SummonManager.isMinion(combatant)) return null;

        const { overspent } = ActorManager.allocateSlots(combatant, newLogs, 'reaction');
        const realOverspent = overspent.filter(o => o.category !== 'system' && o.msgId !== 'System');

        if (realOverspent.length > 0) {
            const rawReactionSpent = realOverspent.length;
            const lastAlert = (c.getFlag(SCOPE, "lastReactionOverspendAlert") as number) || 0;
            if (rawReactionSpent > lastAlert) {
                const reason = `Spent reactions that exceeded available slots (${realOverspent.map(o => o.label).join(', ')}).`;
                const alertActor = SummonManager.getAlertTargetActor(combatant) ?? actor;
                AlertService.triggerAlert(alertActor, "Economy Alert", `**${c.name || actor.name}**: ${reason}`, 'whisperReactionOverspend');
            }
            return { lastReactionOverspendAlert: rawReactionSpent };
        }
        return null;
    }
}
