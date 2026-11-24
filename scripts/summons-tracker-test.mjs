import assert from "node:assert/strict";
import { SCOPE } from "../src/globals.ts";
import { SettingsManager } from "../src/SettingsManager.ts";
import { SummonManager, SUMMONS_ASSISTANT_ID, MINION_ID_PREFIX } from "../src/summons/index.ts";
import { ActorManager } from "../src/ActorManager.ts";
import { ActionManager } from "../src/ActionManager.ts";
import { TrackerPipRenderer } from "../src/ui/TrackerPipRenderer.ts";
import { findCombatantById, findCombatantByMessage } from "../src/foundryCompat.ts";
import { SocketSender } from "../src/sockets/SocketSender.ts";
import { MovementManager } from "../src/MovementManager.ts";
import { GlobalConfig } from "../src/globals.ts";

// --- Mock Foundry Environment ---
const mockSettings = new Map();
let isSummonsModuleActive = false;
const capturedWhispers = [];

SocketSender.broadcastWhisper = (payload) => {
    capturedWhispers.push(payload);
};

class MockActor {
    constructor({ id, name, traits = [], summoner = undefined, ownership = {}, hp = { value: 20, max: 20 }, classSlug = undefined } = {}) {
        this.id = id;
        this.uuid = `Actor.${id}`;
        this.name = name;
        this.img = `tokens/${id}.webp`;
        this.ownership = ownership;
        this.class = classSlug ? { slug: classSlug } : undefined;
        this.system = {
            traits: { value: traits },
            attributes: { hp, speed: { total: 30 } },
            resources: { reactions: { max: 1 } }
        };
        this.itemTypes = { condition: [] };
        this.items = [];
        this.flags = {};
        if (summoner) {
            this.flags[SUMMONS_ASSISTANT_ID] = { summoner };
        }
    }

    isOfType(type) {
        return type === "creature";
    }

    getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
    }

    hasCondition(_slug) {
        return false;
    }
}

class MockTokenDoc {
    constructor({ id, name, actor, hidden = false } = {}) {
        this.id = id;
        this.name = name || actor?.name;
        this.actorId = actor?.id;
        this.actor = actor;
        this.hidden = hidden;
        this.texture = { src: `tokens/${id}.webp` };
        this.flags = {};
        this._isMockToken = true;
    }

    getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
    }

    async setFlag(scope, key, val) {
        if (!this.flags[scope]) this.flags[scope] = {};
        this.flags[scope][key] = val;
        return this;
    }

    async update(updateData, options = {}) {
        // Mirror Foundry's `update(updateData, { diff: false, recursive: false })` behavior:
        // when `recursive: false`, Foundry replaces top-level flag objects unless all keys in flags[SCOPE] are included!
        if (options?.recursive === false) {
            const newScopeFlags = {};
            for (const [k, v] of Object.entries(updateData)) {
                if (k.startsWith(`flags.${SCOPE}.`)) {
                    const flagKey = k.slice(`flags.${SCOPE}.`.length);
                    newScopeFlags[flagKey] = v;
                }
            }
            this.flags[SCOPE] = newScopeFlags;
            return this;
        }
        for (const [k, v] of Object.entries(updateData)) {
            if (k.startsWith(`flags.${SCOPE}.`)) {
                const flagKey = k.slice(`flags.${SCOPE}.`.length);
                if (!this.flags[SCOPE]) this.flags[SCOPE] = {};
                this.flags[SCOPE][flagKey] = v;
            }
        }
        return this;
    }
}

class MockCombatant {
    constructor({ id, tokenId, actor }) {
        this.id = id;
        this.tokenId = tokenId;
        this.actorId = actor.id;
        this.actor = actor;
        this.name = actor.name;
        this.flags = {};
    }

    getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
    }

    async setFlag(scope, key, val) {
        if (!this.flags[scope]) this.flags[scope] = {};
        this.flags[scope][key] = val;
        return this;
    }

    async update(updateData, options = {}) {
        // Mirror Foundry's `update(updateData, { diff: false, recursive: false })` behavior:
        // when `recursive: false`, Foundry replaces top-level flag objects unless all keys in flags[SCOPE] are included!
        if (options?.recursive === false) {
            const newScopeFlags = {};
            for (const [k, v] of Object.entries(updateData)) {
                if (k.startsWith(`flags.${SCOPE}.minions.`)) {
                    const tokenId = k.slice(`flags.${SCOPE}.minions.`.length);
                    if (!newScopeFlags.minions) newScopeFlags.minions = {};
                    newScopeFlags.minions[tokenId] = v;
                } else if (k.startsWith(`flags.${SCOPE}.`)) {
                    const flagKey = k.slice(`flags.${SCOPE}.`.length);
                    newScopeFlags[flagKey] = v;
                }
            }
            this.flags[SCOPE] = newScopeFlags;
            return this;
        }
        for (const [k, v] of Object.entries(updateData)) {
            if (k.startsWith(`flags.${SCOPE}.minions.`)) {
                const tokenId = k.slice(`flags.${SCOPE}.minions.`.length);
                if (!this.flags[SCOPE]) this.flags[SCOPE] = {};
                if (!this.flags[SCOPE].minions) this.flags[SCOPE].minions = {};
                this.flags[SCOPE].minions[tokenId] = v;
            } else if (k.startsWith(`flags.${SCOPE}.`)) {
                const flagKey = k.slice(`flags.${SCOPE}.`.length);
                if (!this.flags[SCOPE]) this.flags[SCOPE] = {};
                this.flags[SCOPE][flagKey] = v;
            }
        }
        return this;
    }
}

