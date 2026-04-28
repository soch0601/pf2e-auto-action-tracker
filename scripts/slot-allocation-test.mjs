import assert from "node:assert/strict";
import { ActorHandler } from "../src/ActorHandler.ts";

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

// Test 1: Slot sorting
const actor1 = new MockActor(['tactical-strike']);
const combatant1 = new MockCombatant(actor1);

const slots = ah.getSlots(combatant1, 'action');
// Tactical strike grants 1 extra action. Base actions = 3. Total slots = 4.
assert.equal(slots.length, 4);

// The restricted slot (tactical strike, allowedSlugs: ['strike']) should be FIRST.
assert.equal(slots[0].isBase, false);
assert.equal(slots[0].definition.slug, 'tactical-strike');
assert.equal(slots[1].isBase, true);
assert.equal(slots[2].isBase, true);
assert.equal(slots[3].isBase, true);

// Test 2: Overspend Calculation
const log1 = [
    { type: 'action', cost: 1, slug: 'stride' }, // Should consume base slot
    { type: 'action', cost: 1, slug: 'stride' }, // Should consume base slot
    { type: 'action', cost: 1, slug: 'strike' }  // Should consume restricted slot (tactical-strike)
];

const result1 = ah.allocateSlots(combatant1, log1, 'action');
assert.equal(result1.overspent.length, 0);
assert.equal(result1.slots[0].spentBy, log1[2]); // Tactical strike used by strike
assert.equal(result1.slots[1].spentBy, log1[0]); // Base used by stride
assert.equal(result1.slots[2].spentBy, log1[1]); // Base used by stride
assert.equal(result1.slots[3].spentBy, undefined);

// Test 3: Complex overlap
// Add a hypothetical feat to AddReactionsLibrary for this test or just mock it.
// Wait, we can't easily mock AddReactionsLibrary because it's imported in ActorHandler.
// So we use quickened.
const actor2 = new MockActor([], []);
// Quickened allows: "strike", "stride", "step", "interact", "sustain-a-spell"
const combatant2 = new MockCombatant(actor2, { isQuickenedSnapshot: true });

const slots2 = ah.getSlots(combatant2, 'action');
assert.equal(slots2.length, 4);
assert.equal(slots2[0].definition.slug, 'quickened'); // Quickened is first

const log2 = [
    { type: 'action', cost: 1, slug: 'stride' }, // Allowed in Quickened
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'action', cost: 1, slug: 'cast-a-spell' } // Base
];

const result2 = ah.allocateSlots(combatant2, log2, 'action');
assert.equal(result2.overspent.length, 0); // Fits perfectly
assert.equal(result2.slots[0].spentBy, log2[0]); // Quickened slot takes Stride

// Now what if the logs are in a different order?
const log3 = [
    { type: 'action', cost: 1, slug: 'cast-a-spell' }, // Base
    { type: 'action', cost: 1, slug: 'stride' }, // Allowed in Quickened
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'action', cost: 1, slug: 'stride' } // Base
];
const result3 = ah.allocateSlots(combatant2, log3, 'action');
assert.equal(result3.overspent.length, 0);
// The Quickened slot (slots[0]) should be taken by the first eligible action, which is log3[1]
assert.equal(result3.slots[0].spentBy, log3[1]);

// Test 4: Overspend detection
const log4 = [
    { type: 'action', cost: 1, slug: 'cast-a-spell' }, // Base
    { type: 'action', cost: 1, slug: 'cast-a-spell' }, // Base
    { type: 'action', cost: 1, slug: 'cast-a-spell' }, // Base
    { type: 'action', cost: 1, slug: 'cast-a-spell' }  // Overspend (Quickened doesn't allow cast-a-spell)
];
const result4 = ah.allocateSlots(combatant2, log4, 'action');
assert.equal(result4.overspent.length, 1);
assert.equal(result4.overspent[0], log4[3]);

// Test 5: System drain overspend
const log5 = [
    { type: 'action', cost: 1, slug: 'stride' }, // Quickened
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'action', cost: 1, slug: 'stride' }, // Base
    { type: 'system', cost: 1 } // System action consumes any slot. It should consume the 4th slot.
];
const result5 = ah.allocateSlots(combatant2, log5, 'action');
assert.equal(result5.overspent.length, 0);
assert.equal(result5.slots[3].spentBy.type, 'system');

