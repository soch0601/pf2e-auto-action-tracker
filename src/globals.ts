/**
 * Project Constants
 */
export const SCOPE = "pf2e-auto-action-tracker";

// Define a local cache outside the class
export const recentIntent = new Map<string, string>(); // ActorID -> ItemID

class TrackerConfig {
    private _noHistoryConflict: boolean = false;
    get noHistoryConflict() { return this._noHistoryConflict; }
    set noHistoryConflict(val: boolean) {
        this._noHistoryConflict = val;
    }
}

if (!(globalThis as any).PF2E_TRACKER_CONFIG) {
    console.log("PF2E Auto Action Tracker | Initializing GlobalConfig on globalThis");
    (globalThis as any).PF2E_TRACKER_CONFIG = new TrackerConfig();
}

export const GlobalConfig = (globalThis as any).PF2E_TRACKER_CONFIG as TrackerConfig;
export const setNoHistoryConflict = (val: boolean) => { GlobalConfig.noHistoryConflict = val; };