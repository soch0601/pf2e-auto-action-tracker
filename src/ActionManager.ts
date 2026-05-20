import { SCOPE } from "./globals.ts";
import { logError, logWarn, logInfo } from "./logger.ts";
import { SettingsManager } from "./SettingsManager.ts";
import { ActorManager } from "./ActorManager.ts";
import type { ActorPF2e, CombatantPF2e } from "module-helpers";
import { ComplexActionEngine } from "./complexActions/ComplexActionEngine.ts";
import { getCurrentMapStateFromLog } from "./mapTracker.ts";
import { isCurrentUserActiveGM } from "./foundryCompat.ts";
import { type ActionLogEntry, getEntryCost } from "./ActionLogTypes.ts";
import { DBManager } from "./DBManager.ts";
import { ItemManager } from "./ItemManager.ts";

export class ActionManager {
    private static writeQueues = new Map<string, Promise<any>>();
    private static _lastUndoId: string | null = null;
    private static _lastUndoTime: number = 0;
    static getEntryCost(entry: ActionLogEntry, log?: readonly ActionLogEntry[]): number {
        return getEntryCost(entry, log);
    }

    /**
     * READ-ONLY ACCESSORS
     * We return clones to prevent external mutation of the flag data.
     */
    static getActions(combatant: CombatantPF2e): ReadonlyArray<ActionLogEntry> {
        return Object.freeze(DBManager.getLog(combatant));
    }

    static getActionById(combatant: CombatantPF2e, msgId: string): ActionLogEntry | undefined {
        return this.getFlattenedActions(combatant).find(e => e.msgId === msgId);
    }

    /**
     * Link a damage application card to the action that caused it
     */
    public static async linkDamageApplicationToAction(combatant: CombatantPF2e, originMsgId: string, targetUuid: string, cardId: string) {
        const cId = (combatant as any).id;
        const existing = this.writeQueues.get(cId) || Promise.resolve();

        const newPromise = existing.then(async () => {
            try {
                await this._linkDamageApplicationToActionInternal(combatant, originMsgId, targetUuid, cardId);
            } catch (err) {
                logError("ActionManager | linkDamageApplicationToAction queue error:", err);
            }
        });

        this.writeQueues.set(cId, newPromise);
        await newPromise;
    }

    /**
     * Link a spell attack roll to the action that cast or sustained it
     */
    public static async linkSpellAttackToAction(combatant: CombatantPF2e, itemUuid: string | undefined, itemId: string | undefined, originUuid: string | undefined, itemName: string | undefined, msgId: string) {
        const log = DBManager.getLog(combatant);
        // Look backwards to find the most recent spell cast that matches this item
        for (let i = log.length - 1; i >= 0; i--) {
            const entry = log[i];
            const isMatch = entry.itemUsage?.uuid === itemUuid ||
                (originUuid && entry.itemUsage?.uuid === originUuid) ||
                entry.spellSlot?.entryId === itemId ||
                entry.sustainItem?.id === itemId ||
                (entry.label && itemName && (entry.label.includes(itemName) || itemName.includes(entry.label)));
            if (isMatch) {
                const linkedMessages = [...(entry.linkedMessages || []), { type: 'attack', msgId } as const];
                await this.editAction(combatant, entry.msgId, { linkedMessages });
                return true;
            }
        }
        return false;
    }

