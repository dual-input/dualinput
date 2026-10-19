# 028: The desktop app's pages are React, built with Vite and styled with Tailwind

The desktop app's pages are TypeScript and React, built with Vite and styled with Tailwind.
They share no interface with the EFB app, only TypeScript logic and the types ts-rs generates from the message crate.
Decided by the user on 2026-10-09, in node 1.6 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#the-desktop-apps-pages-are-react-built-with-vite-and-styled-with-tailwind).

## Context

The desktop app is a Tauri app whose window shows pages that the system's WebView2 draws, written in TypeScript ([decision 018](018-rust-and-typescript.md)).
Node 1.3 left the framework for those pages open as a choice inside one part, and node 1.6 also had to settle what code the EFB app can share with them ([architecture plan](../areas/architecture/plan.md#16-frameworks)).
The EFB app is its own app on the sim's EFB framework, not the desktop app reused ([03-v1-scope](../areas/product/03-v1-scope.md#efb-app)).

## Options

1. **The desktop app's interface running in the EFB too.**
   03-v1-scope leaves it out of v1: Coherent GT rejects syntax newer tools emit and lacks APIs a desktop interface uses (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), and fitting the main app to it would hold the main app back ([03-v1-scope](../areas/product/03-v1-scope.md#efb-app)).
2. **React, built with Vite and styled with Tailwind, for the desktop app's pages alone**, sharing only logic and types with the EFB app.
   Dual Input then has two interfaces, one in each app, which the EFB app's rule keeps to one implementation: it shows the core's state and sends it commands, and decides nothing itself ([03-v1-scope](../areas/product/03-v1-scope.md#efb-app)).

The record weighed no other framework for the desktop app's pages.

## Decision

Option 2.
fsc-editor, our last desktop app, is built that way, on React 19, Vite 7, and Tailwind 4 (read in fsc-editor, `package.json`).
Tauri "is frontend agnostic and supports most frontend frameworks out of the box", and recommends Vite for React (documented, [Tauri's frontend configuration](https://v2.tauri.app/start/frontend/), as of 2026-10-09).
The EFB app's interface is built from the MSFS Avionics Framework's FSComponent components, which are class-based and don't re-render on new props ([06-01](../learn/foundations/06-01-the-engine-and-instruments.md#the-msfs-avionics-framework-and-working-title-avionics); [decision 029](029-in-sim-interface-on-msfs-avionics-framework.md)), so the desktop app's choice of framework doesn't reach it.

## What it commits us to

- The logic and types the two apps share are compiled for the EFB app the way the rest of our code in the sim is ([decision 030](030-in-sim-code-es2017-esbuild.md)).
