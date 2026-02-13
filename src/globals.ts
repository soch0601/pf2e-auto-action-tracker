/**
 * Project Constants
 */
export const SCOPE = "pf2e-auto-action-tracker";

// Define a local cache outside the class
export const recentIntent = new Map<string, string>(); // ActorID -> ItemID