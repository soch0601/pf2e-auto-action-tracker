import { logInfo } from "../logger.ts";

export class ItemRefundService {
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
                        logInfo(`ItemRefundService | Failed to parse or create deleted consumable!`, e);
                    }
                }
            }
        } else if (!item) {
            logInfo(`ItemRefundService | Failed to refund item ${itemUuid} because it was deleted and no itemData snapshot was found in usage metadata!`, usage);
        }
    }
}
