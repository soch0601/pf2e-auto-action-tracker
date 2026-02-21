import { IActionDetector } from './ActionDetector';
import { getIsReaction } from './detectorUtilities';

export class SkillDetector {
    static readonly id = "SkillDetector";

    static shouldBreak() { return false; }

    static isType(message: any): boolean {
        const type = message.flags?.pf2e?.context?.type;
        return type === "skill-check" || type === "perception-check";
    }

    static getDetails(message: any) {
        const context = message.flags?.pf2e?.context;
        const cost = 1;
        const slug = context?.type || "skill-check";
        const label = context?.title || "Skill Check";
        const htmlPool = `${message.flavor || ""} ${message.content || ""}`.trim();
        const isReaction = getIsReaction(message.item, message.flags?.pf2e, htmlPool);

        return { cost, slug, label, isReaction };
    }
}

SkillDetector satisfies IActionDetector;