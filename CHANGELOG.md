# Changelog

All notable changes to **PF2E Automated Action Tracker** are documented in this file.

## [v0.20.0] - 2026-11-21
feat/84: Address tech debt (#85)

* feat/84: Address tech debt

## [v0.19.5] - 2026-11-07
- fix/82 - adding more complex actions to library (#83)

## [v0.19.4] - 2026-11-06
- fix/80: Fix "All Actionable" toolbelt setting integration with AAT (#81)

## [v0.19.3] - 2026-10-23
- feat/78: Add Reaction-Time feat support for extra reactions (#79)

## [v0.19.2] - 2026-10-11
- Fix/76 (#77)
  - Add use-action button for catching custom macros on action to count as user used.

## [v0.19.1] - 2026-07-10
- fix/74 - Fix spell attacks not registering for MAP when appropriate (Closes #74)

## [v0.19.0] - 2026-06-08
- Closes #63 Make sustaining a spell better (#72)

## [v0.18.2] - 2026-06-07
- Closes #69 - Fix issue where sustaining NPC spells (and sustain confirmations) would create public chat cards instead of whispering GM(s) (#70)

## [v0.18.1] - 2026-06-03
- fix/64 - Fix Feint complex action Closes #64 (#66)

## [v0.18.0] - 2026-05-22
- Feat/60 - Complex Actions work (#62)
  - **Features Added:**
    - Added better display for complex actions on hover
    - Added more granularity to Complex Actions with the interact action (reloading vs changing grip, etc.) for: Covered Reload, Glory on High, Hurling Charge, Infiltrator's Reload, Nightwave Springing Reload, Quick Stow, Quick Draw, Running Reload, Slinger's Reload, Subtle Shank
    - Added support for new actions: Fake Out, Rapid Stinging (NPCs), Tag Team, Touch and Go
    - Added Fixed MAP penalties to MAP display for: Cross the Final Horizon, Double Shot, Triangle Shot
  - **Tech Debt Changes:**
    - Refactored complex action engine to remove display features into its own file
    - More i18n prep
  - **Bug Fixes:**
    - Fixed various issues with: Barreling Charge, Defensive Advance, Divide And Conquer, Infiltrator's Reload, Into the Fray, Magpie Snatch, Paired Shots, Shielded Attrition
    - Fixed an issue where moving was not registering as sneaking

## [v0.17.0] - 2026-05-20
- feat/3 - Enhanced Undo support + tech debt cleanup (Closes #3)

## [v0.16.0] - 2026-05-12
- Closes #50 - Refactor for settings improvement (#59)
- Closes #57 - Add support for more complex actions (#58)
