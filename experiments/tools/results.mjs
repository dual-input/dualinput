/*
 * Where a probe's output goes.
 *
 * A probe in experiments/<area>/ saves its report into experiments/<area>/results/.
 * A log entry in record/<area>/ cites it there if the finding is worth keeping.
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

export function resultFile(area, name, ext = "txt", when = stamp()) {
  const dir = join(REPO, "experiments", area, "results")
  mkdirSync(dir, { recursive: true })
  return join(dir, `${name}-${when}.${ext}`)
}

export function saveResult(area, name, text) {
  const file = resultFile(area, name)
  writeFileSync(file, text.endsWith("\n") ? text : text + "\n")
  return file
}

// For printing a saved path without the home folder in it.
export function repoRelative(file) {
  return file.replace(/\\/g, "/").replace(REPO.replace(/\\/g, "/") + "/", "")
}

export function simSourcesDir(...parts) {
  const dir = join(REPO, "experiments", "sim-sources", ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}
