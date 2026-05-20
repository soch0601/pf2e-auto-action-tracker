import type { SpellSlotUsage } from "./ActionLogTypes.ts";

export class ChatPendingState {
    private static pendingDamageOrigins = new Map<string, { originMsgId: string, combatantId: string }>();
    private static pendingSpellSlots = new Map<string, SpellSlotUsage>();
    private static pendingItemUsage = new Map<string, any>();
    private static pendingRerolls = new Map<string, boolean>();

    public static normalizeActorUuid(uuid: string): string {
        if (!uuid) return uuid;
        const parts = uuid.split(".");
        const actorIdx = parts.indexOf("Actor");
        if (actorIdx !== -1 && actorIdx + 1 < parts.length) {
            return `Actor.${parts[actorIdx + 1]}`;
        }
        return uuid;
    }

    public static setPendingReroll(actorUuid: string, isHeroPoint: boolean) {
        const normUuid = this.normalizeActorUuid(actorUuid);
        this.pendingRerolls.set(normUuid, isHeroPoint);
        setTimeout(() => this.pendingRerolls.delete(normUuid), 10000);
    }

    public static getPendingReroll(actorUuid: string): boolean {
        const normUuid = this.normalizeActorUuid(actorUuid);
        const isHeroPoint = this.pendingRerolls.get(normUuid) ?? false;
        this.pendingRerolls.delete(normUuid);
        return isHeroPoint;
    }

    public static setPendingDamageOrigin(actorUuid: string, origin: { originMsgId: string, combatantId: string }) {
        this.pendingDamageOrigins.set(actorUuid, origin);
        setTimeout(() => this.pendingDamageOrigins.delete(actorUuid), 10000);
    }

    public static getPendingDamageOrigin(actorUuid: string): { originMsgId: string, combatantId: string } | undefined {
        const origin = this.pendingDamageOrigins.get(actorUuid);
        if (origin) {
            this.pendingDamageOrigins.delete(actorUuid);
        }
        return origin;
    }

    public static setPendingSpellSlot(uniqueKey: string, slotInfo: SpellSlotUsage) {
        const normKey = this.normalizeActorUuid(uniqueKey);
        this.pendingSpellSlots.set(normKey, slotInfo);
        setTimeout(() => this.pendingSpellSlots.delete(normKey), 10000);
    }

    public static getPendingSpellSlot(actorUuid: string, _tokenId?: string): SpellSlotUsage | undefined {
        const normUuid = this.normalizeActorUuid(actorUuid);
        const slot = this.pendingSpellSlots.get(normUuid);
        if (slot) {
            this.pendingSpellSlots.delete(normUuid);
        }
        return slot;
    }

    public static setPendingItemUsage(actorUuid: string, usage: any, _tokenId?: string) {
        const normUuid = this.normalizeActorUuid(actorUuid);
        const existing = this.pendingItemUsage.get(normUuid);
        if (existing) {
            if (existing.itemData && !usage.itemData) {
                return;
            }
            if (existing.uuid === usage.uuid) {
                if (!usage.itemData || existing.itemData) {
                    return;
                }
            }
        }
        this.pendingItemUsage.set(normUuid, usage);
        setTimeout(() => {
            this.pendingItemUsage.delete(normUuid);
        }, 10000);
    }

    public static getPendingItemUsage(actorUuid: string, _tokenId?: string): any | undefined {
        const normUuid = this.normalizeActorUuid(actorUuid);
        const usage = this.pendingItemUsage.get(normUuid);
        if (usage) {
            this.pendingItemUsage.delete(normUuid);
        }
        return usage;
    }
}
