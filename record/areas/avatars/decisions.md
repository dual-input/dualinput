# Avatars: tentative decisions

What the avatar experiments have settled for now about the figure's hands, each with the findings behind it and what it leaves out.
Avatar sync's design, [01-avatars](01-avatars.md), confirms each one or changes it, as [its table](01-avatars.md#avatars-tentative-decisions) says, and each becomes a decision in `record/decisions/` when step 8's decisions are numbered ([where answers go](../architecture/plan.md#where-answers-go)).
p25 drove our figure, `CROSSCHECK_Figure`, in the Baron's right seat by the decisions below, parked and in flight, while our test pilot clicked from the left seat ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
It cast from `SimConnect_CameraGet`'s `SIMOBJECT` referential and never left the cockpit, so the `WORLD` ray, the fresh cast for drags outside, and the reach of up to 3m on foot haven't run on the figure.
The findings are in [the avatars log](log.md), and the questions still open are in the idea [Avatar sync](../product/ideas.md#avatar-sync).
Every decision here was reached on 2026-10-03 with our test pilot, from probes on MSFS 2024 in the A2A Comanche and the Black Square Baron 58P, except where it names p27 in the iniBuilds A350 on 2026-10-04, or the user and a later date.

## The hand goes where the pilot clicks, found from the aircraft's geometry

- **Decided:** at each click, Crosscheck casts the ray from the pilot's eye through the cursor into the aircraft's own model, and the hand goes to the point the ray meets.
  Nothing names the control: no input event, variable, or behavior component.
- **Because:** picking the control by the input event that changed failed in the Comanche, where none of the sim's 318 input events matched the names in the aircraft's behavior XML ([log](log.md#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists)), while the ray landed within 2mm of known spots ([log](log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)).

## The clicking pilot's machine finds the point, and the other machine only draws it

- **Decided:** on the clicking pilot's machine, Crosscheck's core reads the models, the camera, and the cursor, and finds each hand's point ([architecture's tentative decisions](../architecture/decisions.md#the-core-works-out-where-the-figures-hand-goes), 2026-10-07).
  The other machine receives the points, relative to the aircraft, and its WASM module places the figure there every frame.
  A hand holding the yoke is the exception: the clicking pilot's machine sends which hand holds which grip, and the other machine places that grip from its own yoke, so the hand stays on its horn on every machine (user, 2026-10-17).
- **Because:** both pilots fly the same aircraft package, so a point relative to the aircraft means the same on both machines, and the other machine casts no ray.
  A yoke is the one part a received point can't follow, because a following machine draws the aircraft 0.4s behind, with the yoke positions its samples carry ([flight-model sync](../product/03-v1-scope.md#flight-model-sync); [channels](../network/01-between-machines.md#channels)), while the hand's point arrives after the network's delay alone.
  So on the PM's screen, the PF's hand would move about 0.4s ahead of the yoke it holds, and a 30° roll moves the Baron's grip about 7cm, the grips sitting 25.6cm apart ([log](log.md#2026-10-03-aircraft-mark-their-yoke-grips-with-the-same-node-names-and-the-yokes-own-animations-put-them-on-a-level-wheel); arithmetic).
  Every hand probe ran on one machine, so none could show it.
- **Leaves out:** nothing: each machine finds the grip's spot on its own yoke from its own copy of the models, which it loads anyway for its own pilot's clicks, and the sender gives only which hand holds which grip ([a hand on a yoke](01-avatars.md#a-hand-on-a-yoke)).

## The ray needs no calibration

- **Decided:** the ray comes from `SimConnect_CameraGet` and the cursor's place in the sim window, through its `SIMOBJECT` referential in the aircraft and its `WORLD` referential on foot, by measured rules ([the ray](01-avatars.md#the-ray)):
  - in `SIMOBJECT`, the screen's right is the model's −x, a positive yaw, in SimConnect.h's `Bank` field, turns the view right, and a positive pitch turns it down, with no offset in either
  - the `WORLD` yaw, in the same field, is the camera's true heading, and its pitch the angle below the horizon; the aircraft's heading, pitch, and bank turn the `WORLD` position and angles into the aircraft's frame, through WGS 84's radii at its latitude ([log](log.md#2026-10-04-the-modules-sphere-earth-put-a-point-26m-forward-of-the-a350s-reference-point-14cm-off-and-wgs-84s-radii-account-for-all-of-it))
  - `fov`, in radians, is the view's vertical angle, and the horizontal angle follows the window's shape
- **Because:** inside, the `SIMOBJECT` ray landed within 2mm of known spots at two zooms and two window shapes ([log](log.md#2026-10-03-the-ray-through-the-cursor-needs-no-calibration-cameragets-field-of-view-is-the-views-height-and-clicks-land-within-2mm-at-any-zoom-and-window-shape)), and p25 cast from it at up to 185 kt GS ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
  Inside, the `WORLD` angles turned into the aircraft's frame matched `SIMOBJECT`'s with 0.00° of error, and the `WORLD` position sat a median 0.1cm from `SIMOBJECT`'s, parked ([log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)); in flight `WORLD` would need the aircraft's pose from the camera's own frame, and one frame apart at 150 kt and 30 fps is 2.6m (arithmetic).
  On foot outside, the `WORLD` ray landed within 1cm of known spots and the `SIMOBJECT` ray within 7cm (same entry), and the aircraft stands still.

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

- **Decided:** only the PF's figure holds a yoke at rest, the one in front of its seat, and when control passes, the new PF's figure takes its yoke and the old PF's lets go (user, 2026-10-17).
  The PF's figure, in the left seat:
  - At rest, the left hand holds the yoke, and the right hand rests.
  - A click more than 5cm left of the wheel's center is the left hand's, and the right hand takes the yoke; more than 5cm right of it is the right hand's, and the left keeps the yoke; between the two, the hand that's free clicks.
  - A hand leaving the yoke to click goes at once, since the sim acts on the click at once.
  - A run of clicks with one hand keeps the hands as they are; after each release, the clicking hand stays 150ms on its spot, then hovers 1.5cm off it.
  - 500ms after that, with no new press, the hands go back to rest, the left hand taking the yoke, and the right letting go 0.3s after the left arrives.
  - These times are p27's, the starting values that the build's stage for avatars tunes in the 58P ([which hand, and its target](01-avatars.md#which-hand-and-its-target)).
  - A button on the pilot's own yoke is pressed by the thumb on its side, and the hand holding the yoke keeps hold.

  In the right seat, the PF's figure's right hand holds the copilot's yoke at rest, and when the hands go back to rest it takes the yoke 0.3s before the left lets go.
  A click more than 5cm left of that yoke's wheel center is the left hand's, and the right keeps the yoke; one more than 5cm right of it is the right hand's, and the left takes the yoke.
  A button on the copilot's yoke is pressed by the thumb on its side, and the hand holding the yoke keeps hold.
  The other rules are the left seat's.

  Any other figure rests both hands on its thighs, a click left of its seat's wheel center is the left hand's and one right of it the right hand's, and its runs of clicks, hovering, and going back to rest follow the PF's rules.
  In either seat, a press on a yoke's wheel rather than a button is a grab, and the hand on that side takes the grip on that side (user, 2026-10-17).
- **Because:** the probes had no PF, so they chose the yoke hand by seat, and a PM's figure holding its yoke all flight, moving with the PF's inputs, would read as flying, where the PF's figure taking its yoke shows the handover (user, 2026-10-17).
  With the left-seat rules and 2s before going home, 75 clicks and 40 drags took 9 swaps instead of one each, and our test pilot found that the hands felt right ([log](log.md#2026-10-03-with-a-run-of-clicks-treated-as-one-session-115-taps-took-9-swaps-instead-of-one-swap-a-click)).
  In the A350 our test pilot found those times far too long and tuned them to p27's ([log](log.md#2026-10-04-in-the-a350-the-pilot-cut-the-hands-time-on-the-spot-to-150ms-and-its-hover-to-500ms-at-15cm-and-sent-it-back-in-03s-on-a-curve-that-eases-out)), where on a yoke each going home is a swap, so the 58P's tuning starts from both.
  With the right-seat rules, 138 clicks and 26 drags, made by our test pilot from the left seat for the figure in the right seat, took 14 swaps ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
  Our test pilot found that the figure looked good, parked and in flight, except that some part of it missed a frame now and then; which part is unknown (same entry).
  Handing the yoke over with an overlap when a hand leaves to click put the hand on its switch after the switch had moved ([log](log.md#2026-10-03-with-a-run-of-clicks-treated-as-one-session-115-taps-took-9-swaps-instead-of-one-swap-a-click)).
  A thumb that took the yoke made the holding hand let go and take it back ([log](log.md#2026-10-03-on-the-horns-surface-the-yoke-hand-looks-right-and-a-thumb-on-the-far-horn-must-not-take-the-yoke-from-the-holding-hand)).
  p21 and p25 took a press anywhere on the seat's own yoke for a button, so all 3 thumb presses in p25 pressed the wheel, `Yoke_R`, not a button ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
- **Leaves out:** sidesticks and center sticks, whose habits differ.

## A change applies without waiting for the hand

- **Decided:** the other machine applies a cockpit change when it arrives, and doesn't hold it until the hand reaches the control, so a switch moves before the hand lands, by the hand's reach time, 0.15s in p27 (user, 2026-10-17).
- **Because:** holding a change for the hand would make state sync wait on the avatars' channel, and deleting a feature must leave every other feature whole ([02-code-map](../architecture/02-code-map.md#tiers)).
  p27 set its hand to reach out in 0.15s ([p27's run](../../../experiments/areas/avatars/results/p27-a350-figure-2026-10-04-16-45-44.txt), its settings line).

## A drag glides inside and follows a fresh cast outside

- **Decided:** inside, a held press glides along the plane of the surface it first touched; outside, it follows the ray cast afresh onto the aircraft.
- **Because:** inside, a fresh cast fell through the levers the model holds still, landing a median 11.6cm and 14.4cm from the glide on the Baron's throttle ([log](log.md#2026-10-03-inside-with-the-cockpit-posed-a-fresh-cast-stays-on-a-posed-lever-but-still-falls-through-one-the-file-holds-still)).
  Outside, the plane of the first spot left the curved skin by a median 15.5cm and 2.1m at the 90th percentile, and our test pilot judged the fresh cast right ([log](log.md#2026-10-03-outside-a-drag-should-follow-a-fresh-cast-since-the-plane-of-the-first-spot-leaves-curved-skin)).

## Left clicks, quick right clicks, and wheel turns all bring the hand

- **Decided:** a left press brings the hand, whether tapped, held, or dragged.
  A right press brings it when released within 300ms, with the cursor moving under 5px and the mouse under 20 counts; a longer or moving right press turns the view and brings none.
  A wheel notch brings it too, as a tap held 1s, as p21 and p22 ran it, though no log entry has measured it (unverified); the core helper reports each notch ([the mouse](01-avatars.md#the-mouse)).
- **Because:** the right button both clicks controls and, held, turns the view ([log](log.md#2026-10-03-a-quick-still-right-press-is-a-click-and-a-held-or-moved-one-turns-the-view)).

## A click, or a change at a control's spot, brings the hand, and on foot the hand touches up to 3m

- **Decided:** a click brings the hand, and so does a change made without one, such as from a home cockpit's switch or a key binding, which brings it to the spot the entry's `location` gives ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
  Only a control a pilot moves with hardware or a key, and that the aircraft never moves itself, gets a `location`, and neither several entries changing in the same instant nor noise on an axis brings a hand (user, 2026-10-17).
  VR brings no hand.
  On foot, the arm touches a spot up to 3m away and points at one farther (user, 2026-10-17).
- **Because:** our test pilot chose that only a click brings the hand, and the v1 scope reversed it on 2026-10-04, so the crew also sees what a pilot changes from a home cockpit or a key binding.
  Crosscheck can't tell a pilot's hardware from the aircraft: the platform raises "cockpit sent" for each change a machine sends on the cockpit stream ([02-code-map](../architecture/02-code-map.md#what-a-handler-sees-and-does)), and a change the aircraft makes itself syncs like a pilot's ([state sync](../product/03-v1-scope.md#state-sync)).
  The Baron takes its chocks away once it moves (measured on MSFS 2024, 2026-10-03, [flight-model log](../flight-model/log.md#2026-10-03-the-barons-ground-contact-follows-the-written-altitude-and-its-own-physics-writes-dont-hold-against-ours)), and the KFC 150's disengage clears the flight director and six modes together (read in bksq-aircraft-baronpro 0.1.1, [Baron study](../aircraft/black-square-baron-pro/study.md)), so a `location` on any of them would send the PF's hand there unasked.
  Whether the sim's autopilot moves the 58P's elevator trim is unverified, and a recording of a 58P flight, such as [p10](../../../experiments/areas/architecture/p10-recording.mjs)'s, would show what the aircraft moves itself.
  No probe has run in VR, so whether a VR click gives a cursor place the ray can use is unknown (unverified).
  On foot, our test pilot stood a median 1.8m and 2.6m from the spot clicked in two runs, and up to 5.8m ([log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
- **Leaves out:** nothing: two located changes within 100ms count as one instant, an axis's noise is a change under its entry's `deadband`, and past 3m the arm points at 0.6m ([a change made without a click](01-avatars.md#a-change-made-without-a-click)).
