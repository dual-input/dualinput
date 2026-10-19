# 031: A tool of our own checks every file we ship into the sim against Coherent GT's measured limits

Every JavaScript file we ship into the sim, experiments' files included, passes a check run after every edit and in CI.
The check parses each file at ECMAScript 2017, with the pattern of each regex literal and of each `new RegExp(...)` given a fixed string, and fails any use of a built-in or web API [Coherent GT's JavaScript](../areas/architecture/coherent-gt.md) lists as missing or filled in only in some documents.
It's a tool of its own, holding that list as one data file, built for our needs in a repository of its own under Dual Input's GitHub organization, and published as it is, for anyone to use, without support.
Decided by the user on 2026-10-09, in node 1.6 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#a-tool-of-our-own-checks-every-file-we-ship-into-the-sim-against-coherent-gts-measured-limits).

## Context

Step 7 asks for a check that every file run in Coherent GT, experiments included, parses within the engine's measured limits, run in CI and after edits, and asks us to look first for Coherent GT's own documentation of its JavaScript and for rules others already maintain ([the product plan](../areas/product/plan.md#7-tech-stack-and-architecture)).
A syntax error takes out the whole file ([06-01](../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)), and our code in the sim is compiled by esbuild at `es2017` ([decision 030](030-in-sim-code-es2017-esbuild.md)), which leaves some of what the engine rejects in place:

- Neither TypeScript 7.0.2 nor esbuild 0.28.2 makes the regex features from ES2018 on work: TypeScript leaves them as written and flags some, and esbuild hides each in a `new RegExp(...)` call, which a parse of its output alone can't see (measured on our development machine, 2026-10-09, [architecture log][p09]).
- TypeScript's DOM types declare web APIs the engine lacks, such as `ResizeObserver`, ES5's lib declares `Intl`, which the engine lacks too, and the sim's own scripts fill in some built-ins in some documents only (same entry).

## Options

1. **A rule set others maintain.**
   Nobody maintains one for the engine: we found no ESLint plugin, browserslist query, or compatibility table for Coherent GT or MSFS's JavaScript, on npm or in a code search of GitHub ([architecture log][research]).
2. **`node --check`**, which [CLAUDE.md](../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks for until the check exists.
   It passes the syntax the engine rejects that Node accepts, such as `?.` ([06-01](../learn/foundations/06-01-the-engine-and-instruments.md#coherent-gt-the-chrome-49-engine-and-its-limits)).
3. **The compilers' target and TypeScript's type check alone.**
   They let through the regex features and the web APIs above, and the type check doesn't see our JavaScript files ([01-spine](../areas/architecture/01-spine.md#the-check)).
4. **A tool of our own that parses each file at ES2017, with its regex patterns, and fails each banned built-in and web API.**
   A regex built from a pattern computed at run time escapes it, and a parse at ES2017 rejects object rest too, which the engine parses, so code written as JavaScript keeps to ES2017 ([01-spine](../areas/architecture/01-spine.md#the-check)).

## Decision

Option 4.
It's the only one of the four that fails a file for the regex features from ES2018 on, which neither compiler makes work, and for a web API that TypeScript's DOM types declare and the engine lacks ([architecture log][p09]).
It lives in a repository of its own and is published without support, because other MSFS projects have no such check either, and the user wants ours usable by them without our supporting it (user, 2026-10-09).

## What it commits us to

- The check holds what [Coherent GT's JavaScript](../areas/architecture/coherent-gt.md) lists as one data file, and that list is measured again with p09 after each sim update ([Coherent GT's JavaScript](../areas/architecture/coherent-gt.md#re-measuring)).
- Until the check exists, [CLAUDE.md](../../CLAUDE.md#before-writing-code-that-runs-in-a-panel) asks for `node --check` and a look at the reference ([01-spine](../areas/architecture/01-spine.md#the-check)).
- It leaves out a regex built from a pattern computed at run time, which a parse can't see.
- How the tool is built is left to the build's stage of step 8 ([01-spine](../areas/architecture/01-spine.md#left-open)): its parser, with p09's failing samples as its test; its list of banned built-ins and web APIs, with an exception for a package's own fill-in; and whether it also offers an ESLint config, for warnings in the editor as our sources are written.

[p09]: ../areas/architecture/log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild
[research]: ../areas/architecture/log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework
