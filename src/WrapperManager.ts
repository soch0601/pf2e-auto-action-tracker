import { ChatManager } from "./ChatManager.ts";
import { ItemManager } from "./ItemManager.ts";
import { logWarn } from "./logger.ts";
import { recentIntent } from "./globals.ts";
import { findCombatantByMessage } from "./foundryCompat.ts";
import { SCOPE } from "./globals.ts";
import { ChatPendingState } from "./ChatPendingState.ts";

declare const libWrapper: any;

export class WrapperManager {

    static wrapFunctions() {
        if (typeof libWrapper === 'undefined') {
            logWarn('libWrapper not found! Reroll tracking will be disabled.');
            return;
        }

        this.registerCheckWrappers();
        this.registerSpellWrappers();
        this.registerActorWrappers();
        this.registerItemWrappers();
    }

    private static tryRegister(target: string, fn: any) {
        try {
            libWrapper.register("pf2e-auto-action-tracker", target, fn, "WRAPPER");
        } catch (e) {
            const reason = (e instanceof Error ? e.message : String(e)) || "unknown error";
            logWarn(`libWrapper failed to wrap ${target}: ${reason}. Related tracking will be disabled.`);
        }
    }

    private static registerCheckWrappers() {
        // Wrap the Check.rerollFromMessage to log the old message ID from a message being rerolled.
        this.tryRegister("game.pf2e.Check.rerollFromMessage", function (this: any, wrapped: Function, ...args: any[]) {
            const message = args[0];
            const options = args[1] || {};
            const isHeroPoint = options.resource === "hero-points" || !!options.heroPoint || options.type === "hero-point" || !options.keep;

            if (message?.id) {
                const combatant = findCombatantByMessage(game.combat, message);
                if (combatant?.id) {
                    ChatManager.broadcastReroll(combatant.id, message.id);
                }
                const actorUuid = message.actor?.uuid;
                if (actorUuid) {
                    ChatPendingState.setPendingReroll(actorUuid, isHeroPoint);
                }
            }

            return wrapped.apply(this, args);
        });
    }

    private static registerSpellWrappers() {
        // Wrapper for tracking spell casting
        this.tryRegister(
            "CONFIG.PF2E.Item.documentClasses.spellcastingEntry.prototype.cast",
            async function (this: any, wrapped: Function, spell: any, options: any = {}) {
                const actor = this.actor;
                const token = actor.token ?? actor.getActiveTokens()[0];

                const detectionKey = token?.id ?? actor.id;
                const dataKey = token?.uuid ?? actor.uuid;

                if (detectionKey && spell) {
                    recentIntent.set(detectionKey, spell.id);
                }

                // Enhanced Undo: Store slot info BEFORE the cast to avoid race conditions with the chat hook
                if (options.consume !== false) {
                    const isFocus = this.system.prepared?.value === "focus" || spell.isFocusSpell;
                    const slotInfo = {
                        entryId: this.id,
                        rank: options.level || spell.rank || spell.level,
                        index: options.slot,
                        isFocus
                    };
                    ChatPendingState.setPendingSpellSlot(dataKey, slotInfo);
                }

                const result = await wrapped(spell, options);

                if (result instanceof (game as any).messages.documentClass && options.consume !== false) {
                    const isFocus = this.system.prepared?.value === "focus" || spell.isFocusSpell;
                    const slotInfo = {
                        entryId: this.id,
                        rank: options.level || spell.rank || spell.level,
                        index: options.slot,
                        isFocus
                    };
                    // Set the flag (async, might be late, but good for persistence)
                    await result.setFlag(SCOPE, "spellSlotUsage", slotInfo);
                }

                return result;
            }
        );
    }

    private static registerActorWrappers() {
        // Wrapper for tracking damage application
        this.tryRegister(
            "CONFIG.Actor.documentClass.prototype.applyDamage",
            async function (this: any, wrapped: Function, ...args: any[]) {
                const { ChatCardRenderer } = await import("./ChatCardRenderer.ts");
                const { ChatPendingState } = await import("./ChatPendingState.ts");
                // Prioritize the synchronous variable as it is the most "fresh"
                const lastDamageMsgId = ChatCardRenderer.lastClickedMessageId || (game as any).user.getFlag(SCOPE, "lastDamageMessageId");

                if (lastDamageMsgId) {
                    const message = (game as any).messages.get(lastDamageMsgId);
                    if (message) {
                        const combatant = findCombatantByMessage(game.combat, message);
                        if (combatant) {
                            ChatPendingState.setPendingDamageOrigin(this.uuid, {
                                originMsgId: lastDamageMsgId,
                                combatantId: combatant.id
                            });
                        }
                    }

                    // Clean up both after a short delay to allow parallel applyDamage calls (e.g., area healing/damage) to resolve
                    setTimeout(async () => {
                        if (ChatCardRenderer.lastClickedMessageId === lastDamageMsgId) {
                            ChatCardRenderer.lastClickedMessageId = null;
                        }
                        const currentFlag = await (game as any).user.getFlag(SCOPE, "lastDamageMessageId");
                        if (currentFlag === lastDamageMsgId) {
                            await (game as any).user.unsetFlag(SCOPE, "lastDamageMessageId");
                            await (game as any).user.unsetFlag(SCOPE, "lastDamageIsHealing");
                        }
                    }, 500);
                }

                return await wrapped(...args);
            }
        );
    }

