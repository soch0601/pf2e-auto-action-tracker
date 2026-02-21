import { SCOPE } from "./globals";
import { ActorPF2e, ConditionPF2e, CombatantPF2e } from "module-helpers";

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
    static getMaxActions(combatant: CombatantPF2e): number {
        const isQuickened = this.hasQuickenedSnapshot(combatant);
        return isQuickened ? 4 : 3;
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
     * Determines active speed based on elevation
     */
    static getActiveSpeed(actor: ActorPF2e, isFlying: boolean): number {
        if (!actor.isOfType("creature")) return 0;

        const attributes = actor.system.attributes as any;
        const speed = attributes.speed;

        if (!speed) return 0;

        if (isFlying) {
            const flySpeed = speed.otherSpeeds?.find((s: any) => s.type === "fly");
            return flySpeed?.total ?? 0;
        }

        return speed.total ?? 0;
    }

    /**
     * Removes the tracking flag from the actor.
     */
    static async cleanup(combatant: CombatantPF2e): Promise<void> {
        await (combatant as any).setFlag(SCOPE, "isQuickenedSnapshot", null);
    }
}