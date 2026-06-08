import { SCOPE, recentIntent } from "./globals.ts";
import { getActorAndTokenFromSheet, findCombatantByMessage, findCombatantById, findCombatantByTokenOrActor } from "./foundryCompat.ts";
import { ChatPendingState } from "./ChatPendingState.ts";

export class ChatCardRenderer {
    public static lastClickedMessageId: string | null = null;

    public static registerOverrideListeners() {
        document.addEventListener('click', async (event) => {
            const target = event.target as HTMLElement;
            const btn = target.closest<HTMLButtonElement>('button');
            if (!btn) return;

            const action = btn.dataset.action;
            const chatMessage = btn.closest('.chat-message');
            const messageId = chatMessage?.getAttribute('data-message-id');
            const btnText = btn.innerText?.toLowerCase() || "";
            const btnClasses = btn.className;

            this.handleSustainMessageItemInjection(messageId);
            await this.handleItemStateCapture(btn, action);

            const lowerAction = action?.toLowerCase() || "";
            const isApplyButton =
                btn.matches('[data-action="apply-damage"], [data-action="applyDamage"], [data-action="apply-healing"], [data-action="applyHealing"], [data-action="full-damage"], [data-action="half-damage"], [data-action="double-damage"], [data-action="triple-damage"]') ||
                lowerAction.includes("applydamage") ||
                lowerAction.includes("applyhealing") ||
                btnText.includes('apply damage');

            const isAttack =
                action?.toLowerCase().includes('attack') ||
                btnText.includes('attack');

            if (btn.matches('[data-action="strike-attack"], [data-action="spell-attack"]') || isAttack) {
                await this.handleAttackButtonClick(btn);
            } else if (btn.matches('[data-action="strike-damage"], [data-action="strike-critical"], [data-action="spell-damage"], [data-action="damage"]') || btnText.includes('damage roll')) {
                await this.handleDamageButtonClick(btn);
            } else if (btn.matches('[data-action="toggle-crit-immune"]')) {
                await this.handleToggleCritImmuneClick(btn);
            } else if (isApplyButton) {
                if (messageId) {
                    this.lastClickedMessageId = messageId;
                    await this.handleApplyDamageHealingClick(btn);
                }
            }
        }, { capture: true });
    }

    private static handleSustainMessageItemInjection(messageId: string | null | undefined) {
        if (!messageId) return;
        const message = game.messages.get(messageId);
        if (message && (message as any).getFlag(SCOPE, "isSustainAutomation")) {
            const itemId = (message as any).getFlag(SCOPE, "sustainedItemId") as string;
            const actor = message.actor;
            if (actor && itemId) {
                Object.defineProperty(message, "item", {
                    get() {
                        return actor.items.get(itemId) || null;
                    },
                    configurable: true
                });
            }
        }
    }

    private static async handleItemStateCapture(btn: HTMLButtonElement, action: string | undefined) {
        if (!action) return;
        if (action.includes('use') || action.includes('consume') || action.includes('activate') || action.includes('cast')) {
            const itemId = btn.dataset.itemId ||
                btn.closest('[data-item-id]')?.getAttribute('data-item-id') ||
                btn.closest('.item')?.getAttribute('data-item-id') ||
                btn.closest('[data-id]')?.getAttribute('data-id');

            const slug = btn.dataset.slug ||
                btn.closest('[data-item-slug]')?.getAttribute('data-item-slug') ||
                btn.closest('[data-slug]')?.getAttribute('data-slug') ||
                btn.closest('.item')?.getAttribute('data-item-slug');

            const actorId = btn.closest('[data-actor-id]')?.getAttribute('data-actor-id') ||
                btn.closest('.sheet')?.getAttribute('data-actor-id') ||
                btn.closest('[data-document-id]')?.getAttribute('data-document-id');
            const tokenId = btn.closest('[data-token-id]')?.getAttribute('data-token-id') ||
                btn.closest('.sheet')?.getAttribute('data-token-id');

            // --- Identify Actor/Token from Sheet ---
            const sheetElement = btn.closest<HTMLElement>('.sheet');
            const { actor, actorId: sheetActorId, tokenId: sheetTokenId } = getActorAndTokenFromSheet(sheetElement);

            const finalActorId = actorId || sheetActorId || btn.closest('[data-actor-id]')?.getAttribute('data-actor-id');
            const finalTokenId = tokenId || sheetTokenId || btn.closest('[data-token-id]')?.getAttribute('data-token-id');

            const uniqueKey = finalTokenId || finalActorId;

            if (uniqueKey && (itemId || slug)) {
                recentIntent.set(uniqueKey, (itemId || slug || ""));

                // --- Capture Item State for Enhanced Undo ---
                const item = actor?.items.get(itemId) || (slug ? actor?.items.find((i: any) => i.slug === slug) : null);
                if (item && item.type !== "spellcastingEntry") {
                    ChatPendingState.setPendingItemUsage(actor.uuid, {
                        uuid: item.uuid,
                        quantity: item.system.quantity !== undefined ? foundry.utils.deepClone(item.system.quantity) : undefined,
                        uses: item.system.uses !== undefined ? foundry.utils.deepClone(item.system.uses) : undefined,
                        frequency: item.system.frequency !== undefined ? foundry.utils.deepClone(item.system.frequency) : undefined
                    }, actor.token?.uuid);
                }
            }
        }
    }

    private static async handleAttackButtonClick(btn: HTMLButtonElement) {
        const chatMessage = btn.closest('.chat-message');
        const originMsgId = chatMessage?.getAttribute('data-message-id');
        if (!originMsgId) return;

        const message = game.messages.get(originMsgId);
        const combatant = findCombatantByMessage((game as any).combat, message);
        if (!combatant) return;

        const c = combatant as any;
        const queue = (c.getFlag(SCOPE, 'pendingAttackQueue') as string[]) || [];
        queue.push(originMsgId);
        await c.setFlag(SCOPE, 'pendingAttackQueue', queue);
    }

    private static async handleDamageButtonClick(btn: HTMLButtonElement) {
        const chatMessage = btn.closest('.chat-message');
        const originMsgId = chatMessage?.getAttribute('data-message-id');
        if (!originMsgId) return;

        const message = game.messages.get(originMsgId);
        const combatant = findCombatantByMessage((game as any).combat, message);
        if (!combatant) return;

        const c = combatant as any;
        const queue = (c.getFlag(SCOPE, 'pendingDamageQueue') as string[]) || [];
        queue.push(originMsgId);
        await c.setFlag(SCOPE, 'pendingDamageQueue', queue);
    }

    private static async handleToggleCritImmuneClick(btn: HTMLButtonElement) {
        const chatMessage = btn.closest('.chat-message');
        const originMsgId = chatMessage?.getAttribute('data-message-id');
        if (!originMsgId) return;

        const message = game.messages.get(originMsgId);
        if (!message) return;

        const flags = message.flags?.[SCOPE];
        if (!flags || !flags.isCombinedDamage) return;

        const currentCritImmuneState = !!flags.isCritImmune;
        const originatingActionId = flags.originatingActionId as string;

        const combatant = findCombatantByMessage((game as any).combat, message);
        if (!combatant || !originatingActionId) return;

        const { ActionManager } = await import("./ActionManager.ts");
        const entry = ActionManager.getActionById(combatant, originatingActionId);

        if (entry && entry.ComplexActionState) {
            const { DamageCombinator } = await import("./damageCombinator.ts");
            await DamageCombinator.processDamageCombination(combatant, entry, undefined, !currentCritImmuneState);
        }
    }

    private static async handleApplyDamageHealingClick(btn: HTMLButtonElement) {
        const chatMessage = btn.closest('.chat-message');
        const messageId = chatMessage?.getAttribute('data-message-id');
        if (messageId) {
            const isHealing = btn.dataset.action === "apply-healing";
            await (game as any).user.setFlag(SCOPE, 'lastDamageMessageId', messageId);
            await (game as any).user.setFlag(SCOPE, 'lastDamageIsHealing', isHealing);
        }
    }

