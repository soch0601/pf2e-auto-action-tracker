import { SCOPE } from "./globals";

export class SettingsManager {

    // Register our module settings
    static registerSettings() {
        const settings = (game as any).settings;

        settings.register(SCOPE, "headerWhispers", {
            name: "--- WHISPERS ---",
            hint: "Configure automated economy and sustain alerts.",
            scope: "world",
        });

        settings.register(SCOPE, "whisperOverspend", {
            name: "Alert on Over-spending on actions",
            hint: "Whisper player/GM when spent actions exceed available actions.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "whisperReactionOverspend", {
            name: "Alert on Over-spending on reactions",
            hint: "Whisper player/GM when spent reactions exceed available reactions.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "whisperUnderspend", {
            name: "Alert on Under-spending",
            hint: "Whisper player/GM when ending turn with actions remaining.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "whisperSustain", {
            name: "Remind to Sustain",
            hint: "Whisper player at turn-start if they have active effects to Sustain.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        settings.register(SCOPE, "debugMode", {
            name: "Debug Mode?",
            hint: "Turn on for extra debugging logs in console.",
            scope: "world",
            config: true,
            type: Boolean,
            default: false
        })
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