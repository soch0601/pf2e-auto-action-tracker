import type { IActionDetector } from './IActionDetector.ts';
import { getIsReaction } from './detectorUtilities.ts';
import { getSkillActionMapMetadata } from './skillMapMetadata.ts';

export class SkillDetector {
    static readonly id = "SkillDetector";
    static readonly type = "skill"; // Ensure this matches your library.ts!

    static shouldBreak() { return false; }

    static isType(message: any): boolean {
        const type = message.flags?.pf2e?.context?.type;
        return type === "skill-check" || type === "perception-check";
    }

    static getDetails(message: any) {
        const context = message.flags?.pf2e?.context;
        const options = context?.options || [];

        // 1. Extract the specific Skill (e.g., "athletics")
        const skillOption = options.find((o: string) => o.startsWith("check:statistic:"));
        const skillSlug = skillOption ? skillOption.replace("check:statistic:", "") : "";

        // 3. Determine the Slug
        // We prioritize the action (hide, shove) but fallback to the skill (stealth, athletics)
        const slug = (context?.action || skillSlug || context?.type || "skill-check").toLowerCase();

        // 4. Clean the Label
        let label = context?.title || "Skill Check";
        if (label.includes("<")) {
            // Strip HTML tags and clean up whitespace
            label = label.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
            // Optional: If the label is "Shove 1 (Athletics Check)", 
            // you could regex just the part inside <strong> if you want it even cleaner.
        }

        const cost = 1;
        const htmlPool = `${message.flavor || ""} ${message.content || ""}`.trim();
        const isReaction = getIsReaction(message.item, message.flags?.pf2e, htmlPool);
        const mapMetadata = getSkillActionMapMetadata(message);

        return {
            cost,
            slug,
            label,
            isReaction,
            ...mapMetadata
        };
    }
}

SkillDetector satisfies IActionDetector;
