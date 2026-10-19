# 012: The EFB app's code opens the banner panel

In a session, the EFB app's code opens the banner panel when the core says the session has something to show, and closes it, by calling `TOOLBAR_BUTTON_TOGGLE` from the EFB's document.
Dual Input ships no script in the toolbar's document.
Decided by the user on 2026-10-09, in node 1.5 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-efb-apps-code-opens-the-banner-panel).

## Context

Dual Input's notices show on the banner, a see-through in-game panel of ours, and Dual Input opens the banner's panel itself, with no click from the pilot ([notification banner](../areas/product/03-v1-scope.md#notification-banner)).
`Coherent.call("TOOLBAR_BUTTON_TOGGLE", "PANEL_CROSSCHECK_P05", open)` opened and closed our panel when run in the toolbar's page and in the EFB's page, and did nothing in the Baron's tablet page or in `VLogic`, and mainUi has no `Coherent` to call it with (measured on MSFS 2024, 2026-10-04, [interface log](../areas/interface/log.md#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)).
Closing the panel destroys its page (same entry), so the code that opens it lives in another page.
[Node 1.5](../areas/architecture/plan.md#15-a-flight-with-dual-inputs-rust-pieces) asked which page that is, and with it whether the toolbar script is one of Dual Input's components at all.

## Options

1. **Have the core open the panel itself.**
   It can't: `Coherent` exists only inside the sim's documents, and the inspector on port 19999 is a debugger we won't ship on ([interface log](../areas/interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).
2. **A script that our toolbar icon loads into the toolbar's document,** as [notification banner](../areas/product/03-v1-scope.md#notification-banner) has it.
   Installed from the Community folder, it opened the panel in the same run as the EFB app's code (measured on MSFS 2024, 2026-10-09, [interface log](../areas/interface/log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus)).
   But it reaches the toolbar's document through markup in our toolbar icon, which the toolbar runs, a trick a sim update could stop ([interface log](../areas/interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)), and it would be one more component to ship and watch (user, 2026-10-09).
3. **The EFB app's code, calling `TOOLBAR_BUTTON_TOGGLE` from the EFB's document.**
   No run has tried it during a flight load, before Ready to fly, or after a second flight load in one run of the sim ([01-spine](../areas/architecture/01-spine.md#left-open)).

## Decision

Option 3.
From our package installed in the Community folder, with no Build and Mount, the EFB app's code opened the panel and closed it again, 177s and again 279s after Ready to fly, and each call resolved; the toolbar listed the panel open, the inspector listed its page, and screenshots showed its card (measured on MSFS 2024, 2026-10-09, [interface log](../areas/interface/log.md#2026-10-09-installed-from-the-community-folder-our-toolbar-script-loads-at-the-flight-load-and-it-and-our-efb-apps-code-each-open-the-banner-when-the-client-asks-over-the-commbus)).
The EFB app's code runs from the sim's start with the EFB closed ([interface log](../areas/interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), so it's there whenever the core has something to show.
This changes [notification banner](../areas/product/03-v1-scope.md#notification-banner), whose banner depends on a script that our toolbar icon puts into the toolbar.

## What it commits us to

- The toolbar script isn't one of Dual Input's components ([01-spine](../areas/architecture/01-spine.md#components)).
- The EFB app connects to the core whenever it hears the core's announcement, and the banner panel connects while it's open ([01-spine](../areas/architecture/01-spine.md#the-sims-pages)).
- Opened from code, our panel sat at the left of the screen, not the right, and how to keep it on the right is one of the banner's open questions (measured on MSFS 2024, 2026-10-04, [interface log](../areas/interface/log.md#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click); [notification banner](../areas/product/03-v1-scope.md#notification-banner)).
- This decision leaves to the apps' stage of step 8 opening the panel during a flight load, before Ready to fly, and after a second flight load in one run of the sim, which no run has tried ([01-spine](../areas/architecture/01-spine.md#left-open)).
- It also leaves open how the banner shows in VR, which waits for a headset ([the product plan](../areas/product/plan.md#6-probes-that-retire-architecture-risks)).
