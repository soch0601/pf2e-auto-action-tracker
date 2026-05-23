import assert from "node:assert/strict";
import { MovementManager } from "../src/MovementManager.ts";
import { ActionManager as ActualActionManager } from "../src/ActionManager.ts";
import { GlobalConfig } from "../src/globals.ts";
import { ActorManager } from "../src/ActorManager.ts";
import { SocketsManager } from "../src/SocketManager.ts";
import { ChatManager } from "../src/ChatManager.ts";

// Mocking Foundry globals
globalThis.game = {
    user: { isGM: true, isActiveGM: true, id: 'gm' },
    combat: {
        combatant: { id: "c1" },
        combatants: [{ id: "c1", tokenId: "t1" }]
    },
    settings: {
        get: () => true,
        settings: new Map([["pf2e-auto-action-tracker.debugMode", {}]])
    }
};

globalThis.canvas = {
    grid: {
        measurePath: (path, options = {}) => {
            let distance = 0;
            for (let i = 1; i < path.length; i++) {
                const dx = path[i].x - path[i - 1].x;
                const dy = path[i].y - path[i - 1].y;
                distance += Math.sqrt(dx * dx + dy * dy) * (5 / 100); // 100px = 5ft
            }
            return { distance };
        }
    },
    regions: { placeables: [] }
};

// Mock SocketsManager
SocketsManager.socket = {
    executeForEveryone: () => { },
    executeAsGM: (name, payload) => {
        if (name === "processMovement") {
            MovementManager.processMovementFromData(
                game.combat.combatants.find(c => c.id === payload.combatantId),
                game.scenes.active.tokens.get(payload.tokenId),
                payload
            );
        }
    },
    register: () => { }
};

// Mock ChatManager
ChatManager.triggerAlert = () => { };

// Mock ActionManager to avoid side effects
const mockActions = new Map();
const originalAddAction = ActualActionManager.addAction;
const originalEditAction = ActualActionManager.editAction;
const originalRemoveAction = ActualActionManager.removeAction;
const originalGetActions = ActualActionManager.getActions;
const originalGetFlattenedActions = ActualActionManager.getFlattenedActions;
const originalGetLastAction = ActualActionManager.getLastAction;

ActualActionManager.getActions = (combatant) => {
    const list = mockActions.get(combatant.id) || [];
    return list.map(a => a.entry);
};
ActualActionManager.getFlattenedActions = (combatant) => {
    const list = mockActions.get(combatant.id) || [];
    return list.map(a => a.entry);
};
ActualActionManager.addAction = async (combatant, action) => {
    const list = mockActions.get(combatant.id) || [];
    list.push({ entry: action, isSubAction: false });
    mockActions.set(combatant.id, list);
    return action.msgId;
};
ActualActionManager.editAction = async (combatant, msgId, updates) => {
    const list = mockActions.get(combatant.id) || [];
    const idx = list.findIndex(a => a.entry.msgId === msgId);
    if (idx !== -1) {
        Object.assign(list[idx].entry, updates);
    }
};
ActualActionManager.removeAction = async (combatant, msgId) => {
    const list = mockActions.get(combatant.id) || [];
    const newList = list.filter(a => a.entry.msgId !== msgId);
    mockActions.set(combatant.id, newList);
    // Simulate reset
    MovementManager.broadcastReset(combatant.token?.id || "t1");
};
ActualActionManager.getLastAction = (combatant) => {
    const list = mockActions.get(combatant.id) || [];
    return list[list.length - 1];
};

// Mock ActorManager
const originalActorManager = {
    getActiveSpeed: ActorManager.getActiveSpeed,
    getMaxActions: ActorManager.getMaxActions,
    getSlots: ActorManager.getSlots,
    allocateSlots: ActorManager.allocateSlots,
    hasQuickenedSnapshot: ActorManager.hasQuickenedSnapshot
};

ActorManager.getActiveSpeed = () => 30;
ActorManager.getMaxActions = () => 3;
ActorManager.getSlots = () => [];
ActorManager.allocateSlots = () => ({ slots: [], overspent: [] });
ActorManager.hasQuickenedSnapshot = () => false;

