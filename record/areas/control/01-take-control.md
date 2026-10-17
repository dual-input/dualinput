# Control: take-control

```text
Purpose:     How a pilot takes control with a bound key or hardware button, or with a button in the EFB app or the desktop app, and what each machine shows when control passes.
Depends on:  ../product/03-v1-scope.md, ../architecture/02-code-map.md, ../core/02-clients-and-panel-bridge.md, ../core/04-core-helper.md, ../session/01-roles-and-members.md, ../session/02-units.md, ../network/01-between-machines.md, log.md
Decides:     How a pilot binds the key or button, as a single or a long press; how a press, or a button in the apps, asks for control; what a pilot gets when the guards refuse, and when the link to the PF is lost; what marks a pass on each machine; the budgets; and the cases for the bench (node 6.12).
```

A pilot binds one keyboard key or flight-hardware button in the desktop app, as a single press, which takes control on its down, or a long press, which takes control once it has been held 1s.
The press, or the take-control button in the EFB app or the desktop app, asks the session crate's `TakeControl`, whose guards decide, and a refused press plays a short refusal cue and shows the guards' reason on the banner.
When control passes, every machine whose pilot is in the flight plays the control-passed cue and shows who has control, with no recorded line.
The voice phrases left v1 for Soon on 2026-10-17, so this design holds the take-control key and buttons alone ([control log](log.md#2026-10-17-research-puts-silero-vad-and-sherpa-onnx-ahead-for-recognizing-the-voice-phrases-on-the-pilots-pc-and-the-voice-phrases-move-to-soon)).

This answers node 6.12 of the [architecture plan](../architecture/plan.md#612-control), and holds only what these leave out: [03-v1-scope](../product/03-v1-scope.md#take-control-key)'s take-control key, [decision 006](../../decisions/006-core-catches-take-control-input.md), [decision 036](../../decisions/036-control-is-one-value.md)'s control value, the session crate's [control](../session/02-units.md#control), [the PF](../session/01-roles-and-members.md#the-pf)'s rules, the code map's [guards](../architecture/02-code-map.md#guards), and 6.5's [bindings](../core/04-core-helper.md#what-a-feature-registers-and-calls).

## The units

| Unit | Tier | Holds | Runs |
| --- | --- | --- | --- |
| `take-control` | Feature | The binding's two settings, a long press's timer, its slice of client state, its two sounds, and its notices | Its crate in the core, a button in the EFB app, and a section in the desktop app |

It depends on the session, the core helper's service, and `clients`, as the code map's [features](../architecture/02-code-map.md#features) has it, and reads the session's `status` keys for this core's link to the PF ([members](../session/02-units.md#members)).
It has no unrecorded input, so a replay checks it ([a replay](../recording/01-recording-and-bug-reports.md#a-replay)).

## What it registers

```rust
// a sketch; the hooks' names follow 6.2's and 6.5's, and those marked are hypothetical
pub fn register(r: &mut Registry) {
    let me = r.unit::<TakeControl>("take-control");
    me.setting(setting::INPUT, Option::<Bound>::None);             // a key or a button, with its name to show
    me.setting(setting::LONG_PRESS, false);
    me.binding(setting::INPUT, TakeControl::on_press);
    me.command("take-control.request", TakeControl::request);      // the EFB app's and the desktop app's button
    me.command("take-control.bind", TakeControl::bind);            // hypothetical: start or cancel the next press
    me.client_state::<TakeControlView>("take-control", TakeControl::view);
    me.sound(sound::CONTROL_PASSED, include_bytes!("sounds/control-passed.opus"));
    me.sound(sound::REFUSED, include_bytes!("sounds/refused.opus"));
    me.on::<ControlPassed>(TakeControl::passed);
    me.on::<SessionStarted>(TakeControl::watch_binding);
    me.on::<SessionEnded>(TakeControl::unwatch_binding);
}
```

- It turns its binding on for the whole of a session, which keeps the core helper running then, as [the helper's life](../core/04-core-helper.md#the-helpers-life) has it, and off when the session ends.

## The binding

- Two settings hold it: the input, a key or a button with the name the helper gave it, or none; and whether it takes a long press.
  Neither has a default, since any key we picked may already be bound in the sim, and a pilot with nothing bound takes control from the EFB app's button.
- The desktop app's section binds it: its Bind button sends `take-control.bind`, which turns on the helper's next press, and the next key or button pressed comes back with its name, which take-control writes into the input setting ([what a feature registers and calls](../core/04-core-helper.md#what-a-feature-registers-and-calls)).
  Cancel turns the next press off, and Clear sets the input to none.
- The input setting changing makes the core helper's service send the helper its wants again ([the moments clients raises](../core/02-clients-and-panel-bridge.md#the-moments-clients-raises-and-the-calls-it-takes)), so a pilot can rebind mid-session.
- **A single press** asks for control on the binding's down.
- **A long press** starts a 1s timer on the down, through the loop's timers, and asks for control when it fires, while the button is still held; an up before then cancels it, so a tap asks for nothing.
  So a pilot can bind take-control to a button the sim also uses, such as the autopilot disconnect on the yoke: the helper reads the press without taking it from the sim ([raw input](../core/04-core-helper.md#raw-input)), so a tap disconnects the autopilot alone, and a hold also takes control, as an Airbus sidestick's takeover pushbutton does both when held.
  It also keeps a brushed button from taking control.
- A binding's later downs while one press is held change nothing, since the helper reports a key's press once however long it's held.

## Taking control

The binding, and the take-control button in either app, make the same request:

1. If this pilot holds control, nothing happens.
2. If this pilot isn't in the flight, or preflight hasn't ended, nothing happens, since the core ignores the take-control input then ([the PF](../session/01-roles-and-members.md#the-pf)); the EFB app shows no button then.
3. Otherwise take-control reads the platform's verdict on `TakeControl`, which the platform keeps after every input ([guards](../architecture/02-code-map.md#guards)).
   If a guard denies it, as the cockpit stream's does while this pilot's catch-up or replay runs over a link that's up, take-control plays the refusal cue and shows a notice with each denial's reason, and asks for nothing.
4. If the verdict allows it, take-control asks `TakeControl`, built as this pilot taking control now ([control](../session/02-units.md#control)).

- A pilot pressing hardware in VR gets the refusal cue as the one sign of a refusal that comes before any look at the banner.
- While this core's link to the PF is lost, a press takes control at once, with no confirming step, and take-control shows the warning [while a link is lost](../network/01-between-machines.md#while-a-link-is-lost) asks for, such as "James may still be flying. If he is, his aircraft will jump to yours when he reconnects.", as a notice once control has passed.
  Its slice carries the same warning beforehand, so the apps' buttons show it before the pilot presses.
- The slice carries the verdict, with each denial's reason, the warning, and the binding's name and whether it takes a long press; where each shows is [6.16](../architecture/plan.md#616-the-apps)'s.

## A pass

On each `ControlPassed` whose `before` names a PF, every machine whose pilot is in the flight plays the control-passed cue and shows a notice naming the new PF: "You have control" on the new PF's machine, and "Adam has control" on every other.

- A pass the platform makes itself, such as when the PF leaves the flight, plays the same cue and notice, since it raises the same moment ([control](../session/02-units.md#control)).
- No recorded line plays, where [03-v1-scope](../product/03-v1-scope.md#take-control-key) has the new PF hear "you have control" and the old one "they have control" (user, 2026-10-17): good neutral voice lines are hard to come by, and the cue and the banner already mark the pass.
- On the machine that made the change, `ControlPassed` comes as the change is written, so its pilot hears the cue at once; the others hear it a trip later.
- Two pilots who take control within one trip of each other each get their own pass first, then the winner's by pilot ID ([control](../network/01-between-machines.md#control)), so the loser's machine plays the cue twice, the second notice naming the winner.

## Known limits

- A binding on a button the sim also uses does the sim's action on every press, a long press's included, since the helper never takes a press from the sim.
- Two devices of one model share their IDs, so a button bound on one takes control from the other too ([raw input](../core/04-core-helper.md#raw-input)).

## What this changes elsewhere

The notes at the top of [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), [the code map](../architecture/02-code-map.md), [04-core-helper](../core/04-core-helper.md), and [the spine](../architecture/01-spine.md) list what this design and the voice phrases' move to Soon change there, [the product plan](../product/plan.md) moves the pick, and a [tentative decision](../architecture/decisions.md#the-take-control-input-takes-control-on-its-down-or-held-1s-and-a-pass-plays-a-cue-and-a-notice-with-no-recorded-line) gives the reasons.

## Budgets

Each is a starting value, which [node 7](../architecture/plan.md#7-testing)'s bench measures, beside 6.5's [budgets](../core/04-core-helper.md#budgets).

| What | Budget |
| --- | --- |
| A single press to the cue, on this machine | Under 50ms from the helper's stamp on the down: 5ms on the pipe at p99, the loop, and the helper's output stream |
| A long press | Asks 1s after its down, as late as the loop's timer wakes, which a high-resolution waitable timer kept within 1.5ms (measured on our development machine, 2026-10-15, [core log](../core/log.md#2026-10-15-a-high-resolution-waitable-timer-wakes-within-15ms-where-tokios-wake-up-to-17ms-late-and-the-cores-math-changes-with-the-c-runtimes-fma3-switch-and-with-its-version)) |

## Cases for the bench

[Node 7](../architecture/plan.md#7-testing) turns each into a test, with two cores, the stand-in sim, and a stand-in core helper:

- A single press by the PM: control passes, and both machines play the cue, the PM's notice "You have control" and the PF's "Adam has control".
- A long press held 0.9s: nothing; held 1.2s: control passes at 1s, before the release.
- A press by the PF: nothing.
- A press before preflight ends, or out of the flight: nothing, and no cue.
- A press during this pilot's catch-up: the refusal cue and a notice with the reason, and control stays.
- A press while the link to the PF is lost: control passes at once, and the warning shows after it; the button's slice carried it before.
- Both pilots pressing within 20ms: both machines end with one PF, by pilot ID, and the loser's machine plays the cue twice.
- The PF leaving the flight: the PM's machine plays the cue and "You have control", and the PF's, out of the flight, plays nothing.
- The desktop app's Bind, then a key: the key is bound by its name; Bind, then Cancel: the binding is as before.
- Rebinding mid-session: the new key takes control, and the old one does nothing.
- The core helper killed mid-session and started again: the binding takes control as before ([cases for the bench](../core/04-core-helper.md#cases-for-the-bench)).
- The EFB app's button, while a guard denies: the refusal cue and notice, as for the key.

In the sim:

- A long press on the 58P's yoke's autopilot disconnect: a tap disconnects the autopilot alone, and a hold takes control too.

## Left open

- The two cues' sounds, made in the build, and the words of the notices and the warning: [6.16](../architecture/plan.md#616-the-apps)'s.
- Whether pilots need more than a dead zone set in MSFS to keep a jittering axis from jumping its lever at a pass, which [03-v1-scope](../product/03-v1-scope.md#take-control-key) asks, from v1's recordings.
