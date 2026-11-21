import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { findCombatantByMessage } = await import("../src/foundryCompat.ts");

globalThis.ui = {
    windows: {},
    notifications: { warn: () => {}, error: () => {} },
};

globalThis.foundry = {
    applications: {
        handlebars: {
            loadTemplates: () => {},
            renderTemplate: async () => "",
        },
        api: {
            ApplicationV2: { instances: () => [] },
        },
    },
};

function makeCombatants(contents) {
    return {
        contents,
        [Symbol.iterator]() {
            return contents[Symbol.iterator]();
        },
    };
}

const tokenCombatant = {
    id: "token-combatant",
    tokenId: "token-1",
    actorId: "actor-1",
    actor: { id: "actor-1" },
    getFlag: () => [],
    setFlag: async () => {},
    unsetFlag: async () => {},
};

const actorCombatant = {
    id: "actor-combatant",
    tokenId: "token-2",
    actorId: "actor-2",
    actor: { id: "actor-2" },
    getFlag: () => [],
    setFlag: async () => {},
    unsetFlag: async () => {},
};

globalThis.game = {
    user: { id: "gm", isGM: true, isActiveGM: true },
    users: { activeGM: { id: "gm" } },
    modules: { get: () => null },
    settings: {
        settings: new Map([["pf2e-auto-action-tracker.debugMode", {}]]),
        get: () => false,
        register: () => {},
    },
    messages: { get: () => null },
    combat: {
        active: true,
        id: "combat-1",
        started: true,
        combatant: tokenCombatant,
        combatants: makeCombatants([tokenCombatant, actorCombatant]),
    },
};

const { ChatManager } = await import("../src/chat/ChatManager.ts");

const message = {
    id: "message-1",
    actor: { id: "actor-1" },
    speaker: { token: "token-1", actor: "actor-1" },
    flags: {},
    whisper: [],
};

assert.equal(findCombatantByMessage(game.combat, message), tokenCombatant);

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(join(__dirname, "../src/main.ts"), "utf8");
assert.match(mainSource, /import \{[^}]*getCombatants[^}]*\} from "\.\/foundryCompat"/);
assert.doesNotMatch(mainSource, /\.combatants\.(find|forEach|get)\(/);

console.log("Combatant collection compatibility tests passed!");
