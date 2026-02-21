import { IActionDetector } from './ActionDetector';
import { SCOPE } from '../globals';

export class SustainDetector {

    static readonly id = "SustainDetector";

    static shouldBreak(message: any): boolean {
        return false;
    }

    static isType(message: any): boolean {
        if (message.flags?.[SCOPE]?.isSustainAutomation) return true;
        const originSlug = message.flags?.origin?.slug || "";
        if (originSlug === "sustain" || originSlug === "sustain-a-spell") return true;
        else return false
    }

    static getDetails(message: any) {
        const cost = 1;
        const { itemName } = this.getSustainMetadata(message);
        const label = itemName;
        const slug = "sustain-a-spell";
        const isReaction = false;
        return { cost, slug, label, isReaction };
    }

    /**
      * Extracts info needed for Sustain tracking.
      */
    static getSustainMetadata(message: any) {
        const flags = message.flags?.pf2e || {};
        const customFlags = message.flags?.[SCOPE] || {};

        // ID Extraction
        let itemId = customFlags.sustainedItemId;

        // Fallback 1: Try the Origin UUID (Standard PF2e way)
        if (!itemId && flags.origin?.uuid) {
            const originItem = fromUuidSync(flags.origin.uuid) as any;
            itemId = originItem?.id;
        }

        // Fallback 2: Try the direct message item (Foundry core way)
        if (!itemId) {
            itemId = message.item?.id;
        }

        // Name Extraction
        const itemName = customFlags.sustainedItemName ||
            flags.casting?.embeddedSpell?.name ||
            message.item?.name ||
            (flags.origin?.uuid ? (fromUuidSync(flags.origin.uuid) as any)?.name : null) ||
            "Action";

        return { itemId, itemName };
    }

    /**
     * Determines if this is a sustain message, either from our own personal messages or from PF2E
     */
    static isSustainMessage(message: any): boolean {
        const item = message.item;
        const flags = message.flags?.pf2e || {};
        const customFlags = message.flags?.[SCOPE] || {};

        if (customFlags.isSustainAutomation) return true;
        if (item?.system?.duration?.sustained) return true;

        const embeddedSpell = flags.casting?.embeddedSpell;
        if (embeddedSpell?.system?.duration?.sustained) return true;

        const originSlug = flags.origin?.slug || "";
        if (originSlug === "sustain" || originSlug === "sustain-a-spell") return true;

        const description = item?.system?.description?.value?.toLowerCase() || "";
        return description.includes("sustain a spell") || description.includes("sustain the spell");
    }
}

SustainDetector satisfies IActionDetector;