const summonerActor = new MockActor({
    id: "wizard-1",
    name: "Ezren",
    traits: ["human", "humanoid"],
    ownership: { "player-1": 3 }
});

const wolfMinionActor = new MockActor({
    id: "wolf-summon-1",
    name: "Ezren's Wolf",
    traits: ["animal", "minion", "summoned"],
    summoner: { id: "wizard-1", uuid: "Actor.wizard-1" },
    ownership: {} // Owned via summoner link
});

const eidolonActor = new MockActor({
    id: "eidolon-1",
    name: "Dragon Eidolon",
    traits: ["dragon", "eidolon"],
    classSlug: "eidolon",
    summoner: { id: "wizard-1", uuid: "Actor.wizard-1" }
});

const torchObjectActor = new MockActor({
    id: "torch-1",
    name: "Torch",
    traits: ["object"], // No minion trait
    summoner: { id: "wizard-1", uuid: "Actor.wizard-1" }
});

const summonerToken = new MockTokenDoc({ id: "tok-wizard", actor: summonerActor });
const wolfToken = new MockTokenDoc({ id: "tok-wolf", actor: wolfMinionActor });
const eidolonToken = new MockTokenDoc({ id: "tok-eidolon", actor: eidolonActor });
const torchToken = new MockTokenDoc({ id: "tok-torch", actor: torchObjectActor });

const summonerCombatant = new MockCombatant({
    id: "comb-wizard",
    tokenId: "tok-wizard",
    actor: summonerActor
});

globalThis.ui = {
    combat: { render: () => {} },
    notifications: { warn: () => {}, info: () => {}, error: () => {} }
};

globalThis.game = {
    user: { id: "gm-1", isGM: true, isActiveGM: true },
    users: {
        activeGM: { id: "gm-1" },
        filter: () => [{ id: "gm-1", isGM: true }]
    },
    actors: {
        get: (id) => (id === "wizard-1" ? summonerActor : null)
    },
    messages: {
        get: () => null
    },
    modules: {
        get: (id) => (id === SUMMONS_ASSISTANT_ID ? { active: isSummonsModuleActive } : null)
    },
    settings: {
        settings: new Map([
            [`${SCOPE}.enableSummonsTracking`, {}],
            [`${SCOPE}.whisperOverspend`, {}],
            [`${SCOPE}.whisperUnderspend`, {}],
            [`${SCOPE}.whisperReactionOverspend`, {}],
            [`${SCOPE}.whisperSustain`, {}],
            [`${SCOPE}.enhancedUndo`, {}],
            [`${SCOPE}.whisperUndoCleanup`, {}],
            [`${SCOPE}.debugMode`, {}]
        ]),
        get: (scope, key) => mockSettings.get(`${scope}.${key}`),
        set: async (scope, key, value) => mockSettings.set(`${scope}.${key}`, value),
        register: () => {}
    },
    scenes: {
        active: {
            tokens: {
                contents: [summonerToken, wolfToken, eidolonToken, torchToken],
                get: (id) => [summonerToken, wolfToken, eidolonToken, torchToken].find(t => t.id === id)
            }
        }
    },
    combat: {
        id: "combat-1",
        active: true,
        started: true,
        combatant: summonerCombatant,
        combatants: {
            contents: [summonerCombatant]
        }
    }
};

// --- 1. Module Guard & Setting Tests ---
mockSettings.set(`${SCOPE}.enableSummonsTracking`, false);
mockSettings.set(`${SCOPE}.whisperOverspend`, true);
mockSettings.set(`${SCOPE}.whisperUnderspend`, true);
mockSettings.set(`${SCOPE}.whisperSustain`, false);
isSummonsModuleActive = false;

assert.equal(SettingsManager.isSummonsTrackingEnabled(), false, "Should be false when both module and setting are off");

// Enable setting, but keep pf2e-summons-assistant module OFF
mockSettings.set(`${SCOPE}.enableSummonsTracking`, true);
isSummonsModuleActive = false;
assert.equal(SettingsManager.isSummonsTrackingEnabled(), false, "Should be false when setting is true but pf2e-summons-assistant module is inactive");
assert.equal(SummonManager.getSummonedMinionsForCombatant(summonerCombatant).length, 0, "Should return no minions when module is inactive");

// Enable pf2e-summons-assistant module, but turn setting OFF
mockSettings.set(`${SCOPE}.enableSummonsTracking`, false);
isSummonsModuleActive = true;
assert.equal(SettingsManager.isSummonsTrackingEnabled(), false, "Should be false when module is active but setting is false");

// Enable BOTH module and setting
mockSettings.set(`${SCOPE}.enableSummonsTracking`, true);
isSummonsModuleActive = true;
assert.equal(SettingsManager.isSummonsTrackingEnabled(), true, "Should be true when both module and setting are enabled");

// --- 2. Summoned Minion Discovery & Filtering Tests ---
const discoveredMinions = SummonManager.getSummonedMinionsForCombatant(summonerCombatant);
assert.equal(discoveredMinions.length, 1, "Should discover only the summoned Wolf minion (excluding Eidolon and Torch)");
const wolfMinion = discoveredMinions[0];
assert.equal(wolfMinion.id, `${MINION_ID_PREFIX}tok-wolf`);
assert.equal(wolfMinion.name, "Ezren's Wolf");
assert.equal(SummonManager.isMinion(wolfMinion), true);
assert.equal(SummonManager.isMinion(summonerCombatant), false);

