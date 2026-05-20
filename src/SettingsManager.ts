import { SCOPE } from "./globals.ts";

export class SettingsManager {

    // Register our module settings
    static registerSettings() {
        const settings = (game as any).settings;
        const isGM = (game as any).user?.isGM ?? true; // Safety check

        // Helper to get the correct hint based on role
        const getHint = (settingKey: string, defaultKey: string) => {
            const base = `PF2E_ACTION_TRACKER.Settings.${settingKey}`;
            const roleKey = isGM ? `${base}.GMHint` : `${base}.PlayerHint`;
            return (game as any).i18n.has(roleKey) ? roleKey : defaultKey;
        };

        settings.register(SCOPE, "settingsVersion", {
            scope: "world",
            config: false,
            type: Number,
            default: 0
        });

        settings.register(SCOPE, "headerAlerts", {
            name: "PF2E_ACTION_TRACKER.Settings.Header.Alerts",
            scope: "client",
            config: true,
            type: Boolean, // Dummy type
            default: false
        });

        settings.register(SCOPE, "whisperOverspend", {
            name: "PF2E_ACTION_TRACKER.Settings.WhisperOverspend.Name",
            hint: getHint("WhisperOverspend", "PF2E_ACTION_TRACKER.Settings.WhisperOverspend.Hint"),
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });

        settings.register(SCOPE, "whisperReactionOverspend", {
            name: "PF2E_ACTION_TRACKER.Settings.WhisperReactionOverspend.Name",
            hint: getHint("WhisperReactionOverspend", "PF2E_ACTION_TRACKER.Settings.WhisperReactionOverspend.Hint"),
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });

        settings.register(SCOPE, "whisperUnderspend", {
            name: "PF2E_ACTION_TRACKER.Settings.WhisperUnderspend.Name",
            hint: getHint("WhisperUnderspend", "PF2E_ACTION_TRACKER.Settings.WhisperUnderspend.Hint"),
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });

        settings.register(SCOPE, "whisperSustain", {
            name: "PF2E_ACTION_TRACKER.Settings.WhisperSustain.Name",
            hint: getHint("WhisperSustain", "PF2E_ACTION_TRACKER.Settings.WhisperSustain.Hint"),
            scope: "client",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "whisperComplexAction", {
            name: "PF2E_ACTION_TRACKER.Settings.WhisperComplexAction.Name",
            hint: getHint("WhisperComplexAction", "PF2E_ACTION_TRACKER.Settings.WhisperComplexAction.Hint"),
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });

        settings.register(SCOPE, "whisperUndoCleanup", {
            name: "PF2E_ACTION_TRACKER.Settings.WhisperUndoCleanup.Name",
            hint: getHint("WhisperUndoCleanup", "PF2E_ACTION_TRACKER.Settings.WhisperUndoCleanup.Hint"),
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "undoAlert", {
            name: "PF2E_ACTION_TRACKER.Settings.UndoAlert.Name",
            hint: getHint("UndoAlert", "PF2E_ACTION_TRACKER.Settings.UndoAlert.Hint"),
            scope: "client",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "headerInterface", {
            name: "PF2E_ACTION_TRACKER.Settings.Header.Interface",
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });

        settings.register(SCOPE, "showCoreTracker", {
            name: "PF2E_ACTION_TRACKER.Settings.ShowCoreTracker.Name",
            hint: "PF2E_ACTION_TRACKER.Settings.ShowCoreTracker.Hint",
            scope: "client",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "showPf2eHudTracker", {
            name: "PF2E_ACTION_TRACKER.Settings.ShowPf2eHudTracker.Name",
            hint: "PF2E_ACTION_TRACKER.Settings.ShowPf2eHudTracker.Hint",
            scope: "client",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "headerAdvanced", {
            name: "PF2E_ACTION_TRACKER.Settings.Header.Advanced",
            scope: "world",
            config: true,
            type: Boolean,
            default: false
        });

        settings.register(SCOPE, "debugMode", {
            name: "PF2E_ACTION_TRACKER.Settings.DebugMode.Name",
            hint: "PF2E_ACTION_TRACKER.Settings.DebugMode.Hint",
            scope: "world",
            config: true,
            type: Boolean,
            default: false
        });

        settings.register(SCOPE, "enhancedUndo", {
            name: "PF2E_ACTION_TRACKER.Settings.EnhancedUndo.Name",
            hint: getHint("EnhancedUndo", "PF2E_ACTION_TRACKER.Settings.EnhancedUndo.Hint"),
            scope: "world",
            config: true,
            type: Boolean,
            default: false
        });
    }

    /**
     * Handles migration of settings between versions
     */
    static async migrateSettings() {
        if (!(game as any).user.isGM) return;

        const currentVersion = this.get("settingsVersion") || 0;
        const targetVersion = 1;

        if (currentVersion >= targetVersion) return;

        console.log(`Action Tracker | Migrating settings from version ${currentVersion} to ${targetVersion}`);

        // Version 1 Migration: Initial setup for versioning
        if (currentVersion < 1) {
            // No structural changes yet, just setting the version
            await (game as any).settings.set(SCOPE, "settingsVersion", 1);
        }

        console.log(`Action Tracker | Settings migration to version ${targetVersion} complete.`);
    }

    /**
     * Custom styling for the Module Settings tab
     */
    static onRenderSettingsConfig(_app: any, html: any) {
        const $html = $(html);
        const moduleTab = $html.find(`[data-tab="${SCOPE}"], [data-tab*="action-tracker"]`);
        if (!moduleTab.length) return;

        // Find our header settings and style them
        const headers = ["headerAlerts", "headerInterface", "headerAdvanced"];

        headers.forEach(headerKey => {
            const input = moduleTab.find(`input[name="${SCOPE}.${headerKey}"]`);
            const settingDiv = input.closest(".form-group");
            if (settingDiv.length) {
                settingDiv.addClass("action-tracker-setting-header");
                settingDiv.find(".form-fields").remove();
            }
        });

        // Make the whole row clickable to toggle checkboxes
        moduleTab.find(".form-group:not(.action-tracker-setting-header)").on("click", (event) => {
            if ($(event.target).is("input, label, a, button")) return;
            const checkbox = $(event.currentTarget).find('input[type="checkbox"]');
            if (checkbox.length && !checkbox.prop("disabled")) {
                checkbox.prop("checked", !checkbox.prop("checked")).trigger("change");
            }
        });

        // Dynamic disable/enable whisperUndoCleanup based on enhancedUndo state
        const enhancedUndoInput = moduleTab.find(`input[name="${SCOPE}.enhancedUndo"]`);
        const whisperUndoCleanupInput = moduleTab.find(`input[name="${SCOPE}.whisperUndoCleanup"]`);

        if (enhancedUndoInput.length && whisperUndoCleanupInput.length) {
            const updateUndoCleanupState = () => {
                const isEnhancedEnabled = enhancedUndoInput.prop("checked");
                const cleanupRow = whisperUndoCleanupInput.closest(".form-group");
                
                if (isEnhancedEnabled) {
                    whisperUndoCleanupInput.prop("disabled", true);
                    cleanupRow.addClass("action-tracker-disabled-row");
                    cleanupRow.css({
                        "opacity": "0.5",
                        "pointer-events": "none"
                    });
                } else {
                    whisperUndoCleanupInput.prop("disabled", false);
                    cleanupRow.removeClass("action-tracker-disabled-row");
                    cleanupRow.css({
                        "opacity": "1",
                        "pointer-events": "auto"
                    });
                }
            };

            enhancedUndoInput.on("change", updateUndoCleanupState);
            // Run initially upon open
            updateUndoCleanupState();
        }

        // Dynamic Role-based Hints (Final fallback if registration was too early)
        const isGM = (game as any).user?.isGM ?? true;
        const groups = moduleTab.find(".form-group");

        groups.each((_i: number, el: HTMLElement) => {
            const $group = $(el);
            const $notes = $group.find(".notes, .hint"); // Support both V11 (.notes) and V12 (.hint)

            const input = $group.find('input, select').first();
            const name = input.attr('name');

            if (!name || !$notes.length) return;

            const settingKey = name.replace(`${SCOPE}.`, "");
            const capitalizedKey = settingKey.charAt(0).toUpperCase() + settingKey.slice(1);
            const baseI18nKey = `PF2E_ACTION_TRACKER.Settings.${capitalizedKey}`;
            const roleKey = isGM ? `${baseI18nKey}.GMHint` : `${baseI18nKey}.PlayerHint`;

            if ((game as any).i18n.has(roleKey)) {
                $notes.text((game as any).i18n.localize(roleKey));
            }
        });
    }

    /**
     * Shorthand static getter for settings
     */
    static get(settingName: string): any {
        const settings = (game as any).settings;

        // Safety 1: If game/settings doesn't even exist yet
        if (!settings) return true;

        // Safety 2: Check the internal registry to see if the setting is actually there
        const isRegistered = settings.settings?.has(`${SCOPE}.${settingName}`);
        if (!isRegistered) {
            // Log a warning instead of letting Foundry throw an Uncaught Error
            console.warn(`Action Tracker | Setting "${settingName}" accessed before registration.`);
            return true; // Default to true so features stay on during load
        }

        return settings.get(SCOPE, settingName);
    }
}
