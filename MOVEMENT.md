# Movement Tracking Modes

The PF2E Auto Action Tracker utilizes two different engines for tracking token movement. The system automatically selects the best mode based on your active modules and settings to ensure the most accurate combat log possible.

## Mode Detection

The tracker automatically detects potential conflicts with other modules (specifically **PF2e Toolbelt**). 
- If PF2e Toolbelt's **"No History Record"** setting is enabled (under Better Movement), this module automatically switches to **Captured Mode**.
- In all other cases, it defaults to **Native Mode**.

You can check which mode is active by looking for a warning in the console during initialization.

---

## 1. Native Mode (`noHistoryConflict: false`)

This is the default, recommended, and most powerful tracking mode. It relies on Foundry VTT's internal coordinate history for the current turn.

- **Source of Truth**: The token's turn-cumulative position history.
- **How it works**: Every time a token moves, the tracker calculates the **total distance** traveled this turn by looking at all waypoints. It then reconciles this with the distance already recorded in the Combat Tracker.  This will automatically add to the current distance of a move action (assuming no other actions have happened in between).
- **Undo Support (Ctrl + Z)**: **Fully Supported.** Because this mode monitors the actual coordinate history, it detects when a user presses `Ctrl + Z` (which shrinks the history). The tracker will automatically remove or adjust movement actions in the log to stay perfectly in sync with the token's position.
- **Best For**: Standard play where automated undo support is a priority.

## 2. Captured Mode (`noHistoryConflict: true`)

This mode is designed for compatibility with modules that disable or manipulate Foundry's native history tracking.

- **Source of Truth**: Discrete drag-and-drop sessions.
- **How it works**: The tracker calculates the distance covered in the **current** drag or ruler interaction. If the last action in the combat log was a move, the tracker **adds** this new distance to that existing action. For example, if you move 10 feet and then move another 10 feet, the tracker will update the single "Stride" entry to show 20 feet total.
- **Undo Support (Ctrl + Z)**: **NOT Supported.** Since this mode ignores the cumulative turn history (to avoid conflicts), it has no way of knowing when a `Ctrl + Z` occurred. If you undo a move in Foundry while in this mode, you must **manually delete** the corresponding entry in the combat log (and add a manual action if appropriate).
- **Best For**: Tables using **PF2e Toolbelt** with "No History Record" enabled.

---

### Comparison Summary

| Feature | Native Mode | Captured Mode |
| :--- | :--- | :--- |
| **Trigger** | Default | Module Conflicts (e.g. Toolbelt) |
| **Ctrl + Z Support** | ✅ Yes | ❌ No (Manual deletion required) |
| **Distance Calculation** | Cumulative (Total Turn Distance) | Delta-based (Added to current action) |
| **Conflict Risk** | Higher with history-altering mods | Very Low |

### Frequent Questions

**I pressed Ctrl+Z but the action is still in the log!**
You are likely in **Captured Mode** because of a conflict with another module (like PF2e Toolbelt). In this mode, the tracker cannot "see" undos, so you must manually delete the action from the Combat Tracker.

**Does this record the full path distance if I move in a loop?**
Yes. Both modes use Foundry's path measurement. If you move from Square A to Square B and then back to Square A, the tracker sees the waypoints and will record the total distance traveled (e.g., 10 feet), rather than seeing the net movement as 0.

**Why is my Stride entry increasing as I move?**
Both modes try to be smart about your action economy. If you are in the middle of a move, the tracker will update the current "Stride" entry's distance and cost in real-time rather than cluttering your log with multiple 5ft Stride actions.
