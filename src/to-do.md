# PF2e Automated Action Tracker - Development Roadmap

## 🟢 Completed / Core Logic
- [x] **Three-Action Economy:** Tracking 1, 2, and 3-action costs.
- [x] **Variable Cost Support:** Logic for spells like *Heal*.
- [x] **Intelligent Detection:** Differentiates Actions (on-turn) from Reactions (off-turn/tagged).
- [x] **Status Effect Integration:** - **Stunned:** Auto-burns actions and decrements value at turn end.
    - **Slowed/Quickened:** Dynamically adjusts total pips.
    - **Paralyzed:** Properly locks out action pool.
- [x] **Interactive UI:** - **Hover:** Tooltip showing history/cost breakdown.
    - **Right-click:** "Undo" functionality.
    - **Left-click:** Jump to chat card.
- [x] **Turn Cycle:** Automatic pip reset on start of turn.
- [x] **Automated Whispers (Economy):** - Whisper Player/GM when **Over-spending** (Spent > Available).
- [x] Whisper Player/GM when **Under-spending** (Ending turn with actions remaining).
- [x] **Automated Whispers (Sustain):** - Trigger a whisper to the player at turn-start if they have active `Sustain` effects.
- [x] *Include settings to toggle these alerts.*
- [x] **Quickened Action Allocation:** Only allow specific actions to take up the quickened action slot
- [X] **Permissions:** Setting for player visibility (can they see enemy action counts?).
- [X] **Click permissions:** Ensure players can only click their own tokens.
- [X] **Hidden Message Handling:** Logic to handle/hide links to Private/Secret chat cards for players.
- [x] **Skill Action Validation:** Test Recall Knowledge, Seek, Sense Motive, etc.
- [X] **Reaction Stress Test:** Verify detection across various module-added feats and triggers.
- [X] **Manual Override:** UI button (`+`) to manually add actions to the current turn.
- [X] **Hero Point Integration:** Research/Implement logging for Hero Point rerolls.

## 🟡 Priority: Beta Release

## 🔵 Priority: Polish & Utility
- [ ] **Documentation:** Add documentation (README.md, troubleshooting.md)

## ⚪ Post-Beta / "Nice to Have"
- [ ] **MAP Visual Aid:** Small indicator for current Multi-Attack Penalty (0, -5, -10).
- [ ] **Minion Support:** Tracking "Command an Animal" and minion action pools.
- [ ] **Undoing Action Support:** Can we do more when a strike is undone (undo damage?  Point to damage card?  Other?)
- [ ] **Free Action Logging:** Determine if/how to display $0$-cost actions in hover history.
- [ ] **Special actions:** Figure out how to deal with special actions (like flurry of blows or Spellstrike)
- [ ] **HP interaction dying:** Figure out if we can interact with Hero points and dying (or is this already handled?)
- [ ] **Hardcoded slugs for quickened:** Potentially move to a Module setting for homebrew support

---

Current Bugs: