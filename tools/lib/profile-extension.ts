// Packs the profile extension, src/apps/profile-extension, as
// target/profile-extension/dualinput-profiles-<version>.vsix: its TypeScript bundled by esbuild,
// its grammar and language configuration, its icon, and the profile builder, whose `serve` is the
// extension's language server (record/areas/profiles/03-the-extension.md, "Packing and
// publishing").

import fs from "node:fs"
import path from "node:path"

import * as esbuild from "esbuild"

import { workspaceVersion } from "./package.ts"
import { ROOT } from "./repo.ts"
import { type Manifest, writeVsix } from "./vsix.ts"

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
export function packProfileExtension(builder: string, icon: Buffer, language: { light: string; dark: string }, version = workspaceVersion()): string {
  // The packed manifest names Dual Input's version, so the extension's version names the
  // release whose engine it checks and builds with.
  const manifest = { ...treeManifest(), version }
  // VS Code loads `main` with `require` and provides `vscode` itself, so the bundle is one
  // CommonJS file that leaves `vscode` out, and the .vsix needs no node_modules
  // (documented, https://code.visualstudio.com/api/working-with-extensions/bundling-extension).
  // VS Code 1.91, the lowest `engines` takes, runs Node 20.
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
      // The manifest's `languages` entry names these two paths, so change both together.
      { path: "icons/language-light.svg", data: Buffer.from(language.light) },
      { path: "icons/language-dark.svg", data: Buffer.from(language.dark) },
      { path: "bin/dualinput-profile-builder.exe", data: fs.readFileSync(builder) },
    ],
    "win32-x64",
  )
  return file
}
