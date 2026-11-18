/*
 * What each tool syncs of the Baron 58P, from its profile: the variables and events Dual Input's
 * profile watches, and the ones FS Copilot's profile gets, with its included modules, so p31's
 * report can say how much more one tool has to watch than the other. Both files are read line by
 * line rather than as YAML, since no YAML parser is installed and only these two shapes matter:
 *
 *   Dual Input:  `    watch: A('GENERAL ENG PROPELLER LEVER POSITION:1', 'Position 16k')`
 *   FS Copilot:  `  - get: A:GENERAL ENG THROTTLE LEVER POSITION:1, Position 16k`
 */

import fs from "node:fs"
import path from "node:path"

import { ROOT } from "../../../../tools/lib/repo.ts"
import { sibling } from "./places.ts"

export const OUR_PROFILE = path.join(ROOT, "profiles", "aircraft", "bksq-baronpro.yaml")
/** The user's own FS Copilot profile of the 58P, newer than the copy in FS Copilot's source. */
export const FSC_DEFINITIONS = path.join(sibling("fsc"), "profiles", "bin", "FSCopilot", "Definitions")
export const FSC_PROFILE_NAME = "bksq-aircraft-baronpropress.yaml"

type Read = { entries: number; byKind: Map<string, number>; names: Set<string>; notes: string[] }

/** `A:NAME:1` for a variable as either profile spells it, in capitals, so the two compare. */
function key(kind: string, name: string): string {
  return `${kind.toUpperCase()}:${name.trim().replace(/\s+/g, " ").toUpperCase()}`
}

function readOurs(file: string): Read & { events: number } {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/)
  const names = new Set<string>()
  const byKind = new Map<string, number>()
  let entries = 0
  let events = 0
  let section = ""
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\S/.test(line)) section = line.replace(/:.*/, "")
    const watch = /^ {4}watch:(.*)$/.exec(line)
    if (!watch || (section !== "state" && section !== "events")) continue
    entries++
    if (section === "events") events++
    // A watch that runs on, after `|` or on the lines below, takes every line indented under it.
    let text = watch[1]!
    for (let j = i + 1; j < lines.length && /^ {6,}/.test(lines[j]!); j++) text += ` ${lines[j]}`
    for (const m of text.matchAll(/\b([ALBKHZE])\('([^']+)'/g)) names.add(key(m[1]!, m[2]!.split(",")[0]!))
    for (const m of text.matchAll(/\binstrument\('([^']+)', '([^']+)'\)/g)) names.add(`INSTRUMENT:${m[1]} ${m[2]}`)
  }
  for (const n of names) byKind.set(n.split(":")[0]!, (byKind.get(n.split(":")[0]!) ?? 0) + 1)
  return { entries, events, byKind, names, notes: [] }
}

function readFsc(definitions: string, name: string): Read & { master: number; shared: number; modules: string[] } {
  const names = new Set<string>()
  const byKind = new Map<string, number>()
  const modules: string[] = []
  const notes: string[] = []
  let entries = 0
  let master = 0
  let shared = 0
  const read = (file: string) => {
    let section = ""
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (/^\S/.test(line)) section = line.replace(/:.*/, "")
      const include = /^ {2}- (\S+\.ya?ml)\s*$/.exec(line)
      if (section === "include" && include) {
        const module = path.join(definitions, include[1]!)
        if (fs.existsSync(module)) {
          modules.push(include[1]!)
          read(module)
        } else notes.push(`FS Copilot's profile includes ${include[1]}, which isn't in its Definitions folder`)
        continue
      }
      const get = /^\s+- get:\s*([A-Z]):([^,]+)/.exec(line)
      if (!get) continue
      entries++
      if (section === "master") master++
      else shared++
      names.add(key(get[1]!, get[2]!))
    }
  }
  read(path.join(definitions, name))
  for (const n of names) byKind.set(n.split(":")[0]!, (byKind.get(n.split(":")[0]!) ?? 0) + 1)
  return { entries, master, shared, modules, byKind, names, notes }
}

const KINDS: Record<string, string> = { A: "A: variables", L: "L: variables", B: "B: input events", K: "K: events", H: "H: events", Z: "Z: variables", E: "E: variables", INSTRUMENT: "instrument fields" }

function kinds(byKind: Map<string, number>): string {
  return [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${KINDS[k] ?? k}`).join(", ")
}

/** `names` with each series of three or more that differ only in a trailing index, such as `A:CIRCUIT CONNECTION ON:1`, written once, as `A:CIRCUIT CONNECTION ON:n for 26 values of n`. */
function compact(names: string[]): string {
  const series = new Map<string, string[]>()
  for (const n of names) {
    const base = n.replace(/:\d+$/, "")
    series.set(base, [...(series.get(base) ?? []), n])
  }
  return [...series]
    .map(([base, all]) => (all.length >= 3 && base !== all[0] ? `${base}:n for ${all.length} values of n` : all.join("; ")))
    .join("; ")
}

/** The comparison as lines of text for the report. */
export function compareProfiles(): string[] {
  const ours = readOurs(OUR_PROFILE)
  const theirs = readFsc(FSC_DEFINITIONS, FSC_PROFILE_NAME)
  const both = [...ours.names].filter((n) => theirs.names.has(n))
  const onlyOurs = [...ours.names].filter((n) => !theirs.names.has(n)).sort()
  const onlyTheirs = [...theirs.names].filter((n) => !ours.names.has(n)).sort()
  return [
    `Dual Input's profile, ${path.relative(ROOT, OUR_PROFILE)}: ${ours.entries} entries, ${ours.entries - ours.events} of state and ${ours.events} of events, watching ${ours.names.size} names: ${kinds(ours.byKind)}.`,
    `FS Copilot's profile, the user's ${FSC_PROFILE_NAME} with ${theirs.modules.length} modules (${theirs.modules.join(", ")}): ${theirs.entries} entries, ${theirs.master} sent by the pilot flying alone and ${theirs.shared} by either pilot, getting ${theirs.names.size} names: ${kinds(theirs.byKind)}.`,
    ...theirs.notes,
    `Both watch ${both.length} of the same names.`,
    `Only Dual Input's watches ${onlyOurs.length}: ${compact(onlyOurs) || "none"}.`,
    `Only FS Copilot's gets ${onlyTheirs.length}: ${compact(onlyTheirs) || "none"}.`,
    "Beyond the profiles, each tool streams the aircraft itself: Dual Input's flight-model sync sends the pilot flying's pose and velocities about 20 times a second, and its avatars send each pilot's figure; FS Copilot sends its Physics and Surfaces packets, sampled at 20 a second, and each master-only variable at up to 33 a second while it changes (read in FS Copilot fork, src/FsCopilot/Simulation/Coordinator.cs, AddLink).",
  ]
}
