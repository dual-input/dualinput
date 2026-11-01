# Coherent GT's JavaScript and CSS

What MSFS 2024's Coherent GT, the engine of its cockpit panels, EFB, toolbar, in-game panels, and menu, parses, provides, and keeps.
Its JavaScript was measured on MSFS 2024 SunRise 12.2.282174.999 in five documents on 2026-10-09: mainUi, the EFB's, the toolbar's, a cockpit panel, and an in-game panel of ours ([architecture log][p09]).
Its CSS was measured on MSFS 2024, Steam build 26058316, in mainUi, the EFB's document, and the toolbar's on 2026-10-25, against Chromium 152 ([architecture log][p14]).
No probe has measured the CSS of an in-game panel's document, where the banner runs; the three documents measured kept and dropped the same items, and differ only in the defaults their own stylesheets set, below.
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

The engine drops a declaration it can't parse, and a whole rule when it can't parse the rule's selector or at-rule, with no error.
Our probe p14 tested each property, keyword, unit, selector, and at-rule MDN's mdn-data 2.37.2 lists, with function samples and value forms of ours, and its report names each one the engine drops that Chromium 152 keeps ([architecture log][p14]).
A few entries below come from p13's layout tests alone, such as `opacity` as a percent, `column-gap`, and `display: contents` ([architecture log][p13]).
Tailwind 4's output sits in `@layer`s and gives its colors in oklch, so none of it draws here (same entry).

Kept means the engine holds the declaration and, where p13 or p14 laid it out, places boxes where Chromium does.
Neither probe looked at the paint, so a kept declaration can still paint unlike Chromium's, which only a screenshot shows.

| | Kept | Dropped |
| --- | --- | --- |
| Colors | Hex of 3 to 8 digits; named colors, `transparent`, and `currentcolor`; `rgb()`, `rgba()`, `hsl()`, and `hsla()` with commas and a bare number for the hue; `color()`; a custom property holding a color, or an RGB triplet read as `rgba(var(--t), 0.5)` | `rgb()` and `hsl()` with spaces, a hue in `deg`, an alpha as a percent, `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()`, `color-mix()`, relative colors, `light-dark()`, and the system colors `Canvas` and `CanvasText` |
| Spacing | `grid-gap`, `grid-row-gap`, and `grid-column-gap` in a grid; margins, put between flex items with `* + *` or `:not(:first-child)` | `gap`, `row-gap`, and `column-gap`, in a grid and in a flex row, though `CSS.supports` says yes to `column-gap` |
| Flexbox | Wrapping, `order`, reversed directions, `justify-content` with `flex-start`, `flex-end`, `center`, `space-between`, `space-around`, and `space-evenly`, `align-items`, `align-self`, `align-content`, `flex` and its parts, and `-webkit-box` | `justify-content: end`, which parses and packs at the start |
| Grid | Tracks with `repeat()`, `auto-fill`, `auto-fit`, `minmax()`, `fit-content()`, and named lines; `grid-template-areas`; `grid-auto-flow: dense`; spans and negative lines; `place-items`, `place-self`, `place-content`, `justify-items`, and `justify-self` | `subgrid` |
| Layout | Floats; `position` but `sticky`, which parses only as `-webkit-sticky`; `inline-block`; `columns`; `writing-mode`; `direction`; `box-sizing`; widths of `fit-content`, `max-content`, `min-content`, and `-webkit-fill-available` | `inset` and every other logical property, such as `padding-inline` and `margin-block`; `aspect-ratio`; `display: contents`, which parses but computes as `inline`, `flow-root`, and `ruby`; `overflow: clip`; `contain` and `content-visibility`; container queries; anchor positioning |
| Values | `calc()`, nested too; custom properties with nested fallbacks; `initial`, `inherit`, `unset`, and `revert`; `!important`; `px`, `em`, `rem` at 16px, `ex`, `ch`, `%`, `vw`, `vh`, `vmin`, `vmax`, and the absolute lengths but `Q`; `deg`, `grad`, `rad`, and `turn`; `s` and `ms`; `fr` | `min()`, `max()`, `clamp()`, and every other math function; `env()`; `revert-layer`; `stretch`; the newer viewport units, such as `dvh` and `svh`; container units; `lh`, `rlh`, `cap`, and `ic`; the root font units but `rem` |
| At-rules | `@media` with `min-` and `max-` features, `@supports` but its `selector()`, `@keyframes` and `@-webkit-keyframes`, `@font-face`, `@import`, `@namespace`, and `@page` | `@layer`, `@property`, `@container`, `@scope`, `@starting-style`, `@counter-style`, `@font-feature-values`, `@font-palette-values`, `@position-try`, `@view-transition`, `@supports selector()`, nesting, media range syntax, `not` and `or` inside a media condition, and `calc()` in a media query |
| Selectors | Attribute selectors; the combinators; `:not()` with lists and complex selectors; `:nth-child()` with `of`; `:-webkit-any()`; `:hover`, `:focus`, `:focus-within`, `:checked`, `:disabled`, `:empty`, `:placeholder-shown`, `:dir()`, and `:lang()`; `::before`, `::after`, `::placeholder`, `::selection`, `::first-letter`, and `::-webkit-scrollbar` | `:is()`, `:where()`, `:has()`, `:focus-visible`, `:modal`, `:popover-open`, `:user-valid`, `:user-invalid`, `::marker`, `::backdrop`, `::part()`, `::file-selector-button`, and a top-level `&` |
| Effects | `border-radius`; `box-shadow`; `opacity` as a number; `filter` with every filter function; linear and radial gradients, their repeating forms, and `-webkit-gradient()`; `mix-blend-mode`; `transform` with every function, 3D too; `transition` and `animation` with `cubic-bezier()` and `steps()` | `backdrop-filter` in either form, conic gradients, the `translate`, `scale`, and `rotate` properties, `opacity` as a percent, `linear()` easing, and `transition-behavior` |
| Text | The `font` shorthand, `font-variant-numeric`, `font-feature-settings`, `letter-spacing`, `text-overflow: ellipsis`, `-webkit-line-clamp`, and `counter()` and `attr()` in `content` | `text-wrap`, `line-clamp`, `text-underline-offset`, `text-decoration-thickness`, `text-decoration` with a style or a color, `overflow-wrap: anywhere`, `white-space: break-spaces` and the newer `white-space` values, `font-size: xxx-large`, `font-variation-settings`, and `font-palette` |
| Forms and interaction | `cursor`, `object-fit`, and `will-change` | `accent-color`, `caret-color`, `field-sizing`, the values of `touch-action`, `scrollbar-width`, `scrollbar-color`, `scrollbar-gutter`, `overscroll-behavior`, `scroll-behavior`, the `scroll-snap-` properties, and `color-scheme` |
| Only with `-webkit-` | `-webkit-user-select`, `-webkit-appearance`, `-webkit-aspect-ratio`, `-webkit-backface-visibility`, `-webkit-hyphens`, the `-webkit-mask-` properties, `-webkit-clip-path` with a shape, `-webkit-image-set()`, `-webkit-cross-fade()`, and the `-webkit-text-decoration-` properties | The same without the prefix, and `clip-path` with any shape or box, though `clip-path` itself parses |

