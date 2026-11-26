/*
 * p17: an aircraft's presets, and what each is built from, read from its packages'
 * .fsarchive headers with no sim running, for the variant picker
 * (record/areas/profiles/07-the-variant-picker.md).
 *
 * A streamed package keeps its files in .fsarchive archives. An archive whose header
 * says "notEncrypted" lists every file it holds in a JSON index, and stores a file
 * uncompressed when its byteSize equals its uncompressed_size
 * (record/areas/aircraft/log.md, 2026-10-16 and the Phenom 300E's minimal.fsarchive).
 * This finds every package whose name holds the filter, says which archives are
 * readable, and for each preset a readable archive lists, its path and the
 * attachments and merged models its config/attached_objects.cfg names. It prints
 * names only, never a file's contents, since those are the aircraft developer's.
 *
 *   node experiments/areas/aircraft/p17-archive-presets.mjs c172
 *
 * Output: the report on the console and in
 * experiments/areas/aircraft/results/p17-archive-presets-<time>.txt.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { scrub } from "./lib/out.mjs"
import { saveResult } from "../../tools/results.mjs"

const filter = (process.argv[2] ?? "").toLowerCase()
if (!filter) throw new Error("give a filter for the packages' names, such as c172")

// The Steam edition keeps UserCfg.opt under %APPDATA%, and the Microsoft Store
// edition under its package's LocalCache (record/learn/foundations/
// 02-01-installs-and-packages.md).
const CANDIDATES = [
  join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt"),
  join(process.env.LOCALAPPDATA ?? "", "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache", "UserCfg.opt"),
]
const cfg = CANDIDATES.find((p) => existsSync(p))
if (!cfg) throw new Error("no UserCfg.opt found for either edition")
const line = readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath /.test(l))
const root = line.replace(/^\s*InstalledPackagesPath\s+"?/, "").replace(/"\s*$/, "")

const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const dirs = (p) => (isDir(p) ? readdirSync(p).filter((n) => isDir(join(p, n))) : [])

// The folders that hold packages, as the sim service's package_roots lists them:
// Official2024 and Official2020 hold a folder for each store.
const holders = ["Community", "Community2024", "StreamedPackages", ...["Official2024", "Official2020"].flatMap((o) => dirs(join(root, o)).map((s) => join(o, s)))]
const packages = holders.flatMap((h) => dirs(join(root, h)).filter((n) => n.toLowerCase().includes(filter)).map((n) => ({ holder: h, name: n, path: join(root, h, n) })))

function archivesIn(dir) {
  const found = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (isDir(p)) found.push(...archivesIn(p))
    else if (n.toLowerCase().endsWith(".fsarchive")) found.push(p)
  }
  return found
}

/** The archive's JSON index and where its data starts, or its scheme when it isn't readable. */
function readArchive(file) {
  const bytes = readFileSync(file)
  const start = bytes.indexOf("{")
  if (start < 0 || start > 64) return { scheme: "no plain index" }
  let depth = 0
  let end = -1
  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === 0x7b) depth++
    else if (bytes[i] === 0x7d && --depth === 0) { end = i + 1; break }
  }
  let index
  try { index = JSON.parse(bytes.subarray(start, end).toString("utf8")) } catch { return { scheme: "no plain index" } }
  const scheme = index.encryptionSetup?.scheme ?? "unknown"
  if (scheme !== "notEncrypted") return { scheme }
  // The data follows the index; its start is where a stored .cfg reads as text.
  const probe = index.fileInfoList.find((f) => f.path.endsWith(".cfg") && f.byteSize === f.uncompressed_size && f.byteSize > 40)
  let base = -1
  for (let b = end; probe && b < end + 4096; b++) {
    const s = bytes.subarray(b + probe.byteOffset, b + probe.byteOffset + 40).toString("latin1")
    if (/^[\x09\x0a\x0d\x20-\x7e]{40}$/.test(s)) { base = b; break }
  }
  const read = (f) => (base >= 0 && f.byteSize === f.uncompressed_size ? bytes.subarray(base + f.byteOffset, base + f.byteOffset + f.byteSize).toString("utf8") : null)
  return { scheme, files: index.fileInfoList, read }
}

const out = []
const say = (s = "") => { out.push(s); console.log(s) }

say(`p17 archive presets, filter "${filter}", packages folder ${scrub(root)}`)
say(`${packages.length} package${packages.length === 1 ? "" : "s"}`)
for (const pkg of packages) {
  say()
  say(`## ${pkg.holder}\\${pkg.name}`)
  const presets = new Map()
  for (const file of archivesIn(pkg.path)) {
    const a = readArchive(file)
    say(`archive ${file.slice(pkg.path.length + 1)}: ${a.scheme}${a.files ? `, ${a.files.length} files` : ""}`)
    if (!a.files) continue
    for (const f of a.files) {
      const m = /^simobjects\\airplanes\\([^\\]+)\\presets\\([^\\]+)\\([^\\]+)\\(.+)$/i.exec(f.path)
      if (!m) continue
      const key = `${m[1]}/presets/${m[2]}/${m[3]}`.toLowerCase()
      if (!presets.has(key)) presets.set(key, { files: 0, parts: [] })
      const p = presets.get(key)
      p.files++
      if (!/\\config\\attached_objects\.cfg$/i.test(f.path)) continue
      const text = a.read(f)
      if (text === null) { p.parts.push("(attached_objects.cfg is compressed, so unread)"); continue }
      for (const block of text.split(/\n(?=\[)/)) {
        const root = /attachment_root\s*=\s*"([^"]+)"/i.exec(block)?.[1]
        const merge = /merge_file\s*=\s*"([^"]+)"/i.exec(block)?.[1]
        const name = (root ?? merge ?? "").replaceAll("\\", "/")
        if (name) p.parts.push(`${root ? "attachment" : "merged model"} ${name.replace(/^SimObjects\/Airplanes\/[^/]+\/attachments\//i, "")}`)
      }
    }
  }
  say(`${presets.size} preset${presets.size === 1 ? "" : "s"} in readable archives`)
  for (const [key, p] of presets) {
    say(`- ${key} (${p.files} files)`)
    for (const part of p.parts) say(`    ${part}`)
  }
}

const file = saveResult("aircraft", "p17-archive-presets", out.join("\n"))
console.log(`\nsaved ${scrub(file)}`)
