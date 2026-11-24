import type { ActionLogEntry } from "../ActionLogTypes.ts";
import { SCOPE, recentIntent } from "../globals.ts";
import type { ActorPF2e, CombatantPF2e } from "module-helpers";
import { ComplexActionEngine } from "../complexActions/ComplexActionEngine.ts";
import { ActorManager } from "../ActorManager.ts";
import { logInfo } from "../logger.ts";
import * as Detectors from "../chatTypeDetectors/index.ts";
import type { IActionDetails, DetectedAction } from "../chatTypeDetectors/IActionDetector.ts";
import { findCombatantByMessage, findCombatantById, getOpenApplications, isCurrentUserActiveGM } from "../foundryCompat.ts";
import { ChatPendingState } from "./ChatPendingState.ts";
import { ChatMessageService } from "./ChatMessageService.ts";
import { AlertService } from "./AlertService.ts";
import { SustainReminderService } from "./SustainReminderService.ts";
import { SocketSender } from "../sockets/SocketSender.ts";
import { ActionManager } from "../ActionManager.ts";
import { DamageCombinator } from "../damageCombinator.ts";
import { getSlugFromMsgFlavor } from "../chatTypeDetectors/detectorUtilities.ts";
import { SummonManager } from "../summons/index.ts";

type CombatantId = string;

export class ChatManager {
    private static rerollQueue: Record<CombatantId, string[]> = {};

    public static deleteMessage(msgId: string) {
        return ChatMessageService.deleteMessage(msgId);
    }

    public static deleteMessages(msgIds: string[]) {
        return ChatMessageService.deleteMessages(msgIds);
    }

