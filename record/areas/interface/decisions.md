# Interface: tentative decisions

What stage 11b's design of the apps has settled so far, each with the findings behind it and what it leaves out.
The apps' design in this area confirms each one, changes it, or drops it, as [stage 11b](../build/plan.md#11b-the-apps) writes it, and the user leads that design.

## Dual Input's one full window is its EFB app

- **Decided:** every screen a pilot uses Dual Input through is in the EFB app: hosting and joining, the crew, preflight and Go to, take-control's button and its binding, the settings, traffic's packs, ATC audio, the recordings, and Quit.
  The desktop app stays the Tauri program that runs from login as a tray icon and does the watcher's jobs, and its window shows only its own screens: the update's progress, and the last 24 hours of its own and the core's CPU and memory use, which it records itself ([installing and updating](../product/03-v1-scope.md#installing-and-updating)).
  No screen of the desktop app's needs the core, so an open window keeps no core running, and the desktop app wants a core while the sim runs or a session file exists.
  The EFB app has no button that brings the desktop app forward, so stage 11b takes out what stage 11a built for it: `clients`' command for the button, and the core's start of the desktop app's program with `--data` ([bringing the desktop app forward](01-apps.md#bringing-the-desktop-app-forward)).
  Go to is offered only at Free flight's world map, where the EFB opens, and not from the main menu's home page.
  Settled by the user on 2026-10-25.