    public static onRenderChatMessage(message: any, html: HTMLElement) {
        const sustainButtons = html.querySelectorAll<HTMLButtonElement>("button[data-action^='sustain-']");
        if (sustainButtons.length === 0) return;

        const choiceData = message.getFlag(SCOPE, "sustainChoice") as { choice: string, itemName: string, combatantId?: string, itemId?: string };

        if (choiceData) {
            this.renderSustainChoiceState(message, html, choiceData);
        } else {
            this.setupSustainButtons(message, sustainButtons);
        }
    }

    private static renderSustainChoiceState(message: any, html: HTMLElement, choiceData: { choice: string, itemName: string, combatantId?: string, itemId?: string }) {
        const card = html.querySelector(".pf2e-auto-action-tracker-sustain-card");
        if (!card) return;
        const yesBtn = card.querySelector<HTMLButtonElement>("button[data-action='sustain-yes']");
        const noBtn = card.querySelector<HTMLButtonElement>("button[data-action='sustain-no']");
        if (!yesBtn || !noBtn) return;
        if (choiceData.choice === "yes") {
            yesBtn.innerHTML = '<i class="fas fa-check"></i> Sustained';
            yesBtn.disabled = true;
            noBtn.style.display = "none";
        } else {
            noBtn.innerHTML = '<i class="fas fa-times"></i> Lapsed';
            noBtn.disabled = true;
            yesBtn.style.display = "none";
        }

        const flexContainer = card.querySelector(".flexrow");
        if (!flexContainer) return;

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "pf2e-sustain-reset-btn";
        resetBtn.style.width = "auto";
        resetBtn.style.flex = "0 0 auto";
        resetBtn.innerHTML = '<i class="fas fa-undo"></i>';
        resetBtn.title = "Reset Choice";
        resetBtn.style.marginLeft = "5px";
        resetBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            const payload = {
                messageId: message.id,
                combatantId: choiceData.combatantId || message.flags?.[SCOPE]?.combatantId,
                itemId: choiceData.itemId || message.flags?.[SCOPE]?.itemId,
                choice: choiceData.choice
            };

            if (game.user.isGM) {
                if (choiceData.choice === "yes") {
                    const cId = payload.combatantId;
                    const combatant = findCombatantById(game.combat, cId);
                    if (combatant) {
                        const { ActionManager } = await import("./ActionManager.ts");
                        const logs = ActionManager.getFlattenedActions(combatant);
                        const sustainAction = logs.find(log => log.slug === "sustain-a-spell" && log.sustainItem?.id === payload.itemId);
                        if (sustainAction) {
                            await ActionManager.removeAction(combatant, sustainAction.msgId);
                        }
                    }
                }
                await (message as any).unsetFlag(SCOPE, "sustainChoice");
            } else {
                const { SocketsManager } = await import("./SocketManager.ts");
                SocketsManager.emitResetSustainChoice(payload);
            }
        });
        flexContainer.appendChild(resetBtn);
    }

    private static setupSustainButtons(message: any, sustainButtons: NodeListOf<HTMLButtonElement>) {
        sustainButtons.forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                const { action, actorId, itemId, itemName, combatantId } = button.dataset;

                const actor = (game.actors as any).get(actorId ?? "");
                if (!actor || (!actor.isOwner && !game.user.isGM)) return;

                const choice = action === "sustain-yes" ? "yes" : "no";
                const payload = {
                    messageId: message.id,
                    actorId: actor.id,
                    combatantId: combatantId,
                    itemId: itemId || "",
                    itemName: itemName || "",
                    choice: choice
                };

                if (game.user.isGM) {
                    if (choice === "yes") {
                        await this.processSustainYes(actor, itemId || "", itemName || "", combatantId, message.id);
                    } else {
                        const combatant = findCombatantById(game.combat, combatantId);
                        await this.processSustainNo(actor, itemId || "", combatant);
                    }
                    await (message as any).setFlag(SCOPE, "sustainChoice", { choice, itemName, combatantId, itemId });
                } else {
                    const { SocketsManager } = await import("./SocketManager.ts");
                    SocketsManager.emitSustainChoice(payload);
                }
            });
        });
    }

    public static async processSustainYes(actor: any, itemId: string, itemName: string, combatantId?: string, reminderMessageId?: string) {
        const item = actor.items.get(itemId);
        const displayName = itemName || item?.name || "Action";
        const combatant = findCombatantById(game.combat, combatantId);
        const token = (combatant as any)?.token;

        const spellContent = item ? await this.getSustainSpellCardContent(item) : "";

        const gmUserIds = game.users.filter((u: any) => u.isGM).map((u: any) => u.id);
        const ownerUserIds = Object.entries(actor.ownership || {})
            .filter(([id, level]) => level === 3 && id !== "default")
            .map(([id]) => id);
        const whisperUserIds = Array.from(new Set([...gmUserIds, ...ownerUserIds]));

        await ChatMessage.create({
            speaker: {
                actor: actor.id,
                token: token?.id,
                scene: token?.parent?.id,
                alias: actor.name
            },
            whisper: whisperUserIds,
            flavor: `<h4 class="action"><strong>Sustain</strong> <span class="action-glyph">1</span></h4>`,
            content: `
                <div class="pf2e-auto-action-tracker-sustain-card-container">
                    <div class="pf2e">Sustaining <strong>${displayName}</strong></div>
                    ${spellContent}
                </div>
            `,
            flags: {
                pf2e: {
                    origin: {
                        name: displayName,
                        type: "action",
                        slug: "sustain-a-spell"
                    },
                    context: {
                        type: "action",
                        title: `Sustain: ${displayName}`,
                        options: ["num-actions:1", "action:sustain-a-spell"]
                    }
                },
                [SCOPE]: {
                    isSustainAutomation: true,
                    sustainedItemId: itemId,
                    sustainedItemName: displayName,
                    reminderMessageId: reminderMessageId
                }
            }
        } as any);
    }

    private static async getSustainSpellCardContent(item: any): Promise<string> {
        try {
            const messageData = await item.toMessage(undefined, { create: false });
            if (messageData && messageData.content) {
                let spellContent = messageData.content;
                const uuid = item.uuid;
                const uuidEscaped = uuid.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                spellContent = spellContent.replace(new RegExp(`data-item-uuid=["']${uuidEscaped}["']`, "g"), "");
                spellContent = spellContent.replace(new RegExp(`data-entry-uuid=["']${uuidEscaped}["']`, "g"), "");
                spellContent = spellContent.replace(new RegExp(`data-uuid=["']${uuidEscaped}["']`, "g"), "");
                spellContent = spellContent.replace(/@UUID\[[^\]]+\]\{([^\}]+)\}/g, "$1");
                return spellContent;
            }
        } catch (err) {
            console.error("PF2e Action Tracker | Failed to generate spell card content for sustain:", err);
        }
        return "";
    }

    public static async processSustainNo(actor: any, itemId: string, combatant?: any) {
        const targetCombatant = combatant || findCombatantByTokenOrActor(game.combat, null, actor.id);

        if (targetCombatant) {
            const { ActionManager } = await import("./ActionManager.ts");
            await ActionManager.stopSustaining(targetCombatant, itemId);
        }

        const item = actor.items.get(itemId);
        const relatedEffects = actor.itemTypes.effect.filter((e: any) => {
            const originUuid = e.flags?.pf2e?.origin?.uuid;
            return (item && originUuid === item.uuid) || originUuid?.includes(itemId);
        });

        for (const effect of relatedEffects) {
            await effect.delete({});
        }

        if (item) {
            const protectedTypes = ["spell", "weapon", "equipment", "consumable", "backpack", "treasure"];
            if (!protectedTypes.includes(item.type)) {
                await item.delete({});
            }
        }
    }
}
