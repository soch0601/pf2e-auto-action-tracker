import { SCOPE } from "./globals";
import { logConsole } from "./logger";
import { SettingsManager } from "./SettingsManager";
import { ActorHandler } from "./ActorHandler";
import { ChatManager } from "./ChatManager";
import { MovementManager } from "./MovementManager";
import { ActorPF2e, CombatantPF2e } from "module-helpers";

export interface ActionLogEntry {
    cost: number,
    msgId: string,
    label: string,
    type: 'action' | 'reaction' | 'system' | 'bonus';
    isQuickenedEligible: boolean
    sustainItem?: { id: string, name: string };
}

export class ActionManager {

    // Buffer: key is `${actorId}-${msgId}`
    private static _sustainBuffer = new Map<string, { id: string, name: string }>();

    /**
     * READ-ONLY ACCESSORS
     * We return clones to prevent external mutation of the flag data.
     */
    static getActions(combatant: CombatantPF2e): ReadonlyArray<ActionLogEntry> {
        return Object.freeze(this._getInternalLog(combatant));
    }

    static getActionById(combatant: CombatantPF2e, msgId: string): ActionLogEntry | undefined {
        return this._getInternalLog(combatant).find(e => e.msgId === msgId);
    }

    static getLastAction(combatant: CombatantPF2e): ActionLogEntry | undefined {
        const logs = this._getInternalLog(combatant);
        return logs[logs.length - 1];
    }

    /**
     * It was determined there is something to sustain - track it for later filing on the next action
     */
    static trackSustain(actor: ActorPF2e, msgId: string, itemId: string, itemName: string) {
        const key = `${actor.id}-${msgId}`;
        this._sustainBuffer.set(key, { id: itemId, name: itemName });
    }

    /**
     * Handle start of turn shenanigans, including resetting the previous round's actions and getting the
     * fresh list of actions to spend for this round
     */
    static async handleStartOfTurn(combatant: CombatantPF2e) {
        const c = combatant as any;
        const actor: ActorPF2e = c.actor;
        if (!actor) return;

        // 1. Snapshot conditions
        ActorHandler.handleStartOfTurn(actor);

        // 2. Get Cleaned Condition Data - Important to do before decrementing stunned so we know value of stunned...
        const { logEntries, actionsSpent, reactionsSpent } = this.calculateStartOfTurnDrains(actor);

        // 3. RAW Stunned Logic: Decrement before calculating turn resources
        const stunnedCondition = actor.itemTypes.condition.find(c => c.slug === "stunned");
        let stunnedCost = 0;

        if (stunnedCondition) {
            const currentVal = (stunnedCondition.value ?? 0);
            const maxActions = ActorHandler.getMaxActions(actor);
            stunnedCost = Math.min(currentVal, maxActions);

            // Update the actual condition on the actor
            const newVal = currentVal - stunnedCost;
            if (newVal <= 0) {
                await stunnedCondition.delete();
            } else {
                await stunnedCondition.update({ "system.value.value": newVal } as any);
            }
            logConsole(`RAW: Decremented Stunned on ${actor.name} by ${stunnedCost}.`);
        }

        await c.update({
            [`flags.${SCOPE}.log`]: logEntries,
            [`flags.${SCOPE}.actionsSpent`]: actionsSpent,
            [`flags.${SCOPE}.reactionsSpent`]: reactionsSpent,
            [`flags.${SCOPE}.lastOverspendAlert`]: 0
        });

        // Now checkSustainReminder will find the data preserved in the registry!
        await ChatManager.checkSustainReminder(actor);
    }

    /**
     * Handle end of turn shenanigans, including decrement stunned.  Per RAW in PF2E - this should be done at the
     * beginning of the turn.  But done at the end for user's visual confirmation
     */
    static async handleEndOfTurn(combatant: CombatantPF2e) {
        const actor = (combatant as any).actor;
        if (!actor) return;

        // Check for underspend to alert the player they had actions left
        const log = this.getActions(combatant);
        await this.checkUnderSpend(combatant, log);

        // Stunned logic is removed from here because it's now handled at Start of Turn per RAW.
    }

    /**
     * Add a new ActionLogEntry to the action log for the current turn
     */
    static async addAction(combatant: CombatantPF2e, action: ActionLogEntry) {

        if (action.msgId) {
            const actorId = (combatant as any).actorId;
            const key = `${actorId}-${action.msgId}`;

            // 1. Check if this specific message has sustain data attached
            const pendingSustain = this._sustainBuffer.get(key);
            if (pendingSustain) {
                action.sustainItem = pendingSustain;
                this._sustainBuffer.delete(key); // Consume the buffer
            }
        }

        // We clone the frozen log into a mutable array to modify it
        const currentLog = [...this.getActions(combatant)];
        currentLog.push(action);

        // always check overSpend alert on adding actions
        await this._updateLogs(combatant, currentLog, false);
    }

