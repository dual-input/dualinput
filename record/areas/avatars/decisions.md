# Avatars: tentative decisions

What the avatar experiments have settled for now about the figure's hands, each with the findings behind it and what it leaves out.
They hold until the product feature is designed, and that design confirms each one as a decision in `record/decisions/`, changes it, or drops it.
Our own figure has run them, in the Baron's copilot's seat ([log](log.md#2026-10-03-with-the-seats-swapped-the-yoke-rules-drove-the-figures-hands-from-the-right-seat-and-the-module-held-it-in-its-seat-at-up-to-185-kt)).
The findings are in [the avatars log](log.md), and the questions still open are in the idea [Avatar sync](../product/ideas.md#avatar-sync).
All of them were reached on 2026-10-03 with our test pilot, from probes on MSFS 2024 in the A2A Comanche and the Black Square Baron 58P.

## The hand goes where the pilot clicks, found from the aircraft's geometry

- **Decided:** at each click, Crosscheck casts the ray from the pilot's eye through the cursor into the aircraft's own model, and the hand goes to the point the ray meets.
  Nothing names the control: no input event, variable, or behavior component.
- **Because:** picking the control by the input event that changed failed on the Comanche's naming alone ([log](log.md#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists)), while the ray landed within 2mm of known spots ([log](log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)).

## The clicking pilot's machine finds the point, and the other machine only draws it

- **Decided:** the desktop app on the clicking pilot's machine reads the models, the camera, and the cursor, and finds each hand's point.
  The other machine receives the points, relative to the aircraft, and its WASM module places the figure there every frame.
- **Because:** both pilots fly the same aircraft package, so a point relative to the aircraft means the same on both machines, and the other machine then needs no model files and no posing.

## The ray needs no calibration

- **Decided:** the ray comes from `SimConnect_CameraGet`'s `WORLD` referential and the cursor's place in the sim window, inside and out, by measured rules:
  - the `WORLD` yaw is the camera's true heading and its pitch the angle below the horizon, and its position and angles are turned into the aircraft's frame by the aircraft's heading, pitch, and bank
  - the field of view is the view's height, and the view's width follows the window's shape
- **Because:** inside, the `SIMOBJECT` ray landed within 2mm of known spots at two zooms and two window shapes ([log](log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)).
  In the cockpit, the `WORLD` angles turned into the aircraft's frame matched `SIMOBJECT`'s with 0.00° of error, and the `WORLD` position sat a median 0.1cm from `SIMOBJECT`'s ([log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
  On foot outside, the `WORLD` ray landed within 1cm of known spots and the `SIMOBJECT` ray within 7cm (same entry).

## The models come from the aircraft's own package

- **Decided:** from the aircraft's title, Crosscheck finds its `aircraft.cfg` and `model.cfg`, then the interior and exterior models' most detailed glTF, and reads them once per aircraft.
- **Because:** the eight Community aircraft packages we looked in on our development machine ship their models as `.gltf` files (read in a2a-aircraft-aerostar600 1.0.6, a2a-aircraft-pa24 2.1.3, bksq-aircraft-baronpro 0.1.1, fnx-aircraft-320 2.4.0.4720, inibuilds-aircraft-a350 1.2.6, inibuilds-aircraft-l1011 1.0.8, pmdg-aircraft-77w 2.4.143, and synaptic-aircraft-a220 1.0.10, 2026-10-03), and the Comanche's cockpit model, 650,660 triangles, read in 150ms ([log](log.md#2026-10-03-a-clicks-ray-cast-into-the-cockpit-model-finds-the-control-the-pilot-clicked-with-no-names-but-the-run-couldnt-pin-down-the-field-of-view)).
- **Leaves out:**
  - aircraft whose models aren't on disk to read: aircraft that stream with the sim, which we take the C152 to be, and Marketplace aircraft whose archives are encrypted (both unverified)
  - instruments that are attachments with models of their own, such as the Comanche's GPS units, where rays hit `BlackPanel` behind them ([log](log.md#2026-10-03-a-clicks-ray-cast-into-the-cockpit-model-finds-the-control-the-pilot-clicked-with-no-names-but-the-run-couldnt-pin-down-the-field-of-view))

## The model is posed only from code in the aircraft's own files

- **Decided:** before a cast, Crosscheck moves the parts of its copy of the model, and hides the parts the sim hides, by running the animation and visibility code in the aircraft's behavior XML on the `A:` and `L:` variables that code reads.
  Parts that sim templates drive, and code that keeps its own state from frame to frame, stay as the files store them.
- **Because:** posing the yoke from its own code kept the hand on it through its whole travel ([log](log.md#2026-10-03-one-hand-holds-the-yoke-through-its-whole-travel-posed-from-the-aircrafts-own-code-while-the-other-taps-and-they-swap-by-side)), and expanding the sim's template library would be a project of its own.
- **Leaves out:** parts the files don't pose: the Baron's throttle, prop levers, and gear, which sim templates drive, and its wing flex, whose code keeps its own state ([log](log.md#2026-10-03-inside-with-the-cockpit-posed-a-fresh-cast-stays-on-a-posed-lever-but-still-falls-through-one-the-file-holds-still), [log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
  On the unposed throttle, a fresh cast landed a median 11.6cm and 14.4cm from the glide in two drags.
  On foot, our test pilot saw the hand inside the wing, which the unposed flex may explain (unverified) ([log](log.md#2026-10-03-outside-a-drag-should-follow-a-fresh-cast-since-the-plane-of-the-first-spot-leaves-curved-skin)).

## The yoke hand holds the grip the aircraft marks

- **Decided:** a hand holds the yoke at the aircraft's `HANDLING_Yoke_1_Hand_Left` or `HANDLING_Yoke_1_Hand_Right` node, posed with the yoke, on the horn's surface 3.1cm from the node toward the pilot's eye.
  Where a copilot's yoke repeats the pilot's, as the Baron's does, its grips are those nodes placed relative to the copilot's yoke's roll node as they sit relative to the pilot's, on the horn's surface toward the copilot's eye.
  Where an aircraft has no such nodes, the profile author picks a grip in the profile IDE.
- **Because:** four aircraft mark their grips with these names ([log](log.md#2026-10-03-aircraft-mark-their-yoke-grips-with-the-same-node-names-and-the-yokes-own-animations-put-them-on-a-level-wheel)).
  The nodes sit inside the horns, so a hand placed on them sank into the yoke ([log](log.md#2026-10-03-one-hand-holds-the-yoke-through-its-whole-travel-posed-from-the-aircrafts-own-code-while-the-other-taps-and-they-swap-by-side)), and on the horn's surface our test pilot raised no fault ([log](log.md#2026-10-03-on-the-horns-surface-the-yoke-hand-looks-right-and-a-thumb-on-the-far-horn-must-not-take-the-yoke-from-the-holding-hand)).
  The Baron's copilot's yoke node is turned 180° from the pilot's, so grips placed under it missed the yoke, while relative to the roll node a ray met the horn 1.7cm before each grip, as on the pilot's yoke ([log](log.md#2026-10-03-with-the-seats-swapped-the-yoke-rules-drove-the-figures-hands-from-the-right-seat-and-the-module-held-it-in-its-seat-at-up-to-185-kt)).

## The hands follow a pilot's habits, with the hands swapped in the right seat

- **Decided:** in the left seat:
  - At rest, the left hand holds the yoke, and the right hand rests.
  - A click more than 5cm left of the wheel's center is the left hand's, and the right hand takes the yoke; more than 5cm right of it is the right hand's, and the left keeps the yoke; between the two, the hand that's free clicks.
  - A hand leaving the yoke to click goes at once, since the sim acts on the click at once.
  - A run of clicks with one hand keeps the hands as they are; between clicks, the clicking hand hovers 5cm off its last spot.
  - 2s after the last click or drag is released, the hands go back to rest, the left hand taking the yoke 0.3s before the right lets go.
  - A button on the pilot's own yoke is pressed by the thumb on its side, and the hand holding the yoke keeps hold.

  In the right seat, the same rules run with the hands swapped: the right hand holds the copilot's yoke at rest, a click more than 5cm right of that yoke's wheel is the right hand's, and going home the right hand takes the yoke first.
- **Because:** with these rules, 75 clicks and 40 drags took 9 swaps instead of one each, and our test pilot found that the hands felt right ([log](log.md#2026-10-03-with-a-run-of-clicks-treated-as-one-session-115-taps-took-9-swaps-instead-of-one-swap-a-click)).
  With the hands swapped for the right seat, 164 taps took 14 swaps, and our test pilot found that the figure looked good, parked and in flight ([log](log.md#2026-10-03-with-the-seats-swapped-the-yoke-rules-drove-the-figures-hands-from-the-right-seat-and-the-module-held-it-in-its-seat-at-up-to-185-kt)).
  Handing the yoke over with an overlap when a hand leaves to click put the hand on its switch after the switch had moved ([log](log.md#2026-10-03-with-a-run-of-clicks-treated-as-one-session-115-taps-took-9-swaps-instead-of-one-swap-a-click)).
  A thumb that took the yoke made the holding hand let go and take it back ([log](log.md#2026-10-03-on-the-horns-surface-the-yoke-hand-looks-right-and-a-thumb-on-the-far-horn-must-not-take-the-yoke-from-the-holding-hand)).
- **Leaves out:** sidesticks and center sticks, whose habits differ, and a click on a yoke's wheel itself, which the thumb rule catches though it isn't a button.

## A drag glides inside and follows a fresh cast outside

- **Decided:** inside, a held press glides along the plane of the surface it first touched; outside, it follows the ray cast afresh onto the aircraft.
- **Because:** inside, a fresh cast fell through the levers the model holds still, landing a median 11.6cm and 14.4cm from the glide on the Baron's throttle ([log](log.md#2026-10-03-inside-with-the-cockpit-posed-a-fresh-cast-stays-on-a-posed-lever-but-still-falls-through-one-the-file-holds-still)).
  Outside, the plane of the first spot left the curved skin by a median 15.5cm and 2.1m at the 90th percentile, and our test pilot judged the fresh cast right ([log](log.md#2026-10-03-outside-a-drag-should-follow-a-fresh-cast-since-the-plane-of-the-first-spot-leaves-curved-skin)).

## Left clicks, quick right clicks, and wheel turns all bring the hand

- **Decided:** a left press brings the hand, whether tapped, held, or dragged.
  A right press brings it when released within 300ms, with the cursor moving under 5px and the mouse under 20 counts; a longer or moving right press turns the view and brings none.
  A wheel turn brings it too, as p21 and p22 ran it, though no log entry has measured it (unverified).
- **Because:** the right button both clicks controls and, held, turns the view ([log](log.md#2026-10-03-a-quick-still-right-press-is-a-click-and-a-held-or-moved-one-turns-the-view)).

## No hand without a click, and a reach of 2m to 3m on foot

- **Decided:** VR, which has no cursor, and hardware switches and key bindings, which make no click, bring no hand.
  On foot, the hand reaches 2m to 3m.
- **Because:** our test pilot chose it; on foot, they stood a median 1.8m and 2.6m from the spot clicked in two runs, and up to 5.8m ([log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
- **Leaves out:** what the figure does for a click beyond its reach, which the idea [Avatar sync](../product/ideas.md#avatar-sync) leaves open.
