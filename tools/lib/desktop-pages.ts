// Builds the desktop app's window into the folder Tauri embeds as the program compiles, `frontendDist` in
// src/apps/desktop/tauri.conf.json, so this runs before `cargo build`.

import fs from "node:fs"
import path from "node:path"

import * as esbuild from "esbuild"

import { buildCss, KIT } from "./css.ts"
import { ROOT } from "./repo.ts"

/** The desktop app's folder, a Cargo workspace of its own, which cargo runs from so it finds that workspace's settings. */
export const DESKTOP = path.join(ROOT, "src", "apps", "desktop")

const OUT = path.join(ROOT, "target", "desktop-pages")

/** The source files the window's classes can come from, on top of the kit's. */
const CONTENT = ["src/platform/desktop-shell/src/**/*.{ts,tsx}"]

export async function buildDesktopPages(): Promise<void> {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  esbuild.buildSync({
    entryPoints: [path.join(DESKTOP, "pages", "main.tsx")],
    outfile: path.join(OUT, "app.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  })
  fs.writeFileSync(path.join(OUT, "app.css"), await buildCss(CONTENT))
  fs.cpSync(path.join(KIT, "fonts"), path.join(OUT, "fonts"), { recursive: true })
  fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Dual Input</title><link rel="stylesheet" href="app.css"></head><body style="margin:0;background:#0a0a0a"><div id="page"></div><script src="app.js"></script></body></html>`)
}
