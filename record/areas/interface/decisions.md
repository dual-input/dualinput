# Interface: tentative decisions

What stage 11b's design of the apps has settled so far, each with the findings behind it and what it leaves out.
The apps' design in this area confirms each one, changes it, or drops it, as [stage 11b](../build/plan.md#11b-the-apps) writes it, and the user leads that design.

## The desktop app's pages are built from shadcn's Base UI components on Tailwind's 4px spacing

- **Decided:** the desktop app's pages use shadcn's components in their Base UI variant, a component shadcn lacks is built on Base UI too, and Tailwind styles them on its 4px spacing steps.
  Settled by the user on 2026-10-24.
- **Because:**
  - [Decision 028](../../decisions/028-desktop-pages-react-vite-tailwind.md) puts the desktop app's pages on React, Vite, and Tailwind, which shadcn's components are built with.
  - shadcn's Base UI variant has been its default since July 2026, beside Radix, which it still supports (documented, [shadcn's changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)).
  - Tailwind's spacing unit is 4px, as its theme sets `--spacing: 0.25rem` (read in tailwindcss 4.3.3, `theme.css`).
- **Leaves out:** whether a build check on the desktop app's pages fails Tailwind's half steps and arbitrary values that sit off the 4px grid, such as `p-1.5` (6px) and `p-[7px]`; and which components the apps need that shadcn lacks, which the apps' outline will name.

## The desktop app is dark only

- **Decided:** the desktop app has one dark look and no light one, so it follows no Windows setting.
  Settled by the user on 2026-10-25.
- **Because:** the user chose it, and our pages in the sim can't follow a Windows setting either, and sit in an EFB that has only a dark look:
  - The sim's EFB is dark alone: `efb_os.css` holds no light theme and no `prefers-color-scheme` query (read in fs-base-efb 0.1.10, `efb_os.css`, 2026-10-25).
  - Coherent GT doesn't parse `prefers-color-scheme` ([architecture log][p13]).
- **Leaves out:** the colors themselves, which a bench of mockups from the user's sketch explores.

## The apps draw in shadcn's Nova style, on neutral grays, with Tailwind's sky-300 as the main color, 10px corners, and Geist

- **Decided:** the apps' components take shadcn's Nova preset, with rounded corners and small type, on Tailwind's neutral grays at the steps shadcn's dark theme uses, such as `neutral-950` for the background.
  Their main color, shadcn's `primary`, is Tailwind's sky-300, `oklch(82.8% 0.111 230.318)`, which is `#74d4ff`.
  Their corner radius is shadcn's default of 0.625rem, 10px, and their font is Geist, with Geist Mono for codes.
  The status colors are Tailwind's 400 steps of amber, red, and green, each with its chroma held to 0.14, and slate-300 with its chroma raised to 0.05:

  | For | Color | As hex, for the sim's pages | Contrast on `neutral-950` |
  | --- | --- | --- | --- |
  | Information, a notification's lowest level | `oklch(86.9% 0.05 252.894)` | `#bdd7f5` | 13.4:1 |
  | Warning | `oklch(82.8% 0.14 84.429)` | `#f1be4d` | 11.5:1 |
  | Trouble, which is shadcn's `destructive` too | `oklch(70.4% 0.14 22.216)` | `#ea7977` | 7.1:1 |
  | Success, such as Ready | `oklch(79.2% 0.14 151.711)` | `#6fd58d` | 10.9:1 |

  A status chip is soft: its color at 15% behind text in its color.
  Settled by the user on 2026-10-25, on a bench of mockups in `experiments/areas/interface/bench`, which draws the user's sketch of the desktop app in each of shadcn's eight presets, nine grays, and any main color.
- **Because:**
  - The user kept `#7ad7ff` on the bench, then took sky-300, the Tailwind color nearest it, at `oklch(83.6% 0.105 227.9)` against sky-300's `oklch(82.8% 0.111 230.318)` (computed from the two colors).
  - It's the sim's EFB blue, `#00b4ff`, lightened: both have a hue of 198° in HSL (computed), at a lightness of 74% against the EFB's 50%.
  - Sky-300 has 11.9:1 contrast on `neutral-950` (computed), and a button filled with it takes dark text.
  - Coherent GT reads hex colors but not oklch ([architecture log][p13]), so our pages in the sim take it as `#74d4ff`.
  - Information takes a gray with a cool tint, so it stays apart from sky-300, where a blue of its own would read as a second main color, and the user found violet and purple ugly; its tint is raised from slate-300's 0.022 so it reads apart from the neutral grays too (user, 2026-10-25).
  - Tailwind's 400 steps, at chroma up to 0.209 for green, were too rough beside sky-300's 0.111, and their solid chips too strong, so the user held their chroma to 0.14 and took soft chips (user, 2026-10-25).
  - The hex values and contrasts are computed from the oklch colors.
