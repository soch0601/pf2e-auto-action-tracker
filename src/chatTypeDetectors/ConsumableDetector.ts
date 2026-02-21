import { IActionDetector } from './ActionDetector';
import { SCOPE } from '../globals';
import { getLabelFromMsgFlavor, getSlugFromMsgFlavor } from './detectorUtilities';

export class ConsumableDetector {

    static readonly id = "ConsumableDetector";

    /**
      * If it's a consumable/item card but NOT an explicit use, we "break".
      * This stops the parser from looking at other detectors (like generic action sniffer).
      */
    static shouldBreak(message: any): boolean {
        const originType = message.flags?.pf2e?.origin?.type;
        const isExplicitUse = !!message.flags?.[SCOPE]?.isExplicitUse;

        // If it's a consumable but we didn't explicitly trigger the 'use' flag, 
        // it's just a chat card (description), not an action. Stop here.
        if (originType === 'consumable' && !isExplicitUse) {
            return true;
        }

        return false;
    }

    /**
     * Matches if the origin item is a consumable or if we've explicitly 
     * flagged it as a "use" via custom scope flags.
     */
    static isType(message: any): boolean {
        const originType = message.flags?.pf2e?.origin?.type;
        const isExplicitUse = !!message.flags?.[SCOPE]?.isExplicitUse;

        return originType === 'consumable' && isExplicitUse;
    }

    /**
     * Consumables in PF2e almost universally cost 1 action (Interact),
     * unless they are processed as free actions/reactions.
     */
    static getDetails(message: any) {
        const flags = message.flags?.pf2e || {};
        const htmlPool = `${message.flavor || ""} ${message.content || ""}`.trim();

        // Use the label from the item name, or fall back to "Consumable"
        const label = message.item?.name || getLabelFromMsgFlavor(htmlPool) || "Consumable";
        const slug = message.item?.slug || getSlugFromMsgFlavor(htmlPool) || "use-consumable";

        // Determine if this specific use was a reaction
        const isReaction = false;

        // Logic: If it's a reaction, cost is 0. Otherwise, it's 1.
        const cost = 1;

        return {
            cost,
            slug,
            label,
            isReaction
        };
    }
}

ConsumableDetector satisfies IActionDetector;