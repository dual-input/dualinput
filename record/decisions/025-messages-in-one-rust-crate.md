# 025: Messages are defined in one Rust crate: JSON typed by ts-rs for TypeScript, fixed-width structs in data slots, and length-prefixed binary to the helper

Over a WebSocket, into a plugin, and both ways between the desktop app's Rust side and its pages, a message is JSON that serde_json writes, and the TypeScript sides take their types from ts-rs, generated from the crate that defines the messages, with ts-rs's large-integer setting at `number`.
In a data slot, a message is a struct of fixed-width fields, with its size and field offsets asserted in the crate, which builds for x86_64 and wasm32.
Over the helper's standard input and output, a message is binary and prefixed with its length.
Decided by the user on 2026-10-09, in node 1.4 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#messages-are-defined-in-one-rust-crate-json-typed-by-ts-rs-for-typescript-fixed-width-structs-in-data-slots-and-length-prefixed-binary-to-the-helper).

## Context

The Rust components share one crate that defines the messages they trade ([decision 018](018-rust-and-typescript.md)), and three TypeScript sides trade those messages too: the sim's pages, the desktop app's pages, and plugins calling the core's host functions ([01-spine](../areas/architecture/01-spine.md#messages-between-components)).
Each link needed a form for them that both its ends read, and four findings shaped it:

- **A format written twice drifts.**
  fsc-editor writes its module's wire format in TypeScript and in C++, and "nothing but `src/main/sim/link.test.ts` notices when the two" drift (read in fsc-editor, `link/README.md`).
- **A JavaScript number holds an integer exactly only up to 2^53.**
  In p07, QuickJS-ng held a time of 2^53 + 1µs as 2^53 (measured on our development machine, 2026-10-09, [architecture log][types]), and `BigInt` was missing in all five Coherent GT documents p09 probed (measured on MSFS 2024, 2026-10-09, [architecture log][p09]).
- **Coherent GT parses JSON with no library of ours**, at no frame time we could measure in the PA-24's cockpit panels (measured on MSFS 2024, 2026-10-08, [01-spine](../areas/architecture/01-spine.md#the-sims-pages)).
- **The WASM module reads a data slot in place**, built for wasm32 where the core builds for x86_64, and a struct holding a pointer-sized `usize` was 16 bytes on x86_64 and 8 on wasm32 (measured on our development machine, 2026-10-09, [architecture log][types]).

## Options

For the TypeScript sides' types, node 1.4.1's probe, p07, checked messages shaped like ours, as serde_json wrote them, against each generator's types under TypeScript's strict settings ([architecture log][types]):

1. **Types written by hand beside the crate.**
   Each message is then defined twice, and the two can drift as fsc-editor's did.
2. **specta.**
   It passed every check only with two opt-ins, `PhasesFormat` and a `specta_typescript::Number` mark on each 64-bit field, and only as a release candidate, 2.0.0-rc.25.
3. **typeshare.**
   It refused a `u64` until each was marked `serialized_as = "U53"`, then refused an internally tagged enum, which we found no opt-in for, so it can't express our messages without changing the messages themselves.
4. **ts-rs on its defaults.**
   It typed each `u64` as `bigint`, so every sample carrying a time failed the type check.
5. **ts-rs with its large-integer setting at `number`.**
   The setting types `i64`, `u64`, `i128`, and `u128` alike, so each reaches TypeScript exactly only up to 2^53, and an integer field that can pass it has to cross as text, as the IDs do ([decision 022](022-random-uuids-as-text.md)).

Between the desktop app's Rust side and its pages:

1. **Tauri serializing each value it passes.**
   The pages would then read whatever Tauri writes, rather than the text p07 checked ts-rs's types against ([01-spine](../areas/architecture/01-spine.md#messages-and-their-types)).
2. **serde_json's text, carried as a string both ways**, in a command's argument or answer or an event's payload, which each side parses (documented, [Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/)).

For the data slots and the helper's link, the record weighed no other form: the module can't open a socket, so data slots are its link ([05-02](../learn/foundations/05-02-simconnect-and-the-commbus.md#simconnect-from-inside-a-module)), and the helper's link carries audio ([01-spine](../areas/architecture/01-spine.md#messages-and-their-types)).

## Decision

ts-rs with its large-integer setting at `number`, and serde_json's text carried as a string to the desktop app's pages.
In p07, ts-rs's types with that setting took every message serde_json wrote, the plugin that answered them type-checked, and each of five wrong messages was refused, on one setting where specta needed two opt-ins on a release candidate and typeshare couldn't express an internally tagged enum ([architecture log][types]).
Carried as a string, the text the pages parse is the text those types were checked against.
In the same run, the data slots' structs kept one layout on x86_64 and wasm32, while the struct with a pointer-sized field didn't (same entry).

## What it commits us to

- The TypeScript sides take their types from ts-rs, with `TS_RS_LARGE_INT` or `Config::with_large_int` set to `number`, away from its default, `bigint` (read in ts-rs 12.0.1, `src/lib.rs`).
  Its output is types alone, which erase when compiled, so nothing of it runs in Coherent GT ([01-spine](../areas/architecture/01-spine.md#messages-and-their-types)).
- A plugin gets each message as an object through QuickJS-ng's own JSON parser, and its answer comes back to the core the same way (measured on our development machine, 2026-10-09, [architecture log][types]).
- A struct in a data slot holds only fixed-width fields, and the crate asserts each one's size and field offsets.
- The encoding between cores was left to the node on how the cores reach each other, and [decision 035](035-channels-declare-how-they-travel.md) makes it postcard.
- Whether the desktop app's pages and its Rust side trade the messages' text through Tauri's commands or its events, and whether tauri-specta types the command calls, which ts-rs doesn't, are left to the apps' stage of step 8 ([01-spine](../areas/architecture/01-spine.md#left-open)).
- The choices inside the crate's build, among them the check in CI that ts-rs's generated files match the crate, are left to the build's stage of step 8, and the binary format on the helper's link to the core's stage ([01-spine](../areas/architecture/01-spine.md#left-open)).

[types]: ../areas/architecture/log.md#2026-10-09-ts-rs-with-64-bit-integers-set-to-numbers-generates-typescript-that-matches-what-serde_json-sends-specta-needs-two-opt-ins-typeshare-cant-express-our-messages-and-the-data-slots-keep-one-layout-on-x86_64-and-wasm32
[p09]: ../areas/architecture/log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild
