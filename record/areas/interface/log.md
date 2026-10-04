# Interface: log

What our experiments found about showing Crosscheck to the pilot inside the sim, such as the notification banner and the EFB app, newest entry first.
The probes and their raw output are in [experiments/areas/interface](../../../experiments/areas/interface), with the results in its `results/` folder.

## 2026-10-04: SimConnect_Text reports its texts as displayed, and the pilot didn't catch any of them

**Asked:** does `SimConnect_Text` show the pilot a notice, as a candidate for the [notification banner](../product/03-v1-scope.md#notification-banner), and can its menu type carry a choice such as "Disconnect and take control"?

**Expected:** a line of text on screen for the print and scroll types, and a menu with two choices for the menu type.

**Found:** in the Black Square Baron 58P, p01 sent three texts, each opened by a beep for the pilot to watch:

- `SIMCONNECT_TEXT_TYPE_PRINT_WHITE` for 6s: the sim answered `SIMCONNECT_TEXT_RESULT_DISPLAYED` at once.
- `SIMCONNECT_TEXT_TYPE_SCROLL_YELLOW` for 8s: the sim answered `SIMCONNECT_TEXT_RESULT_QUEUED`, and never `DISPLAYED`.
- `SIMCONNECT_TEXT_TYPE_MENU` for 15s, with a title, a prompt, and two choices: the sim answered `DISPLAYED`, and neither a selection nor `SIMCONNECT_TEXT_RESULT_TIMEOUT` followed.

The pilot, watching the screen at each beep, didn't catch anything appear; they didn't know where or how a text would show.

The MSFS 2020 SDK calls `SimConnect_Text` "deprecated and cannot be used in Microsoft Flight Simulator" ([SimConnect_Text](https://docs.flightsimulator.com/html/Programming_Tools/SimConnect/API_Reference/General/SimConnect_Text.htm)); we found no MSFS 2024 page for it, and the function is still in the 2024 SDK's `SimConnect.h` (read in MSFS 2024 SDK 1.7.3).

**Changed:** we dropped `SimConnect_Text` as a banner candidate without testing further, because an object of our own carrying an HTML gauge gives us control of how a notice looks and where it sits (decided by the user, 2026-10-04).
Whether the sim draws the texts somewhere stays unknown.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope, and the step 6 banner probe in the [plan](../product/plan.md#6-probes-that-retire-architecture-risks).

**Evidence:** [p01's run](../../../experiments/areas/interface/results/p01-simconnect-text-2026-10-04-05-50-31.txt).