// Lookup via foundryCompat
assert.equal(findCombatantById(game.combat, `${MINION_ID_PREFIX}tok-wolf`), wolfMinion);
assert.equal(
    findCombatantByMessage(game.combat, { speaker: { token: "tok-wolf", actor: "wolf-summon-1" } }),
    wolfMinion
);

// --- 3. Turn 1 Post-Summon (Immediate 2 Actions) ---
await SummonManager.handlePostSummon(wolfToken, null, summonerActor);
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Newly summoned minion on caster's turn should start with 2 granted actions");
assert.equal(ActorManager.getSlots(wolfMinion, "action").length, 2, "Should allocate 2 action slots when grantedActions is 2");
assert.equal(ActorManager.getSlots(wolfMinion, "reaction").length, 0, "Minions should have 0 reaction slots");

// --- 4. Start of Controller's Turn -> Resets Minion to 0 Actions (Locked Pips) ---
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Minion should reset to 0 granted actions at start of controller's turn");
assert.equal(ActorManager.getSlots(wolfMinion, "action").length, 0, "Uncommanded minion should have 0 available action slots");

// Verify TrackerPipRenderer outputs 2 locked pips when uncommanded (0 slots) so UI never jumps
const uncommandedAlloc = ActorManager.allocateSlots(wolfMinion, [], "action");
const lockedPipModels = TrackerPipRenderer.buildActionPipModels(uncommandedAlloc.slots, uncommandedAlloc.overspent, true);
assert.equal(lockedPipModels.length, 2, "Uncommanded minion should still render 2 pip models to prevent layout jumping");
assert.equal(lockedPipModels[0].isLocked, true);
assert.equal(lockedPipModels[1].isLocked, true);

// --- 5. Uncommanded Minion Acting Triggers Overspend Routed to Controlling Player ---
capturedWhispers.length = 0;
await ActionManager.addAction(wolfMinion, {
    cost: 1,
    msgId: "wolf-bite-uncommanded",
    label: "Jaws",
    type: "action",
    slug: "strike",
    isQuickenedEligible: true,
    category: "attack",
    linkedMessages: []
});

assert.equal(capturedWhispers.length, 1, "Acting with an uncommanded minion should trigger an overspend alert");
assert.deepEqual(capturedWhispers[0].targetPlayerIds, ["player-1"], "Overspend alert should be routed to the controlling player");
assert.match(capturedWhispers[0].message, /Ezren's Wolf/);
assert.match(capturedWhispers[0].message, /before being Sustained or Commanded/);

// Clean up uncommanded strike
await ActionManager.removeAction(wolfMinion, "wolf-bite-uncommanded");

// --- 6. Controller Sustains -> Grants 2 Actions to Minion -> Undo Sustain Revokes ---
await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "ezren-sustain-1",
    label: "Sustain",
    type: "action",
    slug: "sustain-a-spell",
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});

assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Sustaining on controller should automatically grant 2 actions to the summon");
const commandedAlloc = ActorManager.allocateSlots(wolfMinion, [], "action");
const commandedPipModels = TrackerPipRenderer.buildActionPipModels(commandedAlloc.slots, commandedAlloc.overspent, true);
assert.equal(commandedPipModels.length, 2, "Commanded minion still renders 2 pip models (no layout shift)");
assert.equal(commandedPipModels[0].isLocked, false);
assert.equal(commandedPipModels[1].isLocked, false);

// Undoing the controller's Sustain action should revoke the 2 actions on the minion
await ActionManager.removeAction(summonerCombatant, "ezren-sustain-1");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Undoing the controller's Sustain should revoke the minion's 2 actions");

// Multi-turn sustain persistence: Cast with sustainItem on Turn 1 -> Turn 2 Sustain via Sustain button -> Turn 3 Sustain via Sustain button
await ActionManager.addAction(summonerCombatant, {
    cost: 3,
    msgId: "ezren-cast-summon-wolf",
    label: "Summon Animal (Wolf)",
    type: "action",
    slug: "cast-a-spell",
    sustainItem: { id: "spell-summon-wolf", name: "Summon Animal (Wolf)" },
    isQuickenedEligible: false,
    category: "spell",
    linkedMessages: []
});
assert.deepEqual(summonerCombatant.getFlag(SCOPE, "sustainData"), { "spell-summon-wolf": "Summon Animal (Wolf)" });

// Turn 2: Start of turn -> sustain reminder -> click Sustain
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0);
assert.deepEqual(summonerCombatant.getFlag(SCOPE, "sustainData"), { "spell-summon-wolf": "Summon Animal (Wolf)" }, "sustainData should persist at start of Turn 2");

await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "ezren-sustain-turn-2",
    label: "Summon Animal (Wolf)",
    type: "action",
    slug: "sustain-a-spell",
    sustainItem: { id: "spell-summon-wolf", name: "Summon Animal (Wolf)" },
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Turn 2 Sustain should grant 2 actions to the minion");

// Turn 3: Start of turn -> sustain reminder -> click Sustain again
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0);
assert.deepEqual(summonerCombatant.getFlag(SCOPE, "sustainData"), { "spell-summon-wolf": "Summon Animal (Wolf)" }, "sustainData should persist at start of Turn 3");

