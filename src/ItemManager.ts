import { findCombatantByTokenOrActor } from "./foundryCompat.ts";
import { isCurrentUserActiveGM } from "./foundryCompat.ts";
import { recentIntent } from "./globals.ts";
import { logInfo } from "./logger.ts";
import { ActionManager } from "./ActionManager.ts";

export class ItemManager {
    public static async handleCreateItem(item: any) {
        if (!isCurrentUserActiveGM()) return;
        if (item.type !== "condition" && item.type !== "effect") return;

        const actor = item.parent;
        if (!actor) return;

        const combatant = findCombatantByTokenOrActor(game.combat, undefined, actor.id);
        const c = combatant as any;
        if (!c?.id || !combatant) return;

        // --- Enhanced Undo: Track Created Effects ---
        const uniqueKey = c.token?.id || actor.id;
        const intentItemId = recentIntent.get(uniqueKey);

        if (intentItemId) {
            const entry = ActionManager.getFlattenedActions(combatant).find(e =>
                e.slug === intentItemId ||
                e.label === intentItemId ||
                (e as any).itemId === intentItemId
            );

            if (entry) {
                const createdEffects = entry.createdEffects || [];
                if (!createdEffects.includes(item.uuid)) {
                    createdEffects.push(item.uuid);
                    await ActionManager.editAction(combatant, entry.msgId, { createdEffects });
                }
            }
        }

        if (item.slug === "stunned" || item.slug === "paralyzed") {
            const { enqueueAction } = await import("./main.ts");
            enqueueAction(c.id, async () => await ActionManager.handleConditionChange(combatant));
        }
    }

    public static async handleUpdateItem(item: any, updateData: any) {
        if (!isCurrentUserActiveGM()) return;
        if (item.type !== "condition" && item.type !== "effect") return;

        if (item.slug === "stunned" || item.slug === "paralyzed") {
            if (updateData.system?.value !== undefined) {
                const actor = item.parent;
                if (!actor) return;

                const combatant = findCombatantByTokenOrActor(game.combat, undefined, actor.id);
                const c = combatant as any;
                if (!c?.id || !combatant) return;

                const { enqueueAction } = await import("./main.ts");
                enqueueAction(c.id, async () => await ActionManager.handleConditionChange(combatant));
            }
        }
    }

    public static async handleDeleteItem(item: any) {
        if (!isCurrentUserActiveGM()) return;
        if (item.type !== "condition" && item.type !== "effect") return;

        if (item.slug === "stunned" || item.slug === "paralyzed") {
            const actor = item.parent;
            if (!actor) return;

            const combatant = findCombatantByTokenOrActor(game.combat, undefined, actor.id);
            const c = combatant as any;
            if (!c?.id || !combatant) return;

            const { enqueueAction } = await import("./main.ts");
            enqueueAction(c.id, async () => await ActionManager.handleConditionChange(combatant));
        }
    }

    /**
     * Differentiates between items that have a "Use" button and those that don't.
     */
    public static itemRequiresExplicitUse(item: any): boolean {
        if (!item) return false;
        if (item.type === "spell" || item.type === "consumable") return true;
        if (item.system.frequency) return true;
        if (item.system.uses?.max > 0) return true;
        if (item.system.activations && Object.keys(item.system.activations).length > 0) return true;
        return false;
    }

    /**
     * Reverts item resources (quantity, uses, frequency) to a previous state.
     */
    public static async refundItemUsage(itemUuid: string, usage: any) {
        const item = await fromUuid(itemUuid as any);

        if (item instanceof Item) {
            const updateData: Record<string, unknown> = {};
            if (usage.quantity !== undefined) updateData["system.quantity"] = usage.quantity;
            if (usage.uses?.value !== undefined) updateData["system.uses.value"] = usage.uses.value;
            if (usage.frequency?.value !== undefined) updateData["system.frequency.value"] = usage.frequency.value;

            if (Object.keys(updateData).length > 0) {
                await item.update(updateData, { diff: true });
            }
        } else if (!item && usage.itemData) {
            // The item was deleted (e.g. consumable reached 0 quantity)
            // We must recreate it on the actor!
            const parts = itemUuid.split(".");
            const itemIndex = parts.indexOf("Item");
            if (itemIndex > 0) {
                const actorUuid = parts.slice(0, itemIndex).join(".");
                const actor = await fromUuid(actorUuid as any);
                if (actor && "createEmbeddedDocuments" in actor) {
                    try {
                        const itemData = typeof usage.itemData === "string" ? JSON.parse(usage.itemData) : usage.itemData;
                        await (actor as any).createEmbeddedDocuments("Item", [itemData]);
                    } catch (e) {
                        logInfo(`ItemManager | Failed to parse or create deleted consumable!`, e);
                    }
                }
            }
        } else if (!item) {
            logInfo(`ItemManager | Failed to refund item ${itemUuid} because it was deleted and no itemData snapshot was found in usage metadata!`, usage);
        }
    }
}
