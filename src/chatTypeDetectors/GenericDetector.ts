import type { IActionDetector } from "./IActionDetector.ts";
import { getCostFromMsgFlavor, getIsReaction, getLabelFromMsgFlavor, getSlugFromMsgFlavor } from "./detectorUtilities.ts";
import { SCOPE } from "../globals.ts";

export class GenericActionDetector {

    static readonly id = "GenericActionDetector";
    static readonly type = "action"

    static shouldBreak() { return false; }

    static isType(message: any) {
        // 1. Identify if this is a known "Use" intent
        const isExplicitUse = !!message.flags?.[SCOPE]?.isExplicitUse;

        // 2. If it's an item card, we ONLY count it if it's an explicit Use.
        // This prevents "Link to Chat" from counting as an action just because the description has a glyph.
        const origin = message.flags?.pf2e?.origin;
        const isItemCard = !!(origin || message.item || message.flags?.pf2e?.item || origin?.type || origin?.uuid);
        if (isItemCard && !isExplicitUse) return false;

        // 3. Otherwise, fall back to glyph detection
        if ((message.flavor || "").includes('class="action-glyph"')) return true;
        if ((message.content || "").includes('class="action-glyph"')) return true;
        
        return false;
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