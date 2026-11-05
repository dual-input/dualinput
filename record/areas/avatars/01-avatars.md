# Avatars: avatar sync and the aircraft model

```text
Purpose:     How each pilot's figure takes its seat, looks where its pilot looks, and reaches for what they click or change, on every machine, and how the core reads an aircraft's own models to find where a hand goes.
Depends on:  ../product/03-v1-scope.md, decisions.md, log.md, ../architecture/02-code-map.md, ../core/03-sim-seam-and-wasm-module.md, ../core/04-core-helper.md, ../network/01-between-machines.md, ../network/02-units.md, ../recording/01-recording-and-bug-reports.md, ../session/02-units.md, ../profiles/01-format-and-delivery.md, ../sync/05-units.md, ../flight-model/01-flight-model-sync.md, ../build/01-the-build.md
Decides:     What runs on a pilot's own machine and what on every machine; what a pose carries, and how often it goes; how a seat is taken and held; how a click, a drag, a wheel turn, and a change made without a click become a hand's target; how Figure draws each figure and holds a hand on a yoke; the names the sim shares; the aircraft-model engine and the three engines under it; the authoring tool; which of avatars' tentative decisions this design confirms; the budgets; and the cases for the bench (node 6.13).
```

> **Note**
> Stage 11b's tentative decision on [the Figures tab](../interface/decisions.md#the-figures-tab-holds-the-pilots-figure-and-explains-what-its-figures-can-do) changes avatars' notifications and settings until the apps' design confirms it (user, 2026-10-31).
> A model that can't be read shows as a note at the top of the tab rather than a notification.
> [Seeing a held seat](#a-seat)'s notification says only "This seat is taken", held while this pilot's camera is in the seat, rather than naming the free seats, since a profile can list any number of them.
> Which figures show is four switches: your figure's and the crew's, each inside the aircraft and on a walkaround.

> **Note**
> Since 2026-11-04, the pose carries no color: each figure wears the color the session crate works out from its member's entry, as that member's head in the apps does, and the setting is the session crate's, `session.color`; the rule for a pilot who never picked is unchanged ([session log](../session/log.md#2026-11-04-a-members-entry-is-rewritten-on-a-change-so-a-new-name-or-color-reaches-the-crew-at-once-and-the-color-moves-to-the-session)).
> The match check's item names no one: "Figures won't be able to interact with the cockpit", or "Some figures won't" when only part of the crew can't read the model, since a crew of ten would fill the line (user, 2026-11-04).

> **Note**
> Since 2026-11-04, taking the model costs the loop more than [its budget](#budgets)'s 1ms, which the user accepted as a known limit, and a cockpit with no triangles counts as a model that machine can't read ([log](log.md#2026-11-04-a-large-model-costs-the-loop-about-023ms-a-megabyte-at-each-load-and-the-a350s-and-a220s-cockpits-are-attachments-we-dont-read)).

> **Note**
> Since 2026-11-05, this pilot's own figure on foot hides its head and neck and fades its hands, as it does in a seat, and stands on their avatar: `Figure` reads the avatar's place each frame, with no spring and no lead, through a slot field saying the figure is this pilot's own ([log](log.md#2026-11-05-a-pilots-own-figure-on-foot-stands-on-its-avatar-a-frame-behind-since-the-spring-left-it-150ms-late-and-a-lead-overshoots-every-stop)).

> **Note**
> Since 2026-11-05, [the budgets](#budgets) for `Figure` and the sim's frame stand at what stage 17 measured, which the user accepted: about 140µs at p99 with two figures, and each figure in view 35µs to 64µs still, 63µs to 105µs moving ([log](log.md#2026-11-05-a-click-that-took-the-focus-from-the-sim-left-a-figures-hand-out-and-the-rest-of-the-session-passed)).

> **Note**
> On 2026-10-25, stage 17 settled five of the items [left open](#left-open) ([log](log.md#2026-10-25-stage-17-settles-five-items-01-avatars-left-open-a-run-of-its-own-the-seat-in-the-pose-an-info-item-for-a-model-a-machine-cant-read-vr-as-a-known-limit-and-an-eye-on-what-the-figure-costs)): the figure runs on foot with a gait of its own past a speed; the seat stays in the pose; a model a machine can't read becomes a match-check item at a new level, `info`, saying avatar interaction isn't supported in that pilot's copy of the aircraft; VR stays a known limit for v1; and the figure's model and `Figure` keep its frame time down now, changing and writing a joint only when it moved past what shows.

A pilot's own core works out their figure: it reads the camera every frame and the mouse through the core helper, takes a seat by where the camera is, casts each click's ray into the aircraft's own models, and decides where each hand goes and when.
It sends the whole figure to the crew as a pose, at most every 33ms.
On every machine, the `Figure` routine in our WASM module eases each hand toward its target, holds a hand on a yoke by that machine's own yoke, works out each figure's 27 joints, and places each figure in the moving cockpit, every frame.
The aircraft model is four engines of our own: `msfs-gltf` reads the models, `msfs-rpn` runs the aircraft's code, `ray-cast` casts the ray, and `aircraft-model` puts the three together.

This answers node 6.13 of the [architecture plan](../architecture/plan.md#613-avatars), and holds only what these leave out: [avatars' tentative decisions](decisions.md), which [what this confirms](#avatars-tentative-decisions) goes through one by one; 03-v1-scope's [avatar sync](../product/03-v1-scope.md#avatar-sync) and its note of 2026-10-17; [decision 004](../../decisions/004-core-works-out-figures-hand.md); the code map's [routines in our WASM module](../architecture/02-code-map.md#routines-in-our-wasm-module) and [what a handler sees and does](../architecture/02-code-map.md#what-a-handler-sees-and-does); and 01-format-and-delivery's [seats](../profiles/01-format-and-delivery.md#seats) and [`location`](../profiles/01-format-and-delivery.md#state-entries).
Here a pose is everything one pilot's figure shows, and a target is where one of its hands is going.

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `avatars` | Feature | The seat this pilot holds, each hand's target and its timers, the figures this machine draws, the model, and the settings | Its crate in the core, the routine `Figure` in our WASM module, and the figure's SimObject in our package |
| `aircraft-model` | Engine | Finding an aircraft's model files, the model built from them, posing it from the aircraft's code, and casting into it | In avatars' job, which builds the model, and on the loop, which poses and casts; and in the authoring tool |
| `msfs-gltf` | Engine | Reading an MSFS glTF and its buffer | Under `aircraft-model` |
| `msfs-rpn` | Engine | Expanding, compiling, and running the sim's calculator code | Under `aircraft-model` |
| `ray-cast` | Engine | A BVH for each mesh, and a cast through the nodes' transforms | Under `aircraft-model` |
| `tools/profile-author` | Tool | The seat tool and the click tool | From the repository, with the sim running ([the authoring tool](#the-authoring-tool)) |

- Avatars depends on the session, for control, the members, and who is in the flight; the network, for its channel, each link's state, and whether this PC reaches the internet; the sim service, which also gives the aircraft's package folder; the core helper's service, for the mouse; the cockpit stream, for `CockpitSent`; the profile loader, for the seats and the locations; `clients`, for its settings and notifications; and `aircraft-model`.
  The code map's [features](../architecture/02-code-map.md#features) row lists all but the session and `clients`.
- `msfs-gltf`, `msfs-rpn`, and `ray-cast` depend on nothing of ours, so they sit on the engines' bottom line beside `messages`, and `aircraft-model` on them.
- The core records every input avatars takes: its camera read every frame, its `Frame` events, its poses' channel, its model's job, and its watches, among them the variables the posing code reads, the avatar on foot, and the aircraft's pose while its pilot is on foot.
  A replay checks avatars' outputs, its notifications among them (user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).
- Avatars registers no guard, catch-up step, or cockpit kind.
- The figure ships in our one package, `dualinput`, with the order hint `PANEL_PATCH` ([our package](../build/01-the-build.md#our-package)).
  `fspackagetool` compiles the figure's SimObject on a PC with the sim, closed, since it starts the sim to build, and the compiled model files are committed beside their source with the sources' hashes, which CI checks ([files compiled with the sim](../build/01-the-build.md#files-compiled-with-the-sim)).

## Names

Avatars owns the kind `FIGURE` in [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares):

- The figure's SimObject title is `DUALINPUT_FIGURE_PILOT`, a `StaticObject`, where the probes' was `CROSSCHECK_Figure` (read in `experiments/areas/avatars/figure/build.mjs`), which settles 6.3's line on it.
  A lighter figure for passengers, a Later pick, is `DUALINPUT_FIGURE_PASSENGER`.
- The figure's 27 joints and its color are 28 `Z:` variables of its own object, `DUALINPUT_FIGURE_` and the channel, such as `Z:DUALINPUT_FIGURE_HEAD_YAW`, `Z:DUALINPUT_FIGURE_ARM_L_LEN`, and `Z:DUALINPUT_FIGURE_COLOR`; the probes named them `CROSSCHECK_` and the channel (read in `figure/model.mjs`, `CHANNELS` and `variable`).
  `Z:` variables don't add to the sim's `L:` name table, which held 6,517 names before and after 1,000 figures ([log](log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view)).
- The routine's slot stays `DUALINPUT_ROUTINE_FIGURE`, of the routine host's kind.

## What it registers

```rust
// a sketch; the hooks' names follow the platform's units, and the one marked is hypothetical
pub fn register(r: &mut Registry) {
    let me = r.unit::<Avatars>("avatars");
    me.channel(avatars::POSES, Avatars::on_pose);                 // Newest, in avatars' module of the message crate
    me.mouse(Avatars::on_mouse);                                   // hypothetical name for 6.5's mouse want
    me.on_sim(Avatars::on_sim);                                    // the camera, frames, the avatar, the posing values, each figure's object ID
    me.on::<ProfileLoaded>(Avatars::load);                         // the seats, and the mouse on
    me.on::<ProfileUnloaded>(Avatars::unload);                     // the mouse off
    me.on::<AircraftChanged>(Avatars::aircraft);                   // the aircraft's package folder, for the model's job
    me.on::<CockpitSent>(Avatars::sent);                           // a change made without a click
    me.on::<ControlPassed>(Avatars::control);                      // the new PF's figure takes its yoke
    me.on::<MemberGone>(Avatars::gone);                            // its figure goes
    me.setting(setting::COLOR, Option::<u8>::None);                // a palette index
    me.setting(setting::SHOW_MINE, true);
    me.setting(setting::SHOW_CREW, true);
}
```

## The pose

```rust
// a sketch: avatars' module of the message crate; N and P are hypothetical
pub const POSES: Channel<Pose> = Channel::new(N, Delivery::Newest, Priority(P));   // keyed by its sender

pub struct Pose {
    pub at: u64,                 // µs on the sender's counter, which orders poses
    pub color: Option<u8>,       // the pilot's color setting, or none
    pub body: Body,
    pub hands: [Hand; 2],        // left, then right
}

pub enum Body {
    Seated { seat: String, eye: [f32; 3], look: [f32; 3] },   // the seat's key; the camera, or in an outside view the seat's eye looking forward
    Head { eye: [f32; 3], look: [f32; 3] },                   // inside the aircraft, in no seat
    OnFoot { at: [f32; 3], heading: f32, crouch: bool },
}

pub enum Hand {
    Rest,
    Grip(Side),                  // on the yoke in front of the seat, placed from this machine's yoke
    Thumb([f32; 3]),             // on that yoke, in the frame of its last animated node
    Point([f32; 3]),             // where the hand's center goes
}
```

- A pose goes `To::Crew` whenever anything in it changes, at most every 33ms, the tick of the probes whose figure our test pilot judged good ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)), and at least every 1s, so a link that comes up has the whole figure within a second.
  It goes only while this pilot is in the flight ([in the flight](../session/02-units.md#in-the-flight)).
- A pose is under 100 bytes in postcard (an estimate), about 150 with the 58 bytes of headers [flight-model sync](../flight-model/01-flight-model-sync.md#budgets) counts a packet, so at most about 4.5 KB/s from each pilot (arithmetic).
- A receiver keeps each sender's pose with the highest `at`, and draws it at once ([drawing on arrival](#drawing-on-arrival)).
- Every point is in the aircraft's frame, in meters from its reference point, x left, y up, z forward, the frame `location` uses ([state entries](../profiles/01-format-and-delivery.md#state-entries)), and on foot too, so one aircraft drawn a little apart on two machines still has the figure in the same place on it.
- The pose carries the seat by its key, as [seats](../profiles/01-format-and-delivery.md#seats) has seat claims carry it, and no other unit reads a seat.
  So the seat claims that [channels](../network/01-between-machines.md#channels) puts among the session channel's keys go with the pose, and whether the seat moves to a session key is [left open](#left-open).
- Two pilots who picked the same color both show it, and sort it out between themselves (user, 2026-10-17).
  A figure whose pose carries no color takes, on every machine, the first palette color that no member's setting names and no colorless figure with a lower pilot ID took, so every machine agrees and nothing writes a setting.

## A seat

The seats are the profile's `seats` ([seats](../profiles/01-format-and-delivery.md#seats)), and a seat's eye is its `eye`, up and forward from its hip in the seat's own frame, turned by its `facing`.

- **Taking one:** each frame, of the seats whose take radius holds the camera, the one whose eye is nearest takes it, if no other figure's newest pose names it (user, 2026-10-17).
  So where two seats' radii overlap, the border is the plane halfway between their eyes, as two balls of dough pressed together meet in a flat border; unequal balls of dough bulge into each other, and our border stays at the midpoint.
  A seat's `take_radius` is 0.4m unless the profile gives it (user, 2026-10-17), and an author can raise it to cover the whole left side of the 58P with no check refusing it.
- **Inside or outside:** the camera is inside the aircraft while it's within the interior model's bounding box, or, on a machine with no model, within the box around every seat's eye grown by 1m.
- **Holding it:** a pilot keeps their seat until they take another, go on foot, or move their camera, inside, more than 0.8m behind its hip along its facing, a constant ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
  Outside, the pilot is in an outside view and keeps the seat, and the pose puts the figure's eye at the seat's eye, looking forward.
- **Two at once:** when two pilots' cores take one seat within a trip, as both sims starting in the Pilot view makes likely (unverified), the PF keeps it, or else the lower pilot ID, and the other's core gives it up at once.
- **Seeing a held seat:** while this pilot's camera is in another figure's seat, by the rule above, that figure hides, and a notification names the free seats; Ready doesn't wait for a seat ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
- **In no seat:** inside, the figure is a head at the camera; on foot, which `E:IS AVATAR` on object 0 tells, since it swapped with `E:IS AIRCRAFT` when the pilot sat down ([log](log.md#2026-10-02-the-avatars-own-object-id-gives-its-position-speed-and-facing-every-sim-frame)), it walks.
  Each frame on foot, avatars reads `SIMCONNECT_OBJECT_ID_USER_AVATAR`'s position, `A:PLANE HEADING DEGREES TRUE`, and `A:IS CROUCH` (same entry), and turns the position into the aircraft's frame through the aircraft's pose and WGS 84's radii at its latitude ([log](log.md#2026-10-04-the-modules-sphere-earth-put-a-point-26m-forward-of-the-a350s-reference-point-14cm-off-and-wgs-84s-radii-account-for-all-of-it)).

## A click

### The mouse

- Avatars turns the core helper's mouse want on at `ProfileLoaded`, with no process ID, and off at `ProfileUnloaded`, both recorded ([what a feature registers and calls](../core/04-core-helper.md#what-a-feature-registers-and-calls); user, 2026-10-18).
- The want gains two things 6.5's [raw input](../core/04-core-helper.md#raw-input) left out:
  - a wheel notch, with the cursor's place, since a notch turns a knob, and most of the 58P's radios and bugs are knobs;
  - on the right button's release, the raw counts the mouse moved while the button was held, summed as our probes' `mouse.mjs` sums them (read in `experiments/tools/mouse.mjs`), for the right-click test below.

### The ray

- Avatars reads the camera each `Frame`.
  In the aircraft, it takes `SimConnect_CameraGet`'s `SIMOBJECT` referential, which gives the camera in the aircraft's frame with nothing more to read, and from which p25 cast at up to 185 kt GS ([log](log.md#2026-10-03-in-the-right-seat-the-figures-hands-followed-the-yoke-rules-with-the-right-hand-on-the-yoke-and-the-module-held-it-in-its-seat-at-up-to-185-kt-gs)).
  On foot, it takes the `WORLD` referential, turned into the aircraft's frame through the aircraft's pose, which landed within 1cm where `SIMOBJECT` landed within 7cm ([log](log.md#2026-10-03-on-foot-outside-the-click-ray-lands-within-1cm-on-the-exterior-and-the-pilot-clicks-from-up-to-6m-away)).
- `WORLD` in flight would need the aircraft's pose from the camera's own frame, and one frame apart at 150 kt and 30 fps is 2.6m (arithmetic), while on foot the aircraft stands still; so this design edits [the ray's tentative decision](decisions.md#the-ray-needs-no-calibration), which took `WORLD` inside and out.
- The ray runs from the camera through the cursor's place, by the rule the tentative decision measured: `fov` is the view's height, and the width follows the window's size the core helper reports.

### What it meets

- Before each cast, `aircraft-model` poses the model from the newest values of the variables its code reads ([posing](#posing)).
- The ray goes into the interior model while the camera is inside, and into the exterior otherwise.
- A hit gives the point, the surface's normal, and the node; a ray that meets nothing moves no hand.

### Which hand, and its target

The hands follow [a pilot's habits](decisions.md#the-hands-follow-a-pilots-habits-with-the-right-hand-on-the-yoke-in-the-right-seat), which this design confirms, through these targets in a seat:

| Press | Target |
| --- | --- |
| On a node below the seat's own yoke's node, a button | `Thumb` on its side, at the point in that yoke's frame; the hand holding the yoke keeps hold |
| On the yoke's node itself, the wheel | `Grip` on that side, a grab (user, 2026-10-17) |
| Anywhere else | `Point` for the hand on that side of the wheel's center, by the 5cm band; the other hand takes the yoke when this pilot is the PF |

- A `Point` is the hand's center: the hit, one hand's radius out along the normal, 3.8cm on the probes' figure (read in `p25-figure-hands.mjs`, `HAND_RADIUS`).
- **On foot or in no seat,** the hand on the hit's side of the figure's facing reaches, the other rests, and no yoke rule applies.
- **A left press** sets its hand's target at once.
  While it's held, the target follows the cursor: inside, along the plane of the surface it first met; on the exterior, by a fresh cast at each move ([a drag](decisions.md#a-drag-glides-inside-and-follows-a-fresh-cast-outside)).
  A press on a synced display is a click like any other, so its hand follows a drag as the display moves with it on the other machine ([pointer sync](../pointer-sync/01-pointer-sync.md#a-gesture)), and the figure says who's pressing where a blocked press flashes with no words ([locks](../pointer-sync/01-pointer-sync.md#locks)).
- **A right press** counts as a click at its release when it came up within 300ms, with the cursor under 5px and the mouse under 20 counts from where it went down, and then casts with the cursor and the camera from its press, as p20, p25, and p27 judged it (read in `p25-figure-hands.mjs` and `p27-a350-figure.mjs`; [log](log.md#2026-10-03-a-quick-still-right-press-is-a-click-and-a-held-or-moved-one-turns-the-view)).
- **After a release,** the hand stays 150ms on the spot, then hovers 1.5cm farther out along the normal, and with no new press the hands go home 500ms later, p27's times ([log](log.md#2026-10-04-in-the-a350-the-pilot-cut-the-hands-time-on-the-spot-to-150ms-and-its-hover-to-500ms-at-15cm-and-sent-it-back-in-03s-on-a-curve-that-eases-out)); a `Thumb` or a `Grip` stays where it is, with no hover.
- **A wheel notch** is a tap that stays on its spot 1s rather than 150ms, and a notch within 600ms of the last one keeps it there, as p21 to p27 ran it (same files), so the hands go home 1.5s after the last notch.
- **Going home,** the hand coming to the yoke takes it first, and the hand that held it keeps its grip until 0.3s after the other's arrival, as p21 overlapped them ([log](log.md#2026-10-03-with-a-run-of-clicks-treated-as-one-session-115-taps-took-9-swaps-instead-of-one-swap-a-click)), so for that time both targets are grips; a hand leaving the yoke to click goes at once.
- **At rest,** the PF's figure holds the yoke in front of its seat with the hand on its outboard side, and every other figure's hands rest on its thighs; on `ControlPassed`, this pilot's targets change at once, so the new PF's figure takes its yoke and the old PF's lets go (user, 2026-10-17).
  Which yoke is in front of a seat, and which seat's hand rules apply, comes from the side of the centerline its hip is on, as [seats](../profiles/01-format-and-delivery.md#seats) picks the hand rules.

The pilot's machine decides every target, the overlap of two hands on a yoke included, so `Figure` follows no hand rules: it eases each hand to the target it's given.
Each time here is a starting value, inside avatars' crate, which the build's stage for avatars tunes in the 58P, starting from what [the hands' habits](decisions.md#the-hands-follow-a-pilots-habits-with-the-right-hand-on-the-yoke-in-the-right-seat) records of the yoke probes and of p27.

## A change made without a click

On `CockpitSent` for an entry whose `location` covers this pilot's variant, the hand reaches for that spot, as the code map's [what a handler sees and does](../architecture/02-code-map.md#what-a-handler-sees-and-does) has it:

- A hand that's out from a press, from the press until the hands go home, keeps its target, so a click on a switch that also has a location brings one reach, the click's.
- Avatars waits 100ms before reaching, and two different located entries changing within 100ms of each other bring no hand, so a hardware panel that sends many switches at once moves none (user, 2026-10-17).
- One entry's run of changes, such as a lever moved on a throttle quadrant or a trim button held, which state sync sends up to 20 times a second ([kinds](../sync/05-units.md#kinds)), is one reach: the hand stays on the spot while the changes go on, then hovers and goes home as after a release.
- A number entry's change smaller than its `deadband`, from its value when the hand last reached for it, brings no hand; `deadband` is a new optional field beside `location`, in the entry's own units, which the author sets on an axis as the click tool walks the entries (user, 2026-10-17).
- The hand on the location's side reaches, its center one hand's radius from the location toward the seat's eye, and hovers 1.5cm farther that way.

`CockpitSent` carries the kind, the key, and the clock ([sending](../sync/05-units.md#sending)), and a feature can't name another feature's types, so a kind whose key names an entry declares so at registration, with how to read the entry's number from its body; `CockpitSent` then also carries the entry and its number, as the code map's hook table has a kind name its entry ([what a feature registers](../architecture/02-code-map.md#what-a-feature-registers)).

## Drawing on every machine

### The figures this machine draws

- Avatars creates a figure for each member whose pose has arrived, and one for its own pilot, through `create_ai` with `DUALINPUT_FIGURE_PILOT`, at the aircraft's position, then freezes each one's position, altitude, and attitude with `K:FREEZE_LATITUDE_LONGITUDE_SET`, `K:FREEZE_ALTITUDE_SET`, and `K:FREEZE_ATTITUDE_SET` with 1 on its object ID, as p25 to p27 did (read in `p25-figure-hands.mjs`).
- A figure goes when its member is gone from the session, and every figure goes when the profile unloads.
  At the unload, avatars removes none itself: the platform's close of avatars' sim connection removes them, and the sim service removes any the close leaves ([a connection for each feature](../architecture/02-code-map.md#a-connection-for-each-feature-for-each-load); user, 2026-10-18).
  The SDK documents that closing a connection removes the objects it created, which we've measured only for a killed client.
- Each frame, avatars works out each figure's state from its newest pose and this machine's view of its member:
  - the figure of a member out of the flight slumps and turns gray at once, its link up or not;
  - while the link to a member is lost and this PC reaches the internet, by the network's check ([what the pilot sees](../network/02-units.md#what-the-pilot-sees-and-settings)), that member's figure slumps and turns gray;
  - while the check says this PC doesn't reach it, the other figures ease to rest in their own colors, the PF's still holding its yoke, and this pilot's own figure turns gray without slumping;
  - before the check answers, a figure holds its last pose;
  - a slumped figure's hands let go of every grip.
- "Show my figure" off hides this pilot's own figure, and "Show the crew's figures" off hides every other.
- This pilot's own figure, while it's seated in the cockpit or a head, hides its head and neck and fades its hands, since its head sits at the camera; where the sim can't fade the figure's material, its hands hide instead ([avatar sync](../product/03-v1-scope.md#avatar-sync)).

### Feeding `Figure`

- Avatars feeds `Figure` one slot holding each yoke's grips and animations ([a hand on a yoke](#a-hand-on-a-yoke)), and for each figure its object ID, its seat's hip, knees, feet, and facing, its color, what of it shows, whether it slumps, and its pose.
- It feeds again on each change: a pose that arrives, a change of its own pilot's pose, and a change of a figure's state, at most once an input, so at most about 30 times a second for each pilot.
- Two yokes come to about 2.4 KB and each figure to about 150 bytes, so a crew of eight fits the 8,192 bytes of [the routine's slot](../architecture/02-code-map.md#routines-in-our-wasm-module) (estimates).

### `Figure`, each frame

```rust
// a sketch: avatars' routine; the wants' names follow 6.3's and 6.10's
impl Routine for Figure {
    const ID: RoutineId = routine::FIGURE;
    type Slot = FigureSlot;

    fn on_slot(&mut self, s: &FigureSlot) { self.take(s) }        // new targets; each part's eased place carries on

    fn frame(&mut self, f: &Frame, want: &mut Wants) {
        let aircraft = want.read::<AircraftPose>();               // this frame's and the last's, for the lead
        let yokes = self.yokes.pose(want);                        // each grip, from this machine's yoke variables
        for figure in &mut self.figures {
            figure.ease(f.now);                                   // the hands on their spring or way back, the head on its ease
            let joints = figure.solve(&yokes);                    // the 27 joints, the color, and what shows
            want.write_on(figure.object, &aircraft.lead(1.0).place(figure.root()));
            want.write_on(figure.object, &joints);                // Z:DUALINPUT_FIGURE_*
        }
    }
}
```

- **Why here:** the probes worked out every joint in Node and wrote them from outside the sim every 33ms, while the module placed only the figure's root inside the frame (read in `p25-figure-hands.mjs`, `drive`), which is one candidate for the frame the figure missed now and then (unverified).
- **Easing:** a hand goes out to its target on a spring damped just enough not to overshoot, 95% of the way in 0.15s, and back to rest or to a grip along a curve that sags 6cm toward its shoulder and eases out by 1 − (1 − t)³ over 0.3s, as p27 drove them ([log](log.md#2026-10-04-in-the-a350-the-pilot-cut-the-hands-time-on-the-spot-to-150ms-and-its-hover-to-500ms-at-15cm-and-sent-it-back-in-03s-on-a-curve-that-eases-out)); the head closes 1 − e^(−dt/0.12s) of what's left each frame, as p25's did (read in `p25-figure-hands.mjs`, `EASE_S`).
- **The joints:** the hip sits on the seat, the head at its eye with the neck stretching to it, the arms run straight to the hands, and the legs to the seat's knees and feet, each stick telescoping to its length ([log](log.md#2026-10-03-sticks-that-telescope-two-fixed-pieces-shown-by-the-sticks-length-end-at-the-hands-and-feet)).
  On foot the arm reaches a spot up to 3m away and points at a farther one at 0.6m (user, 2026-10-17); the probes' longest pair of telescope pieces reaches 2.56m (read in `figure/model.mjs`, `TELESCOPE`), so our figure adds a pair.
  The legs step by the distance walked, as p04 stepped GSX's people, and a crouch lowers the hip.
- **Placing:** the figure's root goes at the seat's hip, or on foot at the avatar's place, in the aircraft's frame, turned by the aircraft's heading, pitch, and bank, led by 1 frame of the aircraft's change since the last frame, and placed through WGS 84's radii at the aircraft's latitude ([log](log.md#2026-10-04-the-modules-sphere-earth-put-a-point-26m-forward-of-the-a350s-reference-point-14cm-off-and-wgs-84s-radii-account-for-all-of-it)).
  p16 found a lead of 0.75 or 1 frame held GSX's passenger ([log](log.md#2026-10-03-over-three-minutes-of-flying-leads-of-075-and-1-frame-both-hold-the-figure-and-whats-left-reads-as-inertia)), and p25 held our figure with 1, both on an aircraft the sim's own physics flew; on a following machine, `Figure` reads the aircraft as `Follow` wrote it, which no run has measured.
- The routine host writes the six `A:PLANE` variables through `fsVarsAVarSet` and the 28 `Z:` variables through `fsVarsZVarSet` on the figure's object ID ([wants and the sim's APIs](../core/03-sim-seam-and-wasm-module.md#wants-and-the-sims-apis)).
- `Figure` reports nothing, so it has no report slot.

### A hand on a yoke

- When the model loads, `aircraft-model` finds each yoke's grips by its `HANDLING_Yoke_1_Hand_` nodes, or their copies on a copilot's yoke, and each hand's spot one hand's radius out from where the line from that seat's eye meets the horn, with the yoke centered, in the frame of the yoke's last animated node ([the yoke hand](decisions.md#the-yoke-hand-holds-the-grips-the-aircraft-marks-or-their-copy-on-the-copilots-yoke)).
- Every machine does this from its own copy of the models, which it loads anyway for its own pilot's clicks, so no machine sends a grip.
- For each of a yoke's two animations whose code reads one variable and gives a frame linear in it, `aircraft-model` hands avatars the variable, the line from its value to the frame, and the animated node's transform at 21 frames across the animation; that comes to about 1.2 KB a yoke (an estimate).
- Each frame, `Figure` reads those variables on its own aircraft, places each node from its two nearest frames, and puts a `Grip` or a `Thumb` there, so the hand moves with the yoke as this machine draws it.
- The 58P's yoke plays its animations from `(A:YOKE X POSITION WITH AP LINEAR, Percent)` and `(A:YOKE Y POSITION WITH AP, Percent)`, each halved and added to 50, and the Comanche's from A2A's two `L:` variables, negated, halved, and added to 50 ([log](log.md#2026-10-03-aircraft-mark-their-yoke-grips-with-the-same-node-names-and-the-yokes-own-animations-put-them-on-a-level-wheel)), so both are linear in one variable.
- An animation whose code isn't holds the hand where the centered yoke puts it.

### Drawing on arrival

`Figure` draws a pose as soon as it arrives, each part easing toward its newest target, with no delay and no clock offset, so a hand lands about its reach time, 0.15s, after the switch it reached for moved there, as [a change applies without waiting for the hand](decisions.md#a-change-applies-without-waiting-for-the-hand) has it; `Frame::now` gives only the easing's time.

## A machine that can't read the models

The iniBuilds A380 and the Phenom 300E, both from the Marketplace, ship their files as `.fsc`, which we can't read ([log](log.md#2026-10-04-of-the-three-sidestick-airliners-we-could-read-only-the-fenix-marks-a-grip-and-each-sticks-grip-moves-with-its-own-two-animations)), so a Marketplace copy of the 58P may be unreadable too (unverified), and a streamed copy keeps no model on disk (unverified); the model's job then fails on that machine:

- That machine's pilot brings no hand by a click, and on that machine a `Grip` or a `Thumb` draws as the hand at rest.
- Seats, heads, on foot, and located changes still work, through the box around the seats' eyes ([a seat](#a-seat)), and a notification tells that pilot.
- The crew's other machines draw as usual.

This replaces [preflight match check](../product/03-v1-scope.md#preflight-match-check)'s example that avatar sync stays off when one pilot's copy lacks a model it needs, and whether a model its machine can't read becomes a match item is [left open](#left-open).

## The aircraft model

### Finding the files

- Avatars' job takes the aircraft's package folder from the sim service's aircraft awareness ([the aircraft's facts](../core/03-sim-seam-and-wasm-module.md#the-aircrafts-facts); user, 2026-10-18), and looks in it under the preset's path from sim awareness ([the aircraft](../core/03-sim-seam-and-wasm-module.md#the-aircraft)).
  It starts once both hold, the profile loaded and `AircraftChanged` naming the folder, since nothing orders the two.
- From the preset's `aircraft.cfg`, it takes the model folder, from its `model.cfg` the interior and exterior models, the LOD with the largest `minSize` of each, and the behavior XML with the files it includes, as our probes found them (read in `experiments/areas/avatars/lib/cockpit-files.mjs`, `cockpitFiles` and `behaviorText`).
  The probes followed only `<IncludeBase>`, and the Comanche's cockpit also includes `A2A_Templates.xml` through `<Include File>`, so `aircraft-model` follows both (read in a2a-aircraft-pa24 2.1.3, `PA24_250_INTERIOR.xml`).
- The job reads the files and runs `aircraft-model` on them, as the profile loader's job reads and checks a bundle ([timers, jobs, and IDs](../core/01-loop-and-edge.md#timers-jobs-and-ids)), and hands up the built model as one flat buffer, which the loop reads in place, so taking it costs a check of its header rather than a decode.
- Instruments that are attachments with models of their own, such as the Comanche's GPS units, aren't read, so a ray meets the panel behind them ([the models](decisions.md#the-models-come-from-the-aircrafts-own-package)).

### Its engines

The 58P's two models come to 907,362 triangles as their scenes instance them, none skinned, plain enough that each engine reads only what those files hold ([log](log.md#2026-10-17-the-58ps-models-need-no-gltf-compression-but-carry-msfss-own-vertex-layouts-and-no-rust-crate-reads-them-their-behavior-files-and-their-code-as-the-core-needs)):

| Engine | What it does | Compared with | Why |
| --- | --- | --- | --- |
| `msfs-gltf`, our own, on `serde_json` | Reads nodes, meshes, accessors in MSFS's layouts, and animations, and refuses any layout it doesn't name; geometry that two meshes share is read once | `gltf` 1.4.1, the standard crate | `gltf` refuses the required `MSFT_texture_dds` unless a feature is on, and its typed readers end in `unreachable!()` on MSFS's signed-short texture coordinates and signed-byte colors; `serde_json` is already the core's |
| `msfs-rpn`, our own | Expands an aircraft's own macros and template parameters, then compiles and runs its animation and visibility code on given values | Nothing: no Rust crate runs it | The probes' operator set ran 310 of the 58P's 406 codes, most of the rest stopped at unexpanded parameters and `@` macros, and it adds the SDK's `rng`, `sign`, `exp`, `ln`, `?`, `case`, and the other math words |
| `ray-cast`, our own | One binned-SAH BVH for each distinct mesh in its node's own space, and a cast that turns the ray into each node's frame, so posing moves nodes and rebuilds nothing | `bvh`, `obvhs`, `parry3d` | `bvh` turns on rayon by default and comes to about 415 MB at 2.6 million triangles, `obvhs` calls `Instant::now()` in a builder, and `parry3d` brings more than 10 crates, while our Clippy rules see inside none of them |
| `aircraft-model`, on the three and `quick-xml` 0.42 with its default features off | Finds the files, walks the behavior XML's components, builds and poses the model, casts, and gives the yokes | `roxmltree` | `roxmltree` refuses `A2A_Templates.xml`, which the Comanche's cockpit includes, for a `#` in its element names |

- The sim's own template library stays out, so parts sim templates drive, such as the 58P's throttle, stay as the files store them, and inside, a drag on one glides rather than following it ([posing](decisions.md#the-model-is-posed-only-from-code-in-the-aircrafts-own-files)).
- Each engine keeps the loop's rules ([tiers](../architecture/02-code-map.md#tiers)).

### Posing

- `aircraft-model` lists the `A:` and `L:` variables its code reads, and avatars watches them on change each sim frame.
- Before a cast, it runs only the code whose variables changed since the last pose, moves those nodes, and hides the parts whose visibility code says so.

### Casting

- A cast turns the ray into each node's frame, finds the nearest hit, and skips hidden nodes and materials marked `ASOBO_material_invisible`, since the Comanche wraps its panel and cabin in invisible shells (read in `experiments/areas/avatars/lib/raycast.mjs` and `lib/gltf.mjs`).
- The cockpit model's space lines up with the aircraft's frame within 8mm in the Comanche, and within about 3mm in the 58P if its cabin is symmetric ([log](log.md#2026-10-03-the-cockpit-models-own-space-lines-up-with-simconnects-within-8mm-but-the-models-input-event-ids-arent-the-names-the-sim-lists); [log](log.md#2026-10-03-one-hand-holds-the-yoke-through-its-whole-travel-posed-from-the-aircrafts-own-code-while-the-other-taps-and-they-swap-by-side)), so a hit needs no correction.

## The authoring tool

`tools/profile-author` is one Rust program with two commands, on `sim-client`, `sim-edge`, `aircraft-model`, `profile-engine`, and the message crate, run with the sim in a flight in the aircraft, and v1 ships it to nobody: the core team runs it from the repository ([authoring tools](../build/01-the-build.md#authoring-tools)).
Its commands:

- **`seats`** seeds each seat from the seat objects SimConnect lists, then the cockpit model's `PILOT_` nodes, then a point the author marks on the cushion; it creates our figure and feeds `Figure`'s slot, so the author sees the figure seated while tuning the hip, knees, feet, and eye, and it writes the seats into the profile.
- **`locations`** walks the profile's entries; the author points the cursor at each control and marks it with Page Down, or skips it with Page Up, and the tool casts the ray and writes the entry's `location` for the loaded variant, and its `deadband` when the author gives one.
- A mark is a key, not a click, so walking 100 or more entries leaves the cockpit as it was: a click would flip up a guard's cover, push a knob, or engage a starter, and a key needs no mouse reading, since the tool reads the cursor's place with `GetCursorPos` against the sim's main window.

## Avatars' tentative decisions

| Tentative decision | This design |
| --- | --- |
| [The hand goes where the pilot clicks](decisions.md#the-hand-goes-where-the-pilot-clicks-found-from-the-aircrafts-geometry) | Confirms |
| [The clicking pilot's machine finds the point](decisions.md#the-clicking-pilots-machine-finds-the-point-and-the-other-machine-only-draws-it) | Confirms, and settles what it leaves out: each machine finds the grips from its own models |
| [The ray needs no calibration](decisions.md#the-ray-needs-no-calibration) | Changes it, in place: `SIMOBJECT` in the aircraft, `WORLD` on foot |
| [The models come from the aircraft's own package](decisions.md#the-models-come-from-the-aircrafts-own-package) | Confirms, through the package folder from the sim service's aircraft awareness |
| [The model is posed only from code in the aircraft's own files](decisions.md#the-model-is-posed-only-from-code-in-the-aircrafts-own-files) | Confirms, and expands the aircraft's own macros and template parameters |
| [The yoke hand holds the grips the aircraft marks](decisions.md#the-yoke-hand-holds-the-grips-the-aircraft-marks-or-their-copy-on-the-copilots-yoke) | Confirms |
| [The hands follow a pilot's habits](decisions.md#the-hands-follow-a-pilots-habits-with-the-right-hand-on-the-yoke-in-the-right-seat) | Confirms the rules, with p27's times as the starting values |
| [A change applies without waiting for the hand](decisions.md#a-change-applies-without-waiting-for-the-hand) | Confirms |
| [A drag glides inside and follows a fresh cast outside](decisions.md#a-drag-glides-inside-and-follows-a-fresh-cast-outside) | Confirms |
| [Left clicks, quick right clicks, and wheel turns](decisions.md#left-clicks-quick-right-clicks-and-wheel-turns-all-bring-the-hand) | Confirms, with the wheel and the right release's counts added to the core helper's mouse |
| [A click, or a change at a control's spot](decisions.md#a-click-or-a-change-at-a-controls-spot-brings-the-hand-and-on-foot-the-hand-touches-up-to-3m) | Confirms, and settles what it leaves out: 100ms for one instant, `deadband` for noise, and a pointing arm of 0.6m |

Each is numbered with step 8's decisions, by [where answers go](../architecture/plan.md#where-answers-go).

## What this changes elsewhere

The text or the notes at the top of [03-v1-scope](../product/03-v1-scope.md), [01-format-and-delivery](../profiles/01-format-and-delivery.md), [the code map](../architecture/02-code-map.md), [03-sim-seam-and-wasm-module](../core/03-sim-seam-and-wasm-module.md), [04-core-helper](../core/04-core-helper.md), [01-recording-and-bug-reports](../recording/01-recording-and-bug-reports.md), [the session's units](../session/02-units.md), [01-between-machines](../network/01-between-machines.md), [04-order-and-recovery](../sync/04-order-and-recovery.md), and [the sync units](../sync/05-units.md) list what this design changes there, [avatars' tentative decisions](decisions.md) are edited in place, and [tentative decisions](../architecture/decisions.md#a-pilots-own-core-works-out-their-figure-and-figure-draws-every-figure-on-arrival-each-frame) give the reasons.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside the code map's [budgets for work in the sim](../architecture/02-code-map.md#budgets-for-work-in-the-sim).

| What | Budget |
| --- | --- |
| A cast, its posing included, on the loop | Under 0.5ms at p99 in the 58P, inside the code map's 1ms a handler |
| The model's job | The 58P's two models built within 2s on the blocking pool |
| The model in memory | Under 60 MB for the 58P, where the research's arithmetic gives about 28 MB to 37 MB (unverified) |
| Taking the model on the loop | Within the 1ms a handler, by reading its buffer in place |
| `Figure` | Inside the module's 0.1ms a frame at p99, with two figures |
| The sim's frame | Each figure in view adds the 16µs to 21µs p28 measured standing still, and 10µs to 16µs more moving every joint ([log](log.md#2026-10-05-each-figure-poses-from-its-own-objects-variables-and-costs-frame-time-in-view-and-almost-none-out-of-view)) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, the stand-in sim, a stand-in core helper, and the routine host built natively:

- Both pilots' cameras start in the 58P's Pilot seat: the PF keeps it, the other's figure gives it up, and that pilot's notification names the Copilot seat.
- A camera between the two seats, inside both radii: the seat whose eye is nearer takes it; with the other seat held, nothing changes.
- A camera 0.9m behind the hip inside the cabin: a head; a chase view behind the tail: the figure seated, looking forward.
- A left tap on the left side of the panel by the PF in the left seat: the left hand reaches, the right takes the yoke at once, and 650ms after the release the left takes the yoke and the right lets go 0.3s after it arrives.
- A tap on a chock on foot: the hand on that side reaches, and no hand goes to a yoke.
- A right press held 210ms with 34 counts: no hand; one up in 150ms with 4 counts: the hand.
- Three wheel notches 400ms apart: one tap held through them, home 1.5s after the last.
- A click on a located switch: one reach; the same switch moved by a key: one reach after 100ms; three located switches in 50ms: none.
- A throttle entry with a `deadband` of 2 jittering by 0.5: no hand; moved by 10 over a second, its changes 50ms apart: one reach, home after the run ends.
- Two pilots who never picked a color: each machine draws them in the first two palette colors, by pilot ID, the same on both.
- `ControlPassed`: the new PF's figure takes its yoke and the old PF's lets go, on both machines.
- A pose lost: the next one, within 33ms or 1s, carries the whole figure.
- A link lost with this PC reaching the internet: that figure slumps and turns gray; with it not reaching: the other figures ease to rest in their colors, the PF's on its yoke, and the own figure turns gray.
- The PF's sim crashing with the link up: the PF's figure slumps, turns gray, and lets go of its yoke at once.
- The model's job failing: no hand from a click, grips drawn at rest, the notification, and the seats and heads as before.
- The profile loading before `AircraftChanged` names the package folder: the model's job starts once the folder arrives.
- A following machine's yoke moved through `Follow`'s events: the PF's hand stays on its horn, each frame.
- The 58P's model taken on the loop within its budget, and a cast within its budget, measured.
- After a flight load, the figures are created again and `Figure`'s writes land ([cases for the bench](../core/03-sim-seam-and-wasm-module.md#cases-for-the-bench)).

In the sim:

- No part of the figure skips a frame in flight, on the flying machine and on a following one, which ends the build's stage for avatars ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
- Whether the figure's material fades, which keeps its own hands in view, and whether a click passes through the pilot's own figure to the control behind it; where either fails, the own figure's hands hide.
- Whether the 58P's yoke buttons are nodes below `Yoke_L` and `Yoke_R`, which the thumb rule takes them to be.
- Whether a following machine's `A:YOKE X POSITION WITH AP LINEAR` and `A:YOKE Y POSITION WITH AP` move with `Follow`'s axis events.
- Whether a frame maps to a glTF animation's time as the SDK documents, which `aircraft-model` takes and nothing has measured ([log](log.md#2026-10-03-aircraft-mark-their-yoke-grips-with-the-same-node-names-and-the-yokes-own-animations-put-them-on-a-level-wheel)).
- Whether the interior model's bounding box tells the 58P's chase view from a walk down its cabin.
- Whether a live figure's `Z:` values survive a reset of the sim's variables, since `Figure` writes a value again only when it changes, and the stand-in keeps them.

## Known limits

- A figure on foot while the aircraft moves stands off on another machine by up to 0.4s of the aircraft's travel, because a following machine draws the aircraft 0.4s behind; crews don't walk around an aircraft that's taxiing.
- Until avatars can tell that a pilot is in VR, a VR pilot's clicks may place a hand wrongly.
- The kernel and the recording each copy the model whole as a load takes it, so the loop stalls once at each load in proportion to the model's size, as [the log](log.md#2026-11-04-a-large-model-costs-the-loop-about-023ms-a-megabyte-at-each-load-and-the-a350s-and-a220s-cockpits-are-attachments-we-dont-read) measures (user, 2026-11-04).
- A modular aircraft whose cockpit is an attachment, such as the A350 and the A220, brings no hand from a click, since `aircraft-model` reads no attachments; its seats and heads still work, through the box around the seats' eyes.
- A figure's walk, run, and crouch have visual issues, and a pilot's own arms cover what's behind them; a later pass fixes the first, and tries translucent arms and hands for the second, hiding the pilot's own arms if that fails (user, 2026-11-05).
- A pilot's own figure on foot runs a frame behind their avatar, 30ms and about 5cm at a walk, as [the log](log.md#2026-11-05-a-pilots-own-figure-on-foot-stands-on-its-avatar-a-frame-behind-since-the-spring-left-it-150ms-late-and-a-lead-overshoots-every-stop) measures, since a lead overshoots at every stop (user, 2026-11-05).
- When a pilot on foot looks down, the camera cuts their own figure's chest ball open, as a large arch across the lower half of the view; the later pass decides how their own figure looks on foot (user, 2026-11-05).
- A pilot's own figure has no head from outside it, such as in a chase view, since what shows goes by whose figure it is and not by the camera.
- A figure's head turns with no slow start, closing most of a turn in about a third of a second, which the later pass may soften.
- A click on the sim's own menus brings a hand toward whatever is behind the menu, for as long as the click, since the helper can't tell a menu from the view.
- A click on another program's window or a popped-out display lying over the sim's view brings a hand for as long as the click, since the sim still reads as in front at the press; the helper could check the window under the cursor, which waits for stage 16's session, where the sim can show whether an overlay such as Steam's would then swallow every click (user, 2026-11-05).
- `Figure` and the figure's frame time run over their first budgets, by [the note above](#avatars-avatar-sync-and-the-aircraft-model), and stage 16's routines share the module's 0.1ms, so it measures them again (user, 2026-11-05).
- A located entry's slow run isn't one reach: changes under its `deadband` don't hold the hand on the spot, so a slow enough move sends the hand home and back, and an entry's first change always brings a hand; the session in the sim tunes this (user, 2026-11-04).

## Left open

- How Dual Input's empty avatar is built, and whether the pilot picks it in the sim's own avatar screen: the build's stage for avatars, in the sim ([avatar sync](../product/03-v1-scope.md#avatar-sync)).
- How avatars tells that a pilot is in VR: a sim check with a headset, at the same stage.
- How the authoring tool edits the profile's YAML and keeps its comments: inside the tool.
- How the figure's legs step on foot: the build's stage, by eye.
- Whether the seat moves from the pose to a session key ([the pose](#the-pose)), and whether a model its machine can't read becomes a match item ([a machine that can't read the models](#a-machine-that-cant-read-the-models)) (user, 2026-10-21).