    /**
     * Edit an existingActionLogEntry to the action log for the current turn
     */
    static async editAction(combatant: CombatantPF2e, msgId: string, updates: Partial<ActionLogEntry>) {
        const log = this.getActions(combatant);
        const index = log.findIndex(e => e.msgId === msgId);
        // Safety guard - 
        if (index === -1) return;

        const newLog = [...log];
        newLog[index] = { ...newLog[index], ...updates };

        const isMove = MovementManager.isMoveAction(msgId);
        // If it's a move, skip economy checks (we don't want to spam alerts while dragging)
        await this._updateLogs(combatant, newLog, isMove);
    }

    /**
     * Remove an existing ActionLogEntry from the action log for the current turn
     */
    static async removeAction(combatant: CombatantPF2e, msgId: string, index?: number): Promise<void> {
        const currentLog = [...this.getActions(combatant)];

        // 1. Determine the target index
        let targetIndex = msgId ? currentLog.findIndex(e => e.msgId === msgId) : (index ?? -1);

        // 2. SAFETY GUARD: If index is invalid, just exit
        if (targetIndex < 0 || targetIndex >= currentLog.length) return;

        // 3. Perform the removal
        const removedEntry = currentLog.splice(targetIndex, 1)[0];

        logConsole([`Undoing: ${removedEntry.label}`]);

        // Pass 'true' to skipEconomyCheck so we don't whisper alerts during an undo
        await this._updateLogs(combatant, currentLog, true);
    }

    /**
      * Public entry point to stop tracking a sustained item (e.g., when it lapses)
      */
    static async stopSustaining(combatant: CombatantPF2e, itemId: string) {
        const currentLogs = (combatant as any).getFlag(SCOPE, "log") || [];
        // Reuse our unified private updater
        await this._updateLogs(combatant, currentLogs, true, itemId);
    }

    /**
     * Handle filing data to the database and rerendering the combat UI to show the updates
     */
    private static async _updateLogs(
        combatant: CombatantPF2e,
        newLogs: ActionLogEntry[],
        skipOverspendCheck: boolean,
        removeSustainId?: string
    ) {
        const c = combatant as any;
        const actionsSpent = newLogs.filter(e => e.type !== 'reaction').reduce((sum, e) => sum + (e.cost || 0), 0);
        const reactionsSpent = newLogs.filter(e => e.type === 'reaction').reduce((sum, e) => sum + (e.cost || 0), 0);

        const updateData: Record<string, any> = {
            [`flags.${SCOPE}.log`]: newLogs,
            [`flags.${SCOPE}.actionsSpent`]: actionsSpent,
            [`flags.${SCOPE}.reactionsSpent`]: reactionsSpent
        };

        // 1. Get the PERSISTENT registry. No round check here!
        // This stays until the user clicks "Let Lapse".
        let sustainMap = { ...(c.getFlag(SCOPE, "sustainData") || {}) };

        // 2. Handle Removal (The "Let Lapse" button calls this with removeSustainId)
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
            const economyUpdate = await ActionManager.checkOverspend(combatant, newLogs);
            if (economyUpdate) {
                updateData[`flags.${SCOPE}.lastOverspendAlert`] = economyUpdate.lastOverspendAlert;
            }
            await ActionManager.checkReactionOverspend(combatant, newLogs);
        }

