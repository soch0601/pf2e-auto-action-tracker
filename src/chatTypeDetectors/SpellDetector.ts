import { IActionDetector } from './ActionDetector';
import { SCOPE } from '../globals';
import { getCostFromMsgFlavor, getIsReaction, getLabelFromMsgFlavor, getSlugFromMsgFlavor } from './detectorUtilities';

export class SpellDetector {

    static readonly id = "SpellDetector";

    /**
     * We break if this message is a secondary effect of a spell.
     * We don't want attack rolls or damage rolls to be processed by other detectors
     * because the 'Spell Cast' message already accounted for the action cost.
     */
    static shouldBreak(message: any): boolean {
        const pf2eContext = message.flags?.pf2e?.context;
        const contextType = pf2eContext?.type;
        const isExplicitUse = !!message.flags?.[SCOPE]?.isExplicitUse;

        const spellNoise = [
            "cast-a-spell",       // This is a spell attack roll, ignore it
            "spell-attack-roll",  // Another flavor of spell attack roll
            "spell-damage-roll"   // Ignore spell damage rolls
        ];

        if (contextType && spellNoise.includes(contextType)) {
            return true;
        }

        // Ignore messages that are explicitly marked as damage rolls
        if (message.flags?.pf2e?.damageRoll) {
            return true;
        }

        if (message.item?.type === 'spell' && !isExplicitUse) {
            return true;
        }

        return false;
    }

    /**
     * Matches if the message represents the actual casting of a spell.
     */
    static isType(message: any): boolean {
        const isExplicitUse = !!message.flags?.[SCOPE]?.isExplicitUse;
        const isSpell = message.item?.type === 'spell' || message.flags?.pf2e?.context?.type === 'spell-cast';

        return isSpell && isExplicitUse;
    }

    static getDetails(message: any) {
        const item = message.item;
        const flags = message.flags?.pf2e || {};
        const htmlPool = `${message.flavor || ""} ${message.content || ""}`.trim();
        const isReaction = getIsReaction(message.item, message.flags?.pf2e, htmlPool);

        const label = item?.name || getLabelFromMsgFlavor(htmlPool) || "Spell Cast";
        const slug = item?.slug || getSlugFromMsgFlavor(htmlPool) || "spell-cast";

        // 2. Cost Calculation - Priority 1: Variable Action Flags
        const variableActionFlag = (flags.context?.options || []).find((opt: string) =>
            opt.startsWith("num-actions:") || opt.startsWith("item:cast:actions:")
        );

        if (variableActionFlag) {
            const parsed = parseInt(variableActionFlag.split(":").pop() || "0");
            return { cost: isNaN(parsed) ? 0 : parsed, slug, label, isReaction };
        }

        // 3. Cost Calculation - Priority 2: DOM/Flavor Sniffing
        const tempCost = getCostFromMsgFlavor(htmlPool);
        if (tempCost) return { cost: tempCost, slug, label, isReaction };

        // 4. Cost Calculation - Final Fallback: Item System Data
        let cost = 2;
        const rawValue = item?.system?.time?.value;
        if (isReaction || rawValue === "free") {
            cost = 0;
        } else if (typeof rawValue === "string") {
            const parsed = parseInt(rawValue);
            cost = isNaN(parsed) ? 2 : parsed;
        }

        return { cost, slug, label, isReaction };
    }
}

SpellDetector satisfies IActionDetector;