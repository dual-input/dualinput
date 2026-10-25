# Coherent GT's JavaScript and CSS

What MSFS 2024's Coherent GT, the engine of its cockpit panels, EFB, toolbar, in-game panels, and menu, parses, provides, and draws.
Its JavaScript was measured on MSFS 2024 SunRise 12.2.282174.999 in five documents on 2026-10-09: mainUi, the EFB's, the toolbar's, a cockpit panel, and an in-game panel of ours ([architecture log][p09]).
Its CSS was measured on MSFS 2024, Steam build 26058316, in mainUi, the EFB's document, and the toolbar's on 2026-10-25 ([architecture log][p13]).
Its user agent says Chrome 49 and its makers last compared it to Safari 10.1.2, but its features match neither ([architecture log][research]), so these lists are the rule.
Why our code is compiled to `es2017` is in the [spine](01-spine.md#compiling-our-code-in-the-sim).

## Syntax

A file with syntax the engine rejects doesn't parse, and none of it runs.

| Parses | Doesn't parse |
| --- | --- |
| Everything from ES2015 to ES2017 we tried: classes, `extends Error`, generators, destructuring, tagged templates, `new.target`, the `u` and `y` regex flags, `**`, `async` and `await`, trailing commas in calls | Object spread, `for await`, async generators, optional catch binding |
| Object rest, from ES2018 | Regex named groups, lookbehind, and unicode property escapes |
| The template literal revision, from ES2018 | A raw U+2028 in a string literal, and likely U+2029 (unverified) |
| | `?.`, `??`, `\|\|=`, `&&=`, `??=`, BigInt literals, numeric separators |
| | Class fields, `#private` fields and methods, static blocks, `#x in obj` |

The `s` and `d` regex flags parse, and the regex throws "Invalid regular expression: invalid flags" when its line runs, so a file using one runs until it gets there.

TypeScript 7.0.2 and esbuild 0.28.2 at `es2017` lowered the syntax from the right column that our test module used, and neither makes the regex features work ([architecture log][p09]):

- TypeScript leaves each regex as written, and its type check flags named groups and the `s` flag, but not lookbehind.
- esbuild rewrites each regex it can't lower into a `new RegExp(...)` call, which parses and then throws when it runs, with no warning.
- BigInt literals have no ES2017 form: TypeScript flags them, and esbuild turns each into a `BigInt(...)` call, which throws here, since the engine has no `BigInt`.

So the newer regex features have to be caught in our sources, not in compiled output.

## Built-ins

| | |
| --- | --- |
| The engine's own | Every built-in from ES2015 to ES2017 we tried, and `WeakRef` |
| Missing | `Array.prototype.flat` and `flatMap`, `Object.fromEntries`, `Symbol.prototype.description`, `BigInt`, `globalThis`, `String.prototype.matchAll`, `Promise.any`, `AggregateError`, `FinalizationRegistry`, `Array.prototype.at`, `Object.hasOwn`, `String.prototype.at`, `findLast`, `toSorted`, `Intl`, and an `Error`'s `cause` |
| Filled in by the sim's scripts in some documents only | `Promise.prototype.finally` (mainUi, the EFB, the toolbar), `Promise.allSettled` (mainUi, the toolbar), `String.prototype.trimStart` and `replaceAll` (the toolbar) |

Count on none of the third row: a cockpit panel and our in-game panel had none of them.
FS Copilot's probe found `globalThis` and `Array.prototype.flat` in the A220's DisplayUnits document (FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), which a script there likely filled in (unverified).

## Web APIs

| | |
| --- | --- |
| Missing | `ResizeObserver`, `IntersectionObserver`, `PointerEvent`, `AbortController`, `queueMicrotask`, `structuredClone`, `requestIdleCallback`, `crypto.subtle`, `Worker`, `BroadcastChannel`, `indexedDB` |
| Present | `MutationObserver`, `TouchEvent`, `EventTarget`, `CustomEvent`, `requestAnimationFrame`, `performance.now`, `TextEncoder`, `TextDecoder`, `URL`, `URLSearchParams`, `fetch`, `XMLHttpRequest`, `WebSocket`, `Blob`, `FileReader`, `DOMParser`, `crypto.getRandomValues`, `customElements`, `attachShadow`, `CSS.supports`, `matchMedia`, `localStorage` |

TypeScript's DOM types declare each missing API, so code that uses one type-checks and then throws in the sim.

## CSS

The engine drops a declaration it can't read, and a whole rule when its selector or at-rule is one it can't read, with no error.
Tailwind 4's output sits in `@layer`s and gives its colors in oklch, so none of it draws here ([architecture log][p13]).

| | Draws | Dropped |
| --- | --- | --- |
| Colors | Hex, with or without alpha; `rgb()`, `rgba()`, and `hsl()` with commas; `color(display-p3 ...)`; `currentColor`; a custom property holding a color, or an RGB triplet read as `rgba(var(--t), 0.5)` | `rgb()` and `hsl()` with spaces, `oklch()`, `lab()`, `hwb()`, `color-mix()`, relative colors, `light-dark()` |
| Spacing | `grid-gap` and `grid-column-gap` in a grid, and margins | `gap` and `column-gap`, in a grid and in a flex row, though `CSS.supports` says yes to `column-gap` |
| Layout | Flexbox, `inline-flex`, grid with `repeat()` and `minmax()`, `place-items`, `box-sizing`, `position: -webkit-sticky` | `aspect-ratio`, `inset`, logical properties such as `padding-inline` and `margin-inline-start`, `position: sticky`, `display: contents`, `display: flow-root` |
| Values | `calc()`, custom properties with fallbacks, `rem` at 16px, `em`, `vw`, which rounds down to a whole pixel in the EFB's and the toolbar's documents | `min()`, `max()`, `clamp()`, `dvh`, container query units |
| At-rules | `@media (min-width: ...)`, `@supports`, `@keyframes` | `@layer`, `@property`, `@container`, nesting, `@media (width >= ...)` |
| Selectors | `:not()` with a list, `:focus-within`, attribute selectors, `::before`, `::placeholder`, `::selection`, `::-webkit-scrollbar` | `:is()`, `:where()`, `:has()`, `:focus-visible`, `::marker` |
| Effects | `border-radius`, `box-shadow`, `filter` with `blur()` or `drop-shadow()`, linear and radial gradients, `-webkit-mask-image`, `mix-blend-mode`, `transform`, `transition`, `opacity` as a number, `outline-offset` under an outline | `backdrop-filter` and `-webkit-backdrop-filter`, `clip-path`, conic gradients, the `translate`, `scale`, and `rotate` properties, `opacity` as a percent |
| Text | `font-variant-numeric`, `font-feature-settings`, `letter-spacing`, `text-overflow: ellipsis`, `-webkit-line-clamp` | `text-wrap`, `line-clamp`, `text-underline-offset`, `text-decoration-thickness`, `overflow-wrap: anywhere`, `hyphens` |
| Forms and interaction | `-webkit-appearance`, `-webkit-user-select`, `cursor`, `object-fit`, `will-change` | `appearance`, `user-select`, `accent-color`, `caret-color`, `field-sizing`, `touch-action`, `scrollbar-width`, `scrollbar-gutter`, `overscroll-behavior`, `color-scheme`, `contain` |

- **Media features:** `prefers-color-scheme` and `forced-colors` don't parse, and `(hover: hover)`, `(pointer: fine)`, and `(prefers-reduced-motion: reduce)` parse and never match, so a rule behind any of them never applies.
- **Fonts:** mainUi and the toolbar declare Roboto as one family, `Roboto-Regular`, at weights 300 to 900, and Roboto Mono as `RobotoMono-Regular`.
  The EFB's document declares a family for each face, such as `Roboto-Bold` and `RobotoMono-Regular`, and sets its body in Verdana, so text there takes Roboto only from a rule that names a face.
  What an in-game panel's document declares is unmeasured.

## Re-measuring

A sim update can change any of this, so re-run [p09](../../../experiments/areas/architecture/p09-coherent-syntax.mjs) after each one, with the sim in a flight, and [p13](../../../experiments/areas/architecture/p13-coherent-css.mjs), with the sim at the main menu.

[p13]: log.md#2026-10-25-coherent-gt-drops-layer-oklch-color-mix-and-every-gap-but-grid-gap-so-tailwind-4s-output-cant-style-a-page-there
[p09]: log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild
[research]: log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework
