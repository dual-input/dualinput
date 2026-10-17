# Control: take-control

```text
Purpose:     How a pilot takes control with a bound key or hardware button, or with a button in the EFB app or the desktop app, and what each machine shows when control passes.
Depends on:  ../product/03-v1-scope.md, ../architecture/02-code-map.md, ../core/02-clients-and-panel-bridge.md, ../core/04-core-helper.md, ../session/01-roles-and-members.md, ../session/02-units.md, ../network/01-between-machines.md, ../sync/04-order-and-recovery.md, log.md
Decides:     How a pilot binds the key or button, as a single or a long press; how a press, or a button in the apps, asks for control; what a pilot gets when the guards refuse, and when the link to the PF is lost; what marks a pass on each machine; the budgets; and the cases for the bench (node 6.12).
```

A pilot binds one keyboard key or flight-hardware button in the desktop app, as a single press, which takes control on its down, or a long press, which takes control once it has been held 1s.
The press, or the take-control button in the EFB app or the desktop app, asks the session crate's `TakeControl`, whose guards decide, and a refused press plays a short refusal cue and shows the guards' reason on the banner.
When control passes, every machine whose pilot is in the flight plays the control-passed cue and shows who has control, with no recorded line.
The voice phrases are a Soon pick (user, 2026-10-17), so this design covers the take-control key and buttons alone ([control log](log.md#2026-10-17-research-puts-silero-vad-and-sherpa-onnx-ahead-for-recognizing-the-voice-phrases-on-the-pilots-pc-and-the-voice-phrases-move-to-soon)).

This answers node 6.12 of the [architecture plan](../architecture/plan.md#612-control), and holds only what these leave out: [03-v1-scope](../product/03-v1-scope.md#take-control-key)'s take-control key, [decision 006](../../decisions/006-core-catches-take-control-input.md), [decision 036](../../decisions/036-control-is-one-value.md)'s control value, the session crate's [control](../session/02-units.md#control), [the PF](../session/01-roles-and-members.md#the-pf)'s rules, the code map's [guards](../architecture/02-code-map.md#guards), and 6.5's [bindings](../core/04-core-helper.md#what-a-feature-registers-and-calls).

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `take-control` | Feature | The binding's two settings, a long press's timer, its slice of client state, its two sounds, and its notices | Its crate in the core, a button in the EFB app, and a section in the desktop app |

It depends on the session, the core helper's service, and `clients`, as the code map's [features](../architecture/02-code-map.md#features) has it, and reads this core's link to the PF from the session's `status` keys ([members](../session/02-units.md#members)).
It has no unrecorded input, so the recording's replay checks it ([a replay](../recording/01-recording-and-bug-reports.md#a-replay)).

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
    me.on::<SessionStarted>(TakeControl::watch_binding);
    me.on::<SessionEnded>(TakeControl::unwatch_binding);
}
```

It watches its binding from `SessionStarted` to `SessionEnded`, with or without an input set.
A watched binding is a want that's on, so the core helper runs through the session, and the cues play for a pilot who takes control from the buttons alone ([the helper's life](../core/04-core-helper.md#the-helpers-life)).

## The binding

- Two settings hold it: the input, a key or a button with the name the helper gave it, or none; and whether it takes a long press, off at first.
  The input has no default, since any key we picked may already be bound in the sim, and a pilot with nothing bound takes control from the button in the EFB app or the desktop app.
- The desktop app's section binds it.
  Bind sends `take-control.bind`, which turns on the helper's next press, and the next key or button pressed comes back to take-control, which turned it on, with its name ([what a feature registers and calls](../core/04-core-helper.md#what-a-feature-registers-and-calls)).
  Take-control puts it in its slice, and the desktop app writes it into the input setting with `clients`' settings command, as for any setting.
  That raises a setting changed, so the service sends the helper the new binding ([the moments clients raises](../core/02-clients-and-panel-bridge.md#the-moments-clients-raises-and-the-calls-it-takes)).
  Cancel turns the next press off, and Clear writes none into the input setting the same way, so a pilot can rebind or unbind mid-session.
- The section asks the pilot to make sure the key or button isn't bound in the sim, since Crosscheck can't read the sim's own bindings (user, 2026-10-17).
- A bound key counts only while a window of the sim is in front, its main window or a popped-out display, so a key typed in another program takes nothing (user, 2026-10-17); a bound button counts whatever is in front, since nobody types on a yoke ([raw input](../core/04-core-helper.md#raw-input)).
- **A single press** asks for control on the binding's down.
- **A long press** starts a 1s timer on the down, through the loop's timers, and asks for control when it fires, while the button is still held; an up before then cancels it, so a tap asks for nothing.
  It keeps a brushed button from taking control.

## Taking control

The binding, and the take-control button in either app, make the same request:

1. If this pilot holds control, nothing happens.
2. If this pilot isn't in the flight, or preflight hasn't ended, nothing happens and no cue plays: the take-control input is off then ([the PF](../session/01-roles-and-members.md#the-pf)), and the EFB app shows no button.
   The session crate's guard denies the request then too, so take-control checks this first, and that denial never plays the refusal cue.
3. Otherwise take-control reads the platform's verdict on `TakeControl` ([guards](../architecture/02-code-map.md#guards)).
   If a guard denies it, as the cockpit stream's does while this pilot's catch-up or replay runs over a link that's up, take-control plays the refusal cue and shows a notice with each denial's reason, and asks for nothing.
4. If the verdict allows it, take-control asks `TakeControl`, built as this pilot taking control now ([control](../session/02-units.md#control)).

- The refusal cue is how a pilot pressing hardware in VR learns of a refusal without looking at the banner.
- While this core's link to the PF is lost, a press takes control at once, with no confirming step, a catch-up running or not, since the lost-link rules apply instead ([catch-up](../sync/04-order-and-recovery.md#catch-up)).
  Once control has passed, take-control shows the warning that [while a link is lost](../network/01-between-machines.md#while-a-link-is-lost) asks for as a notice, such as "James may still be flying. If he is, his aircraft will jump to yours when he reconnects."
- Take-control's slice of client state carries the verdict with each denial's reason, the binding's name and whether it takes a long press, the next press while Bind waits for it, and, while the link to the PF is lost, the warning, so the apps' buttons show it before a press; where each shows is [6.16](../architecture/plan.md#616-the-apps)'s.

## A pass

On each `ControlPassed` that moves control from one pilot to another, every machine whose pilot is in the flight plays the control-passed cue and shows a notice naming the new PF: "You have control" on the new PF's machine, and "Adam has control" on every other.

- A pass the platform makes itself, such as when the PF leaves the flight, plays the same cue and notice, since it raises the same moment ([control](../session/02-units.md#control)).
- No recorded line plays (user, 2026-10-17), since good neutral voice lines are hard to come by, and the cue and the banner already mark the pass.
- On the machine that made the change, `ControlPassed` comes as the change is written, so its pilot hears the cue at once; the others hear it a trip later.

## Known limits

- A bound key typed into one of the sim's own text boxes, such as a search field in the EFB, takes control, since the sim's window is in front.
- An input the sim also binds does the sim's action on every press too; reading the sim's bindings to show a conflict is a Soon pick if they can be read (user, 2026-10-17; [ideas](../product/ideas.md#binding-conflicts-with-the-sim)).
- Two devices of one model share their IDs, so a button bound on one takes control from the other too ([raw input](../core/04-core-helper.md#raw-input)).
- In v1, control passes only when a pilot takes it: the PF gives it by saying so to the crew, and the other pilot presses.

## What this changes elsewhere

The notes at the top of [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), [the code map](../architecture/02-code-map.md), [04-core-helper](../core/04-core-helper.md), [05-units](../sync/05-units.md), and [the spine](../architecture/01-spine.md) list what this design and the voice phrases' move to Soon change there, [the product plan](../product/plan.md) moves the pick, and a [tentative decision](../architecture/decisions.md#the-take-control-input-takes-control-on-its-down-or-held-1s-and-a-pass-plays-a-cue-and-a-notice-with-no-recorded-line) gives the reasons.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside 6.5's [budgets](../core/04-core-helper.md#budgets).

| What | Budget |
| --- | --- |
| A single press to the cue, on this machine | Under 50ms from the helper's stamp on the down, of which 6.5 gives the helper's stamp to the queue 5ms at p99, and the loop and the helper's output stream the rest |
| A long press | Asks 1s after its down, plus the loop timer's lateness, which a high-resolution waitable timer kept within 1.5ms with the sim closed and the PC otherwise idle (measured on our development machine, 2026-10-15, [core log](../core/log.md#2026-10-15-a-high-resolution-waitable-timer-wakes-within-15ms-where-tokios-wake-up-to-17ms-late-and-the-cores-math-changes-with-the-c-runtimes-fma3-switch-and-with-its-version)); with the sim running it's unmeasured |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, the stand-in sim, and a stand-in core helper:

- A single press by the PM: control passes, and both machines play the cue, the PM's notice "You have control" and the PF's "Adam has control".
- A long press held 0.9s: nothing; held 1.2s: control passes at 1s, before the release.
- A press by the PF: nothing.
- A press before preflight ends, or out of the flight: nothing, and no cue.
- A press during this pilot's catch-up: the refusal cue and a notice with the reason, and control stays.
- A press while the link to the PF is lost, with or without a catch-up running: control passes at once, and the warning shows after it; the button's slice carried it before.
- The PM's press and the PF's within 20ms: if the PM's pass hasn't reached the PF's machine, the PF's press does nothing, and each machine plays the cue once; if it has, the PF takes control back, and each plays it twice.
- The PF leaving the flight: the PM's machine plays the cue and "You have control", and the PF's, out of the flight, plays nothing.
- A pilot with no binding: the helper runs through the session, and the EFB app's button takes control with the cue.
- Bind, then a key: the key is bound by its scan code, and shown by its name; Bind, then Cancel: the binding is as before.
- Rebinding mid-session: the new key takes control, and the old one does nothing.
- The core helper killed mid-session and started again: the binding takes control as before ([cases for the bench](../core/04-core-helper.md#cases-for-the-bench)).
- The EFB app's button, while a guard denies: the refusal cue and notice, as for the key.
- A bound key typed into another program: nothing crosses; with a popped-out display in front: control passes; a bound button pressed with another program in front: control passes.

## Left open

- The two cues' sounds, which the build makes.
- The words of the notices and the warning: [6.16](../architecture/plan.md#616-the-apps)'s.
- Whether pilots need more than a dead zone set in MSFS to keep a jittering axis from jumping its lever at a pass, which [03-v1-scope](../product/03-v1-scope.md#take-control-key) asks and v1's recordings answer.
