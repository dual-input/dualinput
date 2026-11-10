# Control: log

What we found about passing control between pilots, by the take-control key and buttons and by voice, newest entry first.

## 2026-11-10: A bound button crosses with another program in front, about 70µs after the helper's stamp

**Asked:** does a button bound for take-control cross to the core while another program has the focus, and does a switch held on while binding keep the binding to the button pressed, as [take-control's cases](01-take-control.md#cases-for-the-bench) ask of a pilot at the hardware?

**Expected:** yes to both, since the core helper reads buttons through Raw Input in sink mode, which hears them whatever window is in front.

**Found:** on our development machine, with no sim running, through `node tools/sim/core-helper.ts person 3`, in four runs ([the runs' reports](results/2026-11-10-bound-button-desk-check.txt)):

- In two runs, one on the T.A320 Pilot sidestick's button 4 and one on the Bravo Throttle Quadrant's button 1, with a quadrant switch held on, only the button pressed crossed while binding, and then nothing; and with the terminal in front, the bound button's down and up crossed 65µs to 84µs after the helper's stamp.
- In a third run, on the quadrant's button 4, the binding held, and the second press crossed nothing; the pilot likely pressed a different button the second time.
- In the first run, no press came, since the pilot was away.
- Every run's recording replayed to every checkpoint.

**Changed:** nothing.

**Affects:** nothing.

## 2026-11-04: Stage 20's take-control passes its cases on the bench, and a press reaches the cue about 80ms later, past the 50ms budget

**Asked:** do [take-control's cases](01-take-control.md#cases-for-the-bench) hold with two cores, a stand-in core helper on each, and a fake EFB app, and does a single press reach the cue within [the budget](01-take-control.md#budgets)'s 50ms of the helper's stamp?

**Expected:** yes to both, with the loop's part a fraction of a millisecond and the helper's 40ms output buffer taking most of what's left.

**Found:** ([the runs' figures](results/2026-11-04-take-control-budget.txt))

- Every case on the bench passes, with no sim, and a hold's `Play` reached the stand-in helper 350,160µs after its down.
  The design's last case isn't on the bench: its bound key, in another program and in a popped-out display, passed on the real helper in [stage 6's session](../core/log.md#2026-10-23-stage-6s-helper-passes-every-case-at-the-desk-and-in-the-sim-and-captures-within-1-of-a-core-in-opuss-audio-mode-but-never-sees-an-xbox-controllers-buttons-over-usb), and its bound button with another program in front moves to [stage 14](../build/plan.md#14-state-sync)'s session, which has a pilot at the hardware.
- The stamp to the `Play` reaching the stand-in helper took 168µs at p50 and 248µs at most, of 40 presses.
- A `Play` to a loopback of the device hearing the sound took 85ms to 88ms at p50 and 96ms to 98ms at most, on a Focusrite USB interface whose period is 10ms and whose stream kept 30ms queued at each write.
  So the budget misses at the buffer we ship.
  Writing 20ms ahead in a 22ms buffer, the least we tried, took 53ms at p50, 3ms past the budget.
  At most 20ms of that is our wait and queue, so at least 33ms is outside what we write (unverified: we infer it from these runs, and haven't split it between Windows' audio engine and the driver).
- The output thread took its commands before waiting for the device, so a sound that arrived during the wait missed that write.
  Taking them after the wait moved the three runs to 76ms to 82ms at p50 and 86ms to 89ms at most.
- A loopback hears the engine's mix, so what a USB interface or a Bluetooth headset adds after that isn't counted, and we haven't measured it.
- `node tools/sim/core-helper.ts desk`, on the real helper, found capturing a tone took 1.08% of a core against [6.5's 1%](../core/04-core-helper.md#budgets), with a binding and the mouse still on from its earlier cases.
  Its audio cases alone, in `node tools/sim/core-helper.ts audio`, took 0.49%, and 0.70% with the tone played back too.
  So listening through Raw Input costs about 0.6% (inference, from those two runs), and every session now keeps a binding on, so [stage 18](../build/plan.md#18-traffic-and-atc-audio) measures the budget that way.

Building it also found:

- A slice can't read the clients crate's state, since that crate builds the slices: the first run panicked at "unit clients read its own state through the kernel, but its handler already holds it".
- The code review found a bound key pressed while Bind waited also took control, a PF's replay of the other pilot's changes showed "Taking control disabled while you catch up" under "You have control", and Bind stayed armed on another tab, where the next key typed anywhere would have bound.
  Each is fixed.
  The bench covers the replay's line.
  The bound key's fix passes `node tools/sim/core-helper.ts desk` on the real helper, where the key already bound crossed as the next press alone, and a modifier bound nothing.
  No test runs the part's watch that ends Bind on another tab.

**Changed because of it:** the output thread takes its commands after its wait.
We left its buffer alone, since the 30ms it keeps queued is ATC audio's margin against a late thread under the sim's load, and shrinking it for a cue's 20ms would need a measurement in the sim.
The budget goes from 50ms to 100ms, which this build meets at 89ms at most, since a smaller buffer saves about 25ms on a short cue and risks ATC audio (user, 2026-11-04).
The user found the two synthesized cues basic and flat, and hasn't settled on a style for Dual Input's sounds, so they stay as stand-ins, and [stage 20b](../build/plan.md#20b-the-sounds) explores the style and makes the real ones (user, 2026-11-04).

**Docs affected:** the notes at the top of [01-take-control](01-take-control.md), [the code map](../architecture/02-code-map.md), and [04-core-helper](../core/04-core-helper.md).

## 2026-10-17: research puts Silero VAD and sherpa-onnx ahead for recognizing the voice phrases on the pilot's PC, and the voice phrases move to Soon

**Asked:** for node 6.12, which detector should tell a pilot's speech from noise, and which local recognizer should hear the 14 [voice phrases](../product/03-v1-scope.md#voice-phrases) in our core helper, a Rust program on Windows, with no audio leaving the PC, an open-source license, few false accepts, and a phrase counted only when it ends the utterance ([architecture plan, 6.12](../architecture/plan.md#612-control))?

**Expected:** a keyword spotter or a grammar-limited recognizer, since the phrases are few and fixed.

**Found:** from web sources, as of 2026-10-17 ([the research](results/2026-10-17-recognizer-research.txt)):

- Silero VAD v6.2.3, MIT, 2.3 MB, in 32ms frames at under 1ms each, called 87% of the ESC-50 noise set and 71% of a private one non-speech in its vendor's test, where WebRTC's VAD called 0% and 15%; TEN VAD's license forbids deploying it "in a way that competes with Agora's offerings".
- sherpa-onnx 1.13.8, Apache-2.0, runs both on ONNX Runtime, and its official crate links prebuilt libraries with no CMake.
  Its detector documents Silero v4 and v5, which scored 61% and 44% in the same test, so v6's figures hold for us only if it loads v6's file (unverified).
  Its default archives carry espeak-ng, which is GPL-3.0, so a build of ours would take the no-TTS shared archive, which the crate's build script doesn't fetch, through `SHERPA_ONNX_LIB_DIR` by hand (unverified).
- A full recognizer on each segment the detector closes, NVIDIA's Parakeet TDT-CTC 110M (CC-BY-4.0) or Moonshine tiny (MIT), gives the whole utterance's words, which is what counting a phrase only at its end needs; about 154 MB installed with Parakeet, an estimate since Parakeet's unpacked size wasn't found, and about 52 MB with Moonshine.
- sherpa-onnx's keyword spotter, about 6 MB, has the one published false-alarm rate found, 0.025 an hour over 40h of GigaSpeech at 86% recall with 20 commands, but fires mid-utterance, and its model is trained on GigaSpeech, whose terms say "non-commercial research and educational purposes".
- The endpointers surveyed wait from 0.1s (Silero's own segmenter) and 0.2s (Pipecat, beside a turn-detection model) to 0.5s to 1.2s (sherpa-onnx's detector, LiveKit, and Kaldi after a confident result) of silence before calling an utterance over, and 2.4s to 5.0s in streaming recognizers' defaults.
- Vosk's last Windows binaries date from 2022 and bring 45 MB of MinGW DLLs; Moonshine's own benchmark puts Whisper Tiny at 1,141ms a phrase on Linux x86, and whisper.cpp makes up words in noise and builds with CMake; Picovoice's AccessKey and per-user billing rule it out.
- No CPU figure was found for the keyword spotter or Parakeet 110M on a desktop CPU, and no accent figure for any keyword spotter or grammar recognizer.

**Changed:** the user moved the voice phrases from v1 to Soon, as a nice-to-have v1 can ship without (user, 2026-10-17), so node 6.12 picks neither, and the voice pick starts from this entry: Silero VAD and sherpa-onnx, with Parakeet, Moonshine, and the keyword spotter calibrated against our own voices and room noise, as [the product plan](../product/plan.md#6-probes-that-retire-architecture-risks) defers calibration to the build.
The recorded lines go too, with the take-control key's cue and notification marking a pass ([take-control](01-take-control.md#a-pass)).

**Affects:** [03-v1-scope](../product/03-v1-scope.md)'s voice phrases and take-control key, [the product plan](../product/plan.md)'s picks, [04-room-for-later](../product/04-room-for-later.md), [04-core-helper](../core/04-core-helper.md)'s speech, the code map's `voice` unit, and the spine's item on telling speech from noise.

**Evidence:** [results/2026-10-17-recognizer-research.txt](results/2026-10-17-recognizer-research.txt), the research's brief and its report, with a source for most facts and its totals the researcher's own sums.
