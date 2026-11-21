# Profiles: log

What our experiments and the build found about building profiles' bundles and delivering them to pilots, newest entry first.
TypeScript's own compiler type-checks and compiles inside the QuickJS-ng we embed, with the same results as under Node, in about 0.66s for a profile of 300 write functions once it's loaded, which takes 0.24s.
GitHub Pages answers a repeat fetch of an unchanged file with a 304 and no body.
The sandbox's context runs QuickJS-ng's base objects and lacks JSON, Map, Set, Date, and Promise, which level 1's declarations follow.
The probes are [p01-pages-conditional.mjs](../../../experiments/areas/profiles/p01-pages-conditional.mjs), [p02-typescript-in-quickjs.mjs](../../../experiments/areas/profiles/p02-typescript-in-quickjs.mjs), and [p03-sandbox-globals.mjs](../../../experiments/areas/profiles/p03-sandbox-globals.mjs), and their raw output is in [experiments/areas/profiles/results](../../../experiments/areas/profiles/results).
None needs the sim.

## 2026-11-21: The format's audit before level 1 freezes puts maps on their own lines, types instrument readings, and names one layout

**Asked:** what does an ordinary profile run into at level 1 that we'd change before v1's release freezes the level ([stage 22c](../build/plan.md#22c-the-formats-audit))?
And should CI's check that a released level's files match its release tag hold them to 0.1.0, the one release so far?

**Expected:** a few unclear errors, since the 58P's profile had built and flown since stage 14.

**Found:** reading the format's design docs, the profile engine, the builder, the 58P's profile, and fsc-editor's `docs/profile-format.md`, and building test profiles on our development machine:

- A map in YAML's bracketed form, `write: {toggle: K('ELECTRICAL_BUS_TO_BUS_CONNECTION_TOGGLE', 2, 6)}`, failed with "Each key in a profile is text", because YAML splits a bracketed map at its commas and the name's values became keys.
  [Writing](01-format-and-delivery.md#writing)'s example, `write: {toggle: K('TOGGLE_BEACON_LIGHTS')}`, and the ADF sketch in [01-plugins](../plugins/01-plugins.md#the-58ps-state-in-its-gauges) both use that form, and the 58P's profile wrote 32 of its toggles in it, and its 10 toggles with values on their own lines.
- A file that starts with a UTF-8 byte-order mark failed at its first key, which the parser read with the mark in front, so `maker` read as an unknown block and the profile as missing `maker`.
  Windows PowerShell 5.1's `Set-Content -Encoding utf8` wrote one into our first test file.
- A write function comparing an `instrument()` entry, `value > state.knob`, failed its type check with TS18046, since level 1's declarations type that entry `unknown`, and the 58P's profile wraps each such value in `Number()`.
- The aircraft picker shows one tile per profile and loads the first installed variant it covers (`src/platform/profile-loader/src/lib.rs`, `pick`).
  Each variant's own `aircraft.cfg` names it in `ui_type`: "Baron 58 Professional", "Baron 58TC Professional", and "Baron 58P Professional" (read in bksq-aircraft-baronpro 0.1.1, each variant's `SimObjects\Airplanes\<folder>\aircraft.cfg`).
- The format names no layout for a formatter to write, and the 58P's profile puts `displays` and `seats` before `state`, where a bundle puts them last.
  Its headings hold as written: `# ═══ TITLE` and `# ── Title` are comments to the parser, in fsc-editor's convention.
- Level 1's one schema, `schema.json`, required only a seat's fields, offered `aircraft`, `maker`, `only`, and `location` in a module, and let an event entry count, toggle, or step, each of which the checker refuses.
- The checker's rules live in the engine's code, which CI's frozen-level check doesn't compare, so a release that loosens one, letting a module use `only`, say, would publish a level-1 bundle that every core on an earlier release refuses.
  FS Copilot's fork did that with its `pointer:` key, which "bricks profile loading on older releases" (FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`, item 6).
- A profile with CRLF line ends built to the same bytes as with LF.

**Changed** (user, 2026-11-21):

- A map in a profile goes on its own lines: the reader refuses a bracketed map anywhere, with an error that shows the map written out, and a list keeps both forms.
- The reader skips a leading byte-order mark.
- `instrument(key, path)` reads a number and `instrument(key, path, 'string')` reads text, each typed to match in a write function, and the panel module reports a reading of the other kind as an error.
- The format names one layout, and a bundle's top-level keys come in its order ([layout](01-format-and-delivery.md#layout)).
- Each level has two schemas, `profile.json` and `module.json`, each with its required fields, and an event entry's fields only as the checker takes them; an editor picks one by the file's folder, as the builder takes a file in `profiles/aircraft/` as a profile and one it imports as a module.
- A release that lets a profile do what a level's checker refused raises the level, as a new field does.
- A profile's variants share its `name`, and once a profile has a second variant, the picker asks which one to load, naming each by its `ui_type`; v1's aircraft is the 58P alone, so nothing changes for v1.
- CI holds a level's files only to release tags from 1.0.0 on, since nobody flies a release before it, and publishing still counts every release's level as released, so 0.x releases get the tree's profiles (`tools/lib/levels.ts`).

**Affects:** [01-format-and-delivery](01-format-and-delivery.md), [02-units](02-units.md), [01-plugins](../plugins/01-plugins.md), the code map's [profiles in this repository](../architecture/02-code-map.md#profiles-in-this-repository), and the architecture's tentative decision that [one repository holds all of Dual Input](../architecture/decisions.md#one-repository-holds-all-of-dual-input-its-folders-by-tier-with-each-features-parts-in-one-folder).

## 2026-10-24: Stage 10's profiles pass the stage's bench cases, load a 221 KB bundle in one input under 730µs, and build one of 300 write functions in 1.7s

**Asked:** do [stage 10](../build/plan.md#10-profiles)'s cases and budgets hold on its code: [the profiles' cases for the bench](02-units.md#cases-for-the-bench), the builder's own, two of the session's, and the budgets for a build, a load, and a start with nothing new?

**Expected:** each case as designed, and each budget inside, with the load the closest, since it decodes the whole profile on the loop.

**Found:** on our development machine, with the bench's profile `release-with-checks`, the PC holding no game and a torrent client using about 1.5% of a core:

- All 13 cases of `tools/bench/scenarios/profiles.ts` passed, each ending in a replay of every core's recording that matched its run, the first case's replay logging the same load as the run.
  They covered the 11 cases, a bundle whose fetch failed at start fetched again at Host, which the code review added, the session's case of a wrong aircraft whose pin follows the aircraft, and its case of an aircraft with no profile, which shows "No profile for this aircraft" as an error.
- The whole bench ran 77 cases and failed 1, a clients case comparing a settings file it wrote with the core's write of it, which the bench's start of a core had written over (below); with that fixed, its scenario passed, and the 30 cases of the scenarios that start a core again on its data folder passed too.
  After the code review's fixes, `node tools/check.ts` passed, and the profiles' scenario, the one they reach, passed its 13 cases.
- **A load on the loop:** the 221,156-byte bundle of 300 write functions loaded in an input under 730µs, the run's slowest being the core's start, at 699µs to 730µs over three runs, against the code map's 1ms.
  Its first run took 1,055µs in that one input, which `resolve` spent in part copying every entry's JavaScript for this pilot's variant; it moves them instead.
- **A build:** the builder built that profile in 1,714ms to 1,782ms over four runs, its process's start and the compiler's 280ms load included, against 2s, inside the 128 MB QuickJS-ng holds the compiler to, on an 8 MB stack.
  TypeScript's type check took 642ms of it, as p02's 300 functions did; compiling each script in a call of its own took 1.2s more, until the builder compiled every script in one call.
- **A start with nothing new:** the second start of a core on its data folder fetched only `index.json`, answered with a 304 and no body.

The build changed or settled ten things the record didn't say:

- The builder program's `publish` takes `--released <level>`, the highest level a release supports, which stage 22's workflow reads from the release tags, `--pages <folder>`, and `--profiles <folder>`; and a `levels` command writes each level's files, which `tools/check.ts` runs and compares, as it does the messages' types.
- The local folder is listed at start, at each session, whenever the session's aircraft changes, and when its setting changes, where [the local folder](02-units.md#the-local-folder) lists it at each choice and lookup; a new local bundle takes effect when the design says it does.
- The pilot flying's choice waits for the cache's folder and the local folder to be listed, so a bundle already on disk isn't pinned as none first.
- A pin the session crate refuses is asked for again in a later input, not once ever.
- The match check's item reads "No profile for this aircraft", "Couldn't get the session's profile:" and the members' names, and "The pilots loaded different profiles", until the apps' stage words it; the session crate gains `clear_match`, so a member whose profile is loading shows no value.
- The profile engine depends on no crate of ours, where the code map allows it the message crate.
- The case of a job's result arriving after its member left the flight runs as a fetch the bench's site holds back, since the read of a cached bundle finishes too quickly to hold.
- The bench's site serves what the builder's `publish` lays out, from the tree's profiles at each bench run; a core the scenario gives no site fetches from a closed port on this PC, so no bench core reaches the internet; and the bench's start of a core merges into a settings file already in its data folder, where it replaced it.
- The clients' test unit keeps only its picks of instruments, and the clients' scenarios load the tree's 58P profile through a flight in the Baron; the session's scenarios fly the Baron too, so their cores load the profile and raise the clients crate's notification that no panel connected.
- A profile's file is named for its developer and aircraft, as `bksq-baronpro.yaml`, which reviews check by eye (user, 2026-10-24; [the repository](01-format-and-delivery.md#the-repository)).

The code review found the rest:

- A bundle whose fetch failed at start was never fetched again, so a pilot offline at sim start flew with "No profile for this aircraft" until the core restarted; a new session fetches it again, as [fetching](02-units.md#fetching) has it.
- `publish` took a bare folder in one profile and a preset in it in another for two aircraft; it refuses them, since a folder covers every preset in it.
- The index's ETag could go out with an index that never loaded; it goes out only with one, and is written once the index is.
- A bundle published again after a newer one at a higher level kept that level on the newer one; it replaces it.
- The registration through which a feature's module adds a block or a field of an entry comes with avatars' module in stage 17, its first user, so its shape fits a real block, where stage 10's lines had it here (user, 2026-10-24).
- TypeScript's type for a chain's pace passes paces the format refuses, so the sync engine fails a write whose chain's pace doesn't read as one (user, 2026-10-24; [pace](01-format-and-delivery.md#pace)).

**Changed:** nothing beyond the lists above.

**Affects:** [the profiles' units](02-units.md), [the format](01-format-and-delivery.md)'s pace and repository, and [the build plan](../build/plan.md)'s stages 10 and 17.

**Evidence:** [results/2026-10-24-stage-10-whole-bench.txt](results/2026-10-24-stage-10-whole-bench.txt).

## 2026-10-24: The sandbox's context runs QuickJS-ng's base objects, past ES2020, without JSON, Map, Set, Date, or Promise, and level 1 types write functions by exactly what it runs

**Asked:** what a write function can use in the sandbox, whose context holds QuickJS-ng's base objects and, of rquickjs's intrinsics, `Eval` and `RegExp` alone ([the sandbox](../plugins/01-plugins.md#the-sandbox)), so level 1's declarations, the scripts' whole world under `noLib`, can name exactly that.
Building stage 10, the declarations held only the ten global types TypeScript needs, as empty interfaces, so a write function couldn't type-check `Math.round` or an array's `map`.

**Expected:** ES2020's built-ins, less the intrinsics the context leaves out.

**Found:** p03 made a context that way, through rquickjs 0.14.0, deleted `Math.random` and `queueMicrotask` as the sandbox does, and listed every global with its own properties and its prototype's ([results](../../../experiments/areas/profiles/results/p03-sandbox-globals-2026-10-24-11-03-31.txt)):

- It defines `Object`, `Function`, `Array`, `String`, `Number`, `Boolean`, `Symbol`, `BigInt`, `Math`, `Reflect`, `RegExp`, `Iterator`, `DisposableStack`, `Error` and its kinds, and the global functions such as `parseInt`, `isNaN`, and `encodeURIComponent`.
- Their members run past ES2020: `Object.groupBy`, `Array.prototype.toSorted`, `String.prototype.isWellFormed`, the iterator helpers, and `Math.sumPrecise`.
- It lacks `JSON`, `Map`, `Set`, `WeakMap`, `Date`, `Promise`, `Proxy`, the typed arrays, and `WeakRef`.
- A regex literal, a generator, `for of`, and spread ran.

**Changed:** level 1's declarations open with every global the context defines, and only the members it defines, typed by TypeScript 6.0.3's own library declarations, so a write function gets the whole of the JavaScript the sandbox runs, and one that names what it lacks fails its type check (user, 2026-10-24).
`tools/javascript-types.ts` generates them from TypeScript's libraries and p03's list, which `src/engines/profile-engine/javascript/sandbox.json` keeps, dropping each member or type that names a missing global, as `Array.fromAsync` names `Promise`.
The file is 3,174 lines, and marks itself as a default library, so TypeScript allows its `intrinsic` types and skips checking it on each build.
Stage 12's sandbox gets a test that its context defines exactly that list.
After the JavaScript come the names, `write()`, and the chain, and neither `instrument()`, which a write function may not call, nor `aircraft`, which [the profiles' units](02-units.md#levels) listed but the format never defined (user, 2026-10-24).

**Affects:** [the profiles' units](02-units.md#levels), whose declarations held the ten global types; [the build plan](../build/plan.md)'s stages 10 and 12.

## 2026-10-16: TypeScript 6.0.3's compiler type-checks and compiles inside QuickJS-ng, as under Node, in 0.9s for 300 write functions, on a 1 MB stack

**Asked:** the profile builder type-checks a profile's write functions and its plugin against our declarations, and compiles the plugin to JavaScript ([01-format-and-delivery](01-format-and-delivery.md#levels)).
Can TypeScript's own compiler, `typescript.js`, do that inside the QuickJS-ng that rquickjs embeds, so the builder needs no Node and no second program, and how long, how much memory, and how much stack does it take?

**Expected:** that it runs, since it's plain JavaScript, but slower than under Node, whose V8 compiles it to machine code.

**Found:** p02 loaded TypeScript 6.0.3's `typescript.js` into one QuickJS-ng runtime through rquickjs 0.14.0, and ran each project 5 times on it, in memory, with `noLib` and a lib of our own in place of TypeScript's, at target `ES2020`.
It ran unmodified.

| Project | Load | Each check and emit | Memory | Under Node, same driver |
| --- | --- | --- | --- | --- |
| A plugin of two functions, one passing a string where `write()` takes a number | 241ms | 7.3ms to 7.8ms | 35.2 MB | 3.0ms to 51.7ms |
| 300 write functions, 51,172 bytes, one reading a key the state doesn't have | 242ms | 655ms to 678ms | 57.1 MB | 40.8ms to 120.1ms |

- Both reported the error each project holds, `TS2345` and `TS2339`, at its line and column, and QuickJS-ng's diagnostics and emitted files matched Node's byte for byte.
- The 300-function check passed on a thread of 1 MB, with QuickJS-ng's own stack limit at 512 KB, and on every larger one tried.
- With `noLib`, TypeScript still needs ten global types to exist, `Array`, `Boolean`, `CallableFunction`, `Function`, `IArguments`, `NewableFunction`, `Number`, `Object`, `RegExp`, and `String`, so our declarations declare them.
- `typescript.js` is 9,144,216 bytes, 1,641,628 under gzip -9, and 1,160,209 under zstd -19.

A research pass the same day measured the alternatives on the same machine, in a scratch folder whose raw output we didn't keep:

- tsgo 7.0.2's `tsc.exe` is 24,520,544 bytes, 7,669,581 under zstd -19, and checked a one-file project in 14ms to 26ms; TypeScript 7.0 "does not yet expose a stable programmatic API", and 7.1 is expected to ship a new, different one (documented, [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)), and npm lists no WebAssembly build of 7.0.2 among its packages for each platform (read with `npm view typescript@7.0.2 optionalDependencies`).
- oxc 0.146.0's parser, transformer, and code generator added 2.2 MB to a release build, and swc_ecma_transforms_typescript 56.0.0's stripping 6.2 MB; neither type-checks.
- Monaco 0.57.0, VS Code's editor, ships TypeScript 5.9's compiler as `typescriptServices.js`, 9,075,748 bytes (read in its npm package).

**Changed:** the profile builder type-checks and compiles with TypeScript 6.0.3 inside QuickJS-ng, and the core builds no bundle, so `typescript.js` never ships to pilots ([02-units](02-units.md#the-builder)).
A profile of 300 write functions takes about 0.66s once the compiler is loaded, which is CI's cost per profile and level after one load of 0.24s, and the IDE's on each save.
Pinned at 6.0.3 exactly, its output stays put, and as of Microsoft's post of 2025-12-02, TypeScript 6.0's patches are to be "infrequent, and only issued when absolutely necessary" (documented, [Progress on TypeScript 7](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)).

**Affects:** [02-units](02-units.md); [01-format-and-delivery](01-format-and-delivery.md#testing-an-edit), whose core built a local bundle itself; [the code map](../architecture/02-code-map.md#engines), which gains an engine.

## 2026-10-16: GitHub Pages answers a repeat fetch of an unchanged file with a 304 and no body, and compresses what it sends when asked

**Asked:** the core fetches the profiles' `index.json` each time it starts, and [delivery](01-format-and-delivery.md#delivery) left unverified whether Pages answers a repeat fetch of an unchanged index with "not modified", sending almost nothing.

**Expected:** a 304 to `If-None-Match`, as a CDN in front of static files usually gives.

**Found:** p01 fetched two Pages sites, GitHub's own and an organization's, asking for gzip, then again with each validator it got:

| Site | First fetch, gzip asked | `If-None-Match` | `If-Modified-Since` | No gzip asked |
| --- | --- | --- | --- | --- |
| `pages.github.com` | 200, 3,844 bytes, `W/"689c7eef-386e"` | 304, 0 bytes | 304, 0 bytes | 200, 14,446 bytes |
| `jekyll.github.io/minima/` | 200, 3,319 bytes, `W/"68330611-25c7"` | 304, 0 bytes | 304, 0 bytes | 200, 9,671 bytes |

Every answer carried `Cache-Control: max-age=600`.
The ETag is weak on the compressed answer and strong on the plain one.
p01 fetched two unchanged HTML pages; that a JSON file on our own branch, served at our own domain, answers the same is unverified until that site exists.

**Changed:** the core fetches the index with the ETag it kept, so a start with nothing new published costs one answer of headers ([02-units](02-units.md#fetching)).
A cache may hold the old index for up to 10 minutes after Pages serves a new one, as `max-age=600` allows (inference), on top of the time Pages takes to serve a push.

**Affects:** [delivery](01-format-and-delivery.md#delivery), whose unverified line this settles.