globalThis.PF2E_AUTO_ACTION_TRACKER = { GlobalConfig };

async function runTests() {
    console.log("Running MovementManager Integration Tests...\n");

    for (const mode of [{ name: 'Native (!noHistoryConflict)', value: false }, { name: 'Captured (noHistoryConflict)', value: true }]) {
        console.log(`\nPF2E Auto Action Tracker | TEST | Running Suite for ${mode.name} Mode`);
        GlobalConfig.noHistoryConflict = mode.value;

        const mockCombatant = {
            id: "c1",
            token: { id: "t1" },
            actor: { id: "a1" },
            getFlag: (scope, key) => {
                const list = mockActions.get("c1") || [];
                return list.map(a => a.entry);
            },
            setFlag: async (scope, key, value) => {
                mockActions.set("c1", value.map(entry => ({ entry, isSubAction: false })));
            },
            update: async (data) => {
                if (data[`flags.${SCOPE}.log`]) {
                    mockActions.set("c1", data[`flags.${SCOPE}.log`].map(entry => ({ entry, isSubAction: false })));
                }
            }
        };

        const mockToken = {
            id: "t1",
            name: "Test Token",
            x: 0,
            y: 0,
            elevation: 0,
            combatant: mockCombatant,
            object: { id: "t1", testInsideRegion: () => false },
            _movementHistory: []
        };
        const mockTokenDoc = mockToken;

        // Setup global references for SocketsManager.executeAsGM
        globalThis.game.combat.combatants = [mockCombatant];
        globalThis.game.combat.combatants.get = (id) => id === "c1" ? mockCombatant : null;
        globalThis.game.scenes = {
            active: {
                tokens: {
                    get: (id) => id === "t1" ? mockToken : null
                }
            }
        };

        let tokenHistory = [{ x: 0, y: 0 }];

        async function resetState() {
            mockActions.set("c1", []);
            tokenHistory = [{ x: 0, y: 0 }];
            mockToken.x = 0;
            mockToken.y = 0;
            mockToken._movementHistory = [];
            MovementManager.resetCapturedHistory("t1");
        }

        async function moveToken(x, y) {
            const update = { x, y };

            // Simulate Foundry Hook Lifecycle
            await MovementManager.handlePreUpdateToken(mockTokenDoc, update, {});

            tokenHistory.push({ x, y });
            const coordList = tokenHistory.map(p => ({ x: p.x, y: p.y }));
            mockToken._movementHistory = coordList;

            console.log(`Action Tracker | TEST | moveToken to (${x}, ${y}) | History: ${JSON.stringify(coordList)}`);
            await MovementManager.handleTokenUpdate(mockTokenDoc, update, { diff: true });

            // Update token position for next step
            mockToken.x = x;
            mockToken.y = y;
        }

        async function undoToken(fullUndo = false) {
            if (fullUndo) {
                tokenHistory = [];
            } else {
                tokenHistory.pop();
            }
            const coordList = tokenHistory.map(p => ({ x: p.x, y: p.y }));
            mockToken._movementHistory = coordList;

            const lastPos = coordList[coordList.length - 1] || { x: 0, y: 0 };
            console.log(`Action Tracker | TEST | undoToken | History: ${JSON.stringify(coordList)}`);
            await MovementManager.handleTokenUpdate(mockTokenDoc, { x: lastPos.x, y: lastPos.y }, { diff: true });

            mockToken.x = lastPos.x;
            mockToken.y = lastPos.y;
        }

        // Scenario 1: Standard Stride (10ft)
        await resetState();
        await moveToken(200, 0); // 10ft
        let log = ActualActionManager.getActions(mockCombatant);
        assert.equal(log.length, 1);
        assert.equal(log[0].distance, 10);
        console.log("Scenario 1 passed");

        // Scenario 2: Undo movement (Native mode)
        if (!mode.value) {
            await resetState();
            await moveToken(200, 0);
            await undoToken(true); // Simulate Ctrl+Z full undo
            log = ActualActionManager.getActions(mockCombatant);
            console.log('log: ', log);
            assert.equal(log.length, 0, "Log should be empty after undoing the only move");
            console.log("Scenario 2 passed");
        }

        // Scenario 11: Multi-segment with non-move (Native)
        if (!mode.value) {
            await resetState();
            await moveToken(200, 0);
            await ActualActionManager.addAction(mockCombatant, { type: 'action', category: 'attack', slug: 'strike', label: 'Strike', cost: 1, msgId: 'strike-1', isQuickenedEligible: false, linkedMessages: [] });

            // Undo Strike (simulated)
            const strikeId = ActualActionManager.getActions(mockCombatant)[1].msgId;
            await ActualActionManager.removeAction(mockCombatant, strikeId);
            log = ActualActionManager.getActions(mockCombatant);
            assert.equal(log.length, 1, "Undo 1: Should have Move 1 remaining");

            // Undo Move 1
            await MovementManager.processMovementFromData(mockCombatant, mockToken, { coordList: [], recursiveCall: false, mode: 'native' });
            log = ActualActionManager.getActions(mockCombatant);
            assert.equal(log.length, 0, "Undo 2: Everything should be gone");
            console.log("Scenario 11 passed");
        }

        // Scenario 12: Move -> Strike -> Move -> Undo (Native)
        if (!mode.value) {
            await resetState();
            // 1. Move 10ft
            await moveToken(200, 0);
            // 2. Strike
            await ActualActionManager.addAction(mockCombatant, { type: 'action', category: 'attack', slug: 'strike', label: 'Strike', cost: 1, msgId: 'strike-2', isQuickenedEligible: false, linkedMessages: [] });
            // 3. Move 10ft again
            await moveToken(400, 0);

            log = ActualActionManager.getActions(mockCombatant);
            assert.equal(log.length, 3, "Log should have 3 actions");

            // 4. Undo Move 2
            await MovementManager.processMovementFromData(mockCombatant, mockToken, { coordList: [{ x: 0, y: 0 }, { x: 200, y: 0 }], recursiveCall: false, mode: 'native' });
            log = ActualActionManager.getActions(mockCombatant);
            assert.equal(log.length, 2, "Undo 1: Should have Move 1 and Strike");
            assert.equal(log[1].slug, 'strike');

            // 5. Undo Strike
            await MovementManager.processMovementFromData(mockCombatant, mockToken, { coordList: [{ x: 0, y: 0 }], recursiveCall: false, mode: 'native' });
            log = ActualActionManager.getActions(mockCombatant);
            assert.equal(log.length, 1, "Undo 2: Should have Move 1");
            assert.equal(log[0].label, 'Stride: 0ft');

            // 6. Final Undo
            await MovementManager.processMovementFromData(mockCombatant, mockToken, { coordList: [], recursiveCall: false, mode: 'native' });
            log = ActualActionManager.getActions(mockCombatant);
            assert.equal(log.length, 0, "Everything gone");
            console.log("Scenario 12 passed");
        }
    }

    console.log("\n All MovementManager tests passed!");

    // --- RESTORE ORIGINALS ---
    ActualActionManager.addAction = originalAddAction;
    ActualActionManager.editAction = originalEditAction;
    ActualActionManager.removeAction = originalRemoveAction;
    ActualActionManager.getActions = originalGetActions;
    ActualActionManager.getFlattenedActions = originalGetFlattenedActions;
    ActualActionManager.getLastAction = originalGetLastAction;
    ActorManager.getActiveSpeed = originalActorManager.getActiveSpeed;
    ActorManager.getMaxActions = originalActorManager.getMaxActions;
    ActorManager.getSlots = originalActorManager.getSlots;
    ActorManager.allocateSlots = originalActorManager.allocateSlots;
    ActorManager.hasQuickenedSnapshot = originalActorManager.hasQuickenedSnapshot;
}

await runTests().catch(e => {
    console.error("movement-manager-test.mjs failed!");
    throw e;
});
