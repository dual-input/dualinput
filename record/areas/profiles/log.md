# Profiles: log

What our experiments and the build found about building profiles' bundles and delivering them to pilots, newest entry first.
TypeScript's own compiler type-checks and compiles inside the QuickJS-ng we embed, with the same results as under Node, in about 0.66s for a profile of 300 write functions once it's loaded, which takes 0.24s.
GitHub Pages answers a repeat fetch of an unchanged file with a 304 and no body.
The sandbox's context runs QuickJS-ng's base objects and lacks JSON, Map, Set, Date, and Promise, which level 1's declarations follow.
TypeScript's language service answers inside a write function in about 40ms in QuickJS-ng, and about 3ms in Node.
The probes are [p01-pages-conditional.mjs](../../../experiments/areas/profiles/p01-pages-conditional.mjs), [p02-typescript-in-quickjs.mjs](../../../experiments/areas/profiles/p02-typescript-in-quickjs.mjs), [p03-sandbox-globals.mjs](../../../experiments/areas/profiles/p03-sandbox-globals.mjs), and [p04-language-service.mjs](../../../experiments/areas/profiles/p04-language-service.mjs), and their raw output is in [experiments/areas/profiles/results](../../../experiments/areas/profiles/results).
None needs the sim.

## 2026-11-22: Stage 22d's language server answers inside a script within 73ms at p95 on the 58P, and the scenarios whose bundles changed pass

**Asked:** do [stage 22d](../build/plan.md#22d-the-profile-extension)'s budgets hold ([budgets](03-the-extension.md#budgets)), and do the bench's scenarios that load the 58P's bundle, whose bytes the stage changes by putting `seats` last, still pass?

**Expected:** requests inside a script near p04's 40ms in QuickJS-ng, and the scenarios passing as before.

**Found:** on our development machine, with a release build of `dualinput-profile-builder`, [p05](../../../experiments/areas/profiles/p05-language-server.mjs) drove `serve` over stdio as VS Code does, on the 58P's profile, with 30 runs of each request, each right after an edit, the PC otherwise idle ([results](../../../experiments/areas/profiles/results/p05-language-server-2026-11-22-14-16-43.txt)):

| Request | p50 | p95 | Budget |
| --- | --- | --- | --- |
| Completion after `state.` | 53.1ms | 72.9ms | 100ms at p95 |
| Signature help in `write(` | 46.4ms | 64.4ms | 100ms at p95 |
| A hover on a key of `state` | 44.8ms | 65.6ms | 100ms at p95 |
| The engine's checks on a keystroke, from `didChange` to the diagnostics, stdio included | 1.9ms | 2.2ms | 20ms |

- The server answered `initialize` 535ms after its process started, against 1s, and its first completion in a script 798ms after, which took 262.8ms itself, as TypeScript built its first program; an earlier run of the same probe gave 282ms and 539ms.
- In a QuickJS-ng runtime of its own, TypeScript's language service took 253ms to load, a list of completions with no edit before it 5.5ms, one item's details 2.5ms, and the details of all 183 of the 58P's keys at once 410ms, so the server fetches an item's details as the editor highlights it.
- `node tools/bench.ts state-sync clients-panels profiles test-sessions` passed 36 of 36 cases ([results](results/2026-11-22-stage-22d-bench.txt)), and `node tools/check.ts` passed its 19 checks, `format --check` on `profiles/` among them.
- The formatter changed the 58P's profile only by moving `seats` last and refilling six paragraphs of comment to 100 columns; its bundle's hash is `1cd007862a57eb56e1ff8c9c262dae14bb055b43d71d8039b5fd56266da8e3a6`, the same before and after the format, since a bundle holds no comments.

**Changed:** nothing; each budget holds.

**Affects:** [03-the-extension](03-the-extension.md)'s budgets.

## 2026-11-22: The profile extension's design finds what VS Code reads of a .vsix and a language, what vsce costs, and what Zed allows, and the format puts seats last and takes single quotes

**Asked:** what does [stage 22d](../build/plan.md#22d-the-profile-extension)'s profile extension lean on: how VS Code gives a file a language and installs a `.vsix` from disk, what Microsoft's packer, vsce, would cost us, where an installed Dual Input names its version, and what Zed lets an extension do, since the user weighs Zed as a base for the Dual Input IDE?

**Expected:** that a `.vsix` VS Code installs needs the manifest vsce writes.

**Found:** on our development machine:

- VS Code 1.140.0 turns each of an extension's `filenamePatterns` into a file pattern, matches a pattern that holds a `/` against the file's whole path, ignoring case, and takes a file name's match over a pattern's, and a pattern's over a file extension's (read in VS Code 1.140.0, `resources/app/out/vs/workbench/workbench.desktop.main.js`).
- Installing a `.vsix`, VS Code 1.140.0 reads the extension's manifest from `extension/package.json` in the zip, and no bundle of its code holds the string `.vsixmanifest` (read in `resources/app/out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js`).
- vsce 1.0.0, published 2015-12-16, writes a `PackageManifest` of version 2.0.0, with `Microsoft.VisualStudio.Code` as its installation target and `extension/package.json` as its manifest asset, and `@vscode/vsce` 4.1.1, published 2026-11-16, writes the same, with optional properties added for the Marketplace: the engine, dependencies, the target platform, pre-release, and a sponsor (read in each npm package, `resources/extension.vsixmanifest` and `out/package.js`).
- `@vscode/vsce` 4.1.1 on its own installs 135 packages and 50.4 MB, in 11.6s from an empty cache and 6.5s through a warm `npm ci`, with install scripts off, where the root's lockfile holds 218 packages and its `node_modules` 301 MB; CI runs `npm ci` in its checks job, in its bench build, and in each scenario's job.
- An installed Dual Input names its version in `%LOCALAPPDATA%\DualInput\current\sq.version`, Velopack's nuspec, which holds `<version>0.1.1</version>` here.
- "On December 1, 2026, global Personal Access Tokens (PATs) in Azure DevOps are retired", and publishing from GitHub Actions takes the Marketplace's Trusted Publishing instead, `vsce publish --oidc`, which trades the job's GitHub OIDC token for a Marketplace credential by a policy on the publisher naming the repository and the workflow's file ([publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)); vsce 4.1.1 has `--oidc` (read in its npm package, `out/main.js`).
- As of 2026-11-22, Zed's extensions provide languages, with Tree-sitter grammars and queries, language servers, and default rules for semantic tokens, and themes, icon themes, snippets, debuggers, and MCP servers ([developing extensions](https://zed.dev/docs/extensions/developing-extensions), [languages](https://zed.dev/docs/extensions/languages)), and the docs describe no panel, status bar item, webview, or command of an extension's own.
  Zed takes semantic tokens, which are "disabled" by default ([semantic tokens](https://zed.dev/docs/semantic-tokens)), and an extension's `path_suffixes` "does not support glob patterns", which a user's `file_types` setting does ([languages](https://zed.dev/docs/extensions/languages)).
  Panels, status bar items, and webviews are proposals on Zed's GitHub, such as [RFC #53403](https://github.com/zed-industries/zed/discussions/53403) and [issue #21208](https://github.com/zed-industries/zed/issues/21208).
- The 58P's profile has 28 lines of comment, the longest 98 characters and 17 of them 90 to 99, and double quotes only in its comments (read in `profiles/aircraft/bksq-baronpro.yaml`).

**Changed** (user, 2026-11-21 and 2026-11-22): the extension's design, in [03-the-extension](03-the-extension.md), and five rules of the format:

- `seats` goes last among the top-level keys, after `events`, where [Layout](01-format-and-delivery.md#layout) put it before `state`, since an airliner's profile may hold hundreds of seats ([budgets](02-units.md#budgets)).
- Outside scripts, a profile takes single quotes only, and a double-quoted string there fails the build, while a script takes any string JavaScript takes.
- The formatter reflows each paragraph of a comment to 100 columns.
- A heading's rule runs on to column 100, as in `# ═══ ELECTRICAL ═══…`, as fsc-editor's ran on to 78.
- A script that declares `state`, `write`, `L`, `A`, `B`, `K`, or `H` fails the build, so the extension's grammar paints them as Dual Input's with no semantic tokens from its server; `value` stays free, since every write function names its parameter so.

**Affects:** [01-format-and-delivery](01-format-and-delivery.md), [02-units](02-units.md), [the build](../build/01-the-build.md), [the code map](../architecture/02-code-map.md), and the architecture's tentative decision on authoring tools.

## 2026-11-22: TypeScript's language service answers in about 40ms in QuickJS-ng on the 58P's write functions, against 3ms in Node, once QuickJS-ng has a stand-in for `Intl`

**Asked:** how fast does TypeScript 6.0.3's language service answer what the profile extension asks inside a write function, completion, signature help, a hover, and the file's diagnostics, in the QuickJS-ng the profile builder runs TypeScript in, against Node, on the 58P's own program?
The answer decides where [stage 22d](../build/plan.md#22d-the-profile-extension)'s language service runs: in the builder's language server, or in the extension's Node.

**Expected:** QuickJS-ng about ten times slower than Node, as p02's check of 300 write functions was slower there.

**Found:** on our development machine, with 30 runs of each request, each after an edit to the file, on `press.ts`, the program file for the 58P's one variant, of 303 lines, with 18 write functions and level 1's declarations of 143,541 bytes ([results](../../../experiments/areas/profiles/results/p04-language-service-2026-11-21-23-01-35.txt)):

| Request | QuickJS-ng, rquickjs 0.14.0 | Node 22.23.1 |
| --- | --- | --- |
| Loading `typescript.js` | 243.1ms | 146.0ms |
| The first completion, which builds the program | 249.6ms | 114.0ms |
| Completion after `state.` | median 42.5ms, p95 57.8ms | median 3.0ms, p95 8.4ms |
| Signature help after `write(` | median 35.9ms, p95 55.6ms | median 2.6ms, p95 9.7ms |
| A hover on `write` | median 34.8ms, p95 61.0ms | median 2.4ms, p95 8.1ms |
| The file's diagnostics | median 61.1ms, p95 68.3ms | median 8.0ms, p95 13.1ms |
| Memory | 43 MB | 23 MB of V8's heap |

- Both gave the same 183 completions after `state.`, the same 3 signatures for `write(`, and the same hover text.
- QuickJS-ng as rquickjs 0.14.0 builds it has no `Intl`, and the first completion failed with `Intl is not defined` in TypeScript's `createIntlCollatorStringComparer`, which sorts completions with `Intl.Collator`.
  The probe defines a stand-in that compares by code unit, and the run above used it.
- The diagnostics check the whole file, so they grow with its write functions, while completion, signature help, and a hover read the code around the caret (inference, from p02's check of 300 functions, which took 0.66s in QuickJS-ng).

**Changed:** the language service runs in the profile builder's language server, in two runtimes, one for requests and one for checks and builds (user, 2026-11-22; [TypeScript in two runtimes](03-the-extension.md#typescript-in-two-runtimes)).

**Affects:** [03-the-extension](03-the-extension.md).

## 2026-11-21: Stage 22b's test sessions pass their bench cases, and a reload's catch-up ended 1.5s after its load, against 4s of settling

**Asked:** do [stage 22b](../build/plan.md#22b-test-sessions)'s cases hold on its code: [the profiles' cases for the bench](02-units.md#cases-for-the-bench) that [test sessions](02-units.md#test-sessions) added, in the new `test-sessions` scenario and the changed case of `profiles`?

**Expected:** each case as designed, with a reload's catch-up ending within about 1.5s of the load, the time the new sync engine takes its first readings, since the aircraft settled long before.

**Found:** on our development machine, with the bench's profile `release-with-checks`, after the code review's fixes, `node tools/bench.ts test-sessions profiles traffic` passed 26 of 26 cases ([results](results/2026-11-21-stage-22b-bench.txt)):

- A new bundle in the PF's local folder moved the pin, both cores reloaded it, the following core's catch-up wrote the strobe the new bundle's entry covers, and the slice showed its short hash for both PCs, saved by the PF, with the banner's notice once on each.
- With settling at 4s, the following core's catch-up ended 1,494ms after its load of the new bundle, and 1,498ms in the run before the fixes.
- Through the reload, `Follow`'s slot went on being written on the connection it had before, so flight-model sync ran on.
- A file written again with the same bytes moved no pin.
- A new bundle in the following pilot's local folder reached the PF, which pinned it naming that pilot; the beacon, whose write function the sandbox had stopped, synced again under it; and the PF sent the first bundle once, as it was pinned, and never again.
- A pilot who joined after the save got the bundle from the PF as their link came up, fetched nothing, and kept it in their cache.
- In `profiles`, a member with no copy of the PF's local bundle got it from the PF and loaded it, and the match check showed no difference.
- In `traffic`, a pilot who left the flight had each copy removed once, on the connection that made it, by traffic's own removes, since a profile's unload no longer closes traffic's connection.

The build of the 200 KB profile took 2,016ms in the run before the fixes, 16ms past its 2s, while other work held the PC, and 1,718ms in the run after them, with no change to the builder.
CI's run on the stage's pull request is its whole bench.

The code review found five faults, which the stage fixed before the run above:

- From the second local pin on, the PF's core sent the previous bundle to the crew again, and a member that took control while that copy was on its way would pin it, taking the session back to the earlier save; the PF sends once the pin lands, and pins only a bundle marked as an offer.
- A member's offer that reached a core after control passed from it was dropped; that core passes it on to the PF.
- The PF's own pinned local bundle lived only in its local folder, so an author who deleted the file left a joiner loading for good; every core keeps each local bundle it sends or gets in its cache.
- A failed read of a local file made its next good read count as a new save, though its bytes hadn't changed; the folder's listing keeps each file's last good hash.
- Comments in traffic and the sim seam still said a profile's unload closes every feature's connection.

It also found that the old unload stopped rate and pause's and Go to's watches for the rest of a sim run once a profile first unloaded, since each makes its watch once and makes it again only when told its connection was lost, which a close for an unload never told it; with their connections open through an unload, the watches stay (read in `src/features/rate-and-pause/core/src/lib.rs`, `sim_changed`).
No case measured it before the change.

**Changed:** the design's known limit on a change lost during a reload covers a following machine's own gap too, while it waits for the bundle to arrive ([test sessions](02-units.md#test-sessions)).

**Affects:** [test sessions](02-units.md#test-sessions), and [the build plan](../build/plan.md)'s stage 22b.

**Evidence:** [results/2026-11-21-stage-22b-bench.txt](results/2026-11-21-stage-22b-bench.txt).

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