await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "ezren-sustain-turn-3",
    label: "Summon Animal (Wolf)",
    type: "action",
    slug: "sustain-a-spell",
    sustainItem: { id: "spell-summon-wolf", name: "Summon Animal (Wolf)" },
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Turn 3 Sustain (second time sustaining) should also grant 2 actions to the minion");
await ActionManager.removeAction(summonerCombatant, "ezren-sustain-turn-3");

// --- 7. End-of-Turn Underspend Behavior ---
// Case A: Minion is uncommanded (0 granted actions) -> Should NOT trigger underspend for minion
capturedWhispers.length = 0;
ActionManager.handleEndOfTurn(summonerCombatant);
const minionUnderspendsWhenUncommanded = capturedWhispers.filter(w => w.message.includes("Ezren's Wolf"));
assert.equal(minionUnderspendsWhenUncommanded.length, 0, "Uncommanded minion (0/0) should NOT trigger an underspend alert");

// Case B: Minion is granted 2 actions and only spends 1 -> SHOULD trigger underspend routed to controller
await SummonManager.toggleManualGrant(wolfMinion);
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2);
await ActionManager.addAction(wolfMinion, {
    cost: 1,
    msgId: "wolf-stride-1",
    label: "Stride",
    type: "action",
    slug: "stride",
    isQuickenedEligible: true,
    category: "move",
    linkedMessages: []
});

capturedWhispers.length = 0;
ActionManager.handleEndOfTurn(summonerCombatant);
const minionUnderspendsWhenCommanded = capturedWhispers.filter(w => w.message.includes("Ezren's Wolf"));
assert.equal(minionUnderspendsWhenCommanded.length, 1, "Commanded minion with 1/2 actions spent should trigger underspend alert");
assert.deepEqual(minionUnderspendsWhenCommanded[0].targetPlayerIds, ["player-1"], "Minion underspend alert should be routed to controlling player");
assert.match(minionUnderspendsWhenCommanded[0].message, /ended turn with \*\*1\*\* actions/);

// --- 8. Quickened Minion (0 Actions Locked -> 3 Actions Unlocked with Quickened Slot) ---
wolfMinionActor.hasCondition = (slug) => slug === "quickened";
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(ActorManager.hasQuickenedSnapshot(wolfMinion), true, "Minion should snapshot Quickened at start of controller's turn");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Quickened minion still starts with 0 actions until commanded");
assert.equal(ActorManager.getSlots(wolfMinion, "action").length, 0, "Uncommanded Quickened minion has 0 usable slots before command");

// Locked pips when Quickened should include 1 locked gold pip + 2 locked base pips (3 total)
const quickenedUncommandedAlloc = ActorManager.allocateSlots(wolfMinion, [], "action");
const quickenedLockedPips = TrackerPipRenderer.buildActionPipModels(
    quickenedUncommandedAlloc.slots,
    quickenedUncommandedAlloc.overspent,
    true,
    true
);
assert.equal(quickenedLockedPips.length, 3, "Uncommanded Quickened minion should render 3 locked pips (1 gold + 2 base) so UI doesn't jump");
assert.equal(quickenedLockedPips[0].isGold, true);
assert.equal(quickenedLockedPips[0].isLocked, true);
assert.equal(quickenedLockedPips[1].isGold, false);
assert.equal(quickenedLockedPips[1].isLocked, true);

// Now Command/Grant actions to the Quickened minion -> Should have 3 unlocked slots (1 Quickened + 2 Base)
await SummonManager.grantActionsToMinion(wolfMinion, 2, "cmd-quickened");
const quickenedCommandedSlots = ActorManager.getSlots(wolfMinion, "action");
assert.equal(quickenedCommandedSlots.length, 3, "Commanded Quickened minion should have 3 total slots (1 Quickened + 2 Base)");
assert.equal(quickenedCommandedSlots[0].isBase, false);
assert.equal(quickenedCommandedSlots[0].definition.slug, "quickened");
wolfMinionActor.hasCondition = () => false;

// --- 9. Slowed & Stunned Minion Drains (Applied When Commanded, Reverted When Undone) ---
const stunnedConditionItem = {
    slug: "stunned",
    value: 1,
    update: async function (data) {
        this.value = data["system.value.value"];
    },
    delete: async function () {
        this.value = 0;
    }
};
wolfMinionActor.items = [stunnedConditionItem];
wolfMinionActor.itemTypes = { condition: [stunnedConditionItem] };

await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(stunnedConditionItem.value, 1, "Stunned on a minion is not decremented until the minion is commanded to gain actions");

// Controller sustains to grant 2 actions -> Minion gains 2 actions, loses 1 to Stunned 1, and Stunned 1 decrements to 0
await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "ezren-sustain-stunned",
    label: "Sustain",
    type: "action",
    slug: "sustain-a-spell",
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});

assert.equal(SummonManager.getGrantedActions(wolfMinion), 2);
assert.equal(stunnedConditionItem.value, 0, "Stunned 1 should decrement to 0 when the minion gains its actions");
const stunnedMinionLogs = ActionManager.getActions(wolfMinion);
assert.equal(stunnedMinionLogs.length, 1, "Minion log should contain the Stunned 1 system drain entry");
assert.equal(stunnedMinionLogs[0].type, "system");
assert.equal(stunnedMinionLogs[0].cost, 1);
assert.equal(stunnedMinionLogs[0].label, "Stunned 1");

