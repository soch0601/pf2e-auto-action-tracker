import { SCOPE } from "./globals";
import { logConsole } from "./logger";
import { SettingsManager } from "./SettingsManager";
import { ActorHandler } from "./ActorHandler";
import { ChatManager } from "./ChatManager";
import { MovementManager } from "./MovementManager";
import { ActorPF2e, CombatantPF2e } from "module-helpers";
import { ComplexActionEngine } from "./complexActions/ComplexActionEngine";
import type { ActiveActivityState, ActionModifier } from "./complexActions/types";
import { getCurrentMapStateFromLog } from "./mapTracker";

export interface ActionLogEntry {
    cost: number;
    msgId: string;
    label: string;
    type: 'action' | 'reaction' | 'system' | 'bonus';
    slug?: string;
    isQuickenedEligible: boolean;
    isMapRelevant?: boolean;
    mapProfile?: "standard" | "agile";
    actionModifiers?: ActionModifier[];
    sustainItem?: { id: string, name: string };
    ComplexActionState?: ActiveActivityState;
    category: string;
    linkedMessages: linkedRolls[];
    distance?: number;
}

export interface linkedRolls {
    type: 'damage' | 'attack';
    msgId: string;
}

export class ActionManager {

    // Buffer: key is `${combatantId}-${msgId}`
    private static _sustainBuffer = new Map<string, { id: string, name: string }>();

    /**
     * READ-ONLY ACCESSORS
     * We return clones to prevent external mutation of the flag data.
     */
    static getActions(combatant: CombatantPF2e): ReadonlyArray<ActionLogEntry> {
        return Object.freeze(this._getInternalLog(combatant));
    }

    static getActionById(combatant: CombatantPF2e, msgId: string): ActionLogEntry | undefined {
        return this.getFlattenedActions(combatant).find(e => e.msgId === msgId);
    }

    static getLastAction(combatant: CombatantPF2e): { entry: ActionLogEntry, isSubAction: boolean, subAction?: ActionLogEntry, actionLabel?: string } | undefined {
        const logs = this._getInternalLog(combatant);
        if (!logs || logs.length === 0) return undefined;

        const lastEntry = logs[logs.length - 1];

        // If it's a complex action, check for the most recent child message
        if (lastEntry.ComplexActionState) {
            const childActions = ComplexActionEngine.getAllChildActions(lastEntry.ComplexActionState);
            if (childActions && childActions.length > 0) {
                const lastChildAction = childActions[childActions.length - 1];
                const leafLabel = ComplexActionEngine.getLeafLabel(lastEntry.ComplexActionState, lastChildAction.msgId);
                return {
                    entry: lastEntry,
                    isSubAction: true,
                    subAction: lastChildAction,
                    actionLabel: leafLabel
                };
            }
        }

        return { entry: lastEntry, isSubAction: false };
    }

