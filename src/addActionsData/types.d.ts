import { ActionLogEntry } from "../ActionManager";

export interface ExtraSlotDefinition {
    name: string;            // e.g., "Opportune Attack"
    slug: string;            // Feat/Item/Condition slug (e.g., "opportune-attack", "quickened")
    type: 'action' | 'reaction';
    grants: number;
    allowedSlugs?: string[];
}

export interface ActionSlot {
    isBase: boolean;
    type: 'action' | 'reaction';
    definition?: ExtraSlotDefinition;
    spentBy?: ActionLogEntry; // Null if unused
}
