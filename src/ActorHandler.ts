import { SCOPE } from "./globals.ts";
import type { ActorPF2e, ConditionPF2e, CombatantPF2e } from "module-helpers";
import type { ActionLogEntry } from "./ActionManager.ts";
import { AddActionsLibrary } from "./addActionsData/AddActionsLibrary.ts";
import type { ActionSlot } from "./addActionsData/types.d.ts";

interface TurnSnapshot {
    isQuickened: boolean;
}

export class ActorHandler {

    // Generic list of slugs that can fill a standard Quickened action slot
    private static readonly QUICKENED_ELIGIBLE_SLUGS = ["strike", "stride", "step", "interact", "sustain-a-spell"];

    /**
     * Snapshots the actor's state at the start of their turn.
     * This is called from Combat Turn Change hook to capture if the user is quickened at the start of their turn
     * Since they do not gain the extra action if they are quickened mid turn
     */
    static getQuickenedState(combatant: CombatantPF2e): boolean {
        const actor = (combatant as any).actor;
        return actor ? actor.hasCondition("quickened") : false;
    }

    /**
     * Checks if a logged action can fit into a Quickened slot
     */
    static isActionQuickenedEligible(combatant: CombatantPF2e, actionSlug: string): boolean {
        if (!this.hasQuickenedSnapshot(combatant)) return false;
        return this.QUICKENED_ELIGIBLE_SLUGS.includes(actionSlug.toLowerCase());
    }

    /**
     * Determines if the actor started the turn with the Quickened condition
     */
    static hasQuickenedSnapshot(combatant: CombatantPF2e): boolean {
        return !!(combatant as any).getFlag(SCOPE, "isQuickenedSnapshot");
    }

    /**
     * Helper to get the true integer value of a condition even if suppressed
     */
    static getConditionValue(actor: ActorPF2e, slug: string): number {
        const item = actor.items.find((i: any): i is ConditionPF2e => i.slug === slug);
        return item?.value ?? 0;
    }

    /**
     * Calculates max actions for the turn for the player
     */
    static getMaxActions(combatant: CombatantPF2e, quickenedOverride?: boolean): number {
        // Dynamically calculate true max actions, including feats
        const slots = this.getSlots(combatant, 'action');
        let length = slots.length;

        // If quickenedOverride is provided and differs from the current snapshot, adjust length
        if (quickenedOverride !== undefined) {
            const snapshot = this.hasQuickenedSnapshot(combatant);
            if (quickenedOverride && !snapshot) length += 1;
            if (!quickenedOverride && snapshot) length -= 1;
        }

        return length;
    }

    /**
      * Logic for movement cost calculation across regions
      */
    static calculateMovementCost(token: any, actor: ActorPF2e, distance: number, toPoint: { x: number, y: number }): number {
        const regionLayer = (canvas as any).regions;
        if (!regionLayer?.placeables) return distance;

        const relevantRegions = regionLayer.placeables.filter((r: any) => {
            const behaviors = r.document?.behaviors ?? [];
            const isEnv = behaviors.some((b: any) => !b.disabled && b.type === "environmentFeature");
            return isEnv && token.testInsideRegion(r, toPoint);
        });

        if (relevantRegions.length > 0) {
            const hasGreatDifficult = relevantRegions.some((r: any) =>
                r.document.behaviors.some((b: any) =>
                    b.type === "environmentFeature" &&
                    !b.disabled &&
                    b.system?.terrain?.difficult === 2
                )
            );

            return hasGreatDifficult ? distance + 10 : distance + 5;
        }

        return distance;
    }

