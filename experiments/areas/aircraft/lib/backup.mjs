/*
 * Backs up an aircraft's own persistent files before the harness loads it, and
 * puts them back with the sim closed, byte for byte, with their modification
 * times.
 *
 * The tests write wear, fuel, switch positions, and settings, and these files
 * are the user's real airframes, so the runner stops before loading anything
 * if a backup fails. The copies go outside the repository, under
 * %LOCALAPPDATA%\Crosscheck\harness-backups\, and stay there after a restore.
 *
 * A file the aircraft creates during the run, which the backup can't have, is
 * listed and left where it is: removing it would be a deletion, which
 * CLAUDE.md makes a decision for a person.
 */

import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { REPO, scrub, sleep, stamp } from "./out.mjs"

export const BACKUP_ROOT = join(process.env.LOCALAPPDATA ?? "", "Crosscheck", "harness-backups")

// Navigation databases and terrain caches run to 180 to 300 MB a file in the
// iniBuilds, PMDG, and Synaptic work folders (listed 2026-10-01), and the
// aircraft read them rather than keep state in them. Copying them on every run
// would fill the disk, so a file this large is recorded by size and time only,
// and the report says whether it changed.
export const LARGE_BYTES = 64 * 1024 * 1024

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

function walk(dir, base = dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name)
    if (d.isDirectory()) walk(p, base, out)
    else if (d.isFile()) out.push(relative(base, p))
  }
  return out
}

// items: [{ label, path, kind: "dir" | "file", note }] from the aircraft
// registry. Returns what's there now, without copying anything.
export function survey(items) {
  return items.map((item) => {
    const exists = existsSync(item.path)
    const files = !exists ? [] : item.kind === "dir" ? walk(item.path) : [""]
    const sizes = files.map((rel) => statSync(rel ? join(item.path, rel) : item.path).size)
    const small = sizes.filter((s) => s < LARGE_BYTES)
    return {
      ...item, exists, files: small.length, bytes: small.reduce((a, b) => a + b, 0),
      large: sizes.length - small.length, largeBytes: sizes.filter((s) => s >= LARGE_BYTES).reduce((a, b) => a + b, 0),
    }
  })
}

// Copies every file, hashes source and copy, and throws on any difference, so
// a backup that returns is one that can be restored from.
export function backup(aircraftId, items, { when = stamp() } = {}) {
  const dest = join(BACKUP_ROOT, `${when}-${aircraftId}`)
  mkdirSync(dest, { recursive: true })
  const manifest = { aircraft: aircraftId, when, dest, items: [] }
  items.forEach((item, n) => {
    const entry = { label: item.label, path: item.path, kind: item.kind, existed: existsSync(item.path), files: [], large: [] }
    const store = join(dest, `${n}-${item.label.replace(/[^\w.-]+/g, "_")}`)
    if (entry.existed) {
      const rels = item.kind === "dir" ? walk(item.path) : [""]
      for (const rel of rels) {
        const src = rel ? join(item.path, rel) : item.path
        const st = statSync(src)
        if (st.size >= LARGE_BYTES) {
          entry.large.push({ rel, bytes: st.size, mtimeMs: st.mtimeMs })
          continue
        }
        const copy = rel ? join(store, rel) : join(store, "file")
        mkdirSync(dirname(copy), { recursive: true })
        const before = sha(src)
        copyFileSync(src, copy)
        const after = sha(copy)
        if (before !== after) throw new Error(`backup of ${scrub(src)} doesn't match its source`)
        entry.files.push({ rel, copy, sha: before, bytes: st.size, mtimeMs: st.mtimeMs, atimeMs: st.atimeMs })
      }
    }
    manifest.items.push(entry)
  })
  writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest, null, 1))
  return manifest
}

async function copyBack(copy, target, retries = 5) {
  for (let i = 0; ; i++) {
    try {
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(copy, target)
      return null
    } catch (e) {
      if (i >= retries) return e.message
      await sleep(1000)
    }
  }
}

// Puts every backed-up file back where it differs, then hashes everything
// again. Returns { files, rewritten, identical, failed, created }.
export async function restore(manifest) {
  const out = { files: 0, rewritten: [], identical: 0, failed: [], created: [] }
  for (const item of manifest.items) {
    for (const f of item.files) {
      out.files++
      const target = f.rel ? join(item.path, f.rel) : item.path
      const same = existsSync(target) && sha(target) === f.sha
      if (!same) {
        const err = await copyBack(f.copy, target)
        if (err) { out.failed.push({ path: scrub(target), error: err }); continue }
        out.rewritten.push(scrub(target))
      }
      try { utimesSync(target, f.atimeMs / 1000, f.mtimeMs / 1000) } catch { /* the content is what matters */ }
    }
    if (item.kind === "dir" && existsSync(item.path)) {
      const known = new Set([...item.files, ...(item.large ?? [])].map((f) => f.rel))
      for (const rel of walk(item.path)) if (!known.has(rel)) out.created.push(scrub(join(item.path, rel)))
    } else if (item.kind === "file" && !item.existed && existsSync(item.path)) {
      out.created.push(scrub(item.path))
    }
  }
  const check = verify(manifest)
  out.identical = check.identical
  out.mismatched = check.mismatched
  out.large = check.large
  return out
}