    public static async handleChatPayload(message: any) {
        const pf2eFlags = message.flags?.pf2e;

        // --- Enhanced Undo: Link Damage Taken Cards ---
        if (pf2eFlags?.context?.type === "damage-taken") {
            const origin = message.getFlag(SCOPE, "damageOrigin") as { originMsgId: string, combatantId: string } | undefined;
            if (origin) {
                const { originMsgId, combatantId } = origin;
                const targetCombatant = findCombatantById(game.combat, combatantId);
                if (targetCombatant) {
                    const speaker = message.speaker || {};
                    let actorUuid = message.actor?.uuid;
                    if (!actorUuid) {
                        if (speaker.token && speaker.scene) {
                            const tokenDoc = game.scenes.get(speaker.scene)?.tokens.get(speaker.token);
                            actorUuid = tokenDoc?.actor?.uuid || `Actor.${speaker.actor}`;
                        } else if (speaker.actor) {
                            actorUuid = `Actor.${speaker.actor}`;
                        }
                    }
                    if (actorUuid) {
                        logInfo(`ChatManager | handleChatPayload: Linking damage-taken message ${message.id} to origin action ${originMsgId} on combatant ${combatantId}`);
                        await ActionManager.linkDamageApplicationToAction(targetCombatant, originMsgId, actorUuid, message.id);
                    }
                }
            } else {
                logInfo(`ChatManager | handleChatPayload: Ignoring damage-taken message ${message.id} (no damageOrigin flag)`);
            }
            return;
        }

        const combatant = findCombatantByMessage((game as any).combat, message);
        if (!combatant) {
            logInfo(`ChatManager | handleChatPayload: No combatant found in active combat for message ${message.id}, ignoring.`);
            return;
        }
        const c = combatant as any;

        const speaker = message.speaker || {};
        let actorUuid = message.actor?.uuid;
        let tokenId = (message as any).token?.uuid;

        if (!actorUuid && speaker.actor) {
            if (speaker.token && speaker.scene) {
                tokenId = `Scene.${speaker.scene}.Token.${speaker.token}`;
                const tokenDoc = game.scenes.get(speaker.scene)?.tokens.get(speaker.token);
                actorUuid = tokenDoc?.actor?.uuid || `Actor.${speaker.actor}`;
            } else {
                actorUuid = `Actor.${speaker.actor}`;
            }
        }

        // --- Enhanced Undo: Link Spell Attack Rolls ---
        if (pf2eFlags?.context?.type === "attack-roll") {
            const htmlPool = `${message.flavor || ""} ${message.content || ""}`.trim();
            const slug = pf2eFlags.context.action || getSlugFromMsgFlavor(htmlPool) || "attack";

            const isSpellAttack = message.item?.type === "spell" || slug.toLowerCase().includes("spell");
            if (isSpellAttack) {
                logInfo(`ChatManager | handleChatPayload: Message ${message.id} is a spell attack roll (slug: ${slug}). Linking to parent spell cast instead of counting a new action.`);
                const originUuid = pf2eFlags.origin?.uuid;

                const queue = (c.getFlag(SCOPE, 'pendingAttackQueue') as string[]) || [];
                if (queue.length > 0) {
                    const originatingMsgId = queue.pop();
                    await c.setFlag(SCOPE, 'pendingAttackQueue', queue);

                    if (originatingMsgId) {
                        const entry = ActionManager.getActionById(combatant, originatingMsgId);
                        if (entry) {
                            const linkedMessages = [...(entry.linkedMessages || []), { type: 'attack', msgId: message.id } as const];
                            await ActionManager.editAction(combatant, entry.msgId, { linkedMessages });
                            return;
                        }
                    }
                }

                await ActionManager.linkSpellAttackToAction(combatant, message.item?.uuid, message.item?.id, originUuid, message.item?.name, message.id);
                return;
            }
        }

        const originId = await this.maybeGetOriginMsgId(message);
        if (originId) {
            logInfo(`ChatManager | handleChatPayload: Message ${message.id} is a damage roll linked to origin action ${originId}. Linking without counting a new action.`);
            await this.linkDamageRollToAction(combatant, originId, message.id);
            return;
        }

        if (pf2eFlags?.context?.isReroll) {
            const oldMsgId = this.popFromRerollQueue(c.id);

            if (!oldMsgId) {
                logInfo("Reroll detected but the queue was empty.");
                return;
            }

            const action = ActionManager.getActionById(combatant, oldMsgId);
            if (!action) {
                logInfo(`Reroll detected for ${oldMsgId}, but no matching action was found in history.`);
                return;
            }

            logInfo(`ChatManager | handleChatPayload: Message ${message.id} is a reroll of ${oldMsgId}. Updating existing action.`);
            const spentHeroPoint = message.getFlag(SCOPE, "heroPointSpent");
            await ActionManager.editAction(combatant, oldMsgId, {
                msgId: message.id,
                spentHeroPoint: !!spentHeroPoint
            });
            return;
        }

        // Delegate detection and metadata extraction to Parser
        let sustainItem: { id: string, name: string, minionTokenId?: string } | undefined;
        if (Detectors.SustainDetector.isSustainMessage(message)) {
            const { itemId, itemName, minionTokenId } = Detectors.SustainDetector.getSustainMetadata(message);
            if (itemId) {
                sustainItem = { id: itemId, name: itemName, ...(minionTokenId ? { minionTokenId } : {}) };
            }
        }

        const data = this.runMessageDetectors(message);
        if (!data) return;

        const isQuickenedEligible = data.isQuickenedEligible ?? ActorManager.isActionQuickenedEligible(combatant, data.slug || "");

        // Check if we are updating an existing message or logging a new one
        const log = ActionManager.getActionById(combatant, message.id);

        const mapMetadata: Pick<ActionLogEntry, "isMapRelevant" | "mapProfile"> =
            data.isMapRelevant
                ? {
                    isMapRelevant: true,
                    mapProfile: data.mapProfile ?? "standard"
                }
                : {
                    isMapRelevant: false,
                    mapProfile: undefined
                };

        if (log) {
            const update: Partial<ActionLogEntry> = {
                cost: data.cost as any,
                label: data.label,
                isQuickenedEligible,
                rank: data.rank,
                ...mapMetadata
            };
            await ActionManager.editAction(combatant, message.id, update);
        } else {
            // 1. Determine if it is a reaction based on the parser OR the turn state
            const isActiveTurn = SummonManager.isActiveTurnForCombatant((game as any).combat, combatant);
            const type = (data.isReaction || !isActiveTurn) ? 'reaction' : 'action';

            // 2. Add the action
            await ActionManager.addAction(combatant, {
                cost: data.cost as any,
                msgId: message.id,
                label: data.label,
                type: type,
                slug: data.slug,
                isQuickenedEligible,
                ...mapMetadata,
                category: data.category,
                linkedMessages: [],
                rank: data.rank,
                spellSlot: (message.getFlag(SCOPE, "spellSlotUsage") as any) || (actorUuid ? ChatPendingState.getPendingSpellSlot(actorUuid, tokenId) : undefined),
                itemUsage: (message.getFlag(SCOPE, "itemUsage") as any) || (actorUuid ? ChatPendingState.getPendingItemUsage(actorUuid, tokenId) : undefined),
                sustainItem
            });
        }
    }

