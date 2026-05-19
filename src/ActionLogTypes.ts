import type { ActiveActivityState, ActionModifier } from "./complexActions/types.d.ts";

export interface ActionLogEntry {
    cost: number | ((entry: ActionLogEntry) => number);
    msgId: string;
    label: string;
    type: 'action' | 'reaction' | 'system' | 'bonus';
    slug?: string;
    isQuickenedEligible: boolean;
    isMapRelevant?: boolean;
    mapProfile?: "standard" | "agile";
    actionModifiers?: ActionModifier[];
    sustainItem?: { id: string, name: string };
    ComplexActionState?: ActiveActivityState;
    category: string;
    linkedMessages: linkedRolls[];
    rank?: number;
    distance?: number;
    baseCost?: number;
    spellSlot?: SpellSlotUsage;
    itemUsage?: ItemUsage;
    createdEffects?: string[]; // UUIDs of created effects
    spentHeroPoint?: boolean;
}

export interface SpellSlotUsage {
    entryId: string;
    rank: number;
    index?: number; // For prepared spells
    isFocus?: boolean;
}

export interface ItemUsage {
    uuid: string;
    quantity?: number;
    uses?: {
        value: number;
        max: number;
    };
    frequency?: {
        value: number;
        max: number;
    };
    itemData?: any; // Used to recreate consumables deleted upon reaching 0 quantity
}

export interface linkedRolls {
    type: 'damage' | 'attack' | 'applied-damage';
    msgId: string;
    targetUuid?: string;
}

const DynamicCostRegistry: Record<string, (entry: ActionLogEntry) => number> = {
    'force-barrage': (entry: ActionLogEntry) => {
        const missiles = entry.linkedMessages.filter(m => m.type === 'damage').length;
        if (missiles === 0) return 1;
        const rank = entry.rank || 1;
        const missilesPerAction = 1 + Math.floor((rank - 1) / 2);
        return Math.ceil(missiles / missilesPerAction);
    },
    'quickened-casting': (entry: ActionLogEntry) => 0
};

export function getEntryCost(entry: ActionLogEntry, log?: readonly ActionLogEntry[]): number {
    let cost = entry.cost;

    // 1. Re-hydrate if it's a known dynamic cost slug and cost was lost during serialization
    if (typeof cost !== 'function' && typeof cost !== 'number' && entry.slug && DynamicCostRegistry[entry.slug]) {
        cost = DynamicCostRegistry[entry.slug];
    }

    // 2. Determine raw cost (functional or static)
    let finalCost = 0;
    if (typeof cost === 'function') {
        finalCost = (cost as any)(entry);
    } else {
        finalCost = (cost as number) || 0;
    }

    // 3. Apply Quickened Casting reduction if applicable
    if (entry.category === 'spell' && log && finalCost > 0) {
        const myIndex = log.indexOf(entry);
        if (myIndex !== -1) {
            const logBeforeMe = log.slice(0, myIndex).reverse();
            
            // Find the most recent Quickened Casting usage in this turn
            const featIndex = logBeforeMe.findIndex(e => e.slug === 'quickened-casting');
            
            if (featIndex !== -1) {
                // Check if any other spell consumed it already
                const spellsInBetween = logBeforeMe.slice(0, featIndex).some(e => e.category === 'spell');
                if (!spellsInBetween) {
                    finalCost = Math.max(1, finalCost - 1);
                }
            }
        }
    }

    return finalCost;
}

export function getForceBarrageInfo(entry: ActionLogEntry, log?: readonly ActionLogEntry[]): string | null {
    if (!entry || entry.slug !== 'force-barrage') {
        return null;
    }
    const missiles = entry.linkedMessages.filter(m => m.type === 'damage').length;
    const rank = entry.rank || 1;
    const missilesPerAction = 1 + Math.floor((rank - 1) / 2);
    const cost = getEntryCost(entry, log);
    const capacity = cost * missilesPerAction;
    const remaining = capacity - missiles;

    return `${missiles} missiles cast${remaining > 0 ? ` (${remaining} more space at this cost)` : ''}`;
}
