import { setNoHistoryConflict } from "./globals";
import { notifyWarn } from "./logger";

export function runAllConflictChecks() {
    checkPf2eToolbelt();
}

function checkPf2eToolbelt() {
    const toolbelt = (game as any).modules.get("pf2e-toolbelt");
    if (toolbelt?.active) {
        // Based on console lookup: 'betterMovement.history' is the key.
        // If history is 'false', then "No History Record" is effectively ON.
        const removeHistory = (game as any).settings.get("pf2e-toolbelt", "betterMovement.history");

        if (removeHistory === true) {
            setNoHistoryConflict(true);
            notifyWarn("PF2e Toolbelt Conflict: Movement Undo tracking (Ctrl/Cmd+Z) disabled. To enable - turn off PF2e Toolbelt -> Better Movement -> 'No History Record' and reload (Shift + F5)");
        }
    }
}
