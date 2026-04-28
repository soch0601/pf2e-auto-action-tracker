import { SettingsManager } from "./SettingsManager";

/**
 * Helper to determine if debug logging is enabled.
 * Eventually, this can be hooked to a Module Setting.
 */
const isDebugEnabled = () => {
    return SettingsManager.get('debugMode') ?? false;
};

const modNameString = "PF2E Auto Action Tracker |"

export function logConsole(...args: any[]) {
    if (!isDebugEnabled()) return;
    console.log(modNameString, ...args);
}

export function logInfo(...args: any[]) {
    if (!isDebugEnabled()) return;
    console.info(modNameString, ...args);
}

export function logWarn(...args: any[]) {
    if (!isDebugEnabled()) return;
    console.warn(modNameString, ...args);
}

export function logError(...args: any[]) {
    if (!isDebugEnabled()) return;
    console.error(modNameString, ...args);
}

export function notifyWarn(message: string) {
    const fullMsg = `${modNameString} ${message}`;
    if ((ui as any).notifications) {
        (ui as any).notifications.warn(fullMsg);
    } else {
        console.warn(modNameString, "UI Notifications not ready. Logged:", fullMsg);
    }
}

export function notifyError(message: string) {
    (ui as any).notifications?.error(`${modNameString} ${message}`);
}