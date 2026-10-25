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
- **Leaves out:** whether a check fails Tailwind's half steps and arbitrary values off the grid, such as `p-1.5` and `p-[7px]`, and which components the apps need that shadcn lacks, which their outline names.

## The desktop app is dark only

- **Decided:** the desktop app has one dark look and no light one, so it follows no Windows setting.
  Settled by the user on 2026-10-25.
- **Because:** the user chose it, and it matches our pages in the sim, which can only be dark:
  - The sim's EFB is dark alone: `efb_os.css` holds no light theme and no `prefers-color-scheme` query (read in fs-base-efb 0.1.10, `efb_os.css`, 2026-10-25).
  - Coherent GT doesn't parse `prefers-color-scheme` ([architecture log][p13]).
- **Leaves out:** the colors themselves, which a bench of mockups from the user's sketch explores.

## The EFB app and the banner have Dual Input's own look, from a kit of our own components on the MSFS Avionics Framework

- **Decided:** our pages in the sim look as Dual Input designs them, not as the sim's EFB apps do.
  They draw with components of our own, in a kit on the MSFS Avionics Framework that both pages share, and use none of the EFB API's controls, while the EFB API stays the way our app registers with the EFB, as [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md) has it.
  Settled by the user on 2026-10-25.
- **Because:**
  - The user wants the whole interface in our control and our design, at the cost of a set of components to keep beside the desktop app's (user, 2026-10-25).
  - The sim's look would have reached the EFB app alone: it comes from `efb_os.css`, which the EFB's document loads, and the banner is an in-game panel of its own, which no run has had load it ([interface log][efb-styles]).
  - shadcn's components are React, which decision 029 keeps out of the sim, and Tailwind 4's output and shadcn's theme draw nothing in Coherent GT ([architecture log][p13]).
- **Leaves out:** how the kit's CSS is made, by hand or by a Tailwind build that writes only what the engine reads, as Working Title's CIVA app does ([architecture log][p14]); where the kit lives among our npm packages; and how one set of colors feeds both the kit and shadcn's theme.

## The Coherent GT check covers the CSS we ship into the sim

- **Decided:** the check [decision 031](../../decisions/031-coherent-gt-check-tool.md) gives every JavaScript file we ship into the sim also checks every CSS file we ship there, and stage 11b builds it, since the kit is the first CSS we ship there.
  Settled by the user on 2026-10-25.
- **Because:**
  - Coherent GT drops what it can't read with no error, so a dropped `gap` shows only as a wrong layout in the sim, while the same CSS draws in a browser and in the desktop app ([architecture log][p13]).
  - It drops 250 properties, 44 selectors, and 50 of our function samples that Chromium 152 keeps ([architecture log][p14]).
  - The check already runs on every file we ship into the sim, after each edit and in `tools/check.ts`, from a data file that holds the reference's lists ([the Coherent GT check](../build/01-the-build.md#the-coherent-gt-check)).
- **Leaves out:** its CSS parser; whether it passes only what p14 measured the engine keeping or fails what p14 measured it dropping; and CSS written in a component's markup rather than a stylesheet, which the stage's design of the check settles.

[p13]: ../architecture/log.md#2026-10-25-coherent-gt-drops-layer-oklch-color-mix-and-every-gap-but-grid-gap-so-tailwind-4s-output-cant-style-a-page-there
[p14]: ../architecture/log.md#2026-10-25-coherent-gt-keeps-304-of-the-554-css-properties-chromium-152-keeps-and-lays-out-flexbox-and-grid-as-chromium-does-but-for-gap-justify-content-end-and-subgrid
[efb-styles]: log.md#2026-10-24-the-sims-efb-styles-its-apps-controls-through---efb--variables-sized-from-a-516-by-716-base-and-an-app-gets-the-controls-by-bundling-the-sdks-efb-api
