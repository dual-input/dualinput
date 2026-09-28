/*
 * Where a probe's output goes.
 *
 * A probe in experiments/<area>/ saves its report into record/<area>/results/,
 * beside the area's log, as record/writing.md asks.
 *
 * Source a probe reads out of the sim or an aircraft goes into
 * experiments/sim-sources/ instead, which .gitignore keeps out of the tree,
 * because it belongs to Asobo or to the aircraft's developer and the repository
 * will be public.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import { fileURLToPath } from "node:url"

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

// UTC, so results from one session sort in the order they were taken.
export function stamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, "-")
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
}

export function areaOf(probePath) {
  return basename(dirname(probePath))
}

export function saveResult(area, name, text) {
  const dir = join(REPO, "record", area, "results")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}-${stamp()}.txt`)
  writeFileSync(file, text.endsWith("\n") ? text : text + "\n")
  return file
}

export function simSourcesDir(...parts) {
  const dir = join(REPO, "experiments", "sim-sources", ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}