- **Leaves out:** whether the apps show the pilots' figure colors, and how those stay apart from the status colors; how one set of colors feeds both shadcn's theme and the kit our pages in the sim draw with; and whether those pages ship Geist, where the sim provides Roboto.

## The EFB app and the banner have Dual Input's own look, from a kit of our own components on the MSFS Avionics Framework

- **Decided:** our pages in the sim look as Dual Input designs them, not as the sim's EFB apps do.
  They draw with components of our own, in a kit on the MSFS Avionics Framework that both pages share, and use none of the EFB API's controls, while the EFB API stays the way our app registers with the EFB, as [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md) has it.
  Settled by the user on 2026-10-25.
- **Because:**
  - The user wants the whole interface in our control and our design, at the cost of a set of components to keep beside the desktop app's (user, 2026-10-25).
  - The sim's look would have reached only the EFB app: it comes from `efb_os.css`, which the EFB's document loads, while the banner is an in-game panel with a page of its own, and no run has had that page link `efb_os.css` ([interface log][efb-styles]).
  - shadcn's components are React, which decision 029 keeps out of the sim, and Tailwind 4's output and shadcn's theme draw nothing in Coherent GT ([architecture log][p13]).
- **Leaves out:** how the kit's CSS is made: by hand, or by a Tailwind build like the one behind Working Title's CIVA app, which writes `rgba()` colors and no `@layer`, oklch, or `gap`, yet still writes 5 `:where(` selectors and 2 `inset:` declarations the engine drops ([architecture log][p14]); where the kit lives among our npm packages; and how one set of colors feeds both the kit and shadcn's theme.

## The Coherent GT check covers the CSS we ship into the sim

- **Decided:** the check [decision 031](../../decisions/031-coherent-gt-check-tool.md) gives every JavaScript file we ship into the sim also checks every CSS file we ship there, and stage 11b builds it, since the kit is the first CSS we ship there.
  It passes only what our probe p14 measured the engine keeping, so CSS no run has tried fails until a probe measures it.
  It also fails what the engine parses and then ignores, which a parse alone would pass: layout cases in p13 and p14 found three, `column-gap`, `justify-content: end`, and `display: contents`, which computes as `inline`.
  Settled by the user on 2026-10-25.
- **Because:**
  - Coherent GT drops what it can't parse with no error, so a dropped `gap` shows only as a wrong layout in the sim, while the same CSS draws in a browser and in the desktop app ([architecture log][p13]).
  - p14 found that it drops 250 properties, 44 selectors, and 50 of our function samples that Chromium 152 keeps ([architecture log][p14]).
  - The check already runs on every JavaScript file we ship into the sim, after each edit and in `tools/check.ts`, from a data file that holds the lists in [Coherent GT's JavaScript and CSS](../architecture/coherent-gt.md) ([the Coherent GT check](../build/01-the-build.md#the-coherent-gt-check)).
  - A list of what the engine drops would pass everything no probe tried, which is where a silent drop hides, while a list of what it keeps fails that CSS where the developer writing it sees the failure.
- **Leaves out:** its CSS parser; how its data comes from p14's results, so a run of p14 after a sim update refreshes it; and CSS written in a component's markup rather than a stylesheet, which the stage's design of the check settles.

[p13]: ../architecture/log.md#2026-10-25-coherent-gt-drops-layer-oklch-color-mix-and-every-gap-but-grid-gap-so-tailwind-4s-output-cant-style-a-page-there
[p14]: ../architecture/log.md#2026-10-25-coherent-gt-keeps-304-of-the-554-css-properties-chromium-152-keeps-and-lays-out-flexbox-and-grid-as-chromium-does-but-for-gap-justify-content-end-and-subgrid
[efb-styles]: log.md#2026-10-24-the-sims-efb-styles-its-apps-controls-through---efb--variables-sized-from-a-516-by-716-base-and-an-app-gets-the-controls-by-bundling-the-sdks-efb-api
