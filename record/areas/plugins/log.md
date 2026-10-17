# Plugins: log

## 2026-10-17: The Baron's gauge settings change only through its H: events, which do other things in other modes, and QuickJS-ng's hash seed picks only a Map's or a Set's bucket

**Asked.**
What the Baron 58P's plugin has to read and write to sync the settings that live only in its gauges' JavaScript, and whether QuickJS-ng's hash seed, or anything else in the engine, makes a script behave differently in a replay.

**Expected.**
A plugin that reads each setting in its panel and writes it through an operation of our panel bridge, as [03-v1-scope](../product/03-v1-scope.md#plugins) and [01-format-and-delivery](../profiles/01-format-and-delivery.md#plugins) had it, and a seed that orders a Map's iteration.

**Found,** by reading, with nothing run ([the Baron's gauge state](results/2026-10-17-baron-gauge-state.txt), [the QuickJS-ng sandbox](results/2026-10-17-quickjs-sandbox.txt)):

- Every setting is an own property each gauge's constructor sets, saved nowhere, and changed only in the gauge's event handler, by its H: events, except the KAS 297B's armed vertical speed, which also follows the autopilot's target, and the KR 87's elapsed seconds, which count each frame while its timer runs (read in bksq-aircraft-baronpro 0.1.1, `KR87A.js`, `KAS297B.js`, `bksq_wradar1.js`).
- The same H: events do other things in other modes: on the radar's systems page they refill the oxygen, repair an engine, or set the battery voltage, and on its failures page one resets every failure; on the KAS 297B they step the altitude preselect or the autopilot's vertical speed unless its knob is pulled and vertical speed hold is off; and the ADF's frequency transfer swaps its frequencies when already in FRQ (same files, `onInteractionEvent` and `onEvent`).
  So a profile can write each setting through its events only in a write function that checks the mode, which another entry already syncs.
- The KX 155B mirrors its knob-pulled states to `L:COM_1_KNOB_PULLED` and its siblings and never reads them back, so a profile syncs them with no plugin, which contradicts 03-v1-scope's write method (read in `KX155B.js`, `onInteractionEvent`).
- The tablet restores each failure row's state at load except engine fires and the five rows that toggle a `K:` event, and does restore engine failures, which contradicts the [Baron study](../aircraft/black-square-baron-pro/study.md#persistence-and-initial-state) and its DataStorage inventory as first written (read in `BlackSquareTablet.js`, `loadFailureStates`, and the types in `populateFailureMatrix`); both are corrected.
- QuickJS-ng seeds `Math.random` and a hash seed from the wall clock when it makes a context, and reads the hash seed only in `map_hash_key`, to pick a Map's, Set's, WeakMap's, or WeakSet's bucket, while every iteration walks a list kept in insertion order (read in rquickjs-sys 0.14.0, `quickjs/quickjs.c`, `JS_NewContextRaw`, `map_hash_key`, `js_map_forEach`).
- QuickJS-ng sets its stack limit from the stack pointer when the runtime is made, and rquickjs moves it only with its `parallel` feature, so a recursion's depth at its `RangeError` turns on the Rust stack's depth at the call (read in `quickjs.c`, `update_stack_limit`, and rquickjs-core 0.14.0, `src/runtime/raw.rs`); inferred, not run.

**What changed.**
v1 builds no plugins: a profile reads a gauge's setting through a new name, `instrument()`, and writes it through the gauge's H: events, and the sandbox deletes `Math.random` and pins the stack's top at each call ([plugins and the sandbox](01-plugins.md)).

**Docs affected.**
[Plugins and the sandbox](01-plugins.md), and those its [what this changes elsewhere](01-plugins.md#what-this-changes-elsewhere) lists.
