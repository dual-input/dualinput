# Interface: tentative decisions

What stage 11b's design of the apps has settled so far, each with the findings behind it and what it leaves out.
The apps' design in this area confirms each one, changes it, or drops it, as [stage 11b](../build/plan.md#11b-the-apps) writes it, and the user leads that design.

## Dual Input's one full window is its EFB app

- **Decided:** every screen a pilot uses Dual Input through is in the EFB app: hosting and joining, the crew, preflight and Go to, take-control's button and its binding, the settings, traffic's packs, ATC audio, and the recordings.
  Quit lives only in the [tray](#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest).
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
- **Leaves out:** what a pilot sees of an update while the sim is closed, which the desktop app's design settles during the build; [the fixed local port](#the-desktop-app-tells-the-efb-app-about-updates-and-the-firewall-over-a-fixed-local-port) and [the Settings tab](#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version) settle the rest of how an update reaches the pilot.

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

- **Decided:** the EFB app, [the banner](#the-banner-draws-with-react-and-the-kit), and the desktop app's screens draw with one kit of our own React components, styled with Tailwind 3 through msfs-tailwind ([below](#tailwind-3-reaches-the-kit-through-msfs-tailwind-a-preset-of-our-own-for-coherent-gt)).
  Each page bundles React, pinned to 19.2.7, at `es2017` ([decision 030](../../decisions/030-in-sim-code-es2017-esbuild.md)).
  The kit's components use none of the EFB API's controls, while the EFB API stays the way our app registers with the EFB ([below](#the-efb-app-touches-the-framework-only-to-register-through-the-efbs-own-copy)).
  No screen of ours uses Vite, Tailwind 4, or shadcn's components, which reverses [decision 028](../../decisions/028-desktop-pages-react-vite-tailwind.md)'s Vite and Tailwind 4 for the desktop app's pages and keeps its React, and this reverses what remains of [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md), the EFB app's drawing on the MSFS Avionics Framework.
  Settled by the user on 2026-10-25, and moved from FSComponent to React on 2026-11-01.
- **Because:**
  - The user wants the whole interface in our control and our design (user, 2026-10-25).
  - The sim's look would have reached only the EFB app: it comes from `efb_os.css`, which the EFB's document loads, while the banner is an in-game panel with a page of its own, and no run has had that page link `efb_os.css` ([interface log][efb-styles]).
  - Tailwind 4's output and shadcn's theme draw nothing in Coherent GT ([architecture log][p13]), and a second front end for the desktop app's two screens would cost a second set of components (user, 2026-10-25).
  - The frames lean on content that changes shape, about 116 conditional blocks and 65 lists, and FSComponent has neither conditional rendering nor a keyed list, so we'd own a layer for both, which every later feature's part would inherit (user, 2026-11-01; [interface log][p23]).
  - React took a pilot's real click, wheel, and typing in the EFB's own document, and passed all 11 of p23's checks and the Coherent GT check, on the sim's own engine.
    On a card-sized change it stayed within 0.1ms of FSComponent, and it costs a 196 KB bundle and about 12ms more at a page's first mount (measured on MSFS 2024, 2026-11-01, [interface log][p23]).
  - Preact 11.1.1 is smaller, but failed as shipped, since it calls `queueMicrotask`, which Coherent GT lacks (same entry).
- **Leaves out:** what [the kit's package](#the-kit-and-dual-inputs-palette-are-one-package-in-this-repository) leaves out, and React's times under a flight's load, since p23 measured them at the world map.

## The banner draws with React and the kit

- **Decided:** the banner's page draws its notifications and the preflight summary with React and the kit, in a page of its own on page-client, which bundles its own copy of React and no copy of the MSFS Avionics Framework.
  State sync's checklist and the rest of preflight's help are the EFB app's, so the banner shows no part's view in places of its own.
  Settled by the user on 2026-10-25, and moved from plain markup to React on 2026-11-01.
- **Because:**
  - The banner's frame grew past a few lines, to 689 lines of cards that come, go, reorder, overflow, and drag, so plain markup would hand-build the layer [the kit's move to React](#the-apps-draw-with-a-kit-of-our-own-components-styled-with-tailwind-3) avoids (user, 2026-11-01).
  - A second copy of React costs about 2ms to parse and 13ms to mount once, as measured in the EFB's document ([interface log][p23]).
- **Leaves out:** which lines it shows, which [the banner's content](#the-banner-carries-what-a-pilot-must-see-without-the-efb-and-the-rest-shows-where-its-acted-on) and [its box](#the-banner-is-a-box-of-opaque-cards-at-the-screens-top-right) settle.

## Tailwind 3 reaches the kit through msfs-tailwind, a preset of our own for Coherent GT

- **Decided:** a Tailwind 3 preset of our own, msfs-tailwind, writes each color as `rgba()` around a custom property's RGB triplet, has autoprefixer add the `-webkit-` forms, and turns off the utilities Coherent GT drops.
  It lives in a private repository of its own, `dual-input/msfs-tailwind`, from its first commit in stage 11b, and Dual Input installs it with npm from GitHub, where npm's lockfile pins the commit, with no tags until Dual Input goes public ([build plan](../build/plan.md#11b-the-apps)).
  The lists of what p14 measured Coherent GT keeping are the Coherent GT check's data, which [decision 031](../../decisions/031-coherent-gt-check-tool.md) gives a repository of its own, `dual-input/coherent-checks`, made in stage 11b with msfs-tailwind's, and msfs-tailwind's test reads them from the check's package, so the measurements have one home.
  Settled by the user on 2026-10-25.
- **Because:**
  - It's a package for anyone building for Coherent GT, not a part of Dual Input (user, 2026-10-25).
  - It changes only when a probe finds something new about the engine, so a push there and an `npm update` here cost little.
  - With colors written that way and autoprefixer's `-webkit-` forms, Coherent GT keeps 82% of Tailwind 3's utilities, and every common variant but `focus-visible` and `has-` ([interface log][p17]).
  - Tailwind 3 writes a color as `rgb()` with spaces, which the engine drops, and Tailwind 4 writes its CSS in `@layer` and oklch, which it drops whole ([architecture log][p13]).
- **Leaves out:** whether it later goes public.

## The kit and Dual Input's palette are one package in this repository

- **Decided:** the kit's components, its reset, and Dual Input's palette are one npm package in this repository, `@dualinput/ui`, in `src/packages/ui/`, which our code imports by that name.
  `src/packages/` holds packages that are no tier's units, and the kit is its first.
  The palette is a second entry point of the package, `@dualinput/ui/palette`: the colors as hex, the CSS variables, and the Tailwind config that builds them on msfs-tailwind.
  A feature's EFB part imports the kit directly, so the code map's rule on what a part imports names the kit beside its shell and the messages' types ([the code map's rules](../architecture/02-code-map.md#tiers)).
  Settled by the user on 2026-10-25.
- **Because:**
  - The kit and the palette change with every screen stage 11b builds and every later stage that adds an EFB part, and a stage is reviewed as one diff of this repository ([working a stage](../build/plan.md#working-a-stage)).
  - Nothing but Dual Input uses them (user, 2026-10-25).
  - A package imported by its name moves to a repository of its own without a rewrite, if anything else ever needs it.
  - npm's `@dualinput/` scope says whose package it is, where a bare `ui` would read as a third-party library, and npm's registry already has one by that name, `ui` 0.2.4 as of 2026-10-25; the package is never published, so the scope needs no account (user, 2026-10-25).
- **Leaves out:** whether some of our engines or tools belong in `src/packages/` too, which a later review of the workspace may find (user, 2026-10-25).

## The EFB app touches the framework only to register, through the EFB's own copy

- **Decided:** none of our pages imports `@microsoft/msfs-sdk`.
  The EFB app's registration uses the EFB's own copy, its global `msfssdk`, for the app's `available` subject and the one host element the EFB renders, into which React mounts, as p23's app does.
  The desktop app's window, the banner, and the kit's tests and development pages use no framework but React, and need no stand-ins for the sim's globals.
  This settles which copy each page draws with, which [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md) left to this stage.
  Settled by the user on 2026-11-01.
- **Because:**
  - Of the 12 EFB apps the EFB loaded on our development machine, 11 draw with the EFB's own global `msfssdk`, Working Title's CIVA among them (read in each app's script as the EFB's document loaded it, 2026-10-25).
  - A bundled copy of npm's build would run, in the EFB's document, top-level code that assigns `SimVar.GetSimVarValue` after the EFB's own copy has (read in `@microsoft/msfs-sdk` 2.3.3, `msfssdk.js`), which the EFB's copy spares us; Working Title's Ground Services app is the one of the 12 whose bundled copy does it (same reading).
  - Registering takes so little of that copy that a sim update changing it reaches only our registration, where drawing with it would have reached every screen (inference).
- **Leaves out:** which version of the framework the EFB's copy is.

## The kit follows what the sim gives an EFB app

- **Decided:** the kit:
  - listens for mouse events, never pointer events, so in React it uses `onMouseDown` and never `onPointerDown`;
  - reads keys by `keyCode` and `charCode`;
  - has its text fields ask the sim for the keyboard the way the EFB's own text box does: the field cancels the press, focuses its input itself, and calls `FOCUS_INPUT_FIELD` on focus and `UNFOCUS_INPUT_FIELD` on blur;
  - carries a reset of its own, scoped to its root, rather than Tailwind's, which would restyle the EFB around our app;
  - and the EFB app links its own stylesheet when the EFB installs it.
  Settled by the user on 2026-10-25.
- **Because:**
  - In the EFB's document, `PointerEvent` is undefined, and a click came as `mousedown`, `mouseup`, and `click` ([interface log][p19]).
  - A key came with its `keyCode` and `charCode`, and with `key` null (same entry).
  - The EFB's text box cancels the press, focuses its input, and asks for the keyboard (read in MSFS 2024's `efb_os.js`, the text box's `onmousedown` and `onFocusIn`), as Fenix's EFB app's does (read in fnx-aircraft-320 2.4.0.4720, `FenixSimEfbApp.js`), and a React controlled field that does the same took real keys in order ([interface log][p23]).
  - Without Tailwind's reset, p18's page drew no borders in the EFB, since the reset is what sets `border-style` ([interface log][p19]).
  - The EFB loads no app's stylesheet: each app adds its own link, as CIVA's does through efb_api's `loadCss` (same entry).
- **Leaves out:** whether the sim also acts on keys typed into a field that didn't ask for the keyboard, which p19 saw reach the field but didn't watch the sim for.

## The EFB app fits its view with zoom on its root

- **Decided:** the app's layout flexes to the view it gets, so no width or height is fixed to the frames' 516 by 716 (user, 2026-11-01).
  Then the kit's root takes one number, its scale, which sets how big a frame's pixel is, as the CSS `zoom` property, so the frames' sizes stay as written, in code and in styles, and a bigger tablet draws the same page bigger, as the EFB's own apps do.
  A mouse event's position alone reads in the window's pixels, which the kit converts with its root's scale.
  A hairline is a border, or takes `--hair`, the length of one real pixel at the root's scale, since a 1px height or shadow rounds down to nothing below a scale of 1.
  If the sim's EFB turns out to differ, the fallback is every size written as `calc(Npx * var(--scale))`, which is how `efb_os.css` sizes itself, by a step on the built stylesheet, with a helper for each number in our code.
  The app starts below the EFB's status bar, which covers the view's top, so it has about 700 of its units for its height, against the frames' 716, and pages take up the difference by scrolling sooner ([interface log][p24-efb]).
  The scale follows the tablet, the view's shorter side over 516, so a Small tablet draws the same page smaller, about 12px where the frames write 14px at 0.866, which the user kept over text of one size with more room on Large, and over the sim's own text size with less room at every size (user, 2026-11-01).
  The user agreed on 2026-11-01, after p24 in the SDK's debugger and in the sim's EFB.
- **Because:**
  - A transform blurs text in the debugger, at every scale tried, and `zoom` and `calc()` both draw it sharp ([interface log][p24]).
  - Under `zoom`, offsets, rects, `scrollTop`, and a `translateX` all read and move in the frames' units, so the frames' motion carries over with no number changed (same entry).
  - With `calc()`, every number in our code that sets a size or a motion would need a helper, and one that missed it would show only at another scale.
  - The EFB's own stylesheet scales with the tablet the same way, by 504, 601, and 696 over 516 at the three sizes, so a pilot's choice of size means the same in our app as in the sim's ([interface log](log.md#2026-10-30-in-landscape-an-efb-apps-view-is-its-portrait-view-turned-on-its-side-about-696-by-433-in-the-efbs-own-units-against-468-by-660)).
- **Leaves out:**
  - The scale itself, which the EFB shell reads from the app's view.
  - A design for landscape, which p21 measured at about 696 by 433 of the EFB's units, and which waits until after the portrait build, with the layout's flex keeping it usable until then (user, 2026-11-01).
  - A pilot's real presses in the sim's EFB, and what it costs a frame, which [the list below](#stage-11b-checks-in-coherent-gt-what-the-frames-lean-on) holds.

## Go to from the EFB app runs through the menu script, so BlurPage stays

- **Decided:** the EFB app's Go to button sends `go-to`'s command, as any client's does, and the core runs the world map's requests through the menu script, which our copy of BlurPage brings into the menu's document ([Go to](../session/02-units.md#go-to)), so [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md) stands.
  Settled by the user on 2026-10-25.
- **Because:**
  - The EFB's document has no `requestData` bound and hears no answer to the airport search, while the menu's document does both ([interface log][p20]).
  - The toolbar's document and the world map's `Global/atlas.html` also chose a stand, and the toolbar's chose the airport by its world location, but at the world map no add-on's script runs in the toolbar's document (same entry), and no run has tried one in the atlas page.

## Join takes a joiner from the world map into the PF's flight, or only sets it up

- **Decided:** Go to, which the EFB app labels Join, sits at the end of the pilot flying's (PF's) row in a joiner's crew list, offered at Free flight's world map, and a press asks first, in the kit's confirm popover, with two answers:
  - Set up only: the menu script sets the PF's departure airport, their stand while their engines are off or a runway there while they run, their aircraft, and their livery where the joiner has it, and the joiner starts the flight.
  - Join now: the same, then the script starts the flight and presses Ready to fly.
    Its button takes the sim's own flight-button yellow, `#FFDE03` with `#242934` text, the world map's Start flight button's `--colorSpecial` and `--colorSpecial_Content` (read in fs-base-ui 0.1.10, `components/shared/variables.css`).

  So loading a pilot's flight for them, which [03-v1-scope](../product/03-v1-scope.md#preflight) leaves out of v1, is in v1 from the world map, and Go to from any other page stays [an idea](../product/ideas.md#the-pfs-spot-on-the-world-map).
  Join is disabled, and says why, while the PF has loaded no flight, while the PF's flight names no departure airport, while the joiner lacks the PF's aircraft, and while Dual Input has no copy of BlurPage.
  Its words name the PF and never use he or she, since Dual Input doesn't know a pilot's pronouns (user, 2026-10-29).
  A step that fails says which one ([Go to](../session/02-units.md#go-to)).
  When the world map lists no stand matching the PF's, the airport stays selected with no stand ([the menu script](../session/02-units.md#the-menu-script)), and Join now goes on to the aircraft, the livery, and the flight's start, since Dual Input moves the joiner's aircraft to the PF at the same airport.
  Settled by the user on 2026-10-29.
- **Because:**
  - v1 left it out on 2026-10-05 because Go to would have had to start from whatever page the pilot was on, which would add days to v1's build ([03-v1-scope](../product/03-v1-scope.md#preflight)).
    Since [Dual Input's one full window is its EFB app](#dual-inputs-one-full-window-is-its-efb-app), and the EFB opens at Free flight's world map, Go to is offered only there, so it starts from one page.
  - Every request Go to makes but the runway's ran in the menu's document, `mainUi`, at the world map: the airport search, the stand, the aircraft, the livery, and `launchFlight`, after which the flight loaded at the stand it was given ([interface log][p08]).
    Our script, brought in by our copy of BlurPage, made those requests and pressed Ready to fly from a closed sim ([interface log][p10]).
  - Set up only keeps a pilot's chance to set the fuel, the payload, or the weather before the flight starts (user, 2026-10-29).
- **Leaves out:**
  - Which entry of the joiner's `game/aircraft/aircraftList` is the PF's aircraft, which the session knows by its folder and preset, and which of `game/aircraft/configurator/liveries` is the PF's livery, which a sim session settles.
  - The runway request, which no run has tried ([the menu script](../session/02-units.md#the-menu-script)).

## A display name runs to 20 characters

- **Decided:** the [display name](../session/02-units.md#members) holds at most 20 characters: the apps' name fields stop there, a Windows username the first-time setup fills in is cut to 20, and the session crate refuses a longer name from any app's settings command.
  Settled by the user on 2026-10-29.
- **Because:**
  - Each place the app names a pilot, such as a crew row or Join's question, has room for a short name, and a name with no limit would overflow it.
  - Windows holds a user account's name to the same 20 characters ("The name of the user account can have as many as 20 characters.", read in Windows 11 Pro's `net help user`, 2026-10-29), so the Windows username that setup's name field starts with (user, 2026-10-25) fits as it is.
    Whether a Microsoft account's username keeps to it is unverified, which the cut covers.

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

## Traffic and ATC audio are shared apart, each by a switch of its own

- **Decided:** traffic and ATC audio are shared as two features, each with its own host and its own switch, and Dual Input doesn't check whether one pilot holds both roles.
  The Traffic tab's "Share my traffic" writes the traffic host's key, and the ATC audio tab's "Share my ATC" writes the ATC host's, each by itself, so a pilot can share either without the other, and a crew that wants one host for both turns both on.
  Each role keeps the rest of its row in [the table of roles](../session/01-roles-and-members.md#the-table-of-roles): any pilot takes it at any time by turning their own switch on, which turns the old holder's off, and only leaving the session releases it.
  On the session page, each host's crew row carries a chip with the icon of the tab whose role they hold, a plane for traffic and a headset for ATC.
  This changes [03-v1-scope](../product/03-v1-scope.md#hearing-atc)'s rule that the traffic host is also the ATC host, [roles and members](../session/01-roles-and-members.md#the-traffic-and-atc-host), the code map's [traffic and ATC switch](../architecture/02-code-map.md#the-traffic-and-atc-switch), and the architecture's tentative decision that [one request claims both](../architecture/decisions.md#traffic-and-atc-audio-each-hold-a-role-and-one-request-claims-both), and [decision 044](../../decisions/044-table-of-roles.md), which gives the two one role that can split, once step 8's decisions are numbered.
  Settled by the user on 2026-10-31.
- **Because:**
  - Each half has crews that want it alone.
    ATC without traffic suits a crewmate who can't match the traffic host's traffic packs or scenery, whose copies would go missing, fall back to stand-ins, or float or sink ([traffic sync](../product/03-v1-scope.md#traffic-sync)).
    Traffic without ATC suits a host whose traffic comes from an injector with no ATC voice.
    And [decision 044](../../decisions/044-table-of-roles.md) set aside the case that wants two hosts, an ATC app that injects no traffic on one machine beside a traffic injector on another, as too rare for v1.
  - The two roles already exist, since traffic and ATC audio each declare a key ([02-code-map](../architecture/02-code-map.md#the-traffic-and-atc-switch)), so a switch for each that writes its own key needs nothing a session key doesn't already do, where one host choosing either half would need a rule that both keys name the same pilot (user, 2026-10-31).
  - One switch for two tabs had no clean place: on one tab and explained on the other, or the same switch on both (user, 2026-10-31).
  - FS Copilot's build gave traffic and ATC audio a host each (FS Copilot fork, `record/traffic-atc/docs/03-implementation-plan.md`, "Decisions locked with the user (2026-09-06)", row 1).
- **Leaves out:**
  - A crew whose ATC and traffic come from two pilots may hear ATC talk about aircraft it doesn't see, since an ATC app works with the traffic in its own pilot's sim (unverified, and likely to differ by app); the crew settles that on voice, as it settles a tussle over a switch ([decision 044](../../decisions/044-table-of-roles.md)).
  - Whether the platform keeps its request that claims several keys together, which only the combined switch sent ([02-code-map](../architecture/02-code-map.md#the-traffic-and-atc-switch)): the user's to decide.

## The Traffic and ATC audio tabs hold their sharing, settings, and warnings, flagged by a dot on the tab's icon

- **Decided:** the Traffic tab holds "Share my traffic" and who shares, what a receiving pilot sets up by hand, traffic's warnings, and this PC's traffic packs:
  - on a receiving pilot's tab, two counts kept live: the traffic host's aircraft this sim shows as stand-ins or not at all, and the aircraft that aren't the traffic host's;
  - and on every pilot's tab, the traffic packs on this PC with their versions, as [traffic packs](../traffic-atc/01-traffic-and-atc.md#traffic-packs) lists them, for pilots to compare with the host's by hand, titled as the packs detected, since packs missing from Dual Input's known list don't show, and set apart in a tint as a supplement to the check.

  These replace traffic's two notifications on the banner, and traffic feeds no item of the match check, so the session card's heads-up list stays about the flight; the crew's lists of packs don't travel between the cores.
  The ATC audio tab holds "Share my ATC" and who shares; in the card, the setting of this pilot's role: the ATC app on the ATC host, Automatic or a program playing audio, marked while the capture takes it, and the ATC volume while another member is the ATC host; that Dual Input plays the ATC host's ATC app on every other pilot's machine; and the output device, shown but set in Settings.
  It holds no check and no rules, since everyone understands sharing audio, and shows only what goes wrong in Dual Input's own pipeline, which for now is nothing, since Automatic waits for an ATC app silently (user, 2026-10-31).
  While a tab holds a warning, an amber dot shows on its icon in the tab bar, on every page: for traffic, either count above 0, and ATC audio has none yet; the dot is big enough to notice, and no bigger.
  While a feature is being shared in the session, the header shows its tab's icon in green after the session's phase, so it shows on every page, for every pilot, host or not; the crew list's chips say who is sharing (user, 2026-10-31).
  While ATC audio is shared and this pilot's ATC volume is at 0%, its header icon turns gray with a slash, since the volume is a saved setting and a pilot who turned ATC down on a past flight would otherwise hear none without knowing why; the volume reads "Muted" (user, 2026-10-31).
  Outside a session both switches are off and can't be turned on, since a role is a session key, and the settings still change.
  Settled by the user on 2026-10-31.
- **Because:**
  - Two groups of FS Copilot's testers flew with airliners missing, because their traffic packs differed, without knowing ([traffic sync](../product/03-v1-scope.md#traffic-sync)), so the missing count shows on the tab, and the dot keeps it in view on every page.
    The count measures what a mismatch does, so it catches one whatever its cause, where comparing the crew's lists would have seen only the packs on traffic's known list, and needed the lists sent between the cores (user, 2026-10-31).
    A receiving machine creates the copies once its pilot is in the flight, preflight included, so the count shows before anyone flies.
  - Traffic's warnings concern a feature a crew may not use, and a pilot with traffic trouble looks in its tab, so they live there rather than on the banner or in the card's list (user, 2026-10-31).
    With nobody sharing traffic there's no host to compare against, so the tab shows no warning.
  - The output device carries every sound Dual Input plays, take-control's cues among them ([the devices](../core/04-core-helper.md#the-devices)), so one place sets it, and the ATC audio tab shows it where a pilot looking for ATC's sound looks.
- **Leaves out:**
  - Comparing the crew's traffic packs automatically, which the count covers.
  - What the list can't show: packs missing from traffic's list of known packs, which starts with `fsltl-traffic-base`, and a streamed pack's version, which it has none of on disk ([traffic packs](../traffic-atc/01-traffic-and-atc.md#traffic-packs)); the scenery, which nothing compares, stays a rule a pilot reads.
  - A warning when ATC breaks up, from the frames the core helper conceals, which waits for a threshold; a warning while the capture waits for an ATC app; and the sim's own ATC, which pilots who know ATC apps have off already (user, 2026-10-31).
  - What else sets the ATC audio tab's dot.

## Traffic polls within the sim's 200km cap, with no radius setting

- **Decided:** traffic has no radius setting: the traffic host polls AI aircraft and helicopters within 200km, the most the SDK allows, and ground objects within 1km, as before.
  The sharing pilot's Traffic tab notes, under how traffic sharing works, that traffic is shared as it is, so a slower PC than theirs can struggle, and they then lower the density in their AI traffic app.
  This changes [03-v1-scope](../product/03-v1-scope.md#traffic-sync), which gives a radius as a setting, [traffic and ATC](../traffic-atc/01-traffic-and-atc.md#settings)'s polling and settings, and [the Traffic and ATC audio tabs](#the-traffic-and-atc-audio-tabs-hold-their-sharing-settings-and-warnings-flagged-by-a-dot-on-the-tabs-icon), which held the setting.
  Settled by the user on 2026-10-31.
- **Because:**
  - A smaller radius leaves the aircraft that cost the most: at EGLL, reading AI aircraft within 100km in place of 200km kept 519.3 of 521.2 inputs a second, and within 50km kept 445.5 ([architecture log](../architecture/log.md#2026-10-16-reading-traffic-only-as-it-changes-within-50km-once-a-second-and-the-flight-model-and-camera-at-their-send-rates-would-shrink-p10s-recording-from-45-to-13-mb-an-hour)), so the traffic generators keep their aircraft near the pilot, and the airport's own aircraft, parked and taxiing, stay at any radius a pilot would pick (user, 2026-10-31).
  - Each copy costs a receiving sim about what the same AI traffic costs the host's: 44.7 fps with none, 38.0 with BeyondATC's 73 aircraft, and 32.5 with 132 copies in FS Copilot's measure ([budgets](../traffic-atc/01-traffic-and-atc.md#budgets)), so lowering the density at its source lightens the host's sim and every receiving sim alike.
  - A setting that changes little is one more thing every pilot reads past.
- **Leaves out:** whether a copy far away costs a receiving sim the frame time one at the gate does, which nobody has measured.

## The frames canvas holds the apps' looks, words, and motion

- **Decided:** the canvas at `experiments/areas/interface/bench/frames.html` shows each screen of the EFB app and the banner, in 13 sections: First run, Home, Session, Preflight, Flying, Traffic, ATC audio, Figures, Settings, App status, Aircraft picker, Banner, and Cockpit locks.
  Stage 11b rebuilds each frame in the kit, taking its sizes, colors, words, and timings from the frame's source in the bench's `src/frames/`, and since the frames are React too, its logic and motion where they don't rest on shadcn's components or a Coherent GT limit.
  The decisions below hold what a frame can't show: when each thing shows, what a press does, and why.
  The calls behind them, with the user's words and what was tried and dropped, are in [the PC session's calls](../../../experiments/areas/interface/bench/stage-11b-calls-pc.md) and [the cloud session's](../../../experiments/areas/interface/bench/stage-11b-calls-cloud.md).
  [The desktop app's own screens](#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest) have no frames, since the build designs them.
  Settled by the user on 2026-11-01.
- **Because:**
  - A frame's source is the one place each value is written, so this file doesn't repeat it.
  - Product code never imports from `experiments/`, and the bench draws with shadcn's components and Tailwind 4, which [no screen of ours uses](#the-apps-draw-with-a-kit-of-our-own-components-styled-with-tailwind-3), since Tailwind 4's output draws nothing in Coherent GT ([architecture log][p13]).
- **Leaves out:** the canvas's own code, which ships nowhere: each frame in a React root of its own behind an error boundary, live only near the view, and a name card below 35% zoom.
  A jump to a frame in the first seconds after the very first load can still drift while every frame is measured once.

## Stage 11b checks in Coherent GT what the frames lean on

- **Decided:** as the build reaches the first screen that uses each of these, it checks it in Coherent GT, since no run has shown it there:
  - A pilot's real presses under `zoom` in the EFB's own document, and what `zoom` costs a frame, since p24 measured its layout and hit tests there and no real input ([interface log][p24-efb]).
  - The EFB's frame rate in a flight, since it drew 15 frames a second at the world map, and how the frames' motion reads at that rate ([interface log][efb-frames]).
  - Text inside an element with `opacity` below 1, which lost an edge or drew a ghost line at some scales in the debugger, with `zoom`, with `calc()`, and at 1:1 ([interface log][p24]), since disabled states and fades both rest on it.
  - React in the banner panel's page, since p23 ran it only in the EFB's document.
  - `position: -webkit-sticky`, which pins the session card; the engine parses it, and nobody has seen it stick.
  - What a masked element costs a frame, for the [scrolling page's fold](#a-scrolling-page-folds-its-surfaces-and-a-change-on-a-page-is-one-moment-in-three-steps), since a browser usually draws one offscreen (unverified in Coherent GT); if it costs too much, the fallback is a hard top edge, with a 1px line under the header while the page is scrolled.
  - Animating an SVG stroke's dash offset, for the countdown's ring.
  - `align-items: baseline`, which centers the Traffic check's icons on their lines' capitals.
  - The figures' ray tracer, whose speed we measured only in Chrome and Node: about 5ms a pass for the standing figure and 0.40ms a head on our development machine, where the EFB shares the sim's frame time.
  - Whether the wheel glides or steps in an EFB app, for the page's coasting.
  - Whether clicks reach the cockpit through the banner's empty part, a [case in the sim](01-apps.md#cases-for-the-bench) that the banner's box was sized around.
- **Because:** Coherent GT drops what it can't parse with no error, and p13 and p14 found three things it parses and then ignores ([architecture log][p13]; [architecture log][p14]), so a frame that draws in a browser says nothing about these.
  The development loop, `tools/dev.ts`, runs each page in a copy of the SDK's CoherentGT Debugger with no sim ([interface log][p22]), so what it can't show is what this list checks.

## A pilot's head is traced, and a whole figure is drawn in SVG

- **Decided:** a head in a list or on a card stays ray traced, painted a pixel at a time with `fillRect`, and the standing figure and the portrait draw as SVG, with gradients sampled from the tracer's shading.
  The user saw the two side by side on 2026-11-01, and hasn't yet judged the SVG figure in the sim.
- **Because:** Coherent GT's canvas takes no pixels, so `fillRect` is the only way to paint a traced picture, which a 28px head can afford and a figure 260px wide can't; and SVG at 44px stays a little stepped, where a head's nose needs its smoothness ([interface log](log.md#2026-11-01-coherent-gts-canvas-takes-no-pixels-so-a-figure-drawn-by-rays-cant-reach-the-screen-at-any-size-above-a-heads-while-the-fold-its-pin-and-its-masks-all-work)).
- **Leaves out:** what either costs the sim's GPU in a flight, which a session in the sim settles.

## The desktop app shows Velopack's windows and its own figures, and the build designs the rest

- **Decided:**
  - Dual Input installs with Velopack's `Setup.exe` as it is, our splash image over its progress bar, with no MSI and no setup program of our own.
  - `Setup.exe` starts the app with its first-run flag, which opens a small window, "Welcome to Dual Input", with a line pointing to the EFB app and Dismiss as its only action.
  - While no `UserCfg.opt` exists, that window says MSFS 2024 hasn't run on this PC, so Dual Input can't install its sim components, and gives two steps: start the sim and close it, then start it again and find Dual Input in the EFB.
  - Applying an update shows Velopack's stock progress dialog, so the pilot sees what's happening while `Update.exe` has our programs stopped.
  - Quit lives only in the tray, where it asks once, as [installing and updating](../product/03-v1-scope.md#installing-and-updating) has it.
  - A left click on the tray icon opens the desktop app's main window, and a right click opens a native menu: a usage line with the tray app's own figures, Settings…, a separator, and Quit, where the usage line and Settings… open that window too.
  - The desktop app's main window shows the 24 hours of figures, the tray app's and the core's, and says in concrete terms what the app does for the pilot and what quitting costs, to persuade the pilot to keep it running and starting with Windows without hiding Quit.

  The rest of these screens is designed during the build: the tray menu's details, the update's progress window, the figures and how often the app samples them, how Start with Windows follows Windows' own switch for the Run value, and how the screen for no `UserCfg.opt` looks ([installing and updating's list](../install/01-installing-and-updating.md#left-to-the-apps-stage); user, 2026-11-01).
  Settled by the user on 2026-10-25, 2026-10-31, and 2026-11-01.
- **Because:**
  - A pilot works in the EFB app, so the first-run window only has to point there.
  - Offered a Quit in the EFB app's Settings, the user declined it (user, 2026-10-31).
- **Leaves out:** whether the window keeps a Start with Windows switch beside [the EFB app's](#the-settings-tab-holds-the-binding-the-output-device-the-recordings-and-the-version), which the outline's first call put there.

## The desktop app tells the EFB app about updates and the firewall over a fixed local port

- **Decided:** updates stay out of the core: the desktop app serves the update's state and the firewall rule's on a fixed 127.0.0.1 port, and the EFB app connects to it directly.
  The EFB app shows a new version and asks to restart the sim to install it, and the desktop app then closes the sim, installs, and starts the sim again.
  A rule that's missing or blocked shows as [the header's](#the-header-shows-only-what-needs-the-pilot) Windows Firewall row with Fix, which the desktop app carries out with the UAC prompt, as the first run does.
  If another program holds the port, the EFB app shows no update, and a developer's second desktop app runs without the server.
  Settled by the user on 2026-10-25.
- **Because:** the desktop app holds the update ([updates](../install/01-installing-and-updating.md#updates)), and an open window keeps no core running ([above](#dual-inputs-one-full-window-is-its-efb-app)), so the core can't carry its state.
- **Leaves out:**
  - The port number.
  - How the desktop app closes the sim cleanly, and whether it can start the Store edition, both unverified, which a run that does each settles.
  - How Start with Windows reaches the desktop app, which writes the Run value: this link is the likely way, and the build settles it.
  - A known cost: Fix's UAC prompt opens on the desktop behind the sim, which a pilot in VR can't see.

## First-time setup asks for the name and color once, and checks the PC and our servers

- **Decided:** first-time setup is a screen of the EFB app's own, shown once, with room for more steps later.
  Its name field starts with the Windows username, cut to [20 characters](#a-display-name-runs-to-20-characters), and the pilot changes it or presses Continue, which changes the call of 2026-10-16 that nothing fills it from the Windows account.
  The same name and color card serves [the Figures tab](#the-figures-tab-holds-the-pilots-figure-and-explains-what-its-figures-can-do).
  Its server check tells a PC that's offline from our servers being out of reach.
  The backend down and both relays down are one failure in setup, since either stops hosting and joining, while the shared check still tells them apart for the core's log and the header.
  One relay down passes, and every server failure waits and offers Continue anyway.
  Settled by the user on 2026-10-25 and 2026-10-28.
- **Leaves out:** a custom color, which the user deferred on 2026-10-28, since the figure in the sim takes only a palette index, so custom means baking a ring of hues after the presets and storing a position on it, a change to avatars' design.

## The core's log keeps display names, and replaces only the home folder's path

- **Decided:** the Windows username and Dual Input's display name are separate everywhere: once set, the display name is its own value, and logs and recordings keep it even when it matches the username.
  So the core's log stops replacing the bare username (`src/apps/core/src/log.rs`, `hide_word`), and keeps replacing the home folder's path.
  This changes [the home folder's path](../recording/01-recording-and-bug-reports.md#the-home-folders-path) and [the recording rule](../product/03-v1-scope.md#recording-and-bug-reports) of 2026-10-23, and [stage 11b](../build/plan.md#11b-the-apps) builds it.
  Settled by the user on 2026-10-25.
- **Because:** a display name equal to the username would otherwise be scrubbed, and display names make a crew's recordings readable to us.

## The EFB app is a header, five tabs, and take control under the tabs

- **Decided:** the tabs are Session, Traffic, ATC audio, Figures, and Settings, in that order.
  The Session tab holds home, then the session once Host or Join succeeds.
  An 8px amber dot at a tab icon's lower right flags a warning on that tab, on every page: traffic's [counts](#the-traffic-and-atc-audio-tabs-hold-their-sharing-settings-and-warnings-flagged-by-a-dot-on-the-tabs-icon), and the output device going missing.
  [Take control](#take-control-is-a-held-button-under-the-tabs-with-one-hold-of-035s) sits under the tab bar on every tab.
  Settled by the user on 2026-10-29 and 2026-10-31.
- **Because:** taking control can't wait for a tab switch (user, 2026-10-31).

## The header shows only what needs the pilot

- **Decided:**
  - Outside a session, the header shows the mark and the version.
    Once this pilot is in the flight of a session in preflight or flying, the phase stands in their place on every page: a dot, pulsing in preflight, "PREFLIGHT" or "SYNC ACTIVE", and in preflight the line "Sync starts once everyone's ready".
  - A pill at the right shows each thing wrong with this PC or waiting on its pilot, as a word and an icon, and opens into rows on a hover or a press; with nothing to show there's no pill, and nothing opens.
  - Its rows are: the PC offline, which takes our servers' place, since with no internet Dual Input can't tell whether they answer; our servers not answering; Windows Firewall blocking Dual Input, with Fix; the connection to other pilots failing to open; an update ready, with View update, which opens Settings on its update section; and, while it lasts, trouble in Dual Input's own parts, in the pill as "Screens", "WASM", "Helper", or "Keybind", so a [dismissed notification](#the-banner-is-a-box-of-opaque-cards-at-the-screens-top-right) loses nothing.
  - Each row's title says what's wrong, and its detail what that costs.
    Under them, when something's wrong, but not while offline or for an update alone, a line points to our Discord, since a confused pilot needs a way to people.
  - In a session each row says what it costs there: offline stays an error, since every link is down, and says Dual Input will reconnect and catch the pilot up; our servers and the firewall become warnings, since a running session doesn't wait on the backend, and the crew still flies on links that may be slower; and the update row hides, since installing restarts the sim.

  It has no row for these:
  - The service, since [the app's window](#without-the-service-the-efb-app-shows-one-of-three-screens-and-another-version-shows-setups-box) covers a lost one.
  - The sim, since the core's link to it ends only with the sim.
  - The aircraft, which home names.
  - A crewmate, whose crew row says what's wrong.

  Settled by the user on 2026-10-29, 2026-10-30, 2026-10-31, and 2026-11-01.
- **Because:**
  - Nothing said what state Dual Input was in, or explained what preflight is (user, 2026-10-30), and the header shows on every tab.
  - `iroh` punches again every 60s, so a relayed link could go direct within a minute of the firewall rule landing, which is why Fix stays in a session (inference).
- **Leaves out:** whether another pilot can still join when only this PC can't reach our servers, which is unverified.

## Without the service the EFB app shows one of three screens, and another version shows setup's box

- **Decided:** the EFB app reaches everything through the core, so losing it is the whole window's state:
  - Reconnecting, for a socket closed without a `bye` or 8s of silence: the window dims under a pill with a spinner, and the dimming layer catches every press, since every command would fail, while the page stays as it was under it.
  - Not running, for no core heard, or none 10s into reconnecting: the mark alone, no tabs, and setup's red box, with a line that it's waiting for the service to start.
  - Closed, after a `bye`: the same with no box or spinner, and how to open it to fly together.

  An EFB app whose version differs from the service's shows setup's "Add-on version mismatch" box in place of its pages, the same way.
  That overrides [the core's rule](../core/02-clients-and-panel-bridge.md#a-client-whose-version-differs) and [Trouble's row](01-apps.md#trouble) that a page from another version reaches only the log.
  Settled by the user on 2026-10-29 and 2026-11-01.
- **Because:**
  - The desktop app restarts a crashed core 2s after it exits ([when the core goes](01-apps.md#when-the-core-goes)), so most losses end while the page is still under the pill.
  - The EFB app is part of our package, and nobody can join a flight without seeing it, so it's where a version mismatch shows (user, 2026-11-01).

## Home names the loaded aircraft and offers Host and Join, in any aircraft

- **Decided:** the start card names the loaded aircraft by maker, model, and tail number (`A:ATC ID`), at the world map too, and holds Host and Join.
  - A first visit shows a guide in the page's room, its pages Flying together, Who flies, Preflight, Profiles, and the aircraft check; Skip guide and Done close it for good, and "Have a nice flight!" fades in as it goes.
  - A later visit shows the profile authors' notes, once the format holds them, on a slip that looks foreign to Dual Input, scrolling inside the slip and signed from the profile's `authors`.
  - With no notes, the rest of the page holds the pilot's figure on foot, which follows the cursor, reacts to Host, the code, and Join, leaps away when one succeeds, and slumps when one is refused.
  - An unsupported aircraft is amber everywhere, not red, and home keeps Host and Join there, listing what still works, then offering the aircraft picker and how to build a profile.

  Traffic and ATC setup stay out of the guide, for their own tabs.
  Settled by the user on 2026-10-26 and 2026-10-29.
- **Because:**
  - The main menu loads the selected aircraft, and SimConnect sends `AircraftLoaded` for it (measured on MSFS 2024, 2026-10-07, [flight-controls log](../flight-controls/log.md)), so home can name it before any flight.
  - A session in an unsupported aircraft still flies with flight-model sync, control, traffic, and ATC (user, 2026-10-26).
- **Leaves out:** the page for how to build a profile, disabled with "Coming soon" until it exists.

## Host and Join answer inside the start card

- **Decided:** Host shows that it's starting, then that the session started; Join shows a spinner, then a check; and the code field locks while our servers answer.
  A refusal opens under the control that asked, in setup's red box: our servers not answering, the PC offline, or one of the backend's four, no such session, this pilot's version older, the host's version older, and too many wrong codes.
  A code naming no session also marks its slots red, and too many wrong codes says when the pause ends and points to our Discord.
  This pilot's older version offers "Restart the sim to update", and the host's says they need to leave the session and update, since a host updates only outside one.
  After 6s with no answer, a plain line opens under the control with a local Cancel, which keeps the code: one line while our servers haven't answered, and another once a join's code is found and it's dialing, which never gives up on its own.
  Settled by the user on 2026-10-29 and 2026-11-01.

## A dangerous action asks in the kit's popover, with no Cancel

- **Decided:** a press on a dangerous action opens the kit's popover above the button, pointing at it, or below where there's no room, with a short question and one button, such as "Restart the sim?" and "Restart now", or for [Join](#join-takes-a-joiner-from-the-world-map-into-the-pfs-flight-or-only-sets-it-up) its two answers.
  It has no explanation, since a simmer knows the consequences, and no Cancel, since a press outside or Escape cancels.
  The popover takes the focus, so Enter can't confirm, and a double click on the button shuts it rather than confirming.
  The button that opened it looks pressed in while it asks.
  It serves restarting the sim to update, setup's add-on failure, Leave once anyone else is in the session, Join, and Delete on a recording; Take over takes over at once, and doesn't ask.
  Settled by the user on 2026-10-29, 2026-10-30, and 2026-10-31.

## The aircraft picker loads an aircraft through the world map's store, and only at the world map

- **Decided:** home's Switch to a supported aircraft and the guide's "supported aircraft" link open a large popup over the app's window: the installed aircraft Dual Input has a profile for, as tiles with their maturity, then the rest under "Not installed", dimmed, which never load.
  On the world map, a press on a tile loads it, the others dimming until it's done, and the popup closes with home following the new aircraft.
  In a flight the rows don't press, and the popup says to end the flight and pick on the world map.
  Settled by the user on 2026-10-29.
- **Because:** it works through the world map's store, as Go to does, with `game/aircraft/aircraftList` and `game/aircraft/configurator/setAircraftForConfigurator`, sent by the menu script, since the EFB's document can't send them ([interface log][p20]).
- **Leaves out:**
  - Whether the aircraft list holds only owned aircraft, whose entries carry `isUsable` and rental data, and how a profile, matched by SimObjects folder and preset, finds its entry, which a sim session settles.
  - The world map's aircraft thumbnails on the tiles, once a sim session shows they can be read for the whole list.

## The session page is home once a session starts

- **Decided:** after Host or Join alike, the start card turns into the session card, which ends the page, with no authors' notes:
  - It holds the invite code with Copy, on every pilot's card, since the code belongs to the session; Leave; and the crew.
  - The crew lists each pilot by their figure's head, this pilot first, with the PF marked "Pilot flying"; alone, a dashed row says to send the invite code.
    A head pops in as its pilot's row appears.
  - Under each name, in small muted text, is where the pilot is, or in the warning color "Connection lost" or "Sim crashed".
    A pilot with a link shows it as a quiet chip after the name, such as "Relay · 120ms", and each host of [traffic or ATC](#traffic-and-atc-audio-are-shared-apart-each-by-a-switch-of-its-own) a chip of their tab's icon.
  - [Join](#join-takes-a-joiner-from-the-world-map-into-the-pfs-flight-or-only-sets-it-up) ends the PF's row on a joiner's card, with where the PF is under their name, and the row's end otherwise shows nothing before preflight.

  Once the flight starts, the card keeps the code, Leave, the crew, and the [differences](#preflight-is-the-session-card-with-ready-the-differences-and-a-checklist-under-it) folded to their counts, and the checklist, the hand line, Ready, the countdown, and the Go without button are gone.
  Settled by the user on 2026-10-29 and 2026-10-31.
- **Because:** the host's next milestone is a crewmate joining, so the page points there (user, 2026-10-29).

## Preflight is the session card with Ready, the differences, and a checklist under it

- **Decided:**
  - Preflight shows from the PF being in a flight on the ground, and a joiner still at the world map sees no checklist and no phase until they're in the flight, while preflight stays session-wide in [the session's units](../session/02-units.md).
  - Each crew row ends on Ready or "Not ready", and this pilot's own Ready fills green with a check, a press again undoing it, disabled with a tooltip until the aircraft settles ([decision 048](../../decisions/048-settled-30s-after-ready-to-fly.md)).
  - A reload of the flight clears this pilot's Ready and stops the countdown, with nothing built for it: a reload passes through Loading, which [leaves the flight](../session/02-units.md#in-the-flight), and a member that leaves the flight during preflight writes its Ready off (read in `src/platform/session/src/members.rs`).
  - A dropped-out pilot stays unready and counted, and once this pilot is ready, their row offers Go without, then "Not counted"; the PF can't be gone without.
  - Once every counted pilot is ready, a green ring just before this pilot's Ready counts the 3s down, so nothing shifts, and un-readying stops it.
  - The crew lists this pilot first, then the pilots the countdown waits on, then the rest, in a window of three rows and part of a fourth, during preflight only.
  - The differences list under the crew rows with no title, an error's red X or a warning's triangle, the difference, then a muted note, in a window of three and part of a fourth; a note says what the difference can cause, and never advises or commands.
    Once the flight starts they fold to a row of two counts, which opens the list, and a new difference changes the counts without opening it (user, 2026-11-01).
    "No profile for this aircraft" stays among them, since a joiner can reach the flight without passing home's page for it, and the profile hash line goes, against the call of 2026-10-18 that it shows once, while "Unpublished profile" stays as a muted note when every pilot loaded one.
  - Under the card, every pilot gets a line with a hand icon, "Avoid unnecessary cockpit interactions until the flight starts, as some may not sync.", outside the checklist so it shows with no checklist too.

  Settled by the user from 2026-10-29 to 2026-10-31.
- **Because:** nearly every difference names a crewmate, and [the scope](../product/03-v1-scope.md#preflight-match-check) has them beside each Ready (user, 2026-10-30).

## The checklist takes any entry an author writes, and every pilot has one

- **Decided:** the checklist sits on the page under the card, on every pilot's side: the PF's opens with the counted controls, then the items every pilot sets, and the joiner's holds those items alone.
  Ready doesn't wait on its boxes.
  Author-written entries have no format rules, since Dual Input makes some entries itself and they can't be hand-fixed:
  - A value never truncates, and wraps past half the row.
  - A name is cut hard at the line's edge, and slides to its end while pointed at.
  - Names and values read as written, with the first letter a capital, so "cabin PRESS valve" reads "Cabin PRESS valve".
  - An optional `description` shows under the name, at any length.
  - Rows go by entry ID.

  Reset checklist, under the rows and disabled until a row is checked, unchecks them all with no confirmation, and nothing clears them by itself.
  While the session card is unfolded, the whole checklist, its title and subtitle included, shows at 50% opacity, and it comes up to full as the card folds, or at once under a pointer or keyboard focus, so it never reads as disabled.
  Settled by the user on 2026-10-30 and 2026-10-31.
- **Because:**
  - Dual Input's own items, the counted controls, are the PF's, and items for every pilot come only from profile authors after v1 ([the profile format's additions](#the-profile-format-gains-a-name-a-maturity-and-an-entrys-description)).
  - An automatic clear on a reload could clear a pilot's checks on a signal that wasn't a reload (user, 2026-10-31).
- **Leaves out:**
  - How a value displays, since v1's `default` is a bare number with no unit, zero padding, or switch labels.
  - Where the checked rows live; the call that had the core keep them, so a reload of the EFB's panel doesn't lose them, went with the automatic clear.

## The session card folds with the page's scroll while a checklist waits under it

- **Decided:** during preflight, the first stretch of scrolling folds the whole card into a row of heads and Ready, with the checklist rising with its edge, and past it the checklist scrolls under the row; a pill on the card's bottom edge folds and unfolds it.
  A drag scrubs the fold, a card's content scrolling one for one as each head docks in the row; a click, a snap after letting go, a wheel's rest, a flick's coast, and the flight's start animate it as one motion.
  In the folded row, each head carries a badge, a green check once ready, a red cross while out of the flight, and an empty ring while the countdown waits on them, and past 7 pilots the row shows 6 heads and +N.
  The page keeps the whole card's height in flow, so folding never changes the scroll range and can't loop.
  Before preflight and once the flight starts, nothing waits under the card, so it doesn't fold.
  Settled by the user on 2026-10-30 and 2026-10-31.
- **Because:** a card pinned whole left the checklist 143px on a host with differences, or 71px on a joiner (measured in the bench, 2026-10-30), and the fold keeps Ready in view.
  The session card's fold in the bench is `drawFold` and `FOLD` in `frames/home.tsx`.

## In preflight the heads watch the cursor

- **Decided:** while the cursor is on the EFB, each preflight head watches it, within a 30-degree cone, each a little late, seeded by its pilot's name, so a sweep ripples across the crew.
  With the cursor off the EFB, heads rest.
  Over this pilot's unpressed Ready every head looks at it and bobs, over Leave every head shakes slowly, and a pilot who readies nods while the rest turn to them for a moment.
  A pilot out of the flight slumps, still, at 40% opacity.
  In the folded row each head turns its back as it docks, so at rest it's a plain colored ball that never redraws.
  A head draws only while its look moves.
  Settled by the user on 2026-10-31.
- **Because:** "things that are alive are constantly in motion" (user, 2026-10-31), and a still cursor costs nothing, where heads that looked around by themselves read as chaotic.

## Take control is a held button under the tabs, with one hold of 0.35s

- **Decided:** one large button sits under the tab bar on every tab.
  A click does nothing, and holding it fills a narrow bar left of the label, which appears at once on the press, so a fast clicker sees it needs a hold.
  The hold is 0.35s, and a bound key's long press moves to 0.35s with it, so the gesture has one number; this changes [the binding](../control/01-take-control.md#the-binding)'s and [the scope's](../product/03-v1-scope.md#take-control-key) 1s.
  The bound key's name shows as an outline at the button's other end, and with no key bound there's none.
  The PF sees the same element as a state, "You have control", in a sky tint.
  Lines go under the button with an icon of their own: while catching up, a neutral spinner and "Taking control disabled while you catch up", with the button dimmed; while the link to the PF is lost, the amber triangle and "James may still be flying. If you take control, their aircraft will jump to yours when they reconnect."
  Settled by the user on 2026-10-31.
- **Because:** a takeover through a lost link raises control's generation, so on reconnect it wins, the old PF's aircraft moves to the new PF's, and their solo changes are dropped and undone by a catch-up ([between machines](../network/01-between-machines.md#control)), which a pilot reaching for the key should read first.
- **Leaves out:** left-aligning the label when a binding is set, which the user skipped for now.

## The sharing card is one row in every state, and each tab teaches its feature

- **Decided:** each of [the Traffic and ATC audio tabs](#the-traffic-and-atc-audio-tabs-hold-their-sharing-settings-and-warnings-flagged-by-a-dot-on-the-tabs-icon) opens on a sharing card of one row, what's happening on its left and its control on its right:
  - While nobody's sharing, "Share my traffic" and a switch; while this pilot shares, their head, "You're sharing traffic", and the switch on; while another pilot shares, their head, "James is sharing traffic", and Take over, which takes over at once, with no question.
  - Outside a session, the row does nothing, its switch off, and says sharing needs a session.
  - With a switch in it, the whole row is one target out to the card's edges, for a VR pointer.

  Then "How it works", in a sentence or two, the user's words.
  Traffic's then lists "Rules" while nobody's sharing and outside a session, and "Check" once someone is: on a receiving pilot's tab the two counts, and on the host's nothing.
  Each rule says why, as a muted line under it: own AI traffic off, the same traffic packs, and the same scenery.
  The Traffic tab's performance note, under How it works, shows only on the sharing pilot's tab, since it speaks to them.
  This PC's traffic packs sit at the page's foot in a tinted box, so they hold still as what's above them opens and shuts.
  The ATC app picker offers Automatic, then every program playing audio, the known ATC apps first; closed, it says what it captures, such as "Automatic · BeyondATC", with a green dot while the capture takes it, and with no ATC app running it reads "Automatic", with no warning.
  A receiving pilot's output device shows under the volume as one quiet row that opens Settings, and their volume reads "Muted" at 0%.
  No screen says Dual Input carries no voice, since nothing says it carries any (user, 2026-11-01).
  Settled by the user on 2026-10-31 and 2026-11-01.
- **Because:** people don't understand how a feature works from a switch alone, and a pilot needs one coherent place that explains it and shows its status (user, 2026-10-31).
- **Leaves out:**
  - Where Dual Input states that multiplayer must be off, which is a rule for all of Dual Input rather than traffic's (user, 2026-10-31).
  - Whether a copy in another pack's livery or floating over other scenery counts as missing: the count sees only the creates the sim refused, and whether the sim refuses a title it lacks is a [check in the sim](../traffic-atc/01-traffic-and-atc.md#creating-a-copy).

## The Figures tab holds the pilot's figure and explains what its figures can do

- **Decided:** the tab holds setup's name and color card; in a session, a new name brings a line that it applies in the next session, since a member's entry is never rewritten after the first message ([session keys](../session/02-units.md#session-keys)).
  It has four switches, "Your figure" and "The crew's figures", each with "Inside the aircraft" and "Walkaround", where [the scope's avatar sync](../product/03-v1-scope.md#avatar-sync) has two.
  Three guides that open sit at the page's foot: how seats work, how pointing and clicking works, and how to hide the sim's default avatar.
  A note at the top, in the information color and with no tab dot, says when pointing and clicking won't work because the aircraft's model files can't be read, with a Learn more that opens that guide, or when the profile has no seats, so figures show as floating heads only.
  Interface copy says "figure" for Dual Input's and "avatar" only for the sim's own.
  Settled by the user on 2026-10-31.
- **Because:** a notification that a model can't be read was annoying, popping up again and again (user, 2026-10-31), and this replaces [avatars'](../avatars/01-avatars.md#a-seat) notifications with this note and with "This seat is taken".
- **Leaves out:** the steps in the guide that hides the sim's avatar: the menu path comes from forum posts, unverified, and the avatar's name in it is hypothetical.

## The Settings tab holds the binding, the output device, the recordings, and the version

- **Decided:** four sections, in this order:
  - Take control: the key or button, one key only, so neither a modifier alone nor a combination binds; Press or Hold; and a line to keep it unbound in the sim's own controls.
  - Sound: "Output device", since it carries every sound Dual Input plays; a picked device that's missing says what's playing instead, in amber, and lights the tab's dot.
  - Recordings: the space used of 1 GB, then each run by its start, in the pilot's time, and its size, newest first.
    The run in progress can be opened but not deleted, since a pilot reporting a problem now needs it, and a recording that stopped, at under 1 GB free or on a failed write, says so here, since nothing else tells the pilot.
    Open folder's toast says it opened on the desktop, since Explorer opens behind the sim, and a line under the card says what a run keeps and that a report starts with `log.txt` on Discord.
  - Dual Input: Start with Windows, on at first, then the version with the update's state: up to date with when it checked and Check now, checking, downloading with how far, or failed with the error and Try again.
    A ready update grows a box: "Close the sim to install." over Install and restart, which asks first, or in a session "Install it when you're not in a session." with no button.

  The name, color, sharing, the ATC app, and the volume stay on their tabs; the microphone comes with the voice phrases, after v1; and the relay list ships with each release.
  Settled by the user on 2026-10-31 and 2026-11-01.
- **Because:** [the one full window](#dual-inputs-one-full-window-is-its-efb-app) moves the desktop app's settings here, the runs' list with them, and a report asks for the log first and the recording only when the log isn't enough ([recording and bug reports](../recording/01-recording-and-bug-reports.md)).
- **Leaves out:** whether the core zips a report's folder, which for now opens in Windows Explorer; and turning off an aircraft plugin, skipped in the design for now.

## The banner carries what a pilot must see without the EFB, and the rest shows where it's acted on

- **Decided:** a notification is information, a warning, or trouble, the last for trouble that costs the pilot a feature, and none carries a button in v1.
  - On the banner, held while its cause lasts: the lost link; catching up, one word for a late joiner's catch-up and a short outage's replay; the PF in the pause menu, on the others' banners; Dual Input's service gone or reconnecting; the panel bridge not loading; our WASM module stopped or missing; the Windows helper down; a key Windows refuses; and "This seat is taken", while this pilot's camera is in the seat.
  - On the banner, shown once: control passing or refused, with the reason; for a PF who lost control through the lost link, once back, that what they changed alone was undone; a crewmate leaving the flight or the session, closing their sim, crashing, or coming back; and a control that couldn't sync, once per entry each load, several at one load as one.
  - Elsewhere: the output device in Settings; traffic's counts on its tab; the unreadable model on the Figures tab; offline, our servers, the firewall, and the update in the header; Host and Join refused in the start card; and a recording that stops in Settings.
  - Dropped: the warning after a takeover through a lost link, by which time the deed is done, with its words on the lost link's line; "Adam is in the A320", which the crew row shows; the crash's ask for a bug report; our package missing or from another version, which [the EFB app's box](#without-the-service-the-efb-app-shows-one-of-three-screens-and-another-version-shows-setups-box) shows; and each crewmate's link, which the crew rows show.

  Settled by the user on 2026-11-01.
- **Because:**
  - A pilot with the EFB closed doesn't see the app's own screen, so anything that stops every feature, such as the service going, has to reach the banner.
  - A crewmate who leaves the flight, closes their sim, or crashes is still in the session, so their card says so.
  - The pause menu's line stays because it explains a frozen aircraft or says the PF is away from the controls: anyone can open that menu, since Dual Input syncs only active pause, and whether it stops a flying aircraft is unmeasured (user, 2026-11-01).
- **Leaves out:**
  - A list of sync failures on the session card, which the user set aside until a need shows (user, 2026-11-01), so a click on one lands on the Session tab with nothing there to list it.
  - The panel bridge's check, no cockpit panel's `hello` within 10s of the profile loading, which warns falsely in an aircraft with no cockpit panels, such as a balloon, so it needs to know the aircraft has panels.

## A notification's click opens the EFB app where it's explained or acted on

- **Decided:** the order that opens the EFB carries where to land, which [notifications](01-apps.md#notifications) left open:
  - The Session tab, for control passing or refused, the lost link, a takeover while away, catching up, the pause, a crewmate leaving or back, sync failures, and the preflight summary, since the take-control strip, the crew rows, the checklist, and the differences are there.
  - The header opened on the row that repeats it, for trouble in the panel bridge, the WASM module, the Windows helper, and a refused key.
  - The Figures tab, for "This seat is taken", since it explains seats.
  - Wherever the app was, for the service gone, since the app's own screen covers every tab.

  Settled by the user on 2026-11-01.
- **With the service gone,** no core can carry the click, so the banner's page raises `L:DUALINPUT_BANNER_OPEN_EFB`, and the EFB app reads it every 200ms only while its own link is down, the one way we've measured from a panel to the EFB's document ([log](log.md#2026-10-04-a-click-on-a-notice-in-our-panel-opens-the-efb-onto-another-app-whether-the-efb-was-open-or-closed)).

## The banner is a box of opaque cards at the screen's top right

- **Decided:** the banner's box sits 16px in from the screen's right edge and 210px down from its top, 360px wide and 390px tall, room for the preflight summary and three notifications, above the instrument panel.
  - Cards stack down from the top, newest first, with the summary leading during preflight.
    Each is opaque, with its edge an inset ring and no shadow.
  - A one-time card stays 6s, paused under the pointer.
  - An × at a card's top right, always shown, dismisses it, as does dragging it right past a third of its width or flinging it; a click anywhere else opens the EFB app.
    A held card dismissed stays hidden until its cause ends, and shows again if the cause comes back.
    The summary has no ×, since it's the banner's whole job during preflight, it leaves when the flight starts, and the toolbar's button closes the banner.
  - When cards don't fit, the oldest one-time cards leave early; held ones keep their places by trouble, then warnings, then information, newest first in each; and the rest wait behind a line at the box's foot, "3 more" with Dismiss all.
    A card coming out from behind that line arrives at the stack's foot, where the line said it was, and a new notification arrives at the top.

  Settled by the user on 2026-11-01.
- **Because:**
  - The sim blurs whatever lies behind a panel's painted pixels, so a translucent pixel would show it, and we know no way to turn it off (unverified: no run has measured it, and a look at a translucent card in the sim settles it).
  - A full-height column would block a third of the cockpit if clicks don't pass through its empty part, which no run has tried ([cases in the sim](01-apps.md#cases-for-the-bench)).
- **Leaves out:** how the banner shows in VR, beyond the same panel.

## A visible lock is a veil over the display with one centered card

- **Decided:** a visible lock is a veil over the whole display, which stays readable through it, tinted for its lock with a fine hatch, and over it a card like the banner's, one centered column of icon, title, message, and Dismiss where it has one, smaller only on a display too small for it.
  - While this machine has no link up to the PF, in amber: "Reconnecting to James" over "When they reconnect, their actions during the outage will be replayed here."
  - While it catches up, neutral with a spinner: "Catching up with James", with no way out, since it ends by itself.
  - Once the core stops renewing the lock, 8s to 10s after its last renewal, tinted from our trouble color: "Dual Input stopped responding" over "This screen works, but won't be synced until Dual Input is back.", with Dismiss.
    Presses pass through this veil to the display, and only its card takes them.
    Dismiss clears the warning on every display at once, by the CommBus event `DUALINPUT_BRIDGE_DISMISS`, since the core is silent then.
  - The unseen lock paints nothing, since the other pilot's figure at the display shows who's pressing, and the blocked press's flash fills the display in our error red at 55% while the press is held.

  This changes [what the bridge owns](../architecture/02-code-map.md#what-the-bridge-owns), whose warning blocks nothing and has no button, and adds to [names the sim shares](../architecture/02-code-map.md#names-the-sim-shares).
  Settled by the user on 2026-11-01.
- **Because:**
  - The CommBus reached every cockpit panel (measured on MSFS 2024, 2026-10-08, [interface log][coverage]).
  - Anything in the pilot's input path must fail open: blocking the whole display until Dismiss would hang the release on the pilot, or on the button's own script.
  - "Replayed" is the record's word for how a link cut under 30 minutes comes back, and reads plainly where the sentence says whose actions and where (user, 2026-11-01).

## A scrolling page folds its surfaces, and a change on a page is one moment in three steps

- **Decided:**
  - A change on a page is one moment: what's going fades, the layout settles, and what's arriving fades in, starting once the layout is about 80% there, so two states never show at once.
    Pages move only `transform` and opacity, with positions from offsets, for Coherent GT.
  - The app's scrolling boxes draw no scrollbar; their fades say there's more, and dragging anywhere scrolls, coasting from a fast release.
  - A scroll box's fades are a mask on the box itself, so they can't part from its clip, except the fade under the Session page's pinned card, which stays a layer, since the card pins inside the box.
    On every other tab's page, that mask covers only the foot: at the top, a surface folds under the page's top edge, and words and controls outside a surface each fade through a mask of their own.
  - A guide that opens scrolls the page just enough to show it whole, and not at all when it shows already.

  A surface's fold in the bench, `foldPage` in `frames/scroller.tsx`, isn't the product's shape, since it reads a border's color from a computed `box-shadow` and sets its masks on a card's children.
  In the product the card owns its fold, as an unclipped wrapper around a clipped layer and a border layer, and one scroll loop sets two numbers, the clip's depth and the fade's strength, from offsets, on the elements each card registers.
  Settled by the user on 2026-10-30 and 2026-10-31.
- **Because:** at a fraction of a pixel, a box's clip rounded out to the row its edge fell in, while a fading layer covered only a sliver of that row, so a row of what scrolled under showed at full strength past the fade (measured in Chromium, 2026-10-31).
- **Leaves out:**
  - What the fold costs a frame ([above](#stage-11b-checks-in-coherent-gt-what-the-frames-lean-on)).
  - Whether the aircraft picker's, the match check's, and the authors' notes' fades feel heavy, which waits until one shows as a problem (user, 2026-11-01).

## The apps' words follow a few rules

- **Decided:**
  - Words name pilots and never use he or she, since Dual Input doesn't know anyone's pronouns.
  - A status of something happening now takes the progressive, "James is sharing traffic", and present simple stays for how things work.
  - A tooltip or toast of one sentence takes no period.
  - A pilot reads "session" where Dual Input means one, not "flight", which would turn "Adam left the flight" into a claim about the main menu.
  - One word serves a catch-up and a replay on the banner and the header, "catching up", since "replay sounds like it's unrelated to you".
  - Everything in a colored box takes the box's palette, its hovers and focus rings included.

  Settled by the user on 2026-10-29, 2026-10-31, and 2026-11-01.

## The profile format gains a name, a maturity, and an entry's description

- **Decided:** level 1 of the profile format gains `name`, the aircraft's name as the EFB app's list shows it, and `maturity`, `stable` or `experimental`, which the profile's authors set, and [stage 11b](../build/plan.md#11b-the-apps) adds them.
  A state entry gains an optional `description`, which the checklist shows under its name ([profile entries](../sync/01-profile-entries.md)).
  The `checklist:` block and the authors' notes come after v1, and the design has made room for both.
  Settled by the user on 2026-10-26 and 2026-10-30.

## Mark the moment leaves the EFB app

- **Decided:** the EFB app has no button that marks the moment, and the core's `recording.mark` command (`src/platform/recording/src/lib.rs`) stays, with no sender, for a later button.
  This changes [marking the moment](../recording/01-recording-and-bug-reports.md#marking-the-moment) and [the scope's EFB app](../product/03-v1-scope.md#efb-app).
  Settled by the user on 2026-10-31.
- **Because:** every input is recorded with its time, so a pilot's rough time still finds the moment (user, 2026-10-31).

[coverage]: log.md#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel
[efb-frames]: log.md#2026-11-01-the-efbs-document-draws-15-frames-a-second-at-the-world-map-half-the-rate-of-the-sims-other-documents-so-a-quick-click-often-lands-between-two-frames
[p24-efb]: log.md#2026-11-01-in-the-sims-own-efb-zoom-lays-out-and-hit-tests-as-in-the-debugger-the-efbs-status-bar-covers-the-views-top-25px-and-a-picture-taken-with-the-sims-hdr-on-reads-about-twice-too-bright
[p24]: log.md#2026-11-01-in-the-sdks-debugger-zoom-scales-a-page-with-sharp-text-and-its-layout-motion-scrolling-and-real-input-in-step-where-a-transform-blurs-its-text
[p22]: log.md#2026-11-01-the-sdks-coherentgt-debugger-runs-our-pages-in-coherent-gt-with-no-sim-and-matches-the-sims-efb-on-1159-of-p14s-1170-css-items-and-on-repeated-work-in-a-loaded-page
[p23]: log.md#2026-11-01-react-19-runs-in-the-efbs-own-document-and-takes-a-pilots-real-click-wheel-and-typing-and-on-a-card-sized-change-it-stays-within-01ms-of-fscomponent
[p02]: ../install/log.md#2026-10-25-an-egui-window-in-a-rust-tray-app-takes-96-mb-to-153-mb-while-open-and-leaves-62-mb-to-69-mb-in-the-process-once-it-closes-where-tauris-leaves-37-mb
[p08]: log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight
[p10]: log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly
[p13]: ../architecture/log.md#2026-10-25-coherent-gt-drops-layer-oklch-color-mix-and-every-gap-but-grid-gap-so-tailwind-4s-output-cant-style-a-page-there
[p14]: ../architecture/log.md#2026-10-25-coherent-gt-keeps-304-of-the-554-css-properties-chromium-152-keeps-and-lays-out-flexbox-and-grid-as-chromium-does-but-for-gap-justify-content-end-and-subgrid
[p17]: log.md#2026-10-25-by-p14s-measurements-coherent-gt-keeps-82-of-tailwind-3s-output-with-its-colors-written-as-rgba-and-autoprefixers--webkit--twins-and-every-common-variant-but-focus-visible-and-has
[p19]: log.md#2026-10-25-inside-an-efb-app-clicks-the-wheel-hover-focus-and-typing-reach-our-elements-and-a-127001-frame-as-mouse-and-keyboard-events-geist-loads-as-ttf-but-not-woff2-and-p18s-page-renders-there-with-tailwind-3
[p20]: log.md#2026-10-25-the-efbs-document-cant-make-go-tos-requests-on-the-world-map-and-no-add-ons-script-runs-in-the-toolbars-there-so-an-efb-apps-go-to-still-needs-the-menu-script
[efb-styles]: log.md#2026-10-24-the-sims-efb-styles-its-apps-controls-through---efb--variables-sized-from-a-516-by-716-base-and-an-app-gets-the-controls-by-bundling-the-sdks-efb-api