    public static async linkDamageRollToAction(combatant: CombatantPF2e, attackMsgId: string, damageMsgId: string) {
        let entry = ActionManager.getActionById(combatant, attackMsgId);

        if (!entry) {
            entry = ActionManager.getFlattenedActions(combatant).find(e =>
                e.linkedMessages.some(m => m.msgId === attackMsgId)
            );
        }

        if (entry) {
            const linkedMessages = [...entry.linkedMessages, { type: 'damage', msgId: damageMsgId } as const];
            await ActionManager.editAction(combatant, entry.msgId, { linkedMessages });

            const updatedParent = ActionManager.getFlattenedActions(combatant).find(e =>
                e.ComplexActionState && (
                    ComplexActionEngine.getAllChildMessageIds(e.ComplexActionState).includes(attackMsgId) ||
                    ComplexActionEngine.getAllChildMessageIds(e.ComplexActionState).includes(entry.msgId)
                )
            );

            if (updatedParent && updatedParent.ComplexActionState) {
                await DamageCombinator.processDamageCombination(combatant, updatedParent, damageMsgId);
            }
        }
    }

    public static async handleDamageModifierDialogRender(combatant: CombatantPF2e, app: any) {
        const c = combatant as any;
        const queue = (c.getFlag(SCOPE, 'pendingDamageQueue') as string[]) || [];
        if (queue.length === 0) return;

        const originMsgId = queue.pop();
        if (!originMsgId) return;

        await c.setFlag(SCOPE, 'pendingDamageQueue', queue);
        app.options.originatingMessageId = originMsgId;
    }

    public static async maybeGetOriginMsgId(message: any) {
        const isDamageRoll = message.flags?.pf2e?.context?.type === "damage-roll";
        if (!isDamageRoll) return;

        const combatant = findCombatantByMessage((game as any).combat, message);
        if (!combatant) return;

        let originatingMsgId: string | undefined;

        const activeDialog = getOpenApplications().find(
            (w: any) => w.constructor.name === "DamageModifierDialog" && w.actor?.id === (combatant as any).actorId
        ) as any;

        if (activeDialog?.options?.originatingMessageId) {
            originatingMsgId = activeDialog.options.originatingMessageId;
            delete activeDialog.options.originatingMessageId;
        } else {
            const c = combatant as any;
            const queue = (c.getFlag(SCOPE, 'pendingDamageQueue') as string[]) || [];
            if (queue.length > 0) {
                originatingMsgId = queue.pop();
                await c.setFlag(SCOPE, 'pendingDamageQueue', queue);
            } else {
                const speaker = message.speaker || {};
                const itemOriginUuid = message.flags?.pf2e?.origin?.uuid;
                const itemOriginId = message.flags?.pf2e?.origin?.uuid?.split('.').pop();
                const logs = ActionManager.getFlattenedActions(combatant);

                const matchingAction = logs.find(log => {
                    if (log.msgId === itemOriginId) return true;
                    const matchesSpell = log.slug === "cast-a-spell" && log.linkedMessages.some(m => m.msgId === itemOriginId);
                    if (matchesSpell) return true;

                    if (log.slug === "sustain-a-spell" && log.sustainItem?.id === itemOriginId) return true;

                    const exactUuidMatch = log.linkedMessages.some(m => m.type === "attack" && m.msgId === itemOriginId);
                    if (exactUuidMatch) return true;

                    return false;
                });

                if (matchingAction) {
                    originatingMsgId = matchingAction.msgId;
                } else {
                    const recentLogs = logs.filter(log =>
                        log.type === "action" &&
                        (log.slug === "strike" || log.slug === "cast-a-spell" || log.slug === "sustain-a-spell" || log.category === "spell" || log.category === "attack")
                    );

                    // Smart fallback: Find the most recent Strike/Spell attack that does NOT have a linked damage message yet
                    const unlinkedAttack = [...recentLogs].reverse().find(log =>
                        !log.linkedMessages.some(m => m.type === "damage")
                    );

                    if (unlinkedAttack) {
                        originatingMsgId = unlinkedAttack.msgId;
                    } else if (recentLogs.length > 0) {
                        originatingMsgId = recentLogs[recentLogs.length - 1].msgId;
                    }
                }
            }
        }

        return originatingMsgId;
    }

