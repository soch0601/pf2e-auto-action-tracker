import { findCombatantByTokenOrActor } from "../foundryCompat.ts";
import { isCurrentUserActiveGM } from "../foundryCompat.ts";
import { recentIntent } from "../globals.ts";
import { ActionManager } from "../ActionManager.ts";
import { enqueueAction } from "../actionQueue.ts";

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
}
