# Profiles: log

What our experiments found about building profiles' bundles and delivering them to pilots, newest entry first.
TypeScript's own compiler type-checks and compiles inside the QuickJS-ng we embed, with the same results as under Node, in about 0.9s for a profile of 300 write functions.
GitHub Pages answers a repeat fetch of an unchanged file with a 304 and no body.
The probes are [p01-pages-conditional.mjs](../../../experiments/areas/profiles/p01-pages-conditional.mjs) and [p02-typescript-in-quickjs.mjs](../../../experiments/areas/profiles/p02-typescript-in-quickjs.mjs), and their raw output is in [experiments/areas/profiles/results](../../../experiments/areas/profiles/results).
Neither needs the sim.

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

A research pass the same day, whose probes stayed in a scratch folder, measured the alternatives, on the same machine:

- tsgo 7.0.2's `tsc.exe` is 24,520,544 bytes, 7,669,581 under zstd -19, and checked a one-file project in 14ms to 26ms; TypeScript 7 has no stable programmatic API until 7.1 (documented, [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)), and npm lists no WebAssembly build of 7.0.2 among its packages for each platform (read with `npm view typescript@7.0.2 optionalDependencies`).
- oxc 0.146.0's parser, transformer, and code generator added 2.2 MB to a release build and swc's TypeScript stripping 6.2 MB; neither type-checks.
- Monaco 0.57.0, VS Code's editor, ships TypeScript 5.9's compiler as `typescriptServices.js`, 9,075,748 bytes (read in its npm package).

**Changed:** the profile builder type-checks and compiles with TypeScript 6.0.3 inside QuickJS-ng, and the core builds no bundle, so `typescript.js` never ships to pilots ([02-units](02-units.md#the-builder)).
A build of a profile of 300 write functions takes about 0.9s, with the load, which is CI's cost per profile and level, and the IDE's on each save.
TypeScript 6 gets only patches "infrequent, and only issued when absolutely necessary" (documented, [Progress on TypeScript 7](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)), so its output stays put.

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

**Changed:** the core fetches the index with the ETag it kept, so a start with nothing new published costs one answer of headers ([02-units](02-units.md#fetching)).
A merge reaches a pilot's next start within 10 minutes of CI publishing it, as `max-age=600` lets a cache hold the old index that long.

**Affects:** [delivery](01-format-and-delivery.md#delivery), whose unverified line this settles.
