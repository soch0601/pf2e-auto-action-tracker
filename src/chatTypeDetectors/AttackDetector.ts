import { getCostFromMsgFlavor, getIsReaction, getLabelFromMsgFlavor, getSlugFromMsgFlavor } from "./detectorUtilities.ts";
import type { IActionDetector, IActionDetails } from "./IActionDetector.ts";

export class AttackDetector {

    static readonly id = "AttackDetector";
    static readonly type = "attack"

    static shouldBreak(message: any) {
        // Break if it's just a damage roll for a strike (noise)
        return !!message.flags?.pf2e?.context?.type?.includes('damage-roll');
    }

    static isType(message: any) {
        const context = message.flags?.pf2e?.context;
        // Catch Strikes, NPC Special Attacks, and Abilities
        return context?.type === 'attack-roll' || !!context?.action;
    }

    static getDetails(message: any): IActionDetails {
        const flags = message.flags?.pf2e || {};
        const htmlPool = `${message.flavor || ""} ${message.content || ""}`.trim();
        const isReaction = getIsReaction(message.item, message.flags?.pf2e, htmlPool);
        const cost = getCostFromMsgFlavor(message.flavor);
        const mapProfile: IActionDetails["mapProfile"] = message.item?.traits?.has?.("agile") ? "agile" : "standard";

        const slug = flags.context?.action || getSlugFromMsgFlavor(htmlPool) || "attack";
        const isStrike = slug.toLowerCase() === "strike";

        let finalCost = isReaction ? 0 : (cost !== undefined ? cost : 1);
        if (message.item?.type === "spell" || slug.toLowerCase().includes("spell")) {
            finalCost = 0;
        }

        return {
            cost: finalCost,
            slug,
            label: flags.context?.title || message.item?.name || getLabelFromMsgFlavor(htmlPool) || "Attack",
            isReaction,
            isMapRelevant: true,
            isQuickenedEligible: isStrike,
            mapProfile
        };
    }
}

AttackDetector satisfies IActionDetector;
