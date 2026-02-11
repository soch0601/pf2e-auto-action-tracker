# Troubleshooting & FAQ

### 1. The movement didn't track or tracked incorrectly.
* **Is it your turn?** To prevent "token-dragging" noise, the tracker only records movement for the active combatant during their own turn.
* **Did you drag off-grid?** The module uses the PF2e grid measurement. If the movement doesn't resolve to at least 5ft, no action is logged.
* **Difficult Terrain:** Ensure your map uses **Foundry V12 Regions** with the `environmentFeature` behavior. Legacy difficult terrain modules may not be detected.

### 2. A reroll didn't update the action.
* This module uses `libWrapper` to catch system rerolls. Ensure `libWrapper` is enabled. "If you manually roll a new d20 from the character sheet instead of using the 'Hero Point' or 'Fortune' buttons on the original chat card, the module will see it as a new, separate action.

### 3. I see "Secret Action" on a pip.
* This is a privacy feature. If a player or GM rolls a "Blind GM" roll (like Recall Knowledge or a Secret Save), other players will see a "Secret Action" pip but cannot see the label or click it to view the chat card.

### 4. How do I remove a mistakenly added action?
* **Right-click** any spent action pip in the combat tracker to remove it. (Only GMs can remove "System" pips like Slowed/Stunned drains).

### 5. The tracker icons are overlapping other UI elements.
* This module appends icons to the combatant name. If you are using other modules that heavily modify the Combat Tracker UI (e.g., *Combat Enhancements*), you may need to adjust the CSS or report a compatibility issue.

### 6. No actions are being logged.
* Only the active GM user will log actions - this helps prevent things from being logged multiple times.

### 7. Sustaining from Wands or Scrolls
* If you cast a spell from a consumable (like a Wand), the tracker identifies the spell by its origin. If you let the spell lapse, the tracker will attempt to remove the spell's effects from your actor, even if the temporary spell item is no longer on your sheet.