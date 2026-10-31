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
  - The words, which the apps' design settles.

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
  - The two tabs' words, which the apps' design settles.

## The Traffic and ATC audio tabs hold their sharing, settings, and warnings, flagged by a dot on the tab's icon

- **Decided:** the Traffic tab holds "Share my traffic" and who shares, what a receiving pilot sets up by hand, and traffic's warnings:
  - a check of each receiving pilot's known traffic packs against the traffic host's, with their versions, which every pilot's Traffic tab shows, so the host sees which crewmates lack or add which packs, and a receiving pilot sees their own;
  - and, on a receiving pilot's tab, two counts kept live: the traffic host's aircraft this sim shows as stand-ins or not at all, and the aircraft that aren't the traffic host's.

  These replace traffic's two notifications on the banner, and traffic feeds no item of the match check, so the session card's heads-up list stays about the flight.
  The ATC audio tab holds "Share my ATC" and who shares; on the ATC host, which program the capture takes, or that it's waiting for one; the ATC app and ATC volume settings; what a receiving pilot sets up by hand; that Dual Input carries no voice, so the crew talks over Discord; and the output device, shown but set in Settings.
  While a tab holds a warning, an amber dot shows on its icon in the tab bar, on every page: for traffic, a pack that differs or either count above 0, and for ATC audio, such as its capture waiting for an ATC app; the dot is big enough to notice, and no bigger.
  Outside a session both switches are off and can't be turned on, since a role is a session key, and the settings still change.
  Settled by the user on 2026-10-31.
- **Because:**
  - Two groups of FS Copilot's testers flew with airliners missing, because their traffic packs differed, without knowing ([traffic sync](../product/03-v1-scope.md#traffic-sync)), so the packs are compared before aircraft go missing, and the dot keeps a difference in view on every page.
  - Traffic's warnings concern a feature a crew may not use, and a pilot with traffic trouble looks in its tab, so they live there rather than on the banner or in the card's list (user, 2026-10-31).
    With nobody sharing traffic there's no host to compare against, so the tab shows no warning.
  - The output device carries every sound Dual Input plays, take-control's cues among them ([the devices](../core/04-core-helper.md#the-devices)), so one place sets it, and the ATC audio tab shows it where a pilot looking for ATC's sound looks.
- **Leaves out:**
  - How each pilot's list of traffic packs reaches the others, which traffic's design adds; [traffic and ATC](../traffic-atc/01-traffic-and-atc.md#left-open) expected an ask and an answer on a channel of traffic's.
  - What the check can't see: packs missing from traffic's list of known packs, which starts with `fsltl-traffic-base`; a streamed pack's version, which it has none of on disk; and the scenery ([traffic packs](../traffic-atc/01-traffic-and-atc.md#traffic-packs)).
  - What else sets the ATC audio tab's dot, the tabs' words, and their look.

## Traffic polls within the sim's 200km cap, with no radius setting

- **Decided:** traffic has no radius setting: the traffic host polls AI aircraft and helicopters within 200km, the most the SDK allows, and ground objects within 1km, as before.
  When the crew's frame rate suffers, the Traffic tab's rules point the sharing pilot to the traffic density where their traffic comes from, the sim's settings or their traffic app's.
  This changes [03-v1-scope](../product/03-v1-scope.md#traffic-sync), which gives a radius as a setting, [traffic and ATC](../traffic-atc/01-traffic-and-atc.md#settings)'s polling and settings, and [the Traffic and ATC audio tabs](#the-traffic-and-atc-audio-tabs-hold-their-sharing-settings-and-warnings-flagged-by-a-dot-on-the-tabs-icon), which held the setting.
  Settled by the user on 2026-10-31.
- **Because:**
  - A smaller radius leaves the aircraft that cost the most: at EGLL, reading AI aircraft within 100km in place of 200km kept 519.3 of 521.2 inputs a second, and within 50km kept 445.5 ([architecture log](../architecture/log.md#2026-10-16-reading-traffic-only-as-it-changes-within-50km-once-a-second-and-the-flight-model-and-camera-at-their-send-rates-would-shrink-p10s-recording-from-45-to-13-mb-an-hour)), so the traffic generators keep their aircraft near the pilot, and the airport's own aircraft, parked and taxiing, stay at any radius a pilot would pick (user, 2026-10-31).
  - Each copy costs a receiving sim about what the same AI traffic costs the host's: 44.7 fps with none, 38.0 with BeyondATC's 73 aircraft, and 32.5 with 132 copies in FS Copilot's measure ([budgets](../traffic-atc/01-traffic-and-atc.md#budgets)), so lowering the density at its source lightens the host's sim and every receiving sim alike.
  - A setting that changes little is one more thing every pilot reads past.
- **Leaves out:** whether a copy far away costs a receiving sim the frame time one at the gate does, which nobody has measured.

[p02]: ../install/log.md#2026-10-25-an-egui-window-in-a-rust-tray-app-takes-96-mb-to-153-mb-while-open-and-leaves-62-mb-to-69-mb-in-the-process-once-it-closes-where-tauris-leaves-37-mb
[p08]: log.md#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight
[p10]: log.md#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly
[p13]: ../architecture/log.md#2026-10-25-coherent-gt-drops-layer-oklch-color-mix-and-every-gap-but-grid-gap-so-tailwind-4s-output-cant-style-a-page-there
[p14]: ../architecture/log.md#2026-10-25-coherent-gt-keeps-304-of-the-554-css-properties-chromium-152-keeps-and-lays-out-flexbox-and-grid-as-chromium-does-but-for-gap-justify-content-end-and-subgrid
[p17]: log.md#2026-10-25-by-p14s-measurements-coherent-gt-keeps-82-of-tailwind-3s-output-with-its-colors-written-as-rgba-and-autoprefixers--webkit--twins-and-every-common-variant-but-focus-visible-and-has
[p18]: log.md#2026-10-25-fscomponent-runs-in-edge-when-a-bundle-takes-only-the-sdk-modules-it-needs-in-81-kb-while-the-sdk-as-npm-ships-it-throws-on-load-outside-the-sim
[p19]: log.md#2026-10-25-inside-an-efb-app-clicks-the-wheel-hover-focus-and-typing-reach-our-elements-and-a-127001-frame-as-mouse-and-keyboard-events-geist-loads-as-ttf-but-not-woff2-and-p18s-page-renders-there-with-tailwind-3
[p20]: log.md#2026-10-25-the-efbs-document-cant-make-go-tos-requests-on-the-world-map-and-no-add-ons-script-runs-in-the-toolbars-there-so-an-efb-apps-go-to-still-needs-the-menu-script
[stand-ins]: log.md#2026-10-25-the-sdk-as-npm-ships-it-loads-in-a-browser-once-four-of-the-sims-globals-have-stand-ins
[efb-styles]: log.md#2026-10-24-the-sims-efb-styles-its-apps-controls-through---efb--variables-sized-from-a-516-by-716-base-and-an-app-gets-the-controls-by-bundling-the-sdks-efb-api