    static getLastAction(combatant: CombatantPF2e): { entry: ActionLogEntry, isSubAction: boolean, subAction?: ActionLogEntry, actionLabel?: string } | undefined {
        const logs = DBManager.getLog(combatant);
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
     * Handle start of turn shenanigans, including resetting the previous round's actions and getting the
     * fresh list of actions to spend for this round
     */
    static async handleStartOfTurn(combatant: CombatantPF2e) {
        const c = combatant as any;
        const actor: ActorPF2e = c.actor;
        if (!actor) return;

        // Reset any captured movement history for this turn
        const tokenId = c.tokenId || c.token?.id;
        if (tokenId) {
            const { MovementManager } = await import("./MovementManager.ts");
            MovementManager.broadcastReset(tokenId);
        }

        // 1. Logic call to ActorManager, but the ActionManager does the filing
        const isQuickened = ActorManager.getQuickenedState(combatant);

        // 2. Calculate drains using the combatant (which hasn't updated its flag yet, so we pass state)
        const { logEntries, actionsSpent, reactionsSpent } = this.calculateStartOfTurnDrains(combatant);

        // 3. RAW Stunned Logic
        const stunnedCondition = actor.itemTypes.condition.find(c => c.slug === "stunned");
        let stunnedCost = 0;

        if (stunnedCondition) {
            const currentVal = (stunnedCondition.value ?? 0);
            const maxActions = ActorManager.getMaxActions(c);
            stunnedCost = Math.min(currentVal, maxActions);

            const newVal = currentVal - stunnedCost;
            if (newVal <= 0) {
                await stunnedCondition.delete({});
            } else {
                await stunnedCondition.update({ "system.value.value": newVal } as any);
            }
            logInfo(`RAW: Decremented Stunned on ${actor.name} by ${stunnedCost}.`);
        }

        // 4. ATOMIC UPDATE
        await DBManager.updateLogs(combatant, logEntries, true, undefined, {
            [`flags.${SCOPE}.isQuickenedSnapshot`]: isQuickened,
            [`flags.${SCOPE}.lastOverspendAlert`]: 0
        });

        const { ChatManager } = await import("./ChatManager.ts");
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

        // Reset all movement history for the next round to ensure a clean state
        const { MovementManager } = await import("./MovementManager.ts");
        MovementManager.broadcastReset();

        // Stunned logic is removed from here because it's now handled at Start of Turn per RAW.
    }

    /**
     * Add a new ActionLogEntry to the action log for the current turn
     */
    static async addAction(combatant: CombatantPF2e, action: ActionLogEntry) {
        const c = combatant as any;

        if (!isCurrentUserActiveGM()) {
            const { SocketsManager } = await import("./SocketManager.ts");
            return await SocketsManager.socket.executeAsGM("addAction", {
                combatantId: (combatant as any as Combatant).id,
                action
            });
        }

        const { MovementManager } = await import("./MovementManager.ts");
        const tokenId = c.tokenId || c.token?.id;

        if (action.type === 'system') {
            const currentLog = [...DBManager.getLog(combatant)];
            currentLog.push(action);
            await DBManager.updateLogs(combatant, currentLog, false);
            return;
        }

        const currentLog = [...DBManager.getLog(combatant)];
        const incomingSlug = action.slug || (action.type === 'action' ? 'strike' : action.type);

        // 0. Prepare potential new sequence for the incoming action
        const newSequence = ComplexActionEngine.maybeStart(incomingSlug, action.msgId, (combatant as unknown as Combatant).token);
        if (newSequence) {
            action.ComplexActionState = newSequence;
            action.label = ComplexActionEngine.toString(newSequence);
        }

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

                const { MovementManager } = await import("./MovementManager.ts");
                // If this action completed the sequence and it wasn't a move, reset movement history
                if (ComplexActionEngine.isComplete(result.newState) && !wasCompleteBeforeClaim && !MovementManager.isMoveAction(action.msgId)) {
                    if (tokenId) MovementManager.resetCapturedHistory(tokenId);
                }

                const overrideCost = ComplexActionEngine.getOverrideCost(result.newState);

                // Only update the entry cost if an override was explicitly found
                if (overrideCost !== undefined) {
                    openEntry.cost = overrideCost;
                }

                await DBManager.updateLogs(combatant, currentLog, false);
                return;
            } else if (ComplexActionEngine.canComplete(openEntry.ComplexActionState)) {
                openEntry.ComplexActionState = ComplexActionEngine.complete(openEntry.ComplexActionState, ComplexActionEngine.getAllChildActions(openEntry.ComplexActionState).reverse()[0].msgId);
                openEntry.label = ComplexActionEngine.toString(openEntry.ComplexActionState);
                // Sequence completed/ejected, reset history
                const { MovementManager } = await import("./MovementManager.ts");
                if (tokenId) MovementManager.resetCapturedHistory(tokenId);
            } else if (this.getEntryCost(action, currentLog) > 0) {
                // Sequence Broken
                openEntry.ComplexActionState = ComplexActionEngine.complete(openEntry.ComplexActionState, action.msgId);
                const { ChatManager } = await import("./ChatManager.ts");
                await ChatManager.triggerAlert(c.actor, "Sequence Broken", `Cancelled ${openEntry.label}.`, 'whisperComplexAction');
                // Sequence broken, reset history
                const { MovementManager } = await import("./MovementManager.ts");
                if (tokenId) MovementManager.resetCapturedHistory(tokenId);
            }
        }

