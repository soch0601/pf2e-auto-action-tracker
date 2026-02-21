import { getCostFromMsgFlavor, getIsReaction, getLabelFromMsgFlavor, getSlugFromMsgFlavor } from "./detectorUtilities";
import { IActionDetector } from "./ActionDetector";

export class AttackDetector {

    static readonly id = "AttackDetector";

    static shouldBreak(message: any) {
        // Break if it's just a damage roll for a strike (noise)
        return !!message.flags?.pf2e?.context?.type?.includes('damage-roll');
    }

    static isType(message: any) {
        const context = message.flags?.pf2e?.context;
        // Catch Strikes, NPC Special Attacks, and Abilities
        return context?.type === 'attack-roll' || !!context?.action;
    }

    static getDetails(message: any) {
        const flags = message.flags?.pf2e || {};
        const htmlPool = `${message.flavor || ""} ${message.content || ""}`.trim();
        const isReaction = getIsReaction(message.item, message.flags?.pf2e, htmlPool);
        const cost = getCostFromMsgFlavor(message.flavor);

        return {
            cost: isReaction ? 0 : (cost !== undefined ? cost : 1),
            slug: flags.context?.action || getSlugFromMsgFlavor(htmlPool) || "attack",
            label: flags.context?.title || message.item?.name || getLabelFromMsgFlavor(htmlPool) || "Attack",
            isReaction
        };
    }
}

AttackDetector satisfies IActionDetector;