// Undoing the Sustain should revoke the minion's actions AND restore Stunned 1
await ActionManager.removeAction(summonerCombatant, "ezren-sustain-stunned");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0);
assert.equal(stunnedConditionItem.value, 1, "Undoing the controller's Sustain should restore the minion's Stunned value");
assert.equal(ActionManager.getActions(wolfMinion).length, 0, "System drain should be removed when grant is revoked");

// Case 9B: Stunned 3 on a minion:
// - If the minion is NOT granted actions on a turn, Stunned 3 must remain at 3 (NOT decrement to 1!).
// - When the minion IS granted 2 actions, it loses all 2 actions to Stunned 3 and Stunned 3 decrements by 2 -> Stunned 1!
stunnedConditionItem.value = 3;
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(stunnedConditionItem.value, 3, "Uncommanded minion with Stunned 3 must NOT lose Stunned stacks at start of turn");
ActionManager.handleEndOfTurn(summonerCombatant);
assert.equal(stunnedConditionItem.value, 3, "Uncommanded minion with Stunned 3 must still be Stunned 3 at end of turn if never granted actions");

// Next turn: controller sustains the Stunned 3 minion -> minion gains 2 actions, loses 2 to Stunned, and Stunned 3 -> Stunned 1
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(stunnedConditionItem.value, 3);
await SummonManager.grantActionsToMinion(wolfMinion, 2, "sustain-stun3");
assert.equal(stunnedConditionItem.value, 1, "Granting 2 actions to a Stunned 3 minion should drain 2 actions and decrement Stunned 3 -> Stunned 1");
const stun3Logs = ActionManager.getActions(wolfMinion);
assert.equal(stun3Logs.length, 1);
assert.equal(stun3Logs[0].cost, 2, "Stunned 3 should drain all 2 granted actions");
assert.equal(stun3Logs[0].label, "Stunned 3");

// Revoking the grant restores Stunned 1 -> Stunned 3
await SummonManager.grantActionsToMinion(wolfMinion, 0, null);
assert.equal(stunnedConditionItem.value, 3, "Revoking the grant should restore Stunned 1 -> Stunned 3");

wolfMinionActor.items = [];
wolfMinionActor.itemTypes = { condition: [] };

// Case 9C: Zombie Shambler's inMemoryOnly Slowed 1 (stored in actor.conditions.bySlug("slowed"), NOT in actor.items!)
wolfMinionActor.conditions = {
    bySlug: (slug) => (slug === "slowed" ? [{ slug: "slowed", value: 1 }] : [])
};
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(ActionManager.getActions(wolfMinion).length, 0, "Uncommanded Slowed 1 Zombie Shambler has no drain log before being granted actions");

// Grant 2 actions (either on initial summon or via Sustain) -> 1 action docked by Slowed 1!
await SummonManager.grantActionsToMinion(wolfMinion, 2, "sustain-zombie");
const zombieLogs = ActionManager.getActions(wolfMinion);
assert.equal(zombieLogs.length, 1, "Slowed 1 Zombie Shambler should have 1 system drain entry when granted actions");
assert.equal(zombieLogs[0].type, "system");
assert.equal(zombieLogs[0].cost, 1, "Slowed 1 should dock 1 action from the Zombie Shambler's 2 granted actions");
assert.equal(zombieLogs[0].label, "Slowed 1");

delete wolfMinionActor.conditions;

// --- 10. Multiple Minions: Match by Sustained Spell Item ID, Sustain Both Sequentially, & Fallback Selection Dialog ---
const bearMinionActor = new MockActor({
    id: "bear-summon-2",
    name: "Ezren's Bear",
    traits: ["animal", "minion", "summoned"],
    summoner: { id: "wizard-1", uuid: "Actor.wizard-1" }
});
const bearToken = new MockTokenDoc({ id: "tok-bear", actor: bearMinionActor });
game.scenes.active.tokens.contents.push(bearToken);

// Turn A: Post-summon Wolf with Summon Undead / Summon Animal (Wolf)
await SummonManager.handlePostSummon(wolfToken, { id: "spell-summon-wolf", name: "Summon Animal (Wolf)" }, summonerActor);
assert.equal(wolfMinion.getFlag(SCOPE, "summonedByItemId"), "spell-summon-wolf");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2);

// Turn B: Advance to next turn -> Wolf starts at 0 actions.
// Now cast a SECOND summon spell ("Summon Fey (Bear)") which has `sustainItem` on the cast-a-spell action!
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Wolf starts Turn B at 0 actions");

await ActionManager.addAction(summonerCombatant, {
    cost: 3,
    msgId: "cast-summon-bear-msg",
    label: "Summon Animal (Bear)",
    type: "action",
    slug: "cast-a-spell",
    sustainItem: { id: "spell-summon-bear", name: "Summon Animal (Bear)" },
    isQuickenedEligible: false,
    category: "spell",
    linkedMessages: []
});
// Crucial assertion: Casting a second summon spell (which carries sustainItem) must NOT grant actions to the uncommanded Wolf!
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Casting a second summon spell must NOT grant actions to the existing uncommanded minion");

// Now PF2e Summons Assistant places the Bear token and fires postPf2eSummon
await SummonManager.handlePostSummon(bearToken, { id: "spell-summon-bear", name: "Summon Animal (Bear)" }, summonerActor);