        if (!action.ComplexActionState) {
            const { MovementManager } = await import("./MovementManager.ts");
            if (!MovementManager.isMoveAction(action.msgId)) {
                // Not a move and not starting a sequence, reset history
                if (tokenId) MovementManager.broadcastReset(tokenId);
            }
        }

        currentLog.push(action);
        await DBManager.updateLogs(combatant, currentLog, false);
    }

    /**
     * Edit an existing ActionLogEntry (or sub-action) in the log.
     * Handles re-evaluation of complex activities if an edit "fixes" a broken sequence.
     */
    static async editAction(combatant: CombatantPF2e, msgId: string, updates: Partial<ActionLogEntry>) {
        const c = combatant as any;

        if (!isCurrentUserActiveGM()) {
            const { SocketsManager } = await import("./SocketManager.ts");
            return await SocketsManager.socket.executeAsGM("editAction", {
                combatantId: (combatant as any as Combatant).id,
                msgId,
                updates
            });
        }

        const currentLog = [...DBManager.getLog(combatant)];

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

                const { ChatManager } = await import("./ChatManager.ts");
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
        const { MovementManager } = await import("./MovementManager.ts");
        await DBManager.updateLogs(combatant, currentLog, MovementManager.isMoveAction(msgId));
    }

    /**
     * Remove an existing ActionLogEntry from the action log for the current turn
     */
    static async removeAction(combatant: CombatantPF2e, msgId: string, isRecursive: boolean = false) {
        // Always reset movement history when an action is removed (Undo)
        const tokenId = (combatant as any).tokenId || (combatant as any).token?.id;
        const { MovementManager } = await import("./MovementManager.ts");
        if (tokenId) MovementManager.broadcastReset(tokenId);

        // If this is a player, we must delegate the authoritative removal to the GM
        if (!isCurrentUserActiveGM()) {
            const { SocketsManager } = await import("./SocketManager.ts");
            return await SocketsManager.socket.executeAsGM("removeAction", {
                combatantId: (combatant as any as Combatant).id,
                msgId,
                isRecursive
            });
        }

        try {
            const entry = this.getActionById(combatant, msgId);
            const { ChatManager } = await import("./ChatManager.ts");

            // 1. Update the History Log
            const currentLog = DBManager.getLog(combatant);
            let logChanged = false;

            // A. Check if this is a child action inside a complex parent
            const parent = currentLog.find(e => e.ComplexActionState && ComplexActionEngine.getAllChildMessageIds(e.ComplexActionState).includes(msgId));

            if (parent && parent.ComplexActionState) {
                parent.ComplexActionState = ComplexActionEngine.remove(parent.ComplexActionState, msgId);
                parent.label = ComplexActionEngine.toString(parent.ComplexActionState);
                parent.cost = ComplexActionEngine.getOverrideCost(parent.ComplexActionState) ?? parent.cost;

                // If the parent was completed by this message, it's already handled by the UNLOCK logic below
                // but we also need to ensure the parent's cost/label are updated in the log.
                logChanged = true;
            }

            // B. UNLOCK: If this action was completing a complex activity, unlock that activity
            currentLog.forEach(e => {
                if (e.ComplexActionState?.completedBy === msgId) {
                    delete e.ComplexActionState.completedBy;
                    e.label = ComplexActionEngine.toString(e.ComplexActionState);
                    logChanged = true;
                }
            });

            // C. Filter out top-level actions (if it wasn't a child, it's a top-level)
            const newLog = currentLog.filter(e => e.msgId !== msgId);
            if (newLog.length !== currentLog.length) logChanged = true;

            if (logChanged) {
                await DBManager.updateLogs(combatant, newLog, true, entry?.sustainItem?.id);
            }

            if (!entry) {
                // If no entry exists in the log, just ensure the message is gone
                await ChatManager.deleteMessage(msgId);
                return;
            }

            // 2. Perform Enhanced Undo (System Reversions + Children)
            if (SettingsManager.get("enhancedUndo")) {
                await this.performEnhancedUndo(combatant, entry);
            } else {
                // If enhanced undo is off, do NOT delete any chat cards
                // Whisper the GM suggested manual cleanups for pertinent system resources
                const actor = (combatant as any).actor;
                if (actor) {
                    const cleanups: string[] = [];

                    const children = entry.ComplexActionState
                        ? ComplexActionEngine.getAllChildActions(entry.ComplexActionState)
                        : [];

                    // Gather target damage applications
                    const damageApps = (entry.linkedMessages || []).filter(m => m.type === "applied-damage");
                    const childDamageApps = children
                        .flatMap(c => c.linkedMessages || [])
                        .filter(m => m.type === "applied-damage");

                    if (damageApps.length > 0 || childDamageApps.length > 0) {
                        cleanups.push("Damage Applications (revert damage on target sheets)");
                    }

                    // Spell slots
                    if (entry.spellSlot) {
                        cleanups.push(`Spell Slots (Rank ${entry.spellSlot.rank} slot for "${entry.label}")`);
                    }
                    for (const child of children) {
                        if (child.spellSlot) {
                            cleanups.push(`Spell Slots (Rank ${child.spellSlot.rank} slot for "${child.label}")`);
                        }
                    }

                    // Item usages
                    const hasItemUsage = (u: any) => u.itemUsage && (
                        u.itemUsage.quantity !== undefined ||
                        u.itemUsage.uses !== undefined ||
                        u.itemUsage.frequency !== undefined ||
                        u.itemUsage.itemData !== undefined
                    );
                    if (hasItemUsage(entry)) {
                        cleanups.push(`Item Consumption (Quantity/Uses for "${entry.label}")`);
                    }
                    for (const child of children) {
                        if (hasItemUsage(child)) {
                            cleanups.push(`Item Consumption (Quantity/Uses for "${child.label}")`);
                        }
                    }

                    // Hero Points
                    const hasSpentHeroPoint = entry.spentHeroPoint || children.some(c => c.spentHeroPoint);
                    if (hasSpentHeroPoint) {
                        cleanups.push("Hero Points spent");
                    }

                    if (cleanups.length > 0 && SettingsManager.get("whisperUndoCleanup")) {
                        const cleanupList = cleanups.map(c => `<li>${c}</li>`).join("");
                        const whisperContent = `
                            <div class="pf2e-auto-action-tracker-alert">
                                <strong>Manual Reversion Suggested:</strong>
                                <p>Action <strong>${entry.label}</strong> was removed on the tracker. Since Enhanced Undo is disabled, you should consider manually reverting or cleaning up:</p>
                                <ul>${cleanupList}</ul>
                            </div>
                        `;
                        const gmUserIds = game.users.filter((u: any) => u.isGM).map((u: any) => u.id);
                        await ChatMessage.create({
                            content: whisperContent,
                            whisper: gmUserIds,
                            speaker: { alias: "PF2E Action Tracker" },
                            flags: {
                                [SCOPE]: { isAutoAlert: true }
                            } as any
                        });
                    }
                }
            }

        } catch (err) {
            logError(`ActionManager | Failed to remove action ${msgId}:`, err);
        }
    }

    /**
     * Perform the actual system-level reversions for an action undo
     */
    private static async performEnhancedUndo(combatant: CombatantPF2e, entry: ActionLogEntry) {
        const c = combatant as any;

        // 1. Handle Complex Action Children (Recursion)
        if (entry.ComplexActionState) {
            const children = ComplexActionEngine.getAllChildActions(entry.ComplexActionState);

            // Explicitly collect child primary and linked message IDs as a failsafe
            const failsafeIds: string[] = [];
            for (const child of children) {
                if (child.msgId) failsafeIds.push(child.msgId);
                const childLinks = child.linkedMessages || [];
                for (const m of childLinks) {
                    if (m.type !== 'applied-damage' && m.msgId) {
                        failsafeIds.push(m.msgId);
                    }
                }
            }

            // We use Promise.allSettled to handle all children in parallel, passing the memory entry to avoid DB race conditions
            await Promise.allSettled(children.map(child => this.performEnhancedUndo(combatant, child)));

            // Failsafe cleanup of any remaining child messages
            if (failsafeIds.length > 0) {
                const { ChatManager } = await import("./ChatManager.ts");
                await Promise.allSettled(failsafeIds.map(id => ChatManager.deleteMessage(id)));
            }

            // Cleanup combined damage message if exists
            if (entry.ComplexActionState.combinedDamageMessageId) {
                const { ChatManager } = await import("./ChatManager.ts");
                await ChatManager.deleteMessage(entry.ComplexActionState.combinedDamageMessageId);
            }
        }

        // 2. Undo Damage Applications
        const damageApplications = (entry.linkedMessages || []).filter(m => m.type === 'applied-damage');
        for (const app of damageApplications) {
            const message = (game as any).messages.get(app.msgId);
            if (!message) {
                logWarn(`ActionManager | Could not find ChatMessage ${app.msgId} of type ${app.type} in game.messages to cleanup with enhanced undo!`);
            }
            const appliedDamage = message?.flags?.pf2e?.appliedDamage;
            if (appliedDamage && app.targetUuid) {
                if (!appliedDamage.isReverted) {
                    await ActorManager.undoDamage(app.targetUuid, appliedDamage, app.msgId);
                }
                const { ChatManager } = await import("./ChatManager.ts");
                await ChatManager.deleteMessage(app.msgId);
            } else {
                logWarn(`ActionManager | Message flags or targetUuid missing. Has appliedDamage: ${!!appliedDamage} | Has targetUuid: ${!!app.targetUuid}`);
            }
        }

        // 3. Refund Spell Slot
        if (entry.spellSlot) {
            await ActorManager.refundSpellSlot((combatant as any).actor, entry.spellSlot);
        }

        // 4. Refund Item Usage
        if (entry.itemUsage) {
            await ItemManager.refundItemUsage(entry.itemUsage.uuid, entry.itemUsage);
        }

        // 5. Remove Created Effects
        if (entry.createdEffects && entry.createdEffects.length > 0) {
            for (const uuid of entry.createdEffects) {
                const effect = await fromUuid(uuid as any);
                if (effect && "delete" in effect) {
                    await (effect as any).delete({});
                }
            }
        }

        // 5.5. Refund Spent Hero Point
        if (entry.spentHeroPoint) {
            const actor = (combatant as any).actor;
            if (actor) {
                const current = actor.system.resources?.heroPoints?.value ?? 0;
                const max = actor.system.resources?.heroPoints?.max ?? 3;
                const newValue = Math.min(max, current + 1);
                await actor.update({ "system.resources.heroPoints.value": newValue });
            }
        }

        // 6. Delete Linked Messages (Rolls etc)
        const { ChatManager } = await import("./ChatManager.ts");
        const entryLinks = entry.linkedMessages || [];
        if (entryLinks.length > 0) {
            const messageIds = entryLinks
                .filter(m => m.type !== 'applied-damage')
                .map(m => m.msgId);
            await Promise.allSettled(messageIds.map(id => ChatManager.deleteMessage(id)));
        }

        // 7. Delete the primary message
        await ChatManager.deleteMessage(entry.msgId);
    }

    static async completeComplexAction(combatant: CombatantPF2e, action: ActionLogEntry) {
        if (!isCurrentUserActiveGM()) {
            const { SocketsManager } = await import("./SocketManager.ts");
            return await SocketsManager.socket.executeAsGM("completeComplexAction", {
                combatantId: (combatant as any as Combatant).id,
                action
            });
        }

        const currentLog = [...DBManager.getLog(combatant)];
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

        await DBManager.updateLogs(combatant, currentLog, true);
    }

    static async stopSustaining(combatant: CombatantPF2e, itemId: string) {
        const currentLogs = DBManager.getLog(combatant);
        await DBManager.updateLogs(combatant, currentLogs, true, itemId);
    }

    static getFlattenedActions(combatant: CombatantPF2e): ActionLogEntry[] {
        const log = DBManager.getLog(combatant);
        return log.flatMap(entry => {
            if (entry.ComplexActionState) {
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
        return getCurrentMapStateFromLog(DBManager.getLog(combatant), isActiveTurn);
    }


    /**
     * Determine how many actions / reactions to drain from slows/starts, and logs the system action accordingly
     */
    private static calculateStartOfTurnDrains(combatant: CombatantPF2e, quickenedOverride?: boolean) {
        const actor = (combatant as any).actor!;
        const stunnedVal = ActorManager.getConditionValue(actor, "stunned");
        const slowedVal = ActorManager.getConditionValue(actor, "slowed");
        const isParalyzed = actor.hasCondition("paralyzed");
        const maxActions = ActorManager.getMaxActions(combatant, quickenedOverride);

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
            reactionsSpent = ActorManager.getSlots(combatant, 'reaction').length;
            logEntries.push({ type: 'reaction', cost: reactionsSpent, msgId: "System", label: `${isParalyzed ? 'Paralyzed' : 'Stunned'}: Reaction Lost`, isQuickenedEligible: false, category: "system", linkedMessages: [] });
        }

        return { logEntries, actionsSpent, reactionsSpent };
    }

    /**
     * Handles when conditions are dynamically added or removed mid-turn/off-turn.
     */
    static async handleConditionChange(combatant: CombatantPF2e) {
        const c = combatant as any;
        const actor = c.actor as ActorPF2e | undefined;
        if (!actor) return;

        const stunnedVal = ActorManager.getConditionValue(actor, "stunned");
        const isParalyzed = actor.hasCondition("paralyzed");

        let log = [...DBManager.getLog(combatant)];
        const reactionDrainIndex = log.findIndex(e => e.type === 'reaction' && e.category === 'system' && e.label.includes('Reaction Lost'));

        const needsReactionDrain = isParalyzed || stunnedVal > 0;

        let changed = false;

        if (needsReactionDrain && reactionDrainIndex === -1) {
            const reactionsSpent = ActorManager.getSlots(combatant, 'reaction').length;
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
            await DBManager.updateLogs(combatant, log, false);
        }
    }

    /**
     * Determine if there are any remaining actions for a user this round.
     */
    private static async checkUnderSpend(combatant: CombatantPF2e, log: readonly ActionLogEntry[]) {
        const c = combatant as any;
        const spent = log.filter(e => e.type === 'action' || e.type === 'system').reduce((acc, e) => acc + this.getEntryCost(e, log), 0);
        const actor = c.actor as ActorPF2e | undefined;
        if (!actor) return;

        const max = ActorManager.getMaxActions(combatant);
        if (spent < max) {
            const diff = max - spent;
            const { ChatManager } = await import("./ChatManager.ts");
            await ChatManager.triggerAlert(actor, "Economy", `**${c.name}** ended turn with **${diff}** actions/bonus actions remaining.`, 'whisperUnderspend');
        }
    }

    private static async _linkDamageApplicationToActionInternal(combatant: CombatantPF2e, originMsgId: string, targetUuid: string, cardId: string) {
        const originMessage = (game as any).messages.get(originMsgId);
        const originatingActionId = originMessage?.getFlag(SCOPE, "originatingActionId");

        const entry = this.getFlattenedActions(combatant).find(e =>
            e.msgId === originMsgId ||
            e.msgId === originatingActionId ||
            e.linkedMessages.some(m => m.type === 'damage' && m.msgId === originMsgId) ||
            (e.ComplexActionState && e.ComplexActionState.combinedDamageMessageId === originMsgId)
        );

        if (entry) {
            const linkedMessages = [...entry.linkedMessages];
            // Prevent duplicate logs for the same card
            if (!linkedMessages.some(m => m.type === 'applied-damage' && m.msgId === cardId)) {
                linkedMessages.push({ type: 'applied-damage', msgId: cardId, targetUuid });
                await this.editAction(combatant, entry.msgId, { linkedMessages });
            }
        }
    }
}