    public static checkSustainReminder(combatant: CombatantPF2e) {
        return SustainReminderService.checkSustainReminder(combatant);
    }

    public static triggerAlert(actor: ActorPF2e, header: string, message: string, settingKey: string) {
        return AlertService.triggerAlert(actor, header, message, settingKey);
    }

    public static addToRerollQueue(combatantId: string, msgId: string) {
        if (!this.rerollQueue[combatantId]) this.rerollQueue[combatantId] = [];
        if (!this.rerollQueue[combatantId].includes(msgId)) {
            this.rerollQueue[combatantId].push(msgId);
        }
    }

    public static broadcastReroll(combatantId: string, msgId: string) {
        this.addToRerollQueue(combatantId, msgId);
        if (!isCurrentUserActiveGM()) {
            SocketSender.sendQueueReroll(combatantId, msgId);
        }
    }

    public static clearRerollQueue(combatantId?: string) {
        if (combatantId) {
            delete this.rerollQueue[combatantId];
        } else {
            this.rerollQueue = {};
        }
    }

    public static async handleDeletedMessage(combatant: CombatantPF2e, msgId: string) {
        if (this.rerollQueueIncludes(combatant, msgId)) return;
        await ActionManager.removeAction(combatant, msgId);
    }

    private static rerollQueueIncludes(combatant: CombatantPF2e, msgId: string): boolean {
        const combatantId = (combatant as unknown as Combatant).id;
        if (!combatantId) return false;
        return this.rerollQueue[combatantId]?.includes(msgId) ?? false;
    }

    private static popFromRerollQueue(combatantId: string): string | undefined {
        return this.rerollQueue[combatantId]?.shift();
    }

    private static runMessageDetectors(message: any): DetectedAction | undefined {
        const activeDetectors = [
            Detectors.HardIgnoreDetector,
            Detectors.SustainDetector,
            Detectors.SpellDetector,
            Detectors.ConsumableDetector,
            Detectors.AttackDetector,
            Detectors.SkillDetector,
            Detectors.GenericActionDetector
        ];

        const pf2eFlags = message.flags?.pf2e;
        const isExplicitUse = !!message.flags?.[SCOPE]?.isExplicitUse;
        const originUuid = pf2eFlags?.origin?.uuid;
        const originType = pf2eFlags?.origin?.type;
        const contextType = pf2eFlags?.context?.type;
        const contextAction = pf2eFlags?.context?.action;

        logInfo(
            `ChatManager | Evaluating message ${message.id} | item: "${message.item?.name || "none"}" (type: ${message.item?.type || originType || "none"}, slug: ${message.item?.slug || pf2eFlags?.origin?.slug || "none"}) | isExplicitUse: ${isExplicitUse} | context.type: ${contextType || "none"} | context.action: ${contextAction || "none"} | origin.uuid: ${originUuid || "none"}`
        );

        for (const Detector of activeDetectors) {
            if (Detector.shouldBreak(message)) {
                logInfo(`ChatManager | [${Detector.id}] -> shouldBreak=true (ignoring message ${message.id} as non-action/noise or link-to-chat without explicit use)`);
                return undefined;
            }

            if (Detector.isType(message)) {
                const details: IActionDetails = Detector.getDetails(message);
                const isPublic = message.whisper.length === 0 || message.whisper.includes(game.user.id);
                const finalLabel = isPublic ? details.label : "Secret Action";

                logInfo(
                    `ChatManager | [${Detector.id}] -> matched message ${message.id}! Details:`,
                    {
                        slug: details.slug,
                        label: details.label,
                        cost: typeof details.cost === "function" ? "<dynamic>" : details.cost,
                        category: Detector.type,
                        isReaction: details.isReaction,
                        isMapRelevant: details.isMapRelevant,
                        mapProfile: details.mapProfile,
                        rank: details.rank,
                        isQuickenedEligible: details.isQuickenedEligible
                    }
                );

                return {
                    cost: details.cost ?? 0,
                    slug: details.slug ?? "",
                    label: finalLabel ?? "",
                    isReaction: details.isReaction,
                    category: Detector.type,
                    isMapRelevant: details.isMapRelevant,
                    mapProfile: details.mapProfile,
                    rank: details.rank,
                    isQuickenedEligible: details.isQuickenedEligible
                };
            } else {
                logInfo(`ChatManager | [${Detector.id}] -> isType=false`);
            }
        }

        logInfo(`ChatManager | No detector matched message ${message.id}. Message ignored.`);
        return undefined;
    }

