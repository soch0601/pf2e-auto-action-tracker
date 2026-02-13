import { SCOPE } from "./globals";
import { ActorPF2e, ConditionPF2e } from "module-helpers";

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
    static async handleStartOfTurn(actor: ActorPF2e): Promise<void> {
        const isQuickened = actor.hasCondition("quickened");
        await (actor as any).setFlag(SCOPE, "isQuickenedSnapshot", isQuickened);
    }

    /**
     * Checks if a logged action can fit into a Quickened slot
     */
    static isActionQuickenedEligible(actor: ActorPF2e, actionSlug: string): boolean {
        if (!this.hasQuickenedSnapshot(actor)) return false;
        return this.QUICKENED_ELIGIBLE_SLUGS.includes(actionSlug.toLowerCase());
    }

    /**
     * Determines if the actor started the turn with the Quickened condition
     */
    static hasQuickenedSnapshot(actor: ActorPF2e): boolean {
        return !!(actor as any).getFlag(SCOPE, "isQuickenedSnapshot");
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
    static getMaxActions(actor: ActorPF2e): number {
        // They must have the snapshot of quickened at the start of turn - adding quickened mid turn does not grant the bonus action
        const isQuickened = this.hasQuickenedSnapshot(actor);
        return isQuickened ? 4 : 3;
    }

    /**
      * Logic for movement cost calculation across regions
      */
    static calculateMovementCost(token: any, actor: ActorPF2e, distance: number, toPoint: { x: number, y: number }): number {
        // 1. Get the layer and ensure it exists
        const regionLayer = (canvas as any).regions;
        if (!regionLayer?.placeables) return distance;

        // 2. Filter for regions that are environmental and contain the target point
        const relevantRegions = regionLayer.placeables.filter((r: any) => {
            const behaviors = r.document?.behaviors ?? [];
            const isEnv = behaviors.some((b: any) => !b.disabled && b.type === "environmentFeature");
            // token.testInsideRegion is the V12 way to check containment
            return isEnv && token.testInsideRegion(r, toPoint);
        });

        if (relevantRegions.length > 0) {
            // 3. Check behaviors for "Greater Difficult Terrain" (Value 2 in PF2e)
            const hasGreatDifficult = relevantRegions.some((r: any) =>
                r.document.behaviors.some((b: any) =>
                    b.type === "environmentFeature" &&
                    !b.disabled &&
                    b.system?.terrain?.difficult === 2
                )
            );

            // PF2e: Difficult +5ft, Greater Difficult +10ft
            return hasGreatDifficult ? distance + 10 : distance + 5;
        }

        return distance;
    }

    /**
     * Determines active speed based on elevation
     */
    static getActiveSpeed(actor: ActorPF2e, isFlying: boolean): number {
        // 1. Narrow to creature to ensure it's not a loot pile
        if (!actor.isOfType("creature")) return 0;

        // 2. Cast attributes to 'any' just for the assignment to break the circular logic
        // but then immediately treat it as a known structure.
        const attributes = actor.system.attributes as any;
        const speed = attributes.speed;

        // 3. Check if speed actually exists (safety for some specific actor types)
        if (!speed) return 0;

        if (isFlying) {
            // Find the fly speed in 'otherSpeeds'
            const flySpeed = speed.otherSpeeds?.find((s: any) => s.type === "fly");
            return flySpeed?.total ?? 0;
        }

        // Default to the total Land speed
        return speed.total ?? 0;
    }

    /**
     * Removes the tracking flag from the actor.
     */
    static async cleanup(actor: ActorPF2e): Promise<void> {
        // Setting a flag to null in Foundry removes it from the database
        await (actor as any).setFlag(SCOPE, "isQuickenedSnapshot", null);
    }
}