- **Because:**
  - The sim's EFB opens with the Tab key in every flight, whatever tablet the aircraft has of its own, and at the world map (user, 2026-10-25).
  - Inside an EFB app of ours, clicks, the wheel, hover, focus, and typing reach our elements ([interface log][p19]).
  - Go to works from the EFB app as from any client, through the core and the menu script ([below](#go-to-from-the-efb-app-runs-through-the-menu-script-so-blurpage-stays)).
  - Hosting or joining only once the sim is up costs a pilot little, since flying needs the sim anyway, and so does offering Go to only at the world map (user, 2026-10-25).
  - An update can start from the EFB app: the pilot agrees to restart the sim, and the desktop app closes the sim, installs the update, and starts the sim again (user, 2026-10-25).
    No run has tried that end to end, and whether the desktop app can start the Microsoft Store edition of the sim is unverified; a run that starts each edition from the desktop app settles it.
  - A Rust tray app drawing its screens with egui held 61 MB to 67 MB more than its tray alone once its window closed, 62.6 MB to 68.6 MB in all, where Tauri's held 1.5 MB more, so the desktop app keeps Tauri for its screens ([install log][p02]).
- **Leaves out:** how the EFB app shows an update and asks for Install now, such as an icon beside the settings icon in its tabs (user, 2026-10-25), how that request reaches the desktop app, which holds the update ([updates](../install/01-installing-and-updating.md#updates)), and what a pilot sees of an update while the sim is closed, all of which the apps' design settles later.

## The apps are dark only

- **Decided:** the EFB app, the banner, and the desktop app's screens have one dark look and no light one, so they follow no Windows setting.
  Settled by the user on 2026-10-25.
- **Because:** the user chose it, and our pages in the sim can't follow a Windows setting either, and sit in an EFB that has only a dark look:
  - The sim's EFB is dark alone: `efb_os.css` holds no light theme and no `prefers-color-scheme` query (read in fs-base-efb 0.1.10, `efb_os.css`, 2026-10-25).
  - Coherent GT doesn't parse `prefers-color-scheme` ([architecture log][p13]).

## The apps take shadcn's Luma look at a 4px radius, on neutral grays, with Tailwind's sky-300 as the main color, and Geist

- **Decided:** the kit's components copy the look of shadcn's Luma preset, with pill-shaped switches, on Tailwind's neutral grays at the steps shadcn's dark theme uses, such as `neutral-950` for the background.
  Their main color, shadcn's `primary`, is Tailwind's sky-300, `oklch(82.8% 0.111 230.318)`, which is `#74d4ff`.
  Their radius, shadcn's `--radius`, is 0.25rem, 4px, from which Luma draws each component's corners: about 10px on buttons and cards, about 9px on inputs and badges, about 7px on tabs, and full pills on switches.
  Their font is Geist, with Geist Mono for codes, shipped as TTF.
  The status colors are Tailwind's 400 steps of amber, red, and green, each with its chroma held to 0.14, and slate-300 with its chroma raised to 0.05:

  | For | Color | As hex, for Coherent GT | Contrast on `neutral-950` |
  | --- | --- | --- | --- |
  | Information, a notification's lowest level | `oklch(86.9% 0.05 252.894)` | `#bdd7f5` | 13.4:1 |
  | Warning | `oklch(82.8% 0.14 84.429)` | `#f1be4d` | 11.5:1 |
  | Trouble, which is shadcn's `destructive` too | `oklch(70.4% 0.14 22.216)` | `#ea7977` | 7.1:1 |
  | Success, such as Ready | `oklch(79.2% 0.14 151.711)` | `#6fd58d` | 10.9:1 |

  A status chip is soft: its color at 15% behind text in its color.
  Settled by the user on 2026-10-25, and moved from Nova at 10px to Luma at 4px on 2026-10-26, on a bench of mockups in `experiments/areas/interface/bench`, which draws the user's sketch of an app's screen in each of shadcn's eight presets, nine grays, and any main color.
- **Because:**
  - Luma takes each corner from `--radius` by a step of its own, from `--radius-sm` at 0.6 times it to `--radius-4xl` at 2.6 times, which its buttons and cards use (read in the bench's `src/index.css` and `src/presets/luma/`), so at 4px those keep corners near the 10px they had under Nova.
  - Luma's controls stand one step taller than Nova's, a small button 32px against 28px and a large one 40px against 36px (read in the bench's `src/presets/luma/button.tsx` and `src/presets/nova/button.tsx`).
  - The user kept `#7ad7ff` on the bench, `oklch(83.6% 0.105 227.9)`, then took the Tailwind color nearest it, sky-300, `oklch(82.8% 0.111 230.318)` (computed from the two colors).
  - `#7ad7ff` is the EFB's `--efb-primary-color`, `#00b4ff` ([interface log][efb-styles]), lightened: both have a hue of 198° in HSL, at a lightness of 74% against the EFB's 50% (computed).
  - Sky-300 has 11.9:1 contrast on `neutral-950` (computed), and a button filled with it takes dark text.
  - Coherent GT reads hex colors but not oklch ([architecture log][p13]), so the kit takes each color as its hex.
  - Information takes a gray with a cool tint, so it stays apart from sky-300, where a blue of its own would read as a second main color, and the user found violet and purple ugly; its tint is raised from slate-300's 0.022 so it reads apart from the neutral grays too (user, 2026-10-25).
  - Tailwind's 400 steps, at chroma up to 0.209 for green, were too rough beside sky-300's 0.111, and their solid chips too strong, so the user held their chroma to 0.14 and took soft chips (user, 2026-10-25).
  - Coherent GT drew Geist's TTF, from our package and from 127.0.0.1, and drew its WOFF2 from neither ([interface log][p19]).
  - The hex values and contrasts are computed from the oklch colors.
- **Leaves out:** whether the apps show the pilots' figure colors, and how those stay apart from the status colors; and how many of Luma's class names Tailwind 3 builds, which p17 measured for Nova's alone ([interface log][p17]).

## The apps draw with a kit of our own components, styled with Tailwind 3

- **Decided:** the EFB app and the desktop app's screens draw with one kit of our own components, styled with Tailwind 3 through msfs-tailwind ([below](#tailwind-3-reaches-the-kit-through-msfs-tailwind-a-preset-of-our-own-for-coherent-gt)), and the banner takes the kit's colors without its components ([below](#the-banner-draws-its-few-lines-in-plain-markup-with-the-kits-colors-and-no-framework)).
  In the sim and in the desktop app's window alike, the kit's components are the MSFS Avionics Framework's FSComponent components ([decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md)), and they use none of the EFB API's controls, while the EFB API stays the way our app registers with the EFB.
  No screen of ours uses React, Vite, Tailwind 4, or shadcn's components, which reverses [decision 028](../../decisions/028-desktop-pages-react-vite-tailwind.md)'s React, Vite, and Tailwind for the desktop app's pages.
  Settled by the user on 2026-10-25.
- **Because:**
  - The user wants the whole interface in our control and our design (user, 2026-10-25).
  - The sim's look would have reached only the EFB app: it comes from `efb_os.css`, which the EFB's document loads, while the banner is an in-game panel with a page of its own, and no run has had that page link `efb_os.css` ([interface log][efb-styles]).
  - Tailwind 4's output and shadcn's theme draw nothing in Coherent GT ([architecture log][p13]), and a second front end for the desktop app's two screens would cost a second set of components (user, 2026-10-25).
  - A page of FSComponent components styled with Tailwind 3 passed its checks and drew in an EFB app of ours, and in Edge, the engine WebView2 embeds ([interface log][p19]; [interface log][p18]).
- **Leaves out:** what [the kit's package](#the-kit-and-dual-inputs-palette-are-one-package-in-this-repository) leaves out.

## The banner draws its few lines in plain markup, with the kit's colors and no framework

- **Decided:** the banner's page draws its notifications and a few short lines, such as the preflight countdown and a line asking the pilot to open the EFB app for preflight's help, as plain markup from a small script on page-client, with no FSComponent and no copy of the framework.
  Its styles take the kit's colors from the same palette, through msfs-tailwind's classes or the kit's color variables, so the palette is written down once.
  State sync's checklist and the rest of preflight's help are the EFB app's, so the banner shows no part's view in places of its own.
  Settled by the user on 2026-10-25.
- **Because:** a few cards and lines need no component framework, and a banner without one bundles no copy of it (user, 2026-10-25).
- **Leaves out:** which lines the banner shows beside its notifications, and their looks and words, which the apps' design settles.

## Tailwind 3 reaches the kit through msfs-tailwind, a preset of our own for Coherent GT

- **Decided:** a Tailwind 3 preset of our own, msfs-tailwind, writes each color as `rgba()` around a custom property's RGB triplet, has autoprefixer add the `-webkit-` forms, and turns off the utilities Coherent GT drops.
  It lives in a private repository of its own, `dual-input/msfs-tailwind`, from its first commit in stage 11b, and Dual Input installs it with npm from GitHub, pinned to a tag ([build plan](../build/plan.md#11b-the-apps)).
  The lists of what p14 measured Coherent GT keeping are the Coherent GT check's data, which [decision 031](../../decisions/031-coherent-gt-check-tool.md) gives a repository of its own, `dual-input/coherent-checks`, made in stage 11b with msfs-tailwind's, and msfs-tailwind's test reads them from the check's package, so the measurements have one home.
  Settled by the user on 2026-10-25.
- **Because:**
  - It's a package for anyone building for Coherent GT, not a part of Dual Input (user, 2026-10-25).
  - It changes only when a probe finds something new about the engine, so a tag there and a bump here cost little.
  - With colors written that way and autoprefixer's `-webkit-` forms, Coherent GT keeps 82% of Tailwind 3's utilities, and every common variant but `focus-visible` and `has-` ([interface log][p17]).
  - Tailwind 3 writes a color as `rgb()` with spaces, which the engine drops, and Tailwind 4 writes its CSS in `@layer` and oklch, which it drops whole ([architecture log][p13]).
- **Leaves out:** whether it later goes public.

## The kit and Dual Input's palette are one package in this repository

- **Decided:** the kit's components, its reset, its stand-ins for the sim's globals, and Dual Input's palette are one npm package in this repository, `@dualinput/ui`, in `src/packages/ui/`, which our code imports by that name.
  `src/packages/` holds packages that are no tier's units, and the kit is its first.
  The palette is a second entry point of the package, `@dualinput/ui/palette`: the colors as hex, the CSS variables, and the Tailwind config that builds them on msfs-tailwind.
  So the banner and the desktop app's window take it without the components.
  A feature's EFB part imports the kit directly, so the code map's rule on what a part imports names the kit beside its shell and the messages' types ([the code map's rules](../architecture/02-code-map.md#tiers)).
  Settled by the user on 2026-10-25.
- **Because:**
  - The kit and the palette change with every screen stage 11b builds and every later stage that adds an EFB part, and a stage is reviewed as one diff of this repository ([working a stage](../build/plan.md#working-a-stage)).
  - Nothing but Dual Input uses them (user, 2026-10-25).
  - A package imported by its name moves to a repository of its own without a rewrite, if anything else ever needs it.
  - npm's `@dualinput/` scope says whose package it is, where a bare `ui` would read as a third-party library, and npm's registry already has one by that name, `ui` 0.2.4 as of 2026-10-25; the package is never published, so the scope needs no account (user, 2026-10-25).
- **Leaves out:** whether some of our engines or tools belong in `src/packages/` too, which a later review of the workspace may find (user, 2026-10-25).

## Our pages import FSComponent from `@microsoft/msfs-sdk` as npm ships it

- **Decided:** the kit imports the framework from npm's `@microsoft/msfs-sdk`, as its documentation and every developer of the sim's interfaces do.
  The EFB app draws with the EFB's own copy, its global `msfssdk`, so its build leaves the package out of its bundle, and it bundles a copy of its own only if a sim update breaks it through that one.
  The desktop app's window, which has no such copy, bundles npm's, pinned to 2.3.3, npm's newest as of 2026-10-25, and the banner uses no framework ([above](#the-banner-draws-its-few-lines-in-plain-markup-with-the-kits-colors-and-no-framework)).
  This settles which copy each page draws with, which [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md) left to this stage.
  A page or test outside the sim, such as the desktop app's window or the kit's development server, defines stand-ins for the four sim globals the package reaches for as it loads, `SimVar`, `RunwayDesignator`, `Avionics`, and `BaseInstrument`, before it loads the package.
  Settled by the user on 2026-10-25.
- **Because:**
  - A new developer knows the usual import, where a copy of the framework's modules taken from the package or from Microsoft's source would be one more thing to learn (user, 2026-10-25).
  - Of the 12 EFB apps the EFB loaded on our development machine, 11 draw with the EFB's own global `msfssdk`, Working Title's CIVA among them (read in each app's script as the EFB's document loaded it, 2026-10-25).
  - A bundled copy of npm's build would run, in the EFB's document, top-level code that assigns `SimVar.GetSimVarValue` after the EFB's own copy has (read in `@microsoft/msfs-sdk` 2.3.3, `msfssdk.js`), which the EFB's copy spares us; Working Title's Ground Services app is the one of the 12 whose bundled copy does it (same reading).
  - A bundled copy would keep a sim update from changing the framework under us, which the user takes on until an update breaks us (user, 2026-10-25), and p19's app showed that a bundled second copy draws beside the EFB's ([interface log][p19]).
  - npm's build throws outside the sim, since its top-level code assigns to `SimVar`, and with the four stand-ins it loaded in Edge and passed all 10 of p18's checks ([interface log][stand-ins]; [interface log][p18]).
  - A stand-in answers any call with nothing, so code that reads the sim gets no data outside it, and outside the sim we need only the kit's rendering.
- **Leaves out:** which version of the framework the EFB's copy is, while the kit builds and tests against npm's 2.3.3.

## The kit follows what the sim gives an EFB app

- **Decided:** the kit:
  - listens for mouse events, never pointer events;
  - reads keys by `keyCode` and `charCode`;
  - has its text fields ask the sim for the keyboard the way the EFB's own text box does: the field cancels the press, focuses its input itself, and calls `FOCUS_INPUT_FIELD` on focus and `UNFOCUS_INPUT_FIELD` on blur;
  - carries a reset of its own, scoped to its root, rather than Tailwind's, which would restyle the EFB around our app;
  - and the EFB app links its own stylesheet when the EFB installs it.
  Settled by the user on 2026-10-25.
- **Because:**
  - In the EFB's document, `PointerEvent` is undefined, and a click came as `mousedown`, `mouseup`, and `click` ([interface log][p19]).
  - A key came with its `keyCode` and `charCode`, and with `key` null (same entry).
  - The EFB's text box cancels the press, focuses its input, and asks for the keyboard (read in MSFS 2024's `efb_os.js`, the text box's `onmousedown` and `onFocusIn`), as Fenix's EFB app's does (read in fnx-aircraft-320 2.4.0.4720, `FenixSimEfbApp.js`).
  - Without Tailwind's reset, p18's page drew no borders in the EFB, since the reset is what sets `border-style` ([interface log][p19]).
  - The EFB loads no app's stylesheet: each app adds its own link, as CIVA's does through efb_api's `loadCss` (same entry).
- **Leaves out:** whether the sim also acts on keys typed into a field that didn't ask for the keyboard, which p19 saw reach the field but didn't watch the sim for.

## Go to from the EFB app runs through the menu script, so BlurPage stays

- **Decided:** the EFB app's Go to button sends `go-to`'s command, as any client's does, and the core runs the world map's requests through the menu script, which our copy of BlurPage brings into the menu's document ([Go to](../session/02-units.md#go-to)), so [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md) stands.
  Settled by the user on 2026-10-25.
- **Because:**
  - The EFB's document has no `requestData` bound and hears no answer to the airport search, while the menu's document does both ([interface log][p20]).
  - The toolbar's document and the world map's `Global/atlas.html` also chose a stand, and the toolbar's chose the airport by its world location, but at the world map no add-on's script runs in the toolbar's document (same entry), and no run has tried one in the atlas page.

## The Coherent GT check covers the CSS we ship into the sim

- **Decided:** the check [decision 031](../../decisions/031-coherent-gt-check-tool.md) gives every JavaScript file we ship into the sim also checks every CSS file we ship there, and stage 11b builds it, since the kit is the first CSS we ship there.
  It passes only what our probe p14 measured the engine keeping, so CSS no run has tried fails until a probe measures it.
  It also fails what the engine parses and then ignores, which a parse alone would pass: layout cases in p13 and p14 found three, `column-gap`, `justify-content: end`, and `display: contents`, which computes as `inline`.
  Settled by the user on 2026-10-25.
- **Because:**
  - Coherent GT drops what it can't parse with no error, so a dropped `gap` shows only as a wrong layout in the sim, while the same CSS draws in a browser ([architecture log][p13]).
  - p14 found that it drops 250 properties, 44 selectors, and 50 of our function samples that Chromium 152 keeps ([architecture log][p14]).
  - The check already runs on every JavaScript file we ship into the sim, after each edit and in `tools/check.ts`, from a data file that holds the lists in [Coherent GT's JavaScript and CSS](../architecture/coherent-gt.md) ([the Coherent GT check](../build/01-the-build.md#the-coherent-gt-check)).
  - A list of what the engine drops would pass everything no probe tried, which is where a silent drop hides, while a list of what it keeps fails that CSS where the developer writing it sees the failure.
- **Leaves out:** its CSS parser; how its data comes from p14's results, so a run of p14 after a sim update refreshes it; and CSS written in a component's markup rather than a stylesheet, which the stage's design of the check settles.

[p02]: ../install/log.md#2026-10-25-an-egui-window-in-a-rust-tray-app-takes-96-mb-to-153-mb-while-open-and-leaves-62-mb-to-69-mb-in-the-process-once-it-closes-where-tauris-leaves-37-mb
[p13]: ../architecture/log.md#2026-10-25-coherent-gt-drops-layer-oklch-color-mix-and-every-gap-but-grid-gap-so-tailwind-4s-output-cant-style-a-page-there
[p14]: ../architecture/log.md#2026-10-25-coherent-gt-keeps-304-of-the-554-css-properties-chromium-152-keeps-and-lays-out-flexbox-and-grid-as-chromium-does-but-for-gap-justify-content-end-and-subgrid
[p17]: log.md#2026-10-25-by-p14s-measurements-coherent-gt-keeps-82-of-tailwind-3s-output-with-its-colors-written-as-rgba-and-autoprefixers--webkit--twins-and-every-common-variant-but-focus-visible-and-has
[p18]: log.md#2026-10-25-fscomponent-runs-in-edge-when-a-bundle-takes-only-the-sdk-modules-it-needs-in-81-kb-while-the-sdk-as-npm-ships-it-throws-on-load-outside-the-sim
[p19]: log.md#2026-10-25-inside-an-efb-app-clicks-the-wheel-hover-focus-and-typing-reach-our-elements-and-a-127001-frame-as-mouse-and-keyboard-events-geist-loads-as-ttf-but-not-woff2-and-p18s-page-renders-there-with-tailwind-3
[p20]: log.md#2026-10-25-the-efbs-document-cant-make-go-tos-requests-on-the-world-map-and-no-add-ons-script-runs-in-the-toolbars-there-so-an-efb-apps-go-to-still-needs-the-menu-script
[stand-ins]: log.md#2026-10-25-the-sdk-as-npm-ships-it-loads-in-a-browser-once-four-of-the-sims-globals-have-stand-ins
[efb-styles]: log.md#2026-10-24-the-sims-efb-styles-its-apps-controls-through---efb--variables-sized-from-a-516-by-716-base-and-an-app-gets-the-controls-by-bundling-the-sdks-efb-api
