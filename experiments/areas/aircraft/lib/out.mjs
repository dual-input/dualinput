/*
 * The harness's output: one line per event on the console as it happens, the
 * same records as NDJSON, and a text report written at the end.
 *
 * Paths under the repository, %APPDATA%, %LOCALAPPDATA%, and the home folder
 * are written with those names in place of the folder, so a results file
 * carries no username. The sim's other strings go in as they arrive, so read
 * the results before committing them.
 */

import { createWriteStream, writeFileSync } from "node:fs"
import { homedir } from "node:os"

import { REPO, repoRelative, resultFile, stamp } from "../../../tools/results.mjs"

export { REPO, repoRelative, stamp }

const SCRUB = [
  [REPO, "<repo>"],
  [process.env.LOCALAPPDATA, "%LOCALAPPDATA%"],
  [process.env.APPDATA, "%APPDATA%"],
  [homedir(), "%USERPROFILE%"],
].filter(([prefix]) => prefix)

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const SCRUB_RE = SCRUB.map(([prefix, name]) => [
  new RegExp([...new Set([prefix, prefix.replace(/\\/g, "/")])].map(escape).join("|"), "gi"),
  name,
])

export function scrub(s) {
  if (typeof s !== "string") return s
  let out = s
  for (const [re, name] of SCRUB_RE) out = out.replace(re, name)
  return out
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const secs = (ms) => `${(ms / 1000).toFixed(1)}s`
export const clock = (t) => `${new Date(t).toTimeString().slice(0, 8)}.${String(t % 1000).padStart(3, "0")}`
export const fmt = (v) =>
  typeof v === "number" && !Number.isInteger(v) ? String(Math.round(v * 1e6) / 1e6)
    : typeof v === "string" ? JSON.stringify(v)
      : String(v)
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`

const toJson = (fields) =>
  JSON.parse(JSON.stringify(fields, (k, v) => (typeof v === "string" ? scrub(v) : typeof v === "bigint" ? String(v) : v)))

/*
 * One recorder per run. Records are kept in memory as well, because the report
 * at the end reads them back.
 *
 * log() prints and records; data() records without printing, for bulk records
 * such as one per input event, which would bury the console.
 */
export class Recorder {
  constructor(name, { area = "aircraft", when = stamp() } = {}) {
    this.name = name
    this.area = area
    this.when = when
    this.started = Date.now()
    this.timeline = []
    this.ndjson = null
    this.files = null
    this.listeners = new Set()
  }

  // Opened once there's something worth keeping, so a run that never reached
  // the sim leaves no file.
  open() {
    if (this.files) return this.files
    this.files = {
      ndjson: resultFile(this.area, this.name, "ndjson", this.when),
      txt: resultFile(this.area, this.name, "txt", this.when),
    }
    this.ndjson = createWriteStream(this.files.ndjson)
    for (const rec of this.timeline) this.ndjson.write(JSON.stringify(rec) + "\n")
    return this.files
  }

  record(kind, text, fields, print) {
    const t = Date.now()
    const rec = { t, s: Math.round(t - this.started) / 1000, kind, text: scrub(text), ...toJson(fields) }
    this.timeline.push(rec)
    // Closing the connection on the way out fires a close event after the stream
    // has ended, and a write then would throw.
    if (this.ndjson && !this.ndjson.writableEnded) this.ndjson.write(JSON.stringify(rec) + "\n")
    if (print) console.log(`${clock(t)} ${`+${secs(t - this.started)}`.padStart(8)}  ${kind.padEnd(9)} ${rec.text}`)
    for (const fn of this.listeners) {
      try { fn(rec) } catch { /* a listener mustn't break the log */ }
    }
    return rec
  }

  log(kind, text, fields = {}) {
    return this.record(kind, text, fields, true)
  }

  data(kind, text, fields = {}) {
    return this.record(kind, text, fields, false)
  }

  onRecord(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  writeReport(text) {
    this.open()
    writeFileSync(this.files.txt, text.endsWith("\n") ? text : text + "\n")
  }

  async close() {
    if (!this.ndjson || this.ndjson.writableEnded) return
    await new Promise((resolve) => this.ndjson.end(resolve))
  }
}
