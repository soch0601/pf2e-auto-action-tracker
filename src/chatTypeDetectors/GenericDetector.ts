import { IActionDetector } from "./ActionDetector";
import { getCostFromMsgFlavor, getIsReaction, getLabelFromMsgFlavor, getSlugFromMsgFlavor } from "./detectorUtilities";

export class GenericActionDetector {

    static readonly id = "GenericActionDetector";

    static shouldBreak() { return false; }

    static isType(message: any) {
        // If it has the action glyph in the flavor, it's an action!
        if ((message.flavor || "").includes('class="action-glyph"')) return true;
        if ((message.content || "").includes('class="action-glyph"')) return true;
        else return false
    }

    static getDetails(message: any) {
        const htmlPool = `${message.flavor || ""} ${message.content || ""}`.trim();
        const isReaction = getIsReaction(message.item, message.flags?.pf2e, htmlPool) || false;
        const cost = getCostFromMsgFlavor(htmlPool) ?? 1;
        const slug = getSlugFromMsgFlavor(htmlPool) || "unknown-action";
        const label = getLabelFromMsgFlavor(htmlPool) || "Unknown Action";

        return { cost, slug, label, isReaction };
    }
}

GenericActionDetector satisfies IActionDetector