const allMinions = SummonManager.getSummonedMinionsForCombatant(summonerCombatant);
assert.equal(allMinions.length, 2, "Controller should now have 2 summoned minions stored under distinct tokenIds");
const bearMinion = allMinions.find(m => m.tokenId === "tok-bear");
assert.notEqual(wolfMinion.tokenId, bearMinion.tokenId, "Minions must have distinct tokenIds");
assert.equal(wolfMinion.getFlag(SCOPE, "summonedByItemId"), "spell-summon-wolf", "Wolf must retain its own summonedByItemId");
assert.equal(bearMinion.getFlag(SCOPE, "summonedByItemId"), "spell-summon-bear", "Bear must have its own summonedByItemId");
assert.equal(SummonManager.getGrantedActions(bearMinion), 2, "Newly summoned Bear starts with 2 actions on Turn B");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Wolf is still at 0 actions until sustained");

// Sustain Wolf on Turn B -> now BOTH Wolf and Bear have 2 actions!
await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "sustain-wolf-turn-b",
    label: "Summon Animal (Wolf)",
    type: "action",
    slug: "sustain-a-spell",
    sustainItem: { id: "spell-summon-wolf", name: "Summon Animal (Wolf)" },
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Sustaining Wolf on Turn B grants 2 actions to Wolf");
assert.equal(SummonManager.getGrantedActions(bearMinion), 2, "Bear retains its 2 actions");

// Turn C: Start new turn -> both Wolf and Bear reset to 0 actions, while keeping their distinct summonedByItemIds
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0);
assert.equal(SummonManager.getGrantedActions(bearMinion), 0);
assert.equal(wolfMinion.getFlag(SCOPE, "summonedByItemId"), "spell-summon-wolf", "Wolf retains summonedByItemId after turn reset");
assert.equal(bearMinion.getFlag(SCOPE, "summonedByItemId"), "spell-summon-bear", "Bear retains summonedByItemId after turn reset");

// Case A: Sustain specifically "spell-summon-bear" -> should unlock ONLY Bear without needing dialog
await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "sustain-bear-msg",
    label: "Summon Animal (Bear)",
    type: "action",
    slug: "sustain-a-spell",
    sustainItem: { id: "spell-summon-bear", name: "Summon Animal (Bear)" },
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});
assert.equal(SummonManager.getGrantedActions(bearMinion), 2, "Bear minion should be granted 2 actions via matching sustainItem.id");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Wolf minion should remain at 0 actions");

// Case B: Now sustain "spell-summon-wolf" on the SAME turn -> should unlock Wolf so BOTH minions have 2 actions!
await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "sustain-wolf-msg",
    label: "Summon Animal (Wolf)",
    type: "action",
    slug: "sustain-a-spell",
    sustainItem: { id: "spell-summon-wolf", name: "Summon Animal (Wolf)" },
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});
assert.equal(SummonManager.getGrantedActions(bearMinion), 2, "Bear minion still has 2 actions");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Wolf minion now also has 2 actions after sustaining second summon");

// Case C: Undo Bear's sustain -> revokes ONLY Bear's 2 actions, leaving Wolf's 2 actions intact
await ActionManager.removeAction(summonerCombatant, "sustain-bear-msg");
assert.equal(SummonManager.getGrantedActions(bearMinion), 0, "Undoing Bear's sustain revokes only Bear's actions");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Wolf's 2 actions remain intact");

// Reset both to 0 and test ambiguous generic Command/Sustain with 2 uncommanded minions -> triggers promptSelectMinionToCommand
await ActionManager.handleStartOfTurn(summonerCombatant);
let promptCalledWithCount = 0;
const origPrompt = SummonManager.promptSelectMinionToCommand.bind(SummonManager);
SummonManager.promptSelectMinionToCommand = async (candidates) => {
    promptCalledWithCount = candidates.length;
    return candidates.find(c => c.tokenId === "tok-bear");
};

await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "generic-sustain-msg",
    label: "Sustain",
    type: "action",
    slug: "sustain-a-spell",
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});

assert.equal(promptCalledWithCount, 2, "Ambiguous Sustain with 2 uncommanded minions should invoke selection prompt with 2 candidates");
assert.equal(SummonManager.getGrantedActions(bearMinion), 2, "Minion chosen in prompt should receive the 2 actions");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Unchosen minion should remain at 0 actions");

// A second generic Sustain when only 1 minion (Wolf) remains uncommanded should automatically grant to the remaining uncommanded minion (Wolf)!
promptCalledWithCount = 0;
await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "generic-sustain-msg-2",
    label: "Sustain",
    type: "action",
    slug: "sustain-a-spell",
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});
assert.equal(promptCalledWithCount, 0, "Second generic Sustain with only 1 remaining uncommanded minion should grant directly without prompting");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Remaining uncommanded minion (Wolf) should now also have 2 actions");
assert.equal(SummonManager.getGrantedActions(bearMinion), 2, "First minion (Bear) still has 2 actions");
SummonManager.promptSelectMinionToCommand = origPrompt;

// Case D: Casting the SAME summon spell twice (e.g. two Summon Undead castings sharing itemId "spell-summon-undead")
// Both minions share summonedByItemId === "spell-summon-undead", but have distinct tokenIds ("tok-wolf" and "tok-bear").
await SummonManager.handlePostSummon(wolfToken, { id: "spell-summon-undead", name: "Summon Undead" }, summonerActor);
await SummonManager.handlePostSummon(bearToken, { id: "spell-summon-undead", name: "Summon Undead" }, summonerActor);