        await c.update(updateData, { diff: false, recursive: false });
    }

    /**
     * Getthe internal logs from the combatant
     */
    private static _getInternalLog(combatant: CombatantPF2e): ActionLogEntry[] {
        return ((combatant as any).getFlag(SCOPE, "log") as ActionLogEntry[]) || [];
    }

    /**
     * Determine how many actions / reactions to drain from slows/starts, and logs the system action accordingly
     */
    private static calculateStartOfTurnDrains(actor: ActorPF2e) {
        const stunnedVal = ActorHandler.getConditionValue(actor, "stunned");
        const slowedVal = ActorHandler.getConditionValue(actor, "slowed");
        const isParalyzed = actor.hasCondition("paralyzed");
        const maxActions = ActorHandler.getMaxActions(actor);

        const logEntries: ActionLogEntry[] = [];
        let actionsSpent = 0;
        let reactionsSpent = 0;

        // Action Drain
        const totalDrain = isParalyzed ? maxActions : Math.max(stunnedVal, slowedVal);
        if (totalDrain > 0) {
            actionsSpent = Math.min(totalDrain, maxActions);
            const label = isParalyzed ? "Paralyzed" :
                (stunnedVal > 0 && slowedVal > 0) ? `Stunned ${stunnedVal} & Slowed ${slowedVal}` :
                    (stunnedVal > 0 ? `Stunned ${stunnedVal}` : `Slowed ${slowedVal}`);

            logEntries.push({ type: 'system', cost: actionsSpent, msgId: "System", label, isQuickenedEligible: true });
        }

        // Reaction Drain
        if (isParalyzed || stunnedVal > 0) {
            reactionsSpent = (actor.system as any).resources?.reactions?.max || 1;
            logEntries.push({ type: 'reaction', cost: 1, msgId: "System", label: `${isParalyzed ? 'Paralyzed' : 'Stunned'}: Reaction Lost`, isQuickenedEligible: false });
        }

        return { logEntries, actionsSpent, reactionsSpent };
    }

    /**
     * Determine if there are any remaining actions for a user this round.  Whisper accordingly (should only be done at end of a turn)
     */
    private static async checkUnderSpend(combatant: CombatantPF2e, log: readonly ActionLogEntry[]) {
        const c = combatant as any;
        if (!SettingsManager.get("whisperUnderspend")) return;
        const spent = log.filter(e => e.type === 'action' || e.type === 'system').reduce((acc, e) => acc + e.cost, 0);
        const actor = c.actor as ActorPF2e | undefined;
        if (!actor) return;

        const max = ActorHandler.getMaxActions(actor);
        if (spent < max) {
            const diff = max - spent;
            // No need to cast 'actor' again inside the call, it's already typed now
            await ChatManager.whisperAlert(actor, "Economy", `**${c.name}** ended turn with **${diff}** actions/bonus actions remaining.`);
        }
    }

    /**
      * Logic to determine if an over spending alert should be sent for actions.
      * Returns the new alert value for the flag update, or null if no alert is sent.
      */
    private static async checkOverspend(combatant: CombatantPF2e, newLogs: ActionLogEntry[]): Promise<{ lastOverspendAlert: number } | null> {
        const c = combatant as any;
        const actor = c.actor as ActorPF2e | null;
        if (!actor || !SettingsManager.get("whisperOverspend") || (game.user?.id !== game.users?.activeGM?.id)) return null;

        const max = ActorHandler.getMaxActions(actor); // Returns 3 or 4
        const hasQuickened = ActorHandler.hasQuickenedSnapshot(actor);

        const actionLog = newLogs.filter(e => e.type !== 'reaction');
        const rawTotalSpent = actionLog.reduce((sum, e) => sum + (e.cost || 0), 0);

        // System actions (Slowed/Stunned) are inherently Quickened Eligible 
        // because they are the first things to "drain" the pool.
        const hasQuickenedEligible = actionLog.some(e => e.isQuickenedEligible && e.cost > 0);

        let reason = "";

        // --- Violation Check ---
        if (rawTotalSpent > max) {
            reason = `Spent ${rawTotalSpent} actions (Max: ${max})`;
        }
        else if (rawTotalSpent === max && hasQuickened && !hasQuickenedEligible) {
            // They used the 4th slot, but nothing in their log is allowed to be there.
            reason = `Bonus action used for an ineligible activity (e.g., must be Stride/Strike).`;
        }

        if (reason) {
            const lastAlert = (c.getFlag(SCOPE, "lastOverspendAlert") as number) || 0;
            if (rawTotalSpent > lastAlert) {
                await ChatManager.whisperAlert(actor, "Economy Alert", `**${actor.name}**: ${reason}`);
            }
            return { lastOverspendAlert: rawTotalSpent };
        }
        return null;
    }

    /**
      * Logic to determine if an over spending alert should be sent for reactions. 
      */
    private static async checkReactionOverspend(combatant: CombatantPF2e, newLogs: ActionLogEntry[]) {
        const c = combatant as any;
        const actor = c.actor as ActorPF2e | null;
        if (!actor || !SettingsManager.get("whisperReactionOverspend") || game.user?.id !== game.users?.activeGM?.id) return;

        const reactionLog = newLogs.filter(e => e.type === 'reaction');
        const maxReactions = (actor.system as any).resources?.reactions?.max || 1;

        if (reactionLog.length > maxReactions) {
            await ChatManager.whisperAlert(actor, "Economy Alert", `**${actor.name}**: Spent ${reactionLog.length} reactions with only ${maxReactions} available.`);
        }

        return;
    }
}