export function verify(manifest) {
  let identical = 0
  const mismatched = []
  const large = []
  for (const item of manifest.items) {
    for (const f of item.files) {
      const target = f.rel ? join(item.path, f.rel) : item.path
      if (existsSync(target) && sha(target) === f.sha) identical++
      else mismatched.push(scrub(target))
    }
    for (const f of item.large ?? []) {
      const target = join(item.path, f.rel)
      const st = existsSync(target) ? statSync(target) : null
      large.push({ path: scrub(target), bytes: f.bytes, changed: !st || st.size !== f.bytes || st.mtimeMs !== f.mtimeMs })
    }
  }
  return { identical, mismatched, large }
}

// Which backed-up files the run has changed so far, without touching them.
export function changed(manifest) {
  return verify(manifest).mismatched
}

export function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))
}

// ---------------------------------------------------------------- pending restores

// Backups are restored only with the sim closed, at the end of a session or
// after a crash, never while an aircraft might be writing: the sim crashed
// within a second of a restore that ran with it open (results/crashes.tsv,
// 2026-10-01T18:23:31Z; cause unverified). Until then each backup is listed in
// results/pending-restores.tsv, so a run that dies can't lose one. While an
// aircraft has a pending backup, later runs of it reuse that backup rather than
// copying files the earlier run changed.
export const RESULTS = join(REPO, "experiments", "areas", "aircraft", "results")
export const PENDING = join(RESULTS, "pending-restores.tsv")
export const HISTORY = join(RESULTS, "restores.tsv")

const PENDING_HEAD = "# Backups waiting for a restore with the sim closed: node experiments/areas/aircraft/run.mjs --restore-pending\naircraft\tbackup\tbacked up (UTC)\truns\n"
const HISTORY_HEAD = "# Restores of harness backups, made with the sim closed: what was rewritten, and whether every file matched its backup afterwards.\nrestored (UTC)\taircraft\tbackup\tfiles\trewritten\tidentical\tcreated during the runs, left in place\tlarge files changed, not restored\n"

const expand = (p) => p.replace(/^%LOCALAPPDATA%/i, process.env.LOCALAPPDATA ?? "")
const cell = (s) => String(s).replace(/[\t\r\n]+/g, " ")

export function pendingList() {
  if (!existsSync(PENDING)) return []
  return readFileSync(PENDING, "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("aircraft\t"))
    .map((l) => { const [aircraft, backup, created, runs] = l.split("\t"); return { aircraft, backup, dir: expand(backup), created, runs: runs ? runs.split(", ") : [] } })
}

function writePending(rows) {
  writeFileSync(PENDING, PENDING_HEAD + rows.map((r) => [r.aircraft, r.backup, r.created, r.runs.join(", ")].map(cell).join("\t") + "\n").join(""))
}

export function pendingFor(aircraft) {
  return pendingList().find((r) => r.aircraft === aircraft) ?? null
}

// Adds a backup, or this run to the backup already pending for the aircraft.
export function markPending(aircraft, dir, run) {
  const rows = pendingList()
  const had = rows.find((r) => r.aircraft === aircraft)
  if (had) { if (!had.runs.includes(run)) had.runs.push(run) }
  else rows.push({ aircraft, backup: scrub(dir), created: new Date().toISOString(), runs: [run] })
  writePending(rows)
}

// Restores every pending backup and records each in results/restores.tsv;
// a backup leaves the pending list only when every file matches it afterwards.
export async function restorePending({ only = null } = {}) {
  const rows = pendingList()
  const done = []
  for (const row of rows.filter((r) => !only || r.aircraft === only)) {
    const manifest = readManifest(row.dir)
    const r = await restore(manifest)
    const large = (r.large ?? []).filter((l) => l.changed).map((l) => l.path)
    const line = [new Date().toISOString(), row.aircraft, row.backup, r.files, r.rewritten.length, `${r.identical} of ${r.files}`, r.created.join(", ") || "none", large.join(", ") || "none"]
    writeFileSync(HISTORY, (existsSync(HISTORY) ? "" : HISTORY_HEAD) + line.map(cell).join("\t") + "\n", { flag: "a" })
    done.push({ ...row, result: r, ok: r.identical === r.files && !r.failed.length })
  }
  writePending(rows.filter((row) => !done.some((d) => d.backup === row.backup && d.ok)))
  return done
}
