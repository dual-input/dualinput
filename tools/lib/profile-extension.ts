// Packs the profile extension, src/apps/profile-extension, as
// target/profile-extension/dualinput-profiles-<version>.vsix: its TypeScript bundled by esbuild,
// the webviews of the Dual Input panel and the Sync log with the kit's stylesheet and fonts, its
// grammar and language configuration, its icon, and the profile builder, whose `serve` is the
// extension's language server (record/areas/profiles/03-the-extension.md, "Packing and publishing").

import fs from "node:fs"
import path from "node:path"

import * as esbuild from "esbuild"

import { buildCss, KIT } from "./css.ts"
import { workspaceVersion } from "./package.ts"
import { ROOT } from "./repo.ts"
import { type ExtensionFile, type Manifest, writeVsix } from "./vsix.ts"

const EXTENSION = path.join(ROOT, "src", "apps", "profile-extension")

/** Where the build writes the .vsix. */
export const EXTENSION_PACKAGE = path.join(ROOT, "target", "profile-extension")

/** The manifest in the tree, which names version 0.0.0. */
function treeManifest(): Manifest {
  return JSON.parse(fs.readFileSync(path.join(EXTENSION, "package.json"), "utf8")) as Manifest
}

/**
 * The .vsix of `version` in `folder`, named for the manifest's `name`, as
 * dualinput-profiles-<version>.vsix: `packProfileExtension` writes it into EXTENSION_PACKAGE,
 * and tools/release.ts copies it into the release's artifact.
 */
export function extensionVsix(folder: string, version = workspaceVersion()): string {
  return path.join(folder, `${treeManifest().name}-${version}.vsix`)
}

/**
 * Packs the extension with `builder`, the profile builder's release executable, `icon`, a PNG,
 * and `language`, the profile language's SVG icons for light and dark themes, and returns the
 * .vsix's path. It empties the folder first, so it holds only this build's .vsix.
 */
export async function packProfileExtension(builder: string, icon: Buffer, language: { light: string; dark: string }, version = workspaceVersion()): Promise<string> {
  // The packed manifest names Dual Input's version, so the extension's version names the
  // release whose engine it checks and builds with.
  const manifest = { ...treeManifest(), version }
  // VS Code loads `main` with `require` and provides `vscode` itself, so the bundle is one
  // CommonJS file that leaves `vscode` out, and the .vsix needs no node_modules
  // (documented, https://code.visualstudio.com/api/working-with-extensions/bundling-extension).
  // VS Code 1.106, the lowest `engines` takes, runs Node 22, which takes code for Node 20.
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(EXTENSION, "src", "extension.ts")],
    outfile: "extension.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    write: false,
    logLevel: "warning",
  })
  const read = (file: string) => fs.readFileSync(path.join(EXTENSION, file))
  const file = extensionVsix(EXTENSION_PACKAGE, version)
  fs.rmSync(EXTENSION_PACKAGE, { recursive: true, force: true })
  // The builder is a Windows program, so the Marketplace offers the extension to Windows alone
  // (record/areas/profiles/03-the-extension.md, "Known limits"). The extension starts it from
  // bin/dualinput-profile-builder.exe, which src/apps/profile-extension/src/extension.ts names
  // too, so change both together.
  writeVsix(
    file,
    manifest,
    [
      { path: "dist/extension.js", data: Buffer.from(bundle.outputFiles[0]!.contents) },
      { path: "syntaxes/dualinput-profile.tmLanguage.json", data: read(path.join("syntaxes", "dualinput-profile.tmLanguage.json")) },
      { path: "language-configuration.json", data: read("language-configuration.json") },
      { path: "icon.png", data: icon },
      // The manifest's `languages` entry names these two paths, and its `viewsContainers` entries
      // the dark one, so change them together.
      { path: "icons/language-light.svg", data: Buffer.from(language.light) },
      { path: "icons/language-dark.svg", data: Buffer.from(language.dark) },
      { path: "bin/dualinput-profile-builder.exe", data: fs.readFileSync(builder) },
      ...(await webviewFiles()),
    ],
    "win32-x64",
  )
  return file
}

/**
 * The webviews of the Dual Input panel and the Sync log, under webviews/: a script for each, the one stylesheet both
 * load, and the kit's fonts with their licenses, which the stylesheet names as fonts/ beside it, so the two share one
 * copy. The extension's webview pages load webviews/panel.js, webviews/sync-log.js, and webviews/webviews.css, and may
 * load nothing outside webviews/, which src/apps/profile-extension/src/extension.ts names too, so change both together.
 */
async function webviewFiles(): Promise<ExtensionFile[]> {
  // A webview runs in VS Code's own Chromium, a current one, so a script needs none of the dev pages' ES2017, which
  // they keep to for Coherent GT.
  const script = (entry: string) =>
    Buffer.from(
      esbuild.buildSync({
        entryPoints: [path.join(EXTENSION, entry)],
        outfile: "webview.js",
        bundle: true,
        format: "iife",
        target: "es2022",
        jsx: "automatic",
        minify: true,
        define: { "process.env.NODE_ENV": '"production"' },
        write: false,
        logLevel: "warning",
      }).outputFiles[0]!.contents,
    )
  const css = await buildCss(["src/apps/profile-extension/panel/src/**/*.{ts,tsx}", "src/apps/profile-extension/sync-log/src/**/*.{ts,tsx}"])
  const page = fs.readFileSync(path.join(EXTENSION, "panel", "src", "webview.css"), "utf8")
  const fonts = path.join(KIT, "fonts")
  return [
    { path: "webviews/panel.js", data: script(path.join("panel", "src", "webview.tsx")) },
    { path: "webviews/sync-log.js", data: script(path.join("sync-log", "src", "webview.tsx")) },
    { path: "webviews/webviews.css", data: Buffer.from(`${css}\n${page}`) },
    ...fs.readdirSync(fonts).map((name) => ({ path: `webviews/fonts/${name}`, data: fs.readFileSync(path.join(fonts, name)) })),
  ]
}
