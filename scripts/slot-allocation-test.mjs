import assert from "node:assert/strict";
import { ActorManager as ActorHandler } from "../src/ActorManager.ts";

class MockActor {
    constructor(slugs = [], conditions = []) {
        this.items = slugs.map(slug => ({ slug }));
        this.conditions = conditions;
        this.system = { resources: { reactions: { max: 1 } } };
    }
    hasCondition(slug) {
        return this.conditions.includes(slug);
    }
}

class MockCombatant {
    constructor(actor, flags = {}) {
        this.actor = actor;
        this.flags = flags;
    }
    getFlag(scope, key) {
        return this.flags[key];
    }
}

// Ensure the ActorHandler is loaded
const ah = ActorHandler;

// Test 1: Action Slot sorting (Quickened)
const actor1 = new MockActor([], []);
const combatant1 = new MockCombatant(actor1, { isQuickenedSnapshot: true });

const slots1 = ah.getSlots(combatant1, 'action');
// Quickened grants 1 extra action. Base actions = 3. Total slots = 4.
assert.equal(slots1.length, 4);

// The restricted slot (quickened) should be FIRST.
assert.equal(slots1[0].isBase, false);
assert.equal(slots1[0].definition.slug, 'quickened');
assert.equal(slots1[1].isBase, true);
assert.equal(slots1[2].isBase, true);
assert.equal(slots1[3].isBase, true);

// Test 2: Reaction Slot sorting (Tactical Reflexes)
const actor2 = new MockActor(['tactical-reflexes']);
const combatant2 = new MockCombatant(actor2);

const slots2 = ah.getSlots(combatant2, 'reaction');
// Tactical reflexes grants 1 extra reaction. Base reactions = 1. Total slots = 2.
assert.equal(slots2.length, 2);

// The restricted slot (tactical-reflexes) should be FIRST.
assert.equal(slots2[0].isBase, false);
assert.equal(slots2[0].definition.slug, 'tactical-reflexes');
assert.equal(slots2[1].isBase, true);

// Test 3: Overspend Calculation (Action)
const log1 = [
    { type: 'action', cost: 1, slug: 'stride' }, // Allowed in Quickened
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'action', cost: 1, slug: 'cast-a-spell' } // Base
];

const result1 = ah.allocateSlots(combatant1, log1, 'action');
assert.equal(result1.overspent.length, 0);
assert.equal(result1.slots[0].spentBy, log1[0]); // Quickened slot takes Stride (first eligible)

// Test 4: Overspend Calculation (Reaction)
const log2 = [
    { type: 'reaction', cost: 1, slug: 'reactive-strike' }, // Restricted
    { type: 'reaction', cost: 1, slug: 'reactive-strike' }  // Base
];
const result2 = ah.allocateSlots(combatant2, log2, 'reaction');
assert.equal(result2.overspent.length, 0);
assert.equal(result2.slots[0].spentBy, log2[0]); 
assert.equal(result2.slots[1].spentBy, log2[1]);

// Test 5: Complex overlap
// Now what if the logs are in a different order?
const log3 = [
    { type: 'action', cost: 1, slug: 'cast-a-spell' }, // Base
    { type: 'action', cost: 1, slug: 'stride' }, // Allowed in Quickened
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'action', cost: 1, slug: 'stride' } // Base
];
const result3 = ah.allocateSlots(combatant1, log3, 'action');
assert.equal(result3.overspent.length, 0);
// The Quickened slot (slots[0]) should be taken by the first eligible action, which is log3[1]
assert.equal(result3.slots[0].spentBy, log3[1]);

// Test 6: Overspend detection
const log4 = [
    { type: 'action', cost: 1, slug: 'cast-a-spell' }, // Base
    { type: 'action', cost: 1, slug: 'cast-a-spell' }, // Base
    { type: 'action', cost: 1, slug: 'cast-a-spell' }, // Base
    { type: 'action', cost: 1, slug: 'cast-a-spell' }  // Overspend (Quickened doesn't allow cast-a-spell)
];
const result4 = ah.allocateSlots(combatant1, log4, 'action');
assert.equal(result4.overspent.length, 1);
assert.equal(result4.overspent[0], log4[3]);

// Test 7: System drain overspend
const log5 = [
    { type: 'action', cost: 1, slug: 'stride' }, // Quickened
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'system', cost: 1 } // System action consumes any slot. It should consume the 4th slot.
];
const result5 = ah.allocateSlots(combatant1, log5, 'action');
assert.equal(result5.overspent.length, 0);
assert.equal(result5.slots[3].spentBy.type, 'system');

// Test 8: Slowed / Stunned overlap
// Slowed 2 / Stunned 1
// calculateStartOfTurnDrains returns actionsSpent = 2, reactionsSpent = 1
const log6 = [
    { type: 'system', cost: 2, msgId: 'System', label: 'Stunned 1 & Slowed 2' },
    { type: 'action', cost: 1, slug: 'stride' }, // Takes 3rd slot
    { type: 'action', cost: 1, slug: 'stride' }  // Takes 4th slot
];
const result6Action = ah.allocateSlots(combatant1, log6, 'action');
const result6Reaction = ah.allocateSlots(combatant1, log6, 'reaction');

assert.equal(result6Action.overspent.length, 0);
assert.equal(result6Action.slots[0].spentBy.type, 'system'); // System drain takes Quickened first
assert.equal(result6Action.slots[1].spentBy.type, 'system'); // System drain takes Base
assert.equal(result6Action.slots[2].spentBy.slug, 'stride'); // Stride takes Base
assert.equal(result6Action.slots[3].spentBy.slug, 'stride'); // Stride takes Base
assert.equal(result6Reaction.overspent.length, 0);
assert.equal(result6Reaction.slots[0].spentBy, undefined); // Reaction NOT drained since Stunned 1 <= maxActions

// Test 9: Slowed 1 / Stunned 0 and Quickened
const log7 = [
    { type: 'system', cost: 1, msgId: 'System', label: 'Slowed 1' },
    { type: 'action', cost: 1, slug: 'stride' },
    { type: 'action', cost: 1, slug: 'stride' },
    { type: 'action', cost: 1, slug: 'stride' }
];
const result7 = ah.allocateSlots(combatant1, log7, 'action');
assert.equal(result7.overspent.length, 0); // 1 system, 3 standard fit in 4 slots
assert.equal(result7.slots[0].spentBy.type, 'system'); // System drain consumes Quickened
assert.equal(result7.slots[1].spentBy.slug, 'stride');
assert.equal(result7.slots[2].spentBy.slug, 'stride');
assert.equal(result7.slots[3].spentBy.slug, 'stride');

// Test 10: Stunned 4 with Quickened (4 slots total)
// maxActions = 4. stunnedVal = 4. 4 > 4 is false. Reaction NOT drained.
const log8 = [
    { type: 'system', cost: 4, msgId: 'System', label: 'Stunned 4' },
    { type: 'action', cost: 1, slug: 'stride' } // Overspend! All 4 slots drained by Stunned
];
const result8Action = ah.allocateSlots(combatant1, log8, 'action');
const result8Reaction = ah.allocateSlots(combatant1, log8, 'reaction');

assert.equal(result8Action.overspent.length, 1);
assert.equal(result8Action.slots[0].spentBy.type, 'system');
assert.equal(result8Action.slots[1].spentBy.type, 'system');
assert.equal(result8Action.slots[2].spentBy.type, 'system');
assert.equal(result8Action.slots[3].spentBy.type, 'system');
assert.equal(result8Reaction.overspent.length, 0);
assert.equal(result8Reaction.slots[0].spentBy, undefined); // Reaction NOT drained! Stunned drops to 0.

// Test 11: Stunned 5 with Quickened (4 slots total)
// maxActions = 4. stunnedVal = 5. 5 > 4 is true. Reaction IS drained!
const log9 = [
    { type: 'system', cost: 4, msgId: 'System', label: 'Stunned 5' },
    { type: 'reaction', cost: 1, msgId: 'System', label: 'Stunned: Reaction Lost' }
];
const result9Action = ah.allocateSlots(combatant1, log9, 'action');
const result9Reaction = ah.allocateSlots(combatant1, log9, 'reaction');

assert.equal(result9Action.overspent.length, 0); // 4 actions drained perfectly
assert.equal(result9Action.slots[0].spentBy.type, 'system');
assert.equal(result9Reaction.overspent.length, 0);
assert.equal(result9Reaction.slots[0].spentBy.msgId, 'System'); // Reaction drained!

console.log("All slot allocation tests passed!");
