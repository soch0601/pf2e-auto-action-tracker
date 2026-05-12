import assert from "node:assert/strict";
import { SettingsManager } from "../src/SettingsManager.ts";
import { SCOPE } from "../src/globals.ts";

// Mocking Foundry globals
const mockSettings = new Map();
globalThis.game = {
    user: { isGM: true },
    settings: {
        get: (scope, key) => mockSettings.get(`${scope}.${key}`),
        set: async (scope, key, value) => {
            mockSettings.set(`${scope}.${key}`, value);
            return value;
        },
        settings: {
            has: (id) => true // Assume all settings are registered for the test
        }
    }
};

async function runTests() {
    console.log("Running Settings Migration Tests...\n");

    // Test Case 1: Fresh Install (Version 0 -> 1)
    mockSettings.clear();
    mockSettings.set(`${SCOPE}.settingsVersion`, 0);

    await SettingsManager.migrateSettings();

    assert.equal(SettingsManager.get("settingsVersion"), 1, "Version should be migrated to 1");
    console.log("Test Case 1: Fresh Install migration passed");

    // Test Case 2: Already Migrated (Version 1 -> 1)
    mockSettings.set(`${SCOPE}.settingsVersion`, 1);

    // Track if set was called (though we only have a simple mock here)
    let setCalled = false;
    const originalSet = game.settings.set;
    game.settings.set = async (s, k, v) => {
        if (k === 'settingsVersion') setCalled = true;
        return originalSet(s, k, v);
    };

    await SettingsManager.migrateSettings();
    assert.equal(setCalled, false, "Should not re-migrate if already at target version");
    game.settings.set = originalSet;
    console.log("Test Case 2: Already Migrated passed");

    // Test Case 3: Non-GM should not migrate
    mockSettings.set(`${SCOPE}.settingsVersion`, 0);
    game.user.isGM = false;

    await SettingsManager.migrateSettings();
    assert.equal(SettingsManager.get("settingsVersion"), 0, "Non-GM should not trigger migration");
    game.user.isGM = true;
    console.log("Test Case 3: Non-GM check passed");

    console.log("\nAll Settings Migration tests passed!");
}

await runTests().catch(e => {
    console.error("settings-migration-test.mjs failed!");
    console.error(e);
    process.exit(1);
});
