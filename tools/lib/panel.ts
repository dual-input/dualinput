// The banner's in-game panel definition: its source, and what the sim compiled from it, committed beside it, since the
// compiler runs the sim, which no CI runner has (record/areas/build/01-the-build.md, "Files compiled with the sim").

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { ROOT } from "./repo.ts"

const PANEL = path.join(ROOT, "src", "sim-package", "panel")
export const PANEL_SOURCE = path.join(PANEL, "InGamePanels", "dualinput-banner.xml")
export const COMPILED = path.join(PANEL, "compiled")
export const SOURCE_JSON = path.join(COMPILED, "source.json")
/** The compiled file's name, which fspackagetool takes from the source file's, whatever the source's `Filename` element says (measured on our development machine, 2026-11-01). */
export const SPB = "dualinput-banner.spb"

export function panelSourceHash(source = PANEL_SOURCE): string {
  return createHash("sha256").update(fs.readFileSync(source)).digest("hex")
}

/** What's wrong with the committed compile, for a source changed without one, or null when it matches. */
export function panelCompileProblem(source = PANEL_SOURCE, compiled = COMPILED): string | null {
  const sourceJson = path.join(compiled, path.basename(SOURCE_JSON))
  if (!fs.existsSync(sourceJson) || !fs.existsSync(path.join(compiled, SPB))) return "the banner's panel has no compiled file: run node tools/compile-panel.ts with the sim closed"
  const recorded = JSON.parse(fs.readFileSync(sourceJson, "utf8")) as Record<string, string>
  if (recorded[path.basename(source)] !== panelSourceHash(source)) return "the banner's panel definition changed since it was compiled: run node tools/compile-panel.ts with the sim closed"
  return null
}
