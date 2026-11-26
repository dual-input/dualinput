// Our pages as they run with no sim, on their stand-ins: tools/dev.ts serves one, runs it in Coherent GT if it runs in
// the sim, and rebuilds it after each edit, and tools/screenshots.ts builds each once and takes its pictures.

import fs from "node:fs"
import path from "node:path"

import * as esbuild from "esbuild"

import { buildCss, forceStates, KIT } from "./css.ts"
import { ROOT } from "./repo.ts"
import { EFB_RULES, PANEL_RULES } from "./sim-css.ts"

/**
 * A page's entry, the source files its classes come from, on top of the kit's, and what the sim's stylesheets would set
 * around it, or null for a page that runs in a browser engine rather than the sim's, which tools/dev.ts serves to a
 * browser alone, with no debugger.
 */
export type DevPage = { entry: string; content: string[]; simRules: string | null }

/** Each page that runs with no sim. */
export const DEV_PAGES: Record<string, DevPage> = {
  kit: { entry: "src/packages/ui/dev/main.tsx", content: ["src/packages/ui/dev/**/*.tsx"], simRules: EFB_RULES },
  efb: { entry: "src/sim-package/pages/efb-dev.tsx", content: ["src/platform/efb-shell/src/**/*.{ts,tsx}", "src/platform/efb-shell/dev/**/*.{ts,tsx}", "src/features/*/efb/**/*.{ts,tsx}", "src/packages/crew/src/**/*.{ts,tsx}"], simRules: EFB_RULES },
  banner: { entry: "src/platform/banner/dev/main.tsx", content: ["src/platform/banner/src/**/*.{ts,tsx}", "src/platform/banner/dev/**/*.{ts,tsx}", "src/packages/crew/src/**/*.{ts,tsx}"], simRules: PANEL_RULES },
  // The desktop app's window runs in WebView2, so what matters here is the browser's picture, and the sim sets no rules around it.
  desktop: { entry: "src/platform/desktop-shell/dev/main.tsx", content: ["src/platform/desktop-shell/src/**/*.{ts,tsx}", "src/platform/desktop-shell/dev/**/*.{ts,tsx}"], simRules: null },
  welcome: { entry: "src/platform/desktop-shell/dev/welcome.tsx", content: ["src/platform/desktop-shell/src/**/*.{ts,tsx}", "src/platform/desktop-shell/dev/**/*.{ts,tsx}"], simRules: null },
  // The profile extension's Dual Input panel and Sync log run in VS Code webviews, so the sim sets no rules around them either.
  "profile-panel": { entry: "src/apps/profile-extension/panel/dev/main.tsx", content: ["src/apps/profile-extension/panel/**/*.{ts,tsx}"], simRules: null },
  "sync-log": { entry: "src/apps/profile-extension/sync-log/dev/main.tsx", content: ["src/apps/profile-extension/sync-log/**/*.{ts,tsx}", "src/apps/profile-extension/panel/src/island.ts"], simRules: null },
}

/** esbuild's options for a page's script, which tools/dev.ts adds its watch and its hook after each build to. */
export function scriptOptions(page: DevPage, outfile: string): esbuild.BuildOptions {
  return {
    entryPoints: [path.join(ROOT, page.entry)],
    outfile,
    bundle: true,
    format: "iife",
    target: "es2017",
    jsx: "automatic",
    sourcemap: "external",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  }
}

/** Writes a page's folder but its script: the fonts, and the page, which loads `head` and `scripts` around the page's own. */
export function writeShell(page: DevPage, dir: string, { head = "", scripts = "" }: { head?: string; scripts?: string } = {}): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.cpSync(path.join(KIT, "fonts"), path.join(dir, "fonts"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><style>${page.simRules ?? ""}</style><link rel="stylesheet" href="app.css">${head}</head><body style="margin:0;background:#0a0a0a"><div id="page"></div>${scripts}<script src="app.js"></script></body></html>`,
  )
}

/** Writes a page's stylesheet, with the kit's page's states forced on, as its bench shows them. */
export async function writeCss(name: string, page: DevPage, dir: string): Promise<void> {
  fs.writeFileSync(path.join(dir, "app.css"), await buildCss(page.content, name === "kit" ? [forceStates()] : []))
}

/** Builds a page once into `dir`, ready to open as a file, with `head` added to its page's head. */
export async function buildOnce(name: string, dir: string, head = ""): Promise<void> {
  const page = DEV_PAGES[name]!
  writeShell(page, dir, { head })
  await esbuild.build(scriptOptions(page, path.join(dir, "app.js")))
  await writeCss(name, page, dir)
}