- **Media features:** `prefers-color-scheme`, `forced-colors`, `prefers-contrast`, and `scripting` don't parse.
  `(hover: none)` and `(prefers-reduced-motion: no-preference)` match, and `(hover: hover)`, `(pointer: fine)`, and `(any-pointer: fine)` don't, so a rule behind a hover or pointer query applies as on a touch screen, while `:hover` selectors work.
- **Layout:** the engine places boxes on whole pixels where Chromium gives fractions, as `vw` and `space-evenly` showed, and a table cell given a width takes the table's whole width.
  In the SDK's debugger, `width: max-content` under `border-box` comes out short by the box's padding, so words wrap, while an absolute box with its width left alone fits them, and a border inside a rounded `<button>` is cut at the button's corners, though its overflow reads `visible` ([interface log][p24]).
- **Scaling:** in the SDK's debugger, a `transform: scale()` blurs text, and `zoom` scales layout and keeps text sharp, though a 1px height or `box-shadow` spread rounds down to nothing below a zoom of 1, and a border keeps its pixel (same entry).
- **Canvas:** in the SDK's debugger, a 2D canvas draws solid and alpha `fillRect`, `clearRect`, paths, arcs, strokes, and linear gradients, and a radial gradient only with both circles at one center.
  It takes no pixels: `putImageData` and `drawImage` draw nothing, `getImageData` throws `NotSupportedError`, and `toDataURL` returns an empty string, so a page that computes pixels draws each with a 1px `fillRect`, about 2.2ms for 1,250 pixels ([interface log][canvas]).
  A CSS `radial-gradient`, an SVG `radialGradient` with its focus off center, inset `box-shadow`s, and `filter: blur()` all draw.
- **Each document's defaults:** mainUi and the toolbar lay out a box with padding and a border as `border-box`, and the EFB's document as `content-box`, so our pages set `box-sizing` themselves.
- **Fonts:** mainUi and the toolbar declare Roboto as one family, `Roboto-Regular`, at weights 300 to 900, and Roboto Mono as `RobotoMono-Regular`.
  The EFB's document declares a family for each face, such as `Roboto-Bold` and `RobotoMono-Regular`, and sets its body in Verdana, so text there takes Roboto only from a rule that names a face.
  What an in-game panel's document declares is unmeasured.

## Re-measuring

A sim update can change any of this, so re-run [p09](../../../experiments/areas/architecture/p09-coherent-syntax.mjs) after each one, with the sim in a flight, and [p14](../../../experiments/areas/architecture/p14-coherent-css-full.mjs), with the sim at the main menu, after its `--baseline` run in current Chromium.

[p24]: ../interface/log.md#2026-11-01-in-the-sdks-debugger-zoom-scales-a-page-with-sharp-text-and-its-layout-motion-scrolling-and-real-input-in-step-where-a-transform-blurs-its-text
[p14]: log.md#2026-10-25-coherent-gt-keeps-304-of-the-554-css-properties-chromium-152-keeps-and-lays-out-flexbox-and-grid-as-chromium-does-but-for-gap-justify-content-end-and-subgrid
[p13]: log.md#2026-10-25-coherent-gt-drops-layer-oklch-color-mix-and-every-gap-but-grid-gap-so-tailwind-4s-output-cant-style-a-page-there
[p09]: log.md#2026-10-09-coherent-gt-parses-all-of-es2017-and-object-rest-but-no-other-syntax-from-es2018-on-has-no-built-in-from-es2018-on-of-its-own-but-weakref-and-runs-typescript-compiled-to-es2017-by-tsc-and-by-esbuild
[research]: log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework
[canvas]: ../interface/log.md#2026-11-01-coherent-gts-canvas-takes-no-pixels-so-a-figure-drawn-by-rays-cant-reach-the-screen-at-any-size-above-a-heads-while-the-fold-its-pin-and-its-masks-all-work