// Test 6: Slowed / Stunned overlap
// Slowed 2 / Stunned 1
// calculateStartOfTurnDrains returns actionsSpent = 2, reactionsSpent = 1
const log6 = [
    { type: 'system', cost: 2, msgId: 'System', label: 'Stunned 1 & Slowed 2' },
    { type: 'action', cost: 1, slug: 'stride' }, // Takes 3rd slot
    { type: 'action', cost: 1, slug: 'stride' }  // Takes 4th slot
];
const result6Action = ah.allocateSlots(combatant2, log6, 'action');
const result6Reaction = ah.allocateSlots(combatant2, log6, 'reaction');

assert.equal(result6Action.overspent.length, 0);
assert.equal(result6Action.slots[0].spentBy.type, 'system'); // System drain takes Quickened first
assert.equal(result6Action.slots[1].spentBy.type, 'system'); // System drain takes Base
assert.equal(result6Action.slots[2].spentBy.slug, 'stride'); // Stride takes Base
assert.equal(result6Action.slots[3].spentBy.slug, 'stride'); // Stride takes Base
assert.equal(result6Reaction.overspent.length, 0);
assert.equal(result6Reaction.slots[0].spentBy, undefined); // Reaction NOT drained since Stunned 1 <= maxActions

// Slowed 1 / Stunned 0 and Quickened
const log7 = [
    { type: 'system', cost: 1, msgId: 'System', label: 'Slowed 1' },
    { type: 'action', cost: 1, slug: 'stride' },
    { type: 'action', cost: 1, slug: 'stride' },
    { type: 'action', cost: 1, slug: 'stride' }
];
const result7 = ah.allocateSlots(combatant2, log7, 'action');
assert.equal(result7.overspent.length, 0); // 1 system, 3 standard fit in 4 slots
assert.equal(result7.slots[0].spentBy.type, 'system'); // System drain consumes Quickened
assert.equal(result7.slots[1].spentBy.slug, 'stride');
assert.equal(result7.slots[2].spentBy.slug, 'stride');
assert.equal(result7.slots[3].spentBy.slug, 'stride');

// Stunned 4 with Quickened (4 slots total)
// maxActions = 4. stunnedVal = 4. 4 > 4 is false. Reaction NOT drained.
const log8 = [
    { type: 'system', cost: 4, msgId: 'System', label: 'Stunned 4' },
    { type: 'action', cost: 1, slug: 'stride' } // Overspend! All 4 slots drained by Stunned
];
const result8Action = ah.allocateSlots(combatant2, log8, 'action');
const result8Reaction = ah.allocateSlots(combatant2, log8, 'reaction');

assert.equal(result8Action.overspent.length, 1);
assert.equal(result8Action.slots[0].spentBy.type, 'system');
assert.equal(result8Action.slots[1].spentBy.type, 'system');
assert.equal(result8Action.slots[2].spentBy.type, 'system');
assert.equal(result8Action.slots[3].spentBy.type, 'system');
assert.equal(result8Reaction.overspent.length, 0);
assert.equal(result8Reaction.slots[0].spentBy, undefined); // Reaction NOT drained! Stunned drops to 0.

// Stunned 5 with Quickened (4 slots total)
// maxActions = 4. stunnedVal = 5. 5 > 4 is true. Reaction IS drained!
const log9 = [
    { type: 'system', cost: 4, msgId: 'System', label: 'Stunned 5' },
    { type: 'reaction', cost: 1, msgId: 'System', label: 'Stunned: Reaction Lost' }
];
const result9Action = ah.allocateSlots(combatant2, log9, 'action');
const result9Reaction = ah.allocateSlots(combatant2, log9, 'reaction');

assert.equal(result9Action.overspent.length, 0); // 4 actions drained perfectly
assert.equal(result9Action.slots[0].spentBy.type, 'system');
assert.equal(result9Reaction.overspent.length, 0);
assert.equal(result9Reaction.slots[0].spentBy.msgId, 'System'); // Reaction drained!

console.log("All slot allocation tests passed!");
