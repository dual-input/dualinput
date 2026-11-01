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
/** The compiled file's name, which the source's `Filename` element gives it. */
export const SPB = "InGamePanel_DualInputBanner.spb"

export function panelSourceHash(): string {
  return createHash("sha256").update(fs.readFileSync(PANEL_SOURCE)).digest("hex")
}

/** What's wrong with the committed compile, for a source changed without one, or null when it matches. */
export function panelCompileProblem(): string | null {
  if (!fs.existsSync(SOURCE_JSON) || !fs.existsSync(path.join(COMPILED, SPB))) return "the banner's panel has no compiled file: run node tools/compile-panel.ts with the sim closed"
  const recorded = JSON.parse(fs.readFileSync(SOURCE_JSON, "utf8")) as Record<string, string>
  if (recorded[path.basename(PANEL_SOURCE)] !== panelSourceHash()) return "the banner's panel definition changed since it was compiled: run node tools/compile-panel.ts with the sim closed"
  return null
}