    private static registerItemWrappers() {
        const createItemWrapper = (methodName: string) => {
            return async function (this: any, wrapped: Function, ...args: any[]) {
                const actor = this.actor;
                if (!actor) return wrapped(...args);

                const token = actor.token ?? actor.getActiveTokens()[0];
                const detectionKey = token?.id ?? actor.id;
                const dataKey = token?.uuid ?? actor.uuid;

                // 1. Mark intent for detection - ONLY if it's an explicit use (not a link)
                const event = args.find(a => a instanceof Event);
                const isToMessage = methodName === "toMessage";

                let isUse = !isToMessage;

                if (event) {
                    const target = event.target as HTMLElement;
                    const isExplicitAction = !!target.closest('[data-action*="use"], [data-action*="consume"], [data-action*="activate"], [data-action*="cast"], .use-item');
                    const isLinkClick = !!target.closest('[data-action$="to-chat"], [data-action$="to-message"], [data-action="toMessage"], .item-to-chat');

                    if (isToMessage) {
                        // toMessage is a link unless there is no dedicated use from frequency (PF2E system) - so count it if needed
                        const requiresUse = ItemManager.itemRequiresExplicitUse(this);
                        isUse = isExplicitAction || (isLinkClick && !requiresUse);
                    } else if (isLinkClick) {
                        isUse = false;
                    }

                } else if (isToMessage) {
                    // No event + toMessage.
                    const item = this as any;
                    const type = item.type;
                    const name = item.name;

                    if (["action", "feat"].includes(type)) {
                        isUse = true;
                    }
                }

                if (detectionKey && isUse) {
                    recentIntent.set(detectionKey, this.id);
                }

                let usage: any = null;

                if (isUse) {
                    // 2. Capture resource state BEFORE use for Enhanced Undo
                    usage = { uuid: this.uuid };
                    const system = this.system || {};

                    const qty = system.quantity !== undefined ? system.quantity : (this as any).quantity;

                    if (qty !== undefined) usage.quantity = foundry.utils.deepClone(qty);
                    if (system.uses) usage.uses = foundry.utils.deepClone(system.uses);
                    if (system.frequency) usage.frequency = foundry.utils.deepClone(system.frequency);

                    const isConsumableDepleted = this.type === "consumable" && (qty === 1 || qty === 0 || qty === "1" || qty === "0");
                    const isUsesAutoDestroy = (system.uses?.autoDestroy && system.uses?.value === 1) || (this.system?.uses?.autoDestroy && this.system?.uses?.value === 1);

                    if (isConsumableDepleted || isUsesAutoDestroy) {
                        usage.itemData = JSON.stringify(this.toObject());
                    } else if (this.type === "spell" && system.location?.value) {
                        const parentItem = this.actor.items.get(system.location.value);
                        if (parentItem) {
                            const parentQty = parentItem.system?.quantity !== undefined ? parentItem.system.quantity : (parentItem as any).quantity;
                            const isParentConsumableDepleted = parentItem.type === "consumable" && (parentQty === 1 || parentQty === 0 || parentQty === "1" || parentQty === "0");
                            const isParentUsesAutoDestroy = parentItem.system?.uses?.autoDestroy && parentItem.system?.uses?.value === 1;

                            // Always track resource consumption on the parent item (wand, scroll, staff, etc.)
                            usage.uuid = parentItem.uuid;
                            if (parentQty !== undefined) usage.quantity = foundry.utils.deepClone(parentQty);
                            if (parentItem.system?.uses) usage.uses = foundry.utils.deepClone(parentItem.system.uses);
                            if (parentItem.system?.frequency) usage.frequency = foundry.utils.deepClone(parentItem.system.frequency);

                            // Only store full itemData if the parent item will be depleted/destroyed and needs recreation
                            if (isParentConsumableDepleted || isParentUsesAutoDestroy) {
                                usage.itemData = JSON.stringify(parentItem.toObject());
                            }
                        }
                    }

                    ChatPendingState.setPendingItemUsage(this.actor.uuid, usage, (this as any).token?.uuid);
                }

                const result = await wrapped(...args);

                // 3. If the result is a chat message, we can also set the flag for persistence
                if (isUse && usage && result instanceof (game as any).messages.documentClass) {
                    await result.setFlag(SCOPE, "itemUsage", usage);
                }

                return result;
            };
        };

        // Wrap common activation points
        const classesToWrap = ["consumable", "feat", "action", "equipment", "weapon", "armor", "spell"];
        const itemClasses = (CONFIG as any).PF2E.Item.documentClasses;

        for (const type of classesToWrap) {
            const docClass = itemClasses[type];
            if (!docClass) continue;

            if (docClass.prototype.toMessage) {
                this.tryRegister(`CONFIG.PF2E.Item.documentClasses.${type}.prototype.toMessage`, createItemWrapper("toMessage"));
            }

            if (docClass.prototype.use) {
                this.tryRegister(`CONFIG.PF2E.Item.documentClasses.${type}.prototype.use`, createItemWrapper("use"));
            }
        }

        // Specifically for consumables which often use .consume()
        this.tryRegister(
            "CONFIG.PF2E.Item.documentClasses.consumable.prototype.consume",
            createItemWrapper("consume")
        );
    }
}