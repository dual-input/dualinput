# Control: log

What we found about passing control between pilots, by the take-control key and buttons and by voice, newest entry first.

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
The recorded lines go too, with the take-control key's cue and notice marking a pass ([take-control](01-take-control.md#a-pass)).

**Affects:** [03-v1-scope](../product/03-v1-scope.md)'s voice phrases and take-control key, [the product plan](../product/plan.md)'s picks, [04-room-for-later](../product/04-room-for-later.md), [04-core-helper](../core/04-core-helper.md)'s speech, the code map's `voice` unit, and the spine's item on telling speech from noise.

**Evidence:** [results/2026-10-17-recognizer-research.txt](results/2026-10-17-recognizer-research.txt), the research's brief and its report, with a source for most facts and its totals the researcher's own sums.