    public static handlePreCreateChatMessage(message: any) {
        const speaker = message.speaker || {};
        let actorUuid = message.actor?.uuid;
        let tokenId = message.token?.uuid;

        if (!actorUuid && speaker.actor) {
            if (speaker.token && speaker.scene) {
                tokenId = `Scene.${speaker.scene}.Token.${speaker.token}`;
                const tokenDoc = game.scenes.get(speaker.scene)?.tokens.get(speaker.token);
                actorUuid = tokenDoc?.actor?.uuid || `Actor.${speaker.actor}`;
            } else {
                actorUuid = `Actor.${speaker.actor}`;
            }
        }

        if (!actorUuid) {
            logInfo("ChatManager | preCreateChatMessage: No actorUuid resolved from speaker/message, skipping flag injection.", speaker);
            return;
        }

        // 1. Spell Slots
        const spellSlot = ChatPendingState.getPendingSpellSlot(actorUuid, tokenId);
        if (spellSlot) {
            logInfo(`ChatManager | preCreateChatMessage: Attached pending spellSlotUsage for ${actorUuid}:`, spellSlot);
            message.updateSource({ flags: { [SCOPE]: { spellSlotUsage: spellSlot } } } as any);
        }

        // 2. Item Usage
        const itemUsage = ChatPendingState.getPendingItemUsage(actorUuid, tokenId);
        if (itemUsage) {
            logInfo(`ChatManager | preCreateChatMessage: Attached pending itemUsage for ${actorUuid} (uuid: ${itemUsage.uuid})`);
            message.updateSource({ flags: { [SCOPE]: { itemUsage: itemUsage } } } as any);
        }

        // 3. Damage Origins
        const pf2eFlags = message.flags?.pf2e as any;
        if (pf2eFlags?.context?.type === "damage-taken") {
            const origin = ChatPendingState.getPendingDamageOrigin(actorUuid);
            if (origin) {
                logInfo(`ChatManager | preCreateChatMessage: Attached pending damageOrigin for ${actorUuid}:`, origin);
                message.updateSource({ flags: { [SCOPE]: { damageOrigin: origin } } } as any);
            }
        }

        // 4. Reroll Hero Point flag injection
        if (pf2eFlags?.context?.isReroll) {
            const isHeroPoint = ChatPendingState.getPendingReroll(actorUuid);
            if (isHeroPoint) {
                logInfo(`ChatManager | preCreateChatMessage: Attached heroPointSpent=true for reroll on ${actorUuid}`);
                message.updateSource({ flags: { [SCOPE]: { heroPointSpent: true } } } as any);
            }
        }

        // 5. Recent Intent flag injection for explicit item uses
        const tokenKey = speaker.token;
        const actorKey = speaker.actor;
        const intentItemId = (tokenKey ? recentIntent.get(tokenKey) : null) || (actorKey ? recentIntent.get(actorKey) : null);
        const originUuid = message.flags?.[SCOPE]?.sustainedItemUuid || message.flags?.pf2e?.origin?.uuid;
        const messageItemId = message.flags?.[SCOPE]?.sustainedItemId || originUuid?.split('.').pop();

        if (intentItemId && (intentItemId === messageItemId || !messageItemId)) {
            logInfo(
                `ChatManager | preCreateChatMessage: Matched explicit use intent! (intentItemId: ${intentItemId}, messageItemId: ${messageItemId || "none"}, tokenKey: ${tokenKey || "none"}, actorKey: ${actorKey || "none"}) -> setting isExplicitUse=true`
            );
            message.updateSource({
                [`flags.${SCOPE}.isExplicitUse`]: true
            });
            if (tokenKey) recentIntent.delete(tokenKey);
            if (actorKey) recentIntent.delete(actorKey);
        } else {
            logInfo(
                `ChatManager | preCreateChatMessage: No explicit use intent matched (intentItemId: ${intentItemId || "none"}, messageItemId: ${messageItemId || "none"}, tokenKey: ${tokenKey || "none"}, actorKey: ${actorKey || "none"}) -> isExplicitUse remains false`
            );
        }
    }
}
