import { SCOPE } from "./globals";

/**
 * Helper to determine if debug logging is enabled.
 * Eventually, this can be hooked to a Module Setting.
 */
const isDebugEnabled = () => {
    return (game as any).settings.get(SCOPE, "debugMode") ?? false;
};

export function logConsole(...args: any[]) {
    if (!isDebugEnabled()) return;
    console.log(`PF2e Action Tracker |`, ...args);
}

export function logInfo(...args: any[]) {
    if (!isDebugEnabled()) return;
    console.info(`PF2e Action Tracker |`, ...args);
}

export function logWarn(...args: any[]) {
    if (!isDebugEnabled()) return;
    console.warn(`PF2e Action Tracker |`, ...args);
}

export function logError(...args: any[]) {
    if (!isDebugEnabled()) return;
    console.error(`PF2e Action Tracker |`, ...args);
}