    /**
     * Determines active speed
     */
    static getActiveSpeed(actor: ActorPF2e, movementMode: string): number {
        const speed_floor = 5;
        if (!actor.isOfType("creature")) return speed_floor;

        const attributes = actor.system.attributes as any;
        const speed = attributes.speed;

        if (!speed) return 0;

        // Handle the standard land speed
        if (movementMode === "stride" || movementMode === "land") {
            return speed.total ?? speed_floor;
        }

        // Handle all other PF2e speeds (fly, swim, burrow, climb)
        const specialSpeed = speed.otherSpeeds?.find((s: any) => s.type === movementMode);

        // Fallback logic: if a mode is selected but no specific speed exists, 
        // default to our speed_floor.
        return specialSpeed?.total ?? speed_floor;
    }

    /**
     * Removes the tracking flag from the actor.
     */
    static async cleanup(combatant: CombatantPF2e): Promise<void> {
        await (combatant as any).setFlag(SCOPE, "isQuickenedSnapshot", null);
    }

    /**
     * Generates available Action or Reaction slots for the actor, sorted by restrictiveness.
     */
    static getSlots(combatant: CombatantPF2e, type: 'action' | 'reaction'): ActionSlot[] {
        const slots: ActionSlot[] = [];
        const actor = (combatant as any).actor;
        if (!actor) return slots;

        // 1. Generate Base Slots
        if (type === 'action') {
            const maxBase = 3;
            for (let i = 0; i < maxBase; i++) {
                slots.push({ isBase: true, type: 'action' });
            }
        } else {
            const maxReactions = (actor.system as any).resources?.reactions?.max || 1;
            for (let i = 0; i < maxReactions; i++) {
                slots.push({ isBase: true, type: 'reaction' });
            }
        }

        // 2. Generate Extra Slots
        for (const [key, def] of Object.entries(AddActionsLibrary)) {
            if (def.type !== type) continue;

            let hasFeature = false;

            // Special case for Quickened which uses a snapshot
            if (key === 'quickened' && type === 'action') {
                hasFeature = this.hasQuickenedSnapshot(combatant);
            } else {
                hasFeature = actor.items.some((i: any) => i.slug === key || i.system?.slug === key) || actor.hasCondition(key);
            }

            if (hasFeature) {
                for (let i = 0; i < def.grants; i++) {
                    slots.push({ isBase: false, type: type, definition: def });
                }
            }
        }

        // 3. Sort: Most restrictive first.
        slots.sort((a, b) => {
            if (a.isBase && !b.isBase) return 1; // Base goes last
            if (!a.isBase && b.isBase) return -1;
            if (a.isBase && b.isBase) return 0;

            const aLen = a.definition?.allowedSlugs?.length ?? Infinity;
            const bLen = b.definition?.allowedSlugs?.length ?? Infinity;
            return aLen - bLen;
        });

        return slots;
    }

    /**
     * Calculates which logged actions consume which slots, returning both the filled slots and any overspent actions.
     */
    static allocateSlots(combatant: CombatantPF2e, logs: ActionLogEntry[], type: 'action' | 'reaction'): { slots: ActionSlot[], overspent: ActionLogEntry[] } {
        const slots = this.getSlots(combatant, type);
        const overspent: ActionLogEntry[] = [];

        // Filter logs by type (System drains also consume action slots)
        const typeLogs = logs.filter(l => l.type === type || (type === 'action' && l.type === 'system'));

        for (const log of typeLogs) {
            // Reactions in PF2e often have cost: 0. We enforce they take 1 slot.
            let costRemaining = type === 'reaction' ? Math.max(1, log.cost) : log.cost;

            while (costRemaining > 0) {
                const slotIndex = slots.findIndex(s => {
                    if (s.spentBy) return false;
                    if (s.isBase) return true;
                    if (log.type === 'system' || log.msgId === 'System') return true;

                    return s.definition?.allowedSlugs?.includes(log.slug || "") ?? false;
                });

                if (slotIndex !== -1) {
                    slots[slotIndex].spentBy = log;
                    costRemaining--;
                } else {
                    if (!overspent.includes(log)) {
                        overspent.push(log);
                    }
                    costRemaining--;
                }
            }
        }

        return { slots, overspent };
    }
}