    /**
     * It was determined there is something to sustain - track it for later filing on the next action
     */
    static trackSustain(combatant: CombatantPF2e, msgId: string, itemId: string, itemName: string) {
        const key = `${(combatant as any).id}-${msgId}`;
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

        // Reset any captured movement history for this turn
        const tokenId = c.tokenId || c.token?.id;
        if (tokenId) MovementManager.resetCapturedHistory(tokenId);

        // 1. Logic call to ActorHandler, but the ActionManager does the filing
        const isQuickened = ActorHandler.getQuickenedState(combatant);

        // 2. Calculate drains using the combatant (which hasn't updated its flag yet, so we pass state)
        const { logEntries, actionsSpent, reactionsSpent } = this.calculateStartOfTurnDrains(combatant);

        // 3. RAW Stunned Logic: Decrement before calculating turn resources
        const stunnedCondition = actor.itemTypes.condition.find(c => c.slug === "stunned");
        let stunnedCost = 0;

        if (stunnedCondition) {
            const currentVal = (stunnedCondition.value ?? 0);
            const maxActions = ActorHandler.getMaxActions(c);
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

        // 4. ATOMIC UPDATE: File everything to the combatant at once
        await c.update({
            [`flags.${SCOPE}.isQuickenedSnapshot`]: isQuickened,
            [`flags.${SCOPE}.log`]: logEntries,
            [`flags.${SCOPE}.actionsSpent`]: actionsSpent,
            [`flags.${SCOPE}.reactionsSpent`]: reactionsSpent,
            [`flags.${SCOPE}.lastOverspendAlert`]: 0
        });

        await ChatManager.checkSustainReminder(c);
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

        // Reset movement history for the next turn
        const tokenId = (combatant as any).tokenId || (combatant as any).token?.id;
        if (tokenId) MovementManager.resetCapturedHistory(tokenId);

        // Stunned logic is removed from here because it's now handled at Start of Turn per RAW.
    }

    /**
     * Add a new ActionLogEntry to the action log for the current turn
     */
    static async addAction(combatant: CombatantPF2e, action: ActionLogEntry) {
        const c = combatant as any;
        const tokenId = c.tokenId || c.token?.id;
        const isMove = MovementManager.isMoveAction(action.msgId);

        if (action.type === 'system') {
            const currentLog = [...this._getInternalLog(combatant)];
            currentLog.push(action);
            await this._updateLogs(combatant, currentLog, false);
            return;
        }

        // Sustain enrichment
        if (action.msgId) {
            const key = `${c.id}-${action.msgId}`;
            const pendingSustain = this._sustainBuffer.get(key);
            if (pendingSustain) {
                action.sustainItem = pendingSustain;
                this._sustainBuffer.delete(key);
            }
        }

        const currentLog = [...this._getInternalLog(combatant)];
        const incomingSlug = action.slug || (action.type === 'action' ? 'strike' : action.type);

        // 1. Check for OPEN sequences
        const openEntry = currentLog.find(e => e.ComplexActionState && !e.ComplexActionState.completedBy);

        if (openEntry && openEntry.ComplexActionState) {
            const wasCompleteBeforeClaim = ComplexActionEngine.isComplete(openEntry.ComplexActionState);

            const result = ComplexActionEngine.evaluate(openEntry.ComplexActionState!, {
                slug: incomingSlug,
                action,
                cost: action.cost,
                type: action.category
            },
                combatant);

            if (result.claimed) {
                openEntry.ComplexActionState = result.newState;
                // Use toString() for a clean, dynamic label
                openEntry.label = ComplexActionEngine.toString(result.newState);

                // If this action completed the sequence and it wasn't a move, reset movement history
                if (ComplexActionEngine.isComplete(result.newState) && !wasCompleteBeforeClaim && !isMove) {
                    if (tokenId) MovementManager.resetCapturedHistory(tokenId);
                }

                const overrideCost = ComplexActionEngine.getOverrideCost(result.newState);

                // Only update the entry cost if an override was explicitly found
                if (overrideCost !== undefined) {
                    openEntry.cost = overrideCost;
                }

                await this._updateLogs(combatant, currentLog, false);
                return;
            } else if (ComplexActionEngine.canComplete(openEntry.ComplexActionState)) {
                openEntry.ComplexActionState = ComplexActionEngine.complete(openEntry.ComplexActionState, ComplexActionEngine.getAllChildActions(openEntry.ComplexActionState).reverse()[0].msgId);
                openEntry.label = ComplexActionEngine.toString(openEntry.ComplexActionState);
                // Sequence completed/ejected, reset history
                if (tokenId) MovementManager.resetCapturedHistory(tokenId);
            } else if (action.cost > 0) {
                // Sequence Broken
                openEntry.ComplexActionState = ComplexActionEngine.complete(openEntry.ComplexActionState, action.msgId);
                await ChatManager.triggerAlert(c.actor, "Sequence Broken", `Cancelled ${openEntry.label}.`, 'whisperComplexAction');
                // Sequence broken, reset history
                if (tokenId) MovementManager.resetCapturedHistory(tokenId);
            }
        }

        // 2. Check for NEW sequence
        const newSequence = ComplexActionEngine.maybeStart(incomingSlug, action.msgId, (combatant as unknown as Combatant).token);
        if (newSequence) {
            action.ComplexActionState = newSequence;
            action.label = ComplexActionEngine.toString(newSequence);
        } else if (!isMove) {
            // Not a move and not starting a sequence, reset history
            if (tokenId) MovementManager.resetCapturedHistory(tokenId);
        }

        currentLog.push(action);
        await this._updateLogs(combatant, currentLog, false);
    }

    /**
     * Edit an existing ActionLogEntry (or sub-action) in the log.
     * Handles re-evaluation of complex activities if an edit "fixes" a broken sequence.
     */
    static async editAction(combatant: CombatantPF2e, msgId: string, updates: Partial<ActionLogEntry>) {
        const currentLog = [...this._getInternalLog(combatant)];
        const c = combatant as any;

        // 1. Identify the target and potential parent
        const topLevelIndex = currentLog.findIndex(e => e.msgId === msgId);
        const parentEntry = currentLog.find(e =>
            e.ComplexActionState &&
            ComplexActionEngine.getAllChildMessageIds(e.ComplexActionState).includes(msgId)
        );

        // 2. CASE A: Editing an action already inside a Special Activity
        if (parentEntry && parentEntry.ComplexActionState) {
            const oldState = parentEntry.ComplexActionState;
            const newState = ComplexActionEngine.edit(oldState, msgId, updates, combatant);

            const oldLeaf = ComplexActionEngine.findLeafByMessageId(oldState, msgId);
            const newLeaf = ComplexActionEngine.findLeafByMessageId(newState, msgId);
            const subAction = newLeaf?.childActions.find(a => a.msgId === msgId);

            // If the edit makes a previously valid action invalid, eject it
            if (newLeaf && subAction && !newLeaf.satisfied && oldLeaf?.satisfied) {
                parentEntry.ComplexActionState = ComplexActionEngine.remove(oldState, msgId);

                // Mark as broken by this specific message ID
                parentEntry.ComplexActionState = ComplexActionEngine.complete(parentEntry.ComplexActionState, msgId);
                parentEntry.label = ComplexActionEngine.toString(parentEntry.ComplexActionState);

                // Promote the edited action to the top-level log
                currentLog.push({ ...subAction, ...updates });

                await ChatManager.triggerAlert(
                    c.actor,
                    "Sequence Broken",
                    `Action limits exceeded for ${parentEntry.slug}. Item separated.`,
                    'whisperComplexAction'
                );
            } else {
                // Valid edit: just update the internal state
                parentEntry.ComplexActionState = newState;
                parentEntry.label = ComplexActionEngine.toString(newState);

                if (newState.completedBy && newState.completedBy === msgId) {
                    const overrideCost = ComplexActionEngine.getOverrideCost(newState);
                    if (overrideCost) {
                        parentEntry.cost = overrideCost;
                    }
                }
            }

            // 3. CASE B: Editing a top-level action (Potential "Redemption" or normal edit)
        } else if (topLevelIndex !== -1) {
            const topLevelAction = currentLog[topLevelIndex];
            const updatedAction = { ...topLevelAction, ...updates };

            // Check if there's a broken/incomplete sequence that should "re-claim" this action
            const openSequence = currentLog.find(e =>
                e.ComplexActionState &&
                (e.ComplexActionState.completedBy === msgId || !e.ComplexActionState.completedBy)
            );

            if (openSequence && openSequence.msgId !== msgId) {
                const result = ComplexActionEngine.evaluate(openSequence.ComplexActionState!, {
                    slug: updatedAction.slug || (updatedAction.category === 'move' ? 'move' : 'strike'),
                    action: updatedAction,
                    cost: updatedAction.cost,
                    type: updatedAction.category
                },
                    combatant);

                if (result.claimed) {
                    openSequence.ComplexActionState = result.newState;

                    // If it was previously broken by this ID, clear the completedBy lock
                    if (openSequence.ComplexActionState.completedBy === msgId) {
                        delete openSequence.ComplexActionState.completedBy;
                    }

                    openSequence.label = ComplexActionEngine.toString(openSequence.ComplexActionState);

                    // Remove the orphaned top-level action
                    currentLog.splice(topLevelIndex, 1);
                } else {
                    // Just a normal top-level edit
                    currentLog[topLevelIndex] = updatedAction;
                }
            } else {
                // No sequence cares about this, just a normal top-level edit
                currentLog[topLevelIndex] = updatedAction;
            }
        } else {
            return; // Action not found
        }

        // 4. Final Sync
        await this._updateLogs(combatant, currentLog, MovementManager.isMoveAction(msgId));
    }

    /**
     * Remove an existing ActionLogEntry from the action log for the current turn
     */
    static async removeAction(combatant: CombatantPF2e, msgId: string): Promise<void> {
        const stack = new Error().stack;
        const currentLog = [...this._getInternalLog(combatant)];

        // Always reset movement history when an action is removed (Undo)
        const tokenId = (combatant as any).tokenId || (combatant as any).token?.id;
        if (tokenId) MovementManager.resetCapturedHistory(tokenId);

        // 1. UNLOCK: If any activity was locked/broken by this specific ID, clear it
        currentLog.forEach(e => {
            if (e.ComplexActionState?.completedBy === msgId) {
                delete e.ComplexActionState.completedBy;
                e.label = ComplexActionEngine.toString(e.ComplexActionState);
            }
        });

        // 2. SEARCH: Find the parent container or the top-level target
        const parentEntry = currentLog.find(e =>
            e.ComplexActionState && ComplexActionEngine.getAllChildMessageIds(e.ComplexActionState).includes(msgId)
        );
        const topLevelIndex = currentLog.findIndex(e => e.msgId === msgId);

        // 3. RESOLVE
        if (parentEntry && parentEntry.ComplexActionState) {
            // CASE A: The ID belongs to a CHILD. 
            // We only remove the child from the engine state. 
            // The parent entry stays in the log, even if childActions becomes empty.
            parentEntry.ComplexActionState = ComplexActionEngine.remove(parentEntry.ComplexActionState, msgId);
            parentEntry.label = ComplexActionEngine.toString(parentEntry.ComplexActionState);

        } else if (topLevelIndex !== -1) {
            // CASE B: The ID belongs to a TOP-LEVEL entry (could be a Parent or a normal action).
            // Since it's top-level, we remove the whole entry from the log.
            currentLog.splice(topLevelIndex, 1);
        }

        await this._updateLogs(combatant, currentLog, true);
    }

    static async completeComplexAction(combatant: CombatantPF2e, action: ActionLogEntry) {
        const currentLog = [...this._getInternalLog(combatant)];
        if (!action.ComplexActionState) return;

        const topLevelIndex = currentLog.findIndex(e => e.msgId === action.msgId);
        if (topLevelIndex === -1) return;

        const topLevelAction = currentLog[topLevelIndex];
        const newState = ComplexActionEngine.complete(action.ComplexActionState, 'MANUAL COMPLETE');

        const updates: Partial<ActionLogEntry> = {
            label: ComplexActionEngine.toString(action.ComplexActionState),
            cost: ComplexActionEngine.getOverrideCost(action.ComplexActionState) ?? topLevelAction.cost,
            ComplexActionState: newState
        }
        const updatedAction = { ...topLevelAction, ...updates };
        currentLog[topLevelIndex] = updatedAction;

        await this._updateLogs(combatant, currentLog, true);
    }


    static async linkDamageToAttack(combatant: CombatantPF2e, attackMsgId: string | undefined, damageMsgId: string) {

        if (!attackMsgId) return

        const entry = this.getActionById(combatant, attackMsgId);

        if (entry) {
            const updatedLinkedRolls = entry.linkedMessages.concat({ type: 'damage', msgId: damageMsgId });
            this.editAction(combatant, attackMsgId, { linkedMessages: updatedLinkedRolls });
        }
    }

    /**
      * Public entry point to stop tracking a sustained item (e.g., when it lapses)
      */
    static async stopSustaining(combatant: CombatantPF2e, itemId: string) {
        const currentLogs = this._getInternalLog(combatant);
        // Reuse our unified private updater
        await this._updateLogs(combatant, currentLogs, true, itemId);
    }

    static getFlattenedActions(combatant: CombatantPF2e): ActionLogEntry[] {
        const log = this._getInternalLog(combatant);
        return log.flatMap(entry => {
            if (entry.ComplexActionState) {
                // Return the parent (for metadata) + all children
                const children = ComplexActionEngine.getAllChildActions(entry.ComplexActionState);
                return [entry, ...children];
            }
            return [entry];
        });
    }

    static getCurrentMAP(
        combatant: CombatantPF2e
    ): { attackCount: number, penalty: 0 | 4 | 5 | 8 | 10, profile: "standard" | "agile" } {
        const isActiveTurn = (game as any).combat?.combatant?.id === (combatant as any).id;
        return getCurrentMapStateFromLog(this._getInternalLog(combatant), isActiveTurn);
    }

    /**
     * Handle filing data to the database and rerendering the combat UI to show the updates
     */
    private static async _updateLogs(
        combatant: CombatantPF2e,
        newLogs: ActionLogEntry[],
        skipOverspendCheck: boolean,
        removeSustainId?: string,
        extraFlags?: Record<string, any>
    ) {
        const c = combatant as any;
        const actionsSpent = newLogs.filter(e => e.type !== 'reaction').reduce((sum, e) => sum + (e.cost || 0), 0);
        const reactionsSpent = newLogs.filter(e => e.type === 'reaction').reduce((sum, e) => sum + (e.cost || 0), 0);

        const hasQuickenedSnapshot = ActorHandler.hasQuickenedSnapshot(combatant);

        const updateData: Record<string, any> = {
            [`flags.${SCOPE}.log`]: newLogs,
            [`flags.${SCOPE}.actionsSpent`]: actionsSpent,
            [`flags.${SCOPE}.reactionsSpent`]: reactionsSpent,
            [`flags.${SCOPE}.isQuickenedSnapshot`]: hasQuickenedSnapshot
        };

        if (extraFlags) {
            Object.assign(updateData, extraFlags);
        }

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
    private static calculateStartOfTurnDrains(combatant: CombatantPF2e, quickenedOverride?: boolean) {
        const actor = (combatant as any).actor!;
        const stunnedVal = ActorHandler.getConditionValue(actor, "stunned");
        const slowedVal = ActorHandler.getConditionValue(actor, "slowed");
        const isParalyzed = actor.hasCondition("paralyzed");
        const maxActions = ActorHandler.getMaxActions(combatant, quickenedOverride);

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

            logEntries.push({ type: 'system', cost: actionsSpent, msgId: "System", label, isQuickenedEligible: true, category: "system", linkedMessages: [] });
        }

        // Reaction Drain
        if (isParalyzed || stunnedVal > maxActions) {
            reactionsSpent = ActorHandler.getSlots(combatant, 'reaction').length;
            logEntries.push({ type: 'reaction', cost: reactionsSpent, msgId: "System", label: `${isParalyzed ? 'Paralyzed' : 'Stunned'}: Reaction Lost`, isQuickenedEligible: false, category: "system", linkedMessages: [] });
        }

        return { logEntries, actionsSpent, reactionsSpent };
    }

    /**
     * Handles when conditions are dynamically added or removed mid-turn/off-turn.
     * We only manage reaction drains here, because Action drains are resolved strictly at the start of a turn.
     */
    static async handleConditionChange(combatant: CombatantPF2e) {
        const c = combatant as any;
        const actor = c.actor as ActorPF2e | undefined;
        if (!actor) return;

        const stunnedVal = ActorHandler.getConditionValue(actor, "stunned");
        const isParalyzed = actor.hasCondition("paralyzed");

        let log = [...this._getInternalLog(combatant)];
        const reactionDrainIndex = log.findIndex(e => e.type === 'reaction' && e.category === 'system' && e.label.includes('Reaction Lost'));

        const needsReactionDrain = isParalyzed || stunnedVal > 0;

        let changed = false;

        if (needsReactionDrain && reactionDrainIndex === -1) {
            const reactionsSpent = ActorHandler.getSlots(combatant, 'reaction').length;
            log.push({
                type: 'reaction',
                cost: reactionsSpent,
                msgId: "System",
                label: `${isParalyzed ? 'Paralyzed' : 'Stunned'}: Reaction Lost`,
                isQuickenedEligible: false,
                category: "system",
                linkedMessages: []
            });
            changed = true;
        } else if (!needsReactionDrain && reactionDrainIndex !== -1) {
            log.splice(reactionDrainIndex, 1);
            changed = true;
        }

        if (changed) {
            await this._updateLogs(combatant, log, false);
        }
    }

    /**
     * Determine if there are any remaining actions for a user this round.  Whisper accordingly (should only be done at end of a turn)
     */
    private static async checkUnderSpend(combatant: CombatantPF2e, log: readonly ActionLogEntry[]) {
        const c = combatant as any;
        const spent = log.filter(e => e.type === 'action' || e.type === 'system').reduce((acc, e) => acc + e.cost, 0);
        const actor = c.actor as ActorPF2e | undefined;
        if (!actor) return;

        const max = ActorHandler.getMaxActions(combatant);
        if (spent < max) {
            const diff = max - spent;
            // No need to cast 'actor' again inside the call, it's already typed now
            await ChatManager.triggerAlert(actor, "Economy", `**${c.name}** ended turn with **${diff}** actions/bonus actions remaining.`, 'whisperUnderspend');
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

        const { overspent } = ActorHandler.allocateSlots(combatant, newLogs, 'action');

        const actionLog = newLogs.filter(e => e.type !== 'reaction');
        const rawTotalSpent = actionLog.reduce((sum, e) => sum + (e.cost || 0), 0);

        if (overspent.length > 0) {
            const reason = `Spent actions that exceeded available slots (${overspent.map(o => o.label).join(', ')}).`;
            const lastAlert = (c.getFlag(SCOPE, "lastOverspendAlert") as number) || 0;
            if (rawTotalSpent > lastAlert) {
                await ChatManager.triggerAlert(actor, "Economy Alert", `**${actor.name}**: ${reason}`, 'whisperOverspend');
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

        const { overspent } = ActorHandler.allocateSlots(combatant, newLogs, 'reaction');

        if (overspent.length > 0) {
            const reason = `Spent reactions that exceeded available slots (${overspent.map(o => o.label).join(', ')}).`;
            await ChatManager.triggerAlert(actor, "Economy Alert", `**${actor.name}**: ${reason}`, 'whisperReactionOverspend');
        }

        return;
    }
}