// Also register "spell-summon-undead" in sustainData on the controller
await summonerCombatant.setFlag(SCOPE, "sustainData", { "spell-summon-undead": "Summon Undead" });
mockSettings.set(`${SCOPE}.whisperSustain`, true);

const createdReminderCards = [];
globalThis.ChatMessage = {
    getSpeaker: () => ({}),
    create: async (data) => {
        createdReminderCards.push(data);
        return data;
    }
};
globalThis.foundry = {
    applications: {
        handlebars: {
            renderTemplate: async (_path, data) => JSON.stringify(data)
        }
    }
};

// Start of turn -> should emit TWO separate Sustain Reminder cards (one for tok-wolf, one for tok-bear)!
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(createdReminderCards.length, 2, "Casting Summon Undead twice should produce 2 Sustain Reminder cards (one per minion token)");
const card1Data = JSON.parse(createdReminderCards[0].content);
const card2Data = JSON.parse(createdReminderCards[1].content);
assert.equal(card1Data.itemId, "spell-summon-undead");
assert.equal(card2Data.itemId, "spell-summon-undead");
assert.deepEqual(
    [card1Data.minionTokenId, card2Data.minionTokenId].sort(),
    ["tok-bear", "tok-wolf"],
    "Each Sustain Reminder card should carry its specific minionTokenId"
);

// Clicking Sustain on the Bear's reminder card (carrying minionTokenId: "tok-bear") should grant 2 actions ONLY to Bear without needing a prompt!
await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "sustain-undead-bear-card",
    label: "Summon Undead (Ezren's Bear)",
    type: "action",
    slug: "sustain-a-spell",
    sustainItem: { id: "spell-summon-undead", name: "Summon Undead (Ezren's Bear)", minionTokenId: "tok-bear" },
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});
assert.equal(SummonManager.getGrantedActions(bearMinion), 2, "Clicking Sustain on Bear's reminder card should unlock Bear directly via minionTokenId");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 0, "Wolf should still be at 0 actions");

// Clicking Sustain on the Wolf's reminder card (carrying minionTokenId: "tok-wolf") should grant 2 actions to Wolf!
await ActionManager.addAction(summonerCombatant, {
    cost: 1,
    msgId: "sustain-undead-wolf-card",
    label: "Summon Undead (Ezren's Wolf)",
    type: "action",
    slug: "sustain-a-spell",
    sustainItem: { id: "spell-summon-undead", name: "Summon Undead (Ezren's Wolf)", minionTokenId: "tok-wolf" },
    isQuickenedEligible: true,
    category: "sustain",
    linkedMessages: []
});
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Clicking Sustain on Wolf's reminder card should unlock Wolf directly via minionTokenId");

// Case E: Realistic PF2e EmbeddedSpell scenario where `chatMessage.item` passed to `postPf2eSummon` has `id: undefined`!
// 1. Caster casts Summon Undead #1 (logged in ActionManager with sustainItem: { id: "real-item-id-123", name: "Summon Undead" })
// 2. PF2e Summons Assistant calls postPf2eSummon(wolfToken, { id: undefined, name: "Summon Undead" }, summonerActor)
// 3. Caster casts Summon Undead #2 (or next turn) and PF2e Summons Assistant calls postPf2eSummon(bearToken, { id: undefined, name: "Summon Undead" }, summonerActor)
await summonerCombatant.setFlag(SCOPE, "sustainData", {});
await ActionManager.handleStartOfTurn(summonerCombatant);
await ActionManager.addAction(summonerCombatant, {
    cost: 3,
    msgId: "cast-summon-undead-1",
    label: "Summon Undead",
    type: "action",
    slug: "cast-a-spell",
    sustainItem: { id: "real-item-id-123", name: "Summon Undead" },
    isQuickenedEligible: false,
    category: "spell",
    linkedMessages: []
});
await SummonManager.handlePostSummon(wolfToken, { id: undefined, name: "Summon Undead" }, summonerActor);
assert.equal(wolfMinion.getFlag(SCOPE, "summonedByItemId"), "real-item-id-123", "handlePostSummon should recover summonedByItemId from the controller's latest sustained cast when summonerItem.id is undefined");

await ActionManager.addAction(summonerCombatant, {
    cost: 3,
    msgId: "cast-summon-undead-2",
    label: "Summon Undead",
    type: "action",
    slug: "cast-a-spell",
    sustainItem: { id: "real-item-id-123", name: "Summon Undead" },
    isQuickenedEligible: false,
    category: "spell",
    linkedMessages: []
});
await SummonManager.handlePostSummon(bearToken, { id: undefined, name: "Summon Undead" }, summonerActor);
assert.equal(bearMinion.getFlag(SCOPE, "summonedByItemId"), "real-item-id-123", "Second summon should also recover summonedByItemId when summonerItem.id is undefined");

