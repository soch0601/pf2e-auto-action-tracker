export type ActionCostFunction = (entry: any) => number;

export interface IActionDetails {
    cost: number | null | ActionCostFunction,
    slug: string | null,
    label: string | null,
    isReaction: boolean,
    isMapRelevant?: boolean,
    mapProfile?: "standard" | "agile",
    rank?: number,
    isQuickenedEligible?: boolean
}

export interface DetectedAction extends IActionDetails {
    cost: number | ActionCostFunction, // Ensure cost is not null here
    slug: string,
    label: string,
    category: string
}

export interface IActionDetector {

    readonly id: string;
    readonly type: string;

    /**
     * Determines if this message belongs to this type, but should not be counted as an action.  For example, a spell cast has the spell cast
     * And the attack roll and the damage roll.  We don't want the spell atatck roll or damage roll to be parsed, so the spell casting implementation
     * should return a spell attack roll and spell damage roll as a break
     */
    shouldBreak(message: any): boolean;

    /**
     * Determine if the message matches the implementation type
     */
    isType(message: any): boolean;

    /**
     * Get the pertinent details for this implementation type
     */
    getDetails(message: any): IActionDetails;
}
