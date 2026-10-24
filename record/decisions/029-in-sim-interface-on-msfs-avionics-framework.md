# 029: Our interface in the sim is built on the MSFS Avionics Framework

The EFB app and the banner panel draw their interface with the MSFS Avionics Framework's FSComponent, in TypeScript, and the EFB app registers with the sim's EFB through Asobo's EFB API.
The banner panel bundles our own copy of `@microsoft/msfs-sdk`, pinned to one exact version, not the copy the sim provides.
Decided by the user on 2026-10-09, in node 1.6 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#our-interface-in-the-sim-is-built-on-the-msfs-avionics-framework).

## Context

Two of our components draw an interface in the sim's Coherent GT: the EFB app, which holds what a pilot needs during a flight, and the banner panel, which shows notifications ([01-spine](../areas/architecture/01-spine.md#components)).
Node 1.6 had to pick what they build on, and node 1.6.1 asked how the MSFS Avionics Framework is published, licensed, and versioned, so we'd know whether to bundle our own pinned copy or use the one the sim provides ([architecture plan](../areas/architecture/plan.md#161-coherent-gts-javascript-as-documented-and-as-others-build-for-it)).

- The framework is Microsoft's, Asobo's, and Working Title's library for glass cockpits in Coherent GT, and the SDK says many of MSFS 2024's own aircraft use it (documented, [06-01](../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
- Shipping EFB apps are built on it: A2A's tablet is TSX on Asobo's EFB API and the framework (read in a2a-aircraft-aerostar600 1.0.6, `A2ATabletApp.js`; [03-v1-scope](../areas/product/03-v1-scope.md#efb-app)), and our own probe apps registered through the EFB API and drew with the copy of the framework the sim provides, its global `msfssdk` (measured on MSFS 2024, 2026-10-06 and 2026-10-09, [interface log](../areas/interface/log.md#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).
- Its components don't re-render on new props, and state reaches the page through values that update it directly ([06-01](../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).

## Options

For what our pages in the sim draw with:

1. **The desktop app's interface, in React, running in the sim too.**
   03-v1-scope leaves the desktop app's interface out of the EFB in v1, since Coherent GT rejects syntax newer tools emit and lacks APIs a desktop interface uses (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), and fitting the main app to it would hold the main app back ([03-v1-scope](../areas/product/03-v1-scope.md#efb-app)).
2. **The MSFS Avionics Framework, for both the EFB app and the banner panel.**
   One way of drawing serves both of our pages in the sim, while the desktop app's pages stay React ([decision 028](028-desktop-pages-react-vite-tailwind.md); user, 2026-10-09).

For which copy of the framework a page draws with ([architecture log][research]):

1. **The copy the sim provides, its global `msfssdk`**, as our probe apps and FSTRaK's EFB app did.
   That copy can change with a sim update.
2. **Our own copy, pinned to one exact version**, as Working Title's G1000 pins `@microsoft/msfs-sdk` 2.4.3 and copies it into its own folder.
   2.4.3 isn't on npm, whose newest is 2.3.3 as of 2026-10-09, no document states how the framework's versions track sim updates, and no run has registered an EFB app drawn with a second copy of the framework ([01-spine](../areas/architecture/01-spine.md#left-open)).
   The framework's license is MIT, for use only in Microsoft Flight Simulator ([architecture log][research]), which Dual Input is built for.

## Decision

The framework for both pages, and our own pinned copy for the banner panel.
Components that update from values rather than re-render on new props suit an interface showing state the core streams to it ([06-01](../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics)).
The framework's authors ship their own pinned copy rather than the one the sim provides, which can change with a sim update ([architecture log][research]; user, 2026-10-09).
The banner panel alone is held to the pinned copy, because no run has registered an EFB app drawn with a second copy of the framework.

## What it commits us to

- esbuild bundles our pinned copy of the framework into each page that uses it, at `es2017` ([decision 030](030-in-sim-code-es2017-esbuild.md)).
- Whether the EFB app can bundle our pinned copy too is left to the apps' stage of step 8, where p08's EFB app, rebuilt against a bundled copy, settles it ([01-spine](../areas/architecture/01-spine.md#left-open)).
- Which version we pin is left to the apps' stage too ([01-spine](../areas/architecture/01-spine.md#left-open)).
- How the framework's versions track sim updates, which no document states, we follow by re-running p09 and our pages after each sim update ([01-spine](../areas/architecture/01-spine.md#left-open)).

[research]: ../areas/architecture/log.md#2026-10-09-coherent-gts-makers-last-placed-its-engine-near-safari-101-the-msfs-avionics-framework-and-flybywire-compile-to-es2017-nobody-maintains-a-rule-set-for-the-engine-and-working-title-ships-its-own-pinned-copy-of-the-framework
