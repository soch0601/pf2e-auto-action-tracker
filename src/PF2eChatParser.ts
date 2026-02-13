import { SCOPE } from "./globals";
import { logConsole } from "./logger";

export interface ParsedAction {
    slug: string;
    label: string;
    cost: number;
    isReaction: boolean;
}

export class PF2eChatParser {

    /**
     *  Parse a chat message from the PF2E chat system and return information about it
     */
    static parse(message: any): ParsedAction | null {

        const shouldIgnore = this.shouldIgnore(message);
        if (shouldIgnore) return null;

        const cost = this.getCost(message);
        const isReaction = this.getIsReaction(message);
        const slug = this.getSlug(message);
        const isPublic = message.whisper.length === 0 || message.whisper.includes((game as any).user.id);
        const label = isPublic ? this.getLabel(message) : "Secret Action";

        // If it's not a reaction and has no cost, it's not an "action" we track
        if (cost === null || (cost === 0 && !isReaction)) return null;

        return {
            slug: slug,
            label: label,
            cost: cost,
            isReaction: isReaction
        };
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

    private static shouldIgnore(message: any): boolean {

        const speaker = message.speaker;
        const combatant = game.combat?.combatants.get(speaker.token || "")
            || game.combat?.combatants.find(c => (c as any).actorId === speaker.actor);
        const isConsumable = message.flags.pf2e?.origin?.type === 'consumable';

        const isExplicitUse = !!message.flags?.[SCOPE]?.isExplicitUse;

        // 1. Consumables & Items
        if (isConsumable) {
            if (isExplicitUse) return false;
            return true;
        }

        // 2. Persistent damage roll detection
        if (message.rolls?.some((r: any) => r.constructor.name === "DamageRoll") || message.flags?.pf2e?.damageRoll) {
            return true;
        }

        const pf2eContext = message.flags?.pf2e?.context;
        const type = pf2eContext?.type;
        const action = pf2eContext?.action

        // 3. Explicitly ignore non-action types
        const ignoredTypes = [
            "damage-roll",          // Damage rolls
            "saving-throw",         // Saving throws
            "recovery-check",       // death saving throws
            "flat-check"            // any flat check - persistent damage recovery, hidden miss chance, etc.
        ];

        if (type && ignoredTypes.includes(type)) return true;

        // 4. Ingored actions - "cast-a-spell" is the attack roll for "spell-cast" type action, do not track this!
        if (action === "cast-a-spell") return true;

        // 5. If there is no type and it isn't an explicit spellcasting use...
        if (!isExplicitUse && !type) {
            return true;
        }

        return false;
    }

    /**
     * Gets the cost in actions from a message
     */
    private static getCost(message: any): number | null {
        const flags = message.flags?.pf2e || {};
        const flavor = message.flavor || "";

        // 1. Sustain & Explicit Overrides
        if (message.flags?.[SCOPE]?.isSustainAutomation) return 1;
        const originSlug = flags.origin?.slug || "";
        if (originSlug === "sustain" || originSlug === "sustain-a-spell") return 1;

        // 2. High-Fidelity System Flags (The "Source of Truth")
        // If the system explicitly told us how many actions were spent, use that first!
        const variable = (flags.context?.options || []).find((opt: string) =>
            opt.startsWith("num-actions:") || opt.startsWith("item:cast:actions:")
        );
        if (variable) {
            const cost = parseInt(variable.split(":").pop() || "0");
            return isNaN(cost) ? 0 : cost;
        }

        // 3. Consumable Fallback (Hardcoded to 1)
        // We do this after Step 2 just in case a future system update adds explicit costs to items
        const isConsumable = flags.origin?.type === 'consumable';
        if (isConsumable) return 1;

        // 4. Interact/Change Grip (The HTML sniff)
        if (flavor.includes('class="action"')) {
            const glyphMatch = flavor.match(/class="action-glyph">([123FR])/);
            if (glyphMatch) {
                const val = glyphMatch[1];
                if (val === 'F' || val === 'R') return 0;
                const cost = parseInt(val);
                return isNaN(cost) ? 1 : cost;
            }
            return 1;
        }

        // 5. Item Document Data
        const item = message.item;
        if (!item) return null;

        // Extract raw value based on item type
        const rawValue = item.type === "spell"
            ? item.system.time?.value
            : item.system.actions?.value;

        // Handle string-based costs ("reaction", "free", "1", "2", etc)
        if (typeof rawValue === "string") {
            if (["reaction", "free"].includes(rawValue)) return 0;
            const parsed = parseInt(rawValue);
            if (!isNaN(parsed)) return parsed;
        }

        if (typeof rawValue === "number") return rawValue;

        // 6. Generic Type-Based Fallbacks
        if (item.type === "spell") return 2; // Most common spell cost
        if (["action", "feat", "weapon"].includes(item.type)) return 1;

        return null;
    }

    /**
     * Gets the label of what to display for an action from a message
     */
    private static getLabel(message: any): string {
        const flags = message.flags?.pf2e || {};
        const flavor = message.flavor || "";

        // 1. Priority: System Title or Item Name
        const label = flags.context?.title || message.item?.name;
        if (label) return label.replace(/[()]/g, '').trim();

        // 2. DOM Sniffing (Detached Element approach)
        if (flavor.includes('class="action"')) {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = flavor;

            const title = tempDiv.querySelector('h4.action strong')?.textContent;
            const subtitle = tempDiv.querySelector('h4.action .subtitle')?.textContent;

            if (title) {
                const fullLabel = subtitle ? `${title} ${subtitle}` : title;
                return fullLabel.replace(/[()]/g, '').trim();
            }
        }

        // 3. Fallback: Sustain Metadata
        const { itemName } = this.getSustainMetadata(message);
        if (itemName && itemName !== "Action") return itemName;

        return "Action";
    }

    /**
     * Gets the slug from the chat message
     */
    private static getSlug(message: any): string {
        const flags = message.flags?.pf2e || {};
        const flavor = message.flavor || "";

        // 1. CHECK ORIGIN SLUG FIRST
        // This catches "sustain-a-spell", "stride", etc., even if the message 
        // is linked to a specific item like "Bless" or a "Longsword".
        let slug = flags.context?.action || flags.origin?.slug || message.item?.slug || "";

        // 2. Override for Sustain Automation
        // If our custom flag is there, force the sustain slug
        if (message.flags?.[SCOPE]?.isSustainAutomation) {
            slug = "sustain-a-spell";
        }

        if (slug) return slug;

        // 3. Synthetic Slug for Localized System Actions (The Sniff)
        if (flavor.includes('class="action"')) {
            const doc = new DOMParser().parseFromString(flavor, 'text/html');
            const title = doc.querySelector('h4.action strong')?.textContent || "";
            if (title) return title.toLowerCase().trim().replace(/\s+/g, '-');
        }

        return "";
    }

    /**
     * Determines if something in the message says that this is a reaction
     */
    private static getIsReaction(message: any): boolean {
        const flags = message.flags?.pf2e || {};
        return flags.context?.options?.includes("trait:reaction") ||
            message.item?.system?.actionType?.value === "reaction" ||
            (message.flavor || "").includes('action-glyph">R<');
    }
}