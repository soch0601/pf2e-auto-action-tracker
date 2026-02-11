# PF2e Automated Action Tracker

A streamlined, high-performance action economy tracker for **Pathfinder 2e** on Foundry V12+.

## 🚀 The Core Experience
This module eliminates the "How many actions do I have left?" question by automatically tracking every Strike, Spell, Move, and Reaction during combat.

### Key Features
* **Automatic Pip Tracking:** Injects action pips directly into the Combat Tracker.
* **Movement Intelligence:** Automatically detects Strides, Steps, and Fly actions. It even calculates cost adjustments for **Difficult Terrain** and **Greater Difficult Terrain** using V12 Regions.
* **PF2e Rule Integration:** * Handles **Quickened** status (Gold pips) based on start-of-turn snapshots.
    * Accounts for **Slowed/Stunned** by automatically draining actions at turn start.
    * Tracks **Reactions** per combatant.
* **Interactive Log:** Click any action pip to find and highlight the source chat message.
* **GM Tools:** Manual "Add Action" button for homebrew or edge-case triggers.
* **Sustain Tools:** Sends sustain reminders with clickable buttons to sutain spells (and log an action) or let lapse (and partially clean up)
* **Undo Protection:** Automatically refunds actions if a chat message is deleted or a movement is undone via Ctrl+Z. Corrects the action log when system rerolls are used.

## 🛠️ Installation
Requires the following modules:
* [libWrapper](https://foundryvtt.com/packages/libWrapper)
* [socketlib](https://foundryvtt.com/packages/socketlib)

## ⚙️ Settings
* **Whisper Alerts:** Configure alerts for overspending, underspending (ending turns with actions left), and reminders to Sustain spells.
* **Debug Mode:** Verbose logging for troubleshooting complex action triggers.
