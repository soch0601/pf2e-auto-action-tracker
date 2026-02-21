import { IActionDetector } from "./ActionDetector";

export class HardIgnoreDetector {

    static readonly id = "HardIgnoreDetector";

    static shouldBreak(message: any): boolean {
        const contextType = message.flags?.pf2e?.context?.type;

        const ignoredContexts = [
            "saving-throw",
            "recovery-check",
            "flat-check",
            "damage-roll"
        ];

        if (contextType && ignoredContexts.includes(contextType)) return true;

        const pf2e = message.flags?.pf2e;
        const content = message.content || "";

        // 1. Identify "Item Cards" (Links)
        const isItemCard = content.includes('class="pf2e chat-card item-card"');

        // 2. Identify if it's a "Usage" message
        // Usage messages have 'context', Links have 'origin'
        const hasContext = !!pf2e?.context;
        const hasOrigin = !!pf2e?.origin;

        // If it's an item card and has no activation context, it's a candidate for ignoring.
        if (isItemCard && hasOrigin && !hasContext) {
            // Here is the kicker: Divine Wings (Link) and Bon Mot look the same here.
            // But we want to ignore Divine Wings (Link) because a 'Use' message is coming.
            // We can check if the item has an automation/effect that will trigger a 'Use' message.

            const item: any = fromUuidSync(pf2e.origin.uuid);

            // If the item has a 'self-effect', it will produce a 'Use' message. 
            // We ignore the link and wait for the Use.
            if (item?.system?.selfEffect) {
                return true;
            }
        }

        return false;
    }

    static isType() { return false; }
    static getDetails() { return { cost: 0, slug: "", label: "", isReaction: false }; }
}

HardIgnoreDetector satisfies IActionDetector