# 030: Our code in the sim is type-checked against ES2017 and bundled by esbuild at es2017

TypeScript checks the types of our code in the sim with its `lib` set to `DOM`, `DOM.Iterable`, `ES2017`, and `ES2021.WeakRef`, and esbuild bundles each page's code, our pinned framework included, at `es2017`.
The EFB app and the desktop app's pages share TypeScript logic and ts-rs's types, compiled this way for the EFB app.
Decided by the user on 2026-10-09, in node 1.6 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#our-code-in-the-sim-is-type-checked-against-es2017-and-bundled-by-esbuild-at-es2017).

## Context

Four components run our code in Coherent GT: the EFB app, the banner panel, the menu script, and the panel bridge, all written in TypeScript ([decision 018](018-rust-and-typescript.md)).
Node 1.3 left the compiler and syntax target they share open ([architecture plan](../areas/architecture/plan.md#16-frameworks)).
A file with syntax the engine rejects doesn't parse, and none of it runs ([Coherent GT's JavaScript](../areas/architecture/coherent-gt.md#syntax)).

- Coherent GT parses all of ES2017 and object rest, and no other syntax from ES2018 on, and has every ES2015 to ES2017 built-in we tried and `WeakRef`, and no other from ES2018 on of its own (measured on MSFS 2024, 2026-10-09, [architecture log][p09]).
- The framework compiles to `es2017` with the same `lib`, and FlyByWire and every other project we read compile to `es2017` or near it (read, [architecture log][research]).

## Options

1. **The framework's own pipeline: TypeScript, then Rollup with no second compile.**
   It compiles only its own files, so an npm package that pipeline bundled would reach Coherent GT as its author wrote it (read in microsoft/msfs-avionics-mirror, its main branch on 2026-10-09, `src/sdk`).
   It also runs the framework's TypeScript plugin, which rewrites `for`-`of` loops because Coherent GT runs them slowly (documented, `@microsoft/msfs-ts-transformer` 1.0.0 on npm).
2. **esbuild at FlyByWire's target, `safari11`.**
   esbuild refused it for an object rest in a parameter ([architecture log][p09]).
3. **A target from ES2018 on.**
   Coherent GT parses no syntax from ES2018 on but object rest and the template literal revision, and it rejected object spread, which a compiler at ES2018 leaves as written ([architecture log][p09]).
4. **esbuild at `es2017`, with TypeScript checking the types against ES2017's `lib`.**
   esbuild can't run the framework's `for`-`of` rewrite ([01-spine](../areas/architecture/01-spine.md#compiling-our-code-in-the-sim)), and neither esbuild nor TypeScript makes the regex features from ES2018 on work ([architecture log][p09]).

## Decision

Option 4.
A module using `?.`, `??`, `??=`, class and `#private` fields, object spread and rest, and a numeric separator, bundled by esbuild 0.28.2 at `es2017`, ran in the EFB's document and a cockpit panel and passed each of its checks, as it did compiled by TypeScript 7.0.2 ([architecture log][p09]).
esbuild applies its target to every file it bundles, packages included, where the framework's pipeline leaves a package as its author wrote it, and `es2017` is the target both compilers take.
TypeScript's `lib`, set as the framework's own build sets it, makes a built-in from ES2018 on that the engine lacks, such as `Object.fromEntries`, fail the type check ([01-spine](../areas/architecture/01-spine.md#compiling-our-code-in-the-sim)).

## What it commits us to

- The check of [decision 031](031-coherent-gt-check-tool.md) catches what this compiling lets through: the regex features from ES2018 on, which neither compiler makes work, a raw U+2028 or U+2029 in a string ([architecture log][p09]), and the web APIs and `Intl` that TypeScript's libs declare and the engine lacks ([01-spine](../areas/architecture/01-spine.md#the-check)).
- The logic the EFB app shares with the desktop app's pages compiles this way too, and a module of that kind, compiled at `es2017`, ran in the EFB's document ([architecture log][p09]).
- Whether the framework's `for`-`of` rewrite, which esbuild can't run, pays for itself in our interface is left to the build's stage of step 8 ([01-spine](../areas/architecture/01-spine.md#left-open)).
  A frame-time probe of the EFB app and the banner, built with it and without it, settles it.

[p09]: ../areas/architecture/log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild
[research]: ../areas/architecture/log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework
