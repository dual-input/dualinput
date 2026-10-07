# Avatars: tentative decisions

What the avatar experiments have settled for now about the figure's hands, each with the findings behind it and what it leaves out.
They hold until we design avatar sync for the product, and that design confirms each one as a decision in `record/decisions/`, changes it, or drops it.
p25 drove our figure, `CROSSCHECK_Figure`, in the Baron's right seat by the decisions below, parked and in flight, while our test pilot clicked from the left seat ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
It cast from `SimConnect_CameraGet`'s `SIMOBJECT` referential and never left the cockpit, so the `WORLD` ray, the fresh cast for drags outside, and the 2m to 3m reach on foot haven't run on the figure.
The findings are in [the avatars log](log.md), and the questions still open are in the idea [Avatar sync](../product/ideas.md#avatar-sync).
Every decision here was reached on 2026-10-03 with our test pilot, from probes on MSFS 2024 in the A2A Comanche and the Black Square Baron 58P.

## The hand goes where the pilot clicks, found from the aircraft's geometry

- **Decided:** at each click, Crosscheck casts the ray from the pilot's eye through the cursor into the aircraft's own model, and the hand goes to the point the ray meets.
  Nothing names the control: no input event, variable, or behavior component.
- **Because:** picking the control by the input event that changed failed in the Comanche, where none of the sim's 318 input events matched the names in the aircraft's behavior XML ([log](log.md#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists)), while the ray landed within 2mm of known spots ([log](log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)).

## The clicking pilot's machine finds the point, and the other machine only draws it

- **Decided:** on the clicking pilot's machine, Crosscheck's core reads the models, the camera, and the cursor, and finds each hand's point ([architecture's tentative decisions](../architecture/decisions.md#the-core-works-out-where-the-figures-hand-goes), 2026-10-07).
  The other machine receives the points, relative to the aircraft, and its WASM module places the figure there every frame.
- **Because:** both pilots fly the same aircraft package, so a point relative to the aircraft means the same on both machines, and the other machine then needs no model files and no posing.
## The ray needs no calibration

- **Decided:** the ray comes from `SimConnect_CameraGet`'s `WORLD` referential and the cursor's place in the sim window, inside and out, by measured rules:
  - the `WORLD` yaw, in SimConnect.h's `Bank` field, is the camera's true heading, and its pitch the angle below the horizon; the aircraft's heading, pitch, and bank turn the `WORLD` position and angles into the aircraft's frame
  - `fov`, in radians, is the view's vertical angle, and the horizontal angle follows the window's shape
- **Because:** inside, the `SIMOBJECT` ray landed within 2mm of known spots at two zooms and two window shapes ([log](log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)).
  Inside, the `WORLD` angles turned into the aircraft's frame matched `SIMOBJECT`'s with 0.00° of error, and the `WORLD` position sat a median 0.1cm from `SIMOBJECT`'s ([log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
  On foot outside, the `WORLD` ray landed within 1cm of known spots and the `SIMOBJECT` ray within 7cm (same entry).

## The models come from the aircraft's own package

- **Decided:** from the aircraft's title, Crosscheck finds its `aircraft.cfg` and `model.cfg`, then the interior and exterior models' most detailed glTF, and reads them once per aircraft.
- **Because:** the eight Community aircraft packages we looked in on our development machine ship their models as `.gltf` files (read in a2a-aircraft-aerostar600 1.0.6, a2a-aircraft-pa24 2.1.3, bksq-aircraft-baronpro 0.1.1, fnx-aircraft-320 2.4.0.4720, inibuilds-aircraft-a350 1.2.6, inibuilds-aircraft-l1011 1.0.8, pmdg-aircraft-77w 2.4.143, and synaptic-aircraft-a220 1.0.10, 2026-10-03).
  Our probe loaded the Comanche's cockpit model, 650,660 triangles, in 150ms ([log](log.md#2026-10-03-a-clicks-ray-cast-into-the-cockpit-model-finds-the-control-the-pilot-clicked-with-no-names-but-the-run-couldnt-pin-down-the-field-of-view)).
- **Leaves out:**
  - aircraft whose models aren't on disk to read: aircraft that stream with the sim, which we take the C152 to be, and Marketplace aircraft whose archives are encrypted (both unverified)
  - instruments that are attachments with models of their own, such as the Comanche's GPS units, where rays hit `BlackPanel` behind them ([log](log.md#2026-10-03-a-clicks-ray-cast-into-the-cockpit-model-finds-the-control-the-pilot-clicked-with-no-names-but-the-run-couldnt-pin-down-the-field-of-view))

## The model is posed only from code in the aircraft's own files

- **Decided:** before a cast, Crosscheck moves the parts of its copy of the model, and hides the parts the sim hides, by running the animation and visibility code in the aircraft's behavior XML on the `A:` and `L:` variables that code reads.
  Parts that sim templates drive, and parts whose code keeps its own state from frame to frame, stay as the files store them.
- **Because:** posing the yoke from its own code kept the hand on it through its whole travel ([log](log.md#2026-10-03-one-hand-holds-the-yoke-through-its-whole-travel-posed-from-the-aircrafts-own-code-while-the-other-taps-and-they-swap-by-side)), and expanding the sim's template library would be a project of its own.
- **Leaves out:** parts the files don't pose: the Baron's throttle, prop levers, and gear, which sim templates drive, and its wing flex, whose code keeps its own state ([log](log.md#2026-10-03-inside-with-the-cockpit-posed-a-fresh-cast-stays-on-a-posed-lever-but-still-falls-through-one-the-file-holds-still), [log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
  A fresh cast falls through the unposed throttle, which is why a drag glides inside ([A drag glides inside and follows a fresh cast outside](#a-drag-glides-inside-and-follows-a-fresh-cast-outside)).
  On foot, our test pilot saw the hand inside the wing, which the unposed flex may explain (unverified) ([log](log.md#2026-10-03-outside-a-drag-should-follow-a-fresh-cast-since-the-plane-of-the-first-spot-leaves-curved-skin)).

## The yoke hand holds the grips the aircraft marks, or their copy on the copilot's yoke

- **Decided:** the pilot's yoke is the one in front of the left seat, and the copilot's yoke the one in front of the right.
  A hand holds the pilot's yoke by the aircraft's `HANDLING_Yoke_1_Hand_Left` or `HANDLING_Yoke_1_Hand_Right` node, which sits inside the horn.
  With the yoke centered, the hand's center goes one hand's radius out from where the line from the pilot's eye to the node meets the horn's surface, and keeps that spot in the node's own frame, so it moves with the yoke.
  Where the copilot's yoke repeats the pilot's yoke's nodes with `_R` for `_L`, as the Baron's `YokePitch_R`, `YokeRoll_R`, and `Yoke_R` do, its grips are copies of the pilot's grip nodes.
  Each copy sits relative to the copilot's roll node, `YokeRoll_R` in the Baron, as the pilot's grip sits relative to the pilot's, `YokeRoll_L`, and the hand goes where the line from the copilot's eye to the copy meets the horn.
  Where an aircraft has no `HANDLING_Yoke_1_Hand_` nodes, the profile author picks a grip in the profile IDE.
- **Because:** the Baron, the Comanche, Black Square's Bonanza Pro, and the iniBuilds L-1011 mark their grips with these names ([log](log.md#2026-10-03-aircraft-mark-their-yoke-grips-with-the-same-node-names-and-the-yokes-own-animations-put-them-on-a-level-wheel)).
  The nodes sit inside the horns, so a hand placed on them sank into the yoke, and p21's hand, a ball of 1.45cm radius, sat 3.1cm from the node on the horn's surface ([log](log.md#2026-10-03-one-hand-holds-the-yoke-through-its-whole-travel-posed-from-the-aircrafts-own-code-while-the-other-taps-and-they-swap-by-side)).
  There, our test pilot raised no fault ([log](log.md#2026-10-03-on-the-horns-surface-the-yoke-hand-looks-right-and-a-thumb-on-the-far-horn-must-not-take-the-yoke-from-the-holding-hand)).
  The Baron marks grips only on the pilot's yoke, and its `Yoke_R` is turned 180° from `Yoke_L`, so grips placed under `Yoke_R` missed the copilot's yoke.
  Placed relative to `YokeRoll_R` instead, each grip sat 1.7cm behind the copilot's horn on the line from the copilot's eye, as the pilot's grips sit behind theirs (read in bksq-aircraft-baronpro 0.1.1, BaronProfessional_Pressurized_INT.gltf; [log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
- **Leaves out:**
  - a copilot's yoke with grip nodes of its own, such as the L-1011's `HANDLING_Yoke_2_Hand_Left` and `HANDLING_Yoke_2_Hand_Right`, on which no probe has run ([log](log.md#2026-10-03-aircraft-mark-their-yoke-grips-with-the-same-node-names-and-the-yokes-own-animations-put-them-on-a-level-wheel))
  - a copilot's yoke that neither repeats the pilot's nor has grip nodes of its own

## The hands follow a pilot's habits, with the right hand on the yoke in the right seat

- **Decided:** in the left seat:
  - At rest, the left hand holds the yoke, and the right hand rests.
  - A click more than 5cm left of the wheel's center is the left hand's, and the right hand takes the yoke; more than 5cm right of it is the right hand's, and the left keeps the yoke; between the two, the hand that's free clicks.
  - A hand leaving the yoke to click goes at once, since the sim acts on the click at once.
  - A run of clicks with one hand keeps the hands as they are; between clicks, the clicking hand hovers 5cm off its last spot.
  - 2s after the last click or drag is released, the hands go back to rest, the left hand taking the yoke 0.3s before the right lets go.
  - A button on the pilot's own yoke is pressed by the thumb on its side, and the hand holding the yoke keeps hold.

  In the right seat, the right hand holds the copilot's yoke at rest, and when the hands go back to rest it takes the yoke 0.3s before the left lets go.
  A click more than 5cm left of that yoke's wheel center is the left hand's, and the right keeps the yoke; one more than 5cm right of it is the right hand's, and the left takes the yoke.
  A button on the copilot's yoke is pressed by the thumb on its side, and the hand holding the yoke keeps hold.
  The other rules are the left seat's.
- **Because:** with the left-seat rules, 75 clicks and 40 drags took 9 swaps instead of one each, and our test pilot found that the hands felt right ([log](log.md#2026-10-03-with-a-run-of-clicks-treated-as-one-session-115-taps-took-9-swaps-instead-of-one-swap-a-click)).
  With the right-seat rules, 138 clicks and 26 drags, made by our test pilot from the left seat for the figure in the right seat, took 14 swaps ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
  Our test pilot found that the figure looked good, parked and in flight, except that some part of it missed a frame now and then; which part is unknown (same entry).
  Handing the yoke over with an overlap when a hand leaves to click put the hand on its switch after the switch had moved ([log](log.md#2026-10-03-with-a-run-of-clicks-treated-as-one-session-115-taps-took-9-swaps-instead-of-one-swap-a-click)).
  A thumb that took the yoke made the holding hand let go and take it back ([log](log.md#2026-10-03-on-the-horns-surface-the-yoke-hand-looks-right-and-a-thumb-on-the-far-horn-must-not-take-the-yoke-from-the-holding-hand)).
- **Leaves out:**
  - sidesticks and center sticks, whose habits differ
  - a click on a yoke's wheel rather than a button on it: p21 and p25 took a press anywhere on the seat's own yoke for a button, so all 3 thumb presses in p25 pressed the wheel, `Yoke_R`, not a button ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs))

## A drag glides inside and follows a fresh cast outside

- **Decided:** inside, a held press glides along the plane of the surface it first touched; outside, it follows the ray cast afresh onto the aircraft.
- **Because:** inside, a fresh cast fell through the levers the model holds still, landing a median 11.6cm and 14.4cm from the glide on the Baron's throttle ([log](log.md#2026-10-03-inside-with-the-cockpit-posed-a-fresh-cast-stays-on-a-posed-lever-but-still-falls-through-one-the-file-holds-still)).
  Outside, the plane of the first spot left the curved skin by a median 15.5cm and 2.1m at the 90th percentile, and our test pilot judged the fresh cast right ([log](log.md#2026-10-03-outside-a-drag-should-follow-a-fresh-cast-since-the-plane-of-the-first-spot-leaves-curved-skin)).

## Left clicks, quick right clicks, and wheel turns all bring the hand

- **Decided:** a left press brings the hand, whether tapped, held, or dragged.
  A right press brings it when released within 300ms, with the cursor moving under 5px and the mouse under 20 counts; a longer or moving right press turns the view and brings none.
  A wheel turn brings it too, as p21 and p22 ran it, though no log entry has measured it (unverified).
- **Because:** the right button both clicks controls and, held, turns the view ([log](log.md#2026-10-03-a-quick-still-right-press-is-a-click-and-a-held-or-moved-one-turns-the-view)).

## Only a click brings the hand, and on foot it reaches 2m to 3m

- **Decided:** hardware switches and key bindings, which make no click, bring no hand, and neither does VR.
  On foot, the hand reaches 2m to 3m.
- **Because:** our test pilot chose both.
  No probe has run in VR, so whether a VR click gives a cursor place the ray can use is unknown (unverified).
  On foot, our test pilot stood a median 1.8m and 2.6m from the spot clicked in two runs, and up to 5.8m ([log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
- **Leaves out:** what the figure does for a click beyond its reach, which the idea [Avatar sync](../product/ideas.md#avatar-sync) leaves open.
