# Control: take-control

```text
Purpose:     How a pilot takes control with a bound key or hardware button, or with a button in the EFB app or the desktop app, and what each machine shows when control passes.
Depends on:  ../product/03-v1-scope.md, ../architecture/02-code-map.md, ../core/02-clients-and-panel-bridge.md, ../core/04-core-helper.md, ../session/01-roles-and-members.md, ../session/02-units.md, ../network/01-between-machines.md, ../sync/04-order-and-recovery.md, log.md
Decides:     How a pilot binds the key or button, as a single or a long press; how a press, or a button in the apps, asks for control; what a pilot gets when the guards refuse, and when the link to the PF is lost; what marks a pass on each machine; the budgets; and the cases for the bench (node 6.12).
```

> **Note**
> Stage 11b's tentative decision that [Dual Input's one full window is its EFB app](../interface/decisions.md#dual-inputs-one-full-window-is-its-efb-app) moves take-control's section, which binds the input, from the desktop app to the EFB app, and the take-control button is the EFB app's alone (user, 2026-10-25).
> Binding in the EFB happens with the sim's window in front, where a bound key counts.

> **Note**
> Stage 11b's tentative decision that [take control is a held button under the tabs](../interface/decisions.md#take-control-is-a-held-button-under-the-tabs-with-one-hold-of-035s) moves a long press's hold from 1s to 0.35s, the button's hold, so the gesture has one number, until the apps' design confirms it (user, 2026-10-31).
> The warning while the link to the PF is lost reads "James may still be flying. If you take control, their aircraft will jump to yours when they reconnect.", and [the banner's content](../interface/decisions.md#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on) drops the warning after a takeover through a lost link, since by then the deed is done.

> **Note**
> Stage 20's build changes five things below ([control log](log.md#2026-11-04-stage-20s-take-control-passes-its-cases-on-the-bench-and-a-press-reaches-the-cue-about-80ms-later-past-the-50ms-budget)):
> take-control depends on the network crate too, for this core's link to the PF and for `LinkUp`: a reconnected link's first message carries control in the same input as its `LinkUp`, so a pass stamped the same was made while the link was lost, and no `status` key shows that input;
> the part reads the binding's two settings from the slice of settings, since a slice can't read the clients crate's state while that crate builds it, so take-control's slice carries neither;
> a dimmed button takes no hold, as the frames draw it, so the EFB app's button meets a refusal only when a guard denies during a hold;
> while Bind waits, a press crosses only as the next press, and Bind stops waiting once the pilot leaves the Settings tab or the app;
> and the long-press setting starts on, as the frames draw Hold picked, so a pilot who binds a key and changes nothing takes control with a 0.35s hold (user, 2026-11-04).
>
> [Budgets](#budgets)' single press is under 100ms, not 50ms, since it took about 80ms on our development machine, and the smallest output buffer we tried still took 53ms at the cost of ATC audio's margin (user, 2026-11-04).
> The two cues [left open](#left-open) are stand-ins, and [stage 20b](../build/plan.md#20b-the-sounds) makes the real ones (user, 2026-11-04).

> **Note**
> Stage 20b kept stage 20's two cues as v1's, since four rounds of candidates didn't beat them, and sketched the voice phrases' two cues in their style ([control log](log.md#2026-11-15-four-rounds-of-candidate-cues-didnt-beat-stage-20s-stand-ins-so-v1-keeps-them); user, 2026-11-15).
> Richer cues would come from a licensed pack or a sound designer.

> **Note**
> Stage 20's build gives take-control the lost link's notification, as [the banner's content](../interface/decisions.md#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on) has it ([stage 20](../build/plan.md#20-take-control)).
> While this core's link to the PF is lost, take-control holds a "Reconnecting to James" notification on the banner, and clears it once the link is back or control passes.
> While this pilot could take control, the notification's detail is the warning, so the pilot reads it before a press, on the banner and under the EFB app's button.
> Once the link is back, the old PF gets "Adam took control while you were disconnected", with the detail "What you changed in that time was undone, and your pages and FMS entries may differ from Adam's.", in place of [a pass](#a-pass)'s "Adam has control".

> **Note**
> Since 2026-11-25, [the binding](#the-binding)'s key can take Shift, Ctrl, or Alt held with it, such as Ctrl+F9, as [the Settings tab](../interface/decisions.md#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version) has it, so the first of [known limits](#known-limits) holds only for a key bound alone (user, 2026-11-25; [control log](log.md#2026-11-25-the-take-control-binding-takes-shift-ctrl-and-alt-combinations-matched-exactly)).
> A combination presses only with exactly its modifiers held, the left and right keys alike, so a bound F9 does nothing on Ctrl+F9, nor a bound Ctrl+F9 on Ctrl+Shift+F9, as stage 20c chose, and nothing presses with the Windows key held.
> A long press counts from the key's down, its modifiers already held, and the up of the key or of any of its modifiers ends it.
> On a layout with AltGr, Windows sends AltGr as the left Ctrl and the right Alt, so typing a character with AltGr can read as Ctrl+Alt and its key, and a Ctrl+Alt combination there can still take control from a text box (unverified: binding Ctrl+Alt+L on the Polish layout and typing "ł" settles it).

> **Note**
> Since 2026-11-25, the warning while the link to the PF is lost reads "If you take control, your session might desync.", under the EFB app's button with a Learn more that sends take-control's command `take-control.learn-more`, which opens the docs for pilots on taking control while the connection is down, and on the banner as "Reconnecting to James"'s detail, as [take control](../interface/decisions.md#take-control-is-a-held-button-under-the-tabs-with-one-hold-of-035s) has it (user, 2026-11-25).
> The docs, not the warning, name what follows: the PF's aircraft jumping to this pilot's when the PF reconnects.

A pilot binds one keyboard key or flight-hardware button in the desktop app, as a single press, which takes control on its down, or a long press, which takes control once it has been held 1s.
The press, or the take-control button in the EFB app or the desktop app, asks the session crate's `TakeControl`, whose guards decide, and a refused press plays a short refusal cue and shows the guards' reason on the banner.
When control passes, every machine whose pilot is in the flight plays the control-passed cue and shows who has control, with no recorded line.
The voice phrases are a Soon pick (user, 2026-10-17), so this design covers the take-control key and buttons alone ([control log](log.md#2026-10-17-research-puts-silero-vad-and-sherpa-onnx-ahead-for-recognizing-the-voice-phrases-on-the-pilots-pc-and-the-voice-phrases-move-to-soon)).

This answers node 6.12 of the [architecture plan](../architecture/plan.md#612-control), and holds only what these leave out: [03-v1-scope](../product/03-v1-scope.md#take-control-key)'s take-control key, [decision 006](../../decisions/006-core-catches-take-control-input.md), [decision 036](../../decisions/036-control-is-one-value.md)'s control value, the session crate's [control](../session/02-units.md#control), [the PF](../session/01-roles-and-members.md#the-pf)'s rules, the code map's [guards](../architecture/02-code-map.md#guards), and 6.5's [bindings](../core/04-core-helper.md#what-a-feature-registers-and-calls).

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `take-control` | Feature | The binding's two settings, a long press's timer, its slice of client state, its two sounds, and its notifications | Its crate in the core, a button in the EFB app, and a section in the desktop app |

It depends on the session, the core helper's service, and `clients`, as the code map's [features](../architecture/02-code-map.md#features) has it, and reads this core's link to the PF from the session's `status` keys ([members](../session/02-units.md#members)).
The core records every input, so the recording's replay checks take-control, as it checks every unit ([a replay](../recording/01-recording-and-bug-reports.md#a-replay); user, 2026-10-21; [recording log](../recording/log.md#2026-10-21-partial-recording-caused-three-bugs-in-stage-4s-sim-service-while-recording-every-input-costs-45-to-126-mb-an-hour)).

## What it registers

```rust
// a sketch; the hooks' names follow 6.2's and 6.5's, and the one marked is hypothetical
pub fn register(r: &mut Registry) {
    let me = r.unit::<TakeControl>("take-control");
    me.setting(setting::INPUT, Option::<Bound>::None);             // a key or a button, with its name to show
    me.setting(setting::LONG_PRESS, false);
    me.binding(setting::INPUT, TakeControl::on_press);
    me.command("take-control.request", TakeControl::request);      // the EFB app's and the desktop app's button
    me.command("take-control.bind", TakeControl::bind);            // hypothetical: turn the next press on or off
    me.client_state::<TakeControlView>("take-control", TakeControl::view);
    me.sound(sound::CONTROL_PASSED, include_bytes!("sounds/control-passed.opus"));
    me.sound(sound::REFUSED, include_bytes!("sounds/refused.opus"));
    me.on::<ControlPassed>(TakeControl::passed);
    me.on::<SessionStarted>(TakeControl::start);                  // its sounds and its binding on
    me.on::<SessionEnded>(TakeControl::stop);                     // both off
}
```

From `SessionStarted` to `SessionEnded`, take-control turns on its sounds, a want of their own, so the core helper runs through the session and the cues play for a pilot who takes control from the buttons alone ([the helper's life](../core/04-core-helper.md#the-helpers-life)).
It turns on its binding over the same span, while an input is set.

## The binding

- Two settings hold it: the input, a key or a button with the name the helper gave it, or none; and whether it takes a long press, off at first.
  The input has no default, since any key we picked may already be bound in the sim, and a pilot with nothing bound takes control from the button in the EFB app or the desktop app.
- The desktop app's section binds it.
  Bind sends `take-control.bind`, which turns on the helper's next press, and the next key or button pressed comes back to take-control, which turned it on, with its name ([what a feature registers and calls](../core/04-core-helper.md#what-a-feature-registers-and-calls)).
  Take-control puts it in its slice, and the desktop app writes it into the input setting with `clients`' settings command, as for any setting.
  That raises a setting changed, so the service sends the helper the new binding ([the moments clients raises](../core/02-clients-and-panel-bridge.md#the-moments-clients-raises-and-the-calls-it-takes)).
  Cancel turns the next press off, and Clear writes none into the input setting the same way, so a pilot can rebind or unbind mid-session.
- The section asks the pilot to make sure the key or button isn't bound in the sim, since Dual Input can't read the sim's own bindings (user, 2026-10-17).
- A bound key counts only while a window of the sim is in front, its main window or a popped-out display, so a key typed in another program takes nothing (user, 2026-10-17); a bound button counts whatever is in front, since nobody types on a yoke ([raw input](../core/04-core-helper.md#raw-input)).
- **A single press** asks for control on the binding's down.
- **A long press** starts a 1s timer on the down, through the loop's timers, and asks for control when it fires, while the button is still held; an up before then cancels it, so a tap asks for nothing.
  It keeps a brushed button from taking control.
  The hold is 1s, with no setting for it (user, 2026-10-18).

## Taking control

The binding, and the take-control button in either app, make the same request:

1. If this pilot holds control, nothing happens.
2. If this pilot isn't in the flight, or preflight hasn't ended, nothing happens and no cue plays: the take-control input is off then ([the PF](../session/01-roles-and-members.md#the-pf)), and the EFB app shows no button.
   The session crate's guard denies the request then too, so take-control checks this first, and that denial never plays the refusal cue.
3. Otherwise take-control reads the platform's verdict on `TakeControl` ([guards](../architecture/02-code-map.md#guards)).
   If a guard denies it, as the cockpit stream's does while this pilot's catch-up or replay runs over a link that's up, take-control plays the refusal cue and shows a notification with each denial's reason, and asks for nothing.
4. If the verdict allows it, take-control asks `TakeControl`, built as this pilot taking control now ([control](../session/02-units.md#control)).

- The refusal cue is how a pilot pressing hardware in VR learns of a refusal without looking at the banner.
- While this core's link to the PF is lost, a press takes control at once, with no confirming step, a catch-up running or not, since the lost-link rules apply instead ([catch-up](../sync/04-order-and-recovery.md#catch-up)).
  Once control has passed, take-control shows the warning that [while a link is lost](../network/01-between-machines.md#while-a-link-is-lost) asks for as a notification, such as "James may still be flying. If they are, their aircraft will jump to yours when he reconnects."
- Take-control's slice of client state carries the verdict with each denial's reason, the binding's name and whether it takes a long press, the next press while Bind waits for it, and, while the link to the PF is lost, the warning, so the apps' buttons show it before a press; where each shows is [6.16](../architecture/plan.md#616-the-apps)'s.

## A pass

On each `ControlPassed` that moves control from one pilot to another, every machine whose pilot is in the flight plays the control-passed cue and shows a notification naming the new PF: "You have control" on the new PF's machine, and "Adam has control" on every other.

- A pass the platform makes itself, such as when the PF leaves the flight, plays the same cue and notification, since it raises the same moment ([control](../session/02-units.md#control)).
- No recorded line plays (user, 2026-10-17), since good neutral voice lines are hard to come by, and the cue and the banner already mark the pass.
- On the machine that made the change, `ControlPassed` comes as the change is written, so its pilot hears the cue at once; the others hear it a trip later.

## Known limits

- A bound key typed into one of the sim's own text boxes, such as a search field in the EFB, takes control, since the sim's window is in front.
- An input the sim also binds does the sim's action on every press too; reading the sim's bindings to show a conflict is a Soon pick if they can be read (user, 2026-10-17; [ideas](../product/ideas.md#binding-conflicts-with-the-sim)).
- Two devices of one model share their IDs, so a button bound on one takes control from the other too ([raw input](../core/04-core-helper.md#raw-input)).
- In v1, control passes only when a pilot takes it: the PF gives it by saying so to the crew, and the other pilot presses.

## What this changes elsewhere

The text or the notes at the top of [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), [the code map](../architecture/02-code-map.md), [04-core-helper](../core/04-core-helper.md), [05-units](../sync/05-units.md), and [the spine](../architecture/01-spine.md) list what this design and the voice phrases' move to Soon change there, [the product plan](../product/plan.md) moves the pick, and a [tentative decision](../architecture/decisions.md#the-take-control-input-takes-control-on-its-down-or-held-1s-and-a-pass-plays-a-cue-and-a-notification-with-no-recorded-line) gives the reasons.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside 6.5's [budgets](../core/04-core-helper.md#budgets).

| What | Budget |
| --- | --- |
| A single press to the cue, on this machine | Under 50ms from the helper's stamp on the down, of which 6.5 gives the helper's stamp to the queue 5ms at p99, and the loop and the helper's output stream the rest |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, the stand-in sim, and a stand-in core helper:

- A single press by the PM: control passes, and both machines play the cue, the PM's notification "You have control" and the PF's "Adam has control".
- A long press held 0.9s: nothing; held 1.2s: control passes at 1s, before the release.
- A press by the PF: nothing.
- A press before preflight ends, or out of the flight: nothing, and no cue.
- A press during this pilot's catch-up: the refusal cue and a notification with the reason, and control stays.
- A press while the link to the PF is lost, with or without a catch-up running: control passes at once, and the warning shows after it; the button's slice carried it before.
- The PM's press and the PF's within 20ms: if the PM's pass hasn't reached the PF's machine, the PF's press does nothing, and each machine plays the cue once; if it has, the PF takes control back, and each plays it twice.
- The PF leaving the flight: the PM's machine plays the cue and "You have control", and the PF's, out of the flight, plays nothing.
- A pilot with no binding: the helper runs through the session, and the EFB app's button takes control with the cue.
- Bind, then a key: the key is bound by its scan code, and shown by its name; Bind, then Cancel: the binding is as before.
- Rebinding mid-session: the new key takes control, and the old one does nothing.
- The core helper killed mid-session and started again: the binding takes control as before ([cases for the bench](../core/04-core-helper.md#cases-for-the-bench)).
- The EFB app's button, while a guard denies: the refusal cue and notification, as for the key.
- A bound key typed into another program: nothing crosses; with a popped-out display in front: control passes; a bound button pressed with another program in front: control passes.

## Left open

- The two cues' sounds, which the build makes.
- The words of the notifications and the warning: [6.16](../architecture/plan.md#616-the-apps)'s.
- Whether pilots need more than a dead zone set in MSFS to keep a jittering axis from jumping its lever at a pass, which [03-v1-scope](../product/03-v1-scope.md#take-control-key) asks and v1's recordings answer.
