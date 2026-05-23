import type { ActionLogEntry } from "../ActionManager";

/** Supported basic action identifiers */
export type ActionSlug = 'strike' | 'move' | 'reload' | 'draw' | 'cast' | 'skill-check' | string;

/** Logic operators for combining actions */
export type OperatorValue = 'AND' | 'OR' | 'THEN' | 'XOR';

/** Rule-bending flags for specific action resolution */
export type ActionModifier = 'combineDamage' | 'deferMAP' | 'manualFinish' | 'fixedMAP2' | 'allowInterruption' | 'mapIncrease2';

export type ActionType = "move" | "attack" | "spell" | "consumable" | "skill" | "spell" | "action" | "interact";

export interface ActionNode {
    type: 'ACTION';
    id?: string;
    properties: {
        type: ActionType;
        subtype?: string;
        // The cost of the single incoming action (e.g., a 2-action spell)
        minCost?: number;
        maxCost?: number;
        // How many times this node can swallow an action (e.g., 2 strikes for Flurry)
        minOccurrences?: number;
        maxOccurrences?: number;
        // This action might increase the base cost of the action, set it for all leaf nodes if one can override
        overrideParentCost?: number;
        modifiers?: ActionModifier[];
    };
}

export interface OperatorNode {
    type: 'OPERATOR';
    value: OperatorValue;
}

export interface GroupNode {
    type: 'GROUP';
    value: (ActionNode | OperatorNode | GroupNode)[];
}

export interface SpecialActivity {
    name: string;
    slug: string;
    childActions: (ActionNode | OperatorNode | GroupNode)[];
}

/** The runtime state stored in Combatant flags */
export interface LeafState {
    id: string; // "action-0", "action-1", etc.
    type: ActionType;
    subtype?: string;
    minCost: number | undefined;
    maxCost: number | undefined;
    overrideParentCost: number | undefined;
    modifiers: ActionModifier[];
    minOccurrences: number;
    maxOccurrences: number;
    satisfied: boolean; // Hit the mininum (no sequence broken warning)
    isClosed: boolean;  // Hit the maximum OR manually completed - do not accept more
    childActions: ActionLogEntry[];
}

export interface ActiveActivityState {
    activitySlug: string;
    parentMessageId: string;
    completedBy?: string | undefined;
    combinedDamageMessageId?: string;
    // Flat map of leaf states for quick lookup/revert
    leaves: Record<string, LeafState>;
    orderedActivityChildActions: ActionLogEntry[];
    historyAnchorIndex: number;
}