createdReminderCards.length = 0;
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(createdReminderCards.length, 2, "Even when summonerItem.id was undefined in postPf2eSummon, start of turn must emit 2 Sustain Reminder cards");
assert.match(JSON.parse(createdReminderCards[0].content).itemName, /^Summon Undead \(/);
assert.match(JSON.parse(createdReminderCards[1].content).itemName, /^Summon Undead \(/);

// Case F: Dead minions drop out of Sustain reminders; spell removed when ALL linked minions are dead
const sustainKeys = () => Object.keys(summonerCombatant.getFlag(SCOPE, "sustainData") || {});
assert.ok(sustainKeys().includes("real-item-id-123"), "Spell is in sustainData before any minion dies");
bearMinionActor.system.attributes.hp.value = 0;
createdReminderCards.length = 0;
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(createdReminderCards.length, 1, "Only the living minion gets a Sustain Reminder");
assert.equal(JSON.parse(createdReminderCards[0].content).minionTokenId, "tok-wolf");
assert.ok(sustainKeys().includes("real-item-id-123"), "Spell stays sustainable while a linked minion lives");

wolfMinionActor.system.attributes.hp.value = 0;
createdReminderCards.length = 0;
await ActionManager.handleStartOfTurn(summonerCombatant);
assert.equal(createdReminderCards.length, 0, "No reminders when every linked minion is dead");
assert.ok(!sustainKeys().includes("real-item-id-123"), "Spell removed from sustain list once all linked minions are dead");
bearMinionActor.system.attributes.hp.value = 20;
wolfMinionActor.system.attributes.hp.value = 20;

mockSettings.set(`${SCOPE}.whisperSustain`, false);

// --- 11. Minion Move -> Strike -> Ctrl+Z (Undo both Strike and Move in order) ---
globalThis.canvas = {
    grid: {
        measurePath: (coords) => {
            if (!coords || coords.length < 2) return { distance: 0 };
            let dist = 0;
            for (let i = 1; i < coords.length; i++) {
                const dx = coords[i].x - coords[i - 1].x;
                const dy = coords[i].y - coords[i - 1].y;
                dist += Math.round((Math.sqrt(dx * dx + dy * dy) / 100) * 5);
            }
            return { distance: dist };
        }
    },
    regions: { placeables: [] }
};

// Simulate Foundry populating tokenDoc._movementHistory on the minion token
GlobalConfig.noHistoryConflict = false;
wolfToken.x = 0;
wolfToken.y = 0;
wolfToken.elevation = 0;
wolfToken.movementAction = "travel";
wolfToken._movementHistory = [];

await ActionManager.handleStartOfTurn(summonerCombatant);
await SummonManager.grantActionsToMinion(wolfMinion, 2, "sustain-wolf");

// 1. Move wolf from (0,0) to (200,0) (10ft Stride)
MovementManager.handlePreUpdateToken(wolfToken, { x: 200, y: 0 }, {});
wolfToken.x = 200;
wolfToken.y = 0;
wolfToken._movementHistory = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
await MovementManager.handleTokenUpdate(wolfToken, { x: 200, y: 0 }, {});

let wolfLog = ActionManager.getActions(wolfMinion);
assert.equal(wolfLog.length, 1, "Minion should have 1 move action after moving 10ft");
assert.equal(wolfLog[0].category, "move");
assert.equal(wolfLog[0].label, "Stride: 10ft", "Non-combatant minion with movementAction='travel' should log 'Stride: 10ft', not 'Travel: 10ft'");

// 2. Strike with wolf
await ActionManager.addAction(wolfMinion, {
    cost: 1,
    msgId: "wolf-strike-after-move",
    label: "Jaws",
    type: "action",
    slug: "strike",
    isQuickenedEligible: true,
    category: "attack",
    linkedMessages: []
});
wolfLog = ActionManager.getActions(wolfMinion);
assert.equal(wolfLog.length, 2, "Minion should have Move + Strike");

// 3. Ctrl+Z undo move back to (0,0) (Foundry sets tokenDoc._movementHistory = [] on full movement undo)
MovementManager.handlePreUpdateToken(wolfToken, { x: 0, y: 0 }, { isUndo: true });
wolfToken.x = 0;
wolfToken.y = 0;
wolfToken._movementHistory = [];
await MovementManager.handleTokenUpdate(wolfToken, { x: 0, y: 0 }, { isUndo: true });

wolfLog = ActionManager.getActions(wolfMinion);
assert.equal(wolfLog.length, 0, "Move -> Strike -> Ctrl+Z on minion should undo both the Strike and the Move");
assert.equal(SummonManager.getGrantedActions(wolfMinion), 2, "Minion's 2 granted actions should remain intact after undoing Move + Strike");

// 4. Manually moving back to a previous position (without options.isUndo) must NOT undo — it must record the return move!
MovementManager.handlePreUpdateToken(wolfToken, { x: 200, y: 0 }, {});
wolfToken.x = 200;
wolfToken.y = 0;
await MovementManager.handleTokenUpdate(wolfToken, { x: 200, y: 0 }, {});
assert.equal(ActionManager.getActions(wolfMinion).length, 1, "First manual move records 1 move action");

MovementManager.handlePreUpdateToken(wolfToken, { x: 0, y: 0 }, {});
wolfToken.x = 0;
wolfToken.y = 0;
await MovementManager.handleTokenUpdate(wolfToken, { x: 0, y: 0 }, {});
wolfLog = ActionManager.getActions(wolfMinion);
assert.equal(wolfLog.length, 1, "Manual move back to (0,0) without isUndo should not undo the move");
assert.equal(wolfLog[0].distance, 20, "Manual move back to (0,0) without isUndo should extend the recorded movement to 20ft");

console.log("All summons-tracker tests passed!");


