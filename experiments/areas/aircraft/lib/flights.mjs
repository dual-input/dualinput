/*
 * Flight files: reading them, writing them, and finding what they name on disk.
 *
 * The sim writes flight files in Windows-1252 with CRLF line ends: the degree
 * sign in a position is the byte 0xB0 (read in CustomFlight.FLT, 2026-09-29).
 * latin1 decodes that byte to the same character, so every read and write here
 * is latin1, and every write joins lines with CRLF.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

import { repoRelative } from "./out.mjs"

// ---------------------------------------------------------------- parsing

// Keeps every line, the blank one before [Main] and repeated keys included, so
// a file read and rendered unchanged comes back byte for byte.
export function parseFlt(text) {
  const out = { preamble: [], sections: [] }
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const head = /^\s*\[(.+)\]\s*$/.exec(line)
    if (head) {
      current = { name: head[1], lines: [line] }
      out.sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      out.preamble.push(line)
    }
  }
  return out
}

export function renderFlt(parsed) {
  return [...parsed.preamble, ...parsed.sections.flatMap((s) => s.lines)].join("\r\n")
}

const sectionOf = (parsed, name) => parsed.sections.find((s) => s.name.toLowerCase() === name.toLowerCase())

export function getKey(parsed, section, key) {
  const s = sectionOf(parsed, section)
  if (!s) return null
  const want = key.toLowerCase()
  for (const line of s.lines.slice(1)) {
    const eq = line.indexOf("=")
    if (eq > 0 && line.slice(0, eq).trim().toLowerCase() === want) return line.slice(eq + 1).trim()
  }
  return null
}

// Replaces the first line with this key, or adds one before the section's
// trailing blank lines. A missing section is added at the end.
export function setKey(parsed, section, key, value) {
  let s = sectionOf(parsed, section)
  if (!s) {
    s = { name: section, lines: [`[${section}]`, ""] }
    parsed.sections.push(s)
  }
  const want = key.toLowerCase()
  const at = s.lines.findIndex((line, i) => i > 0 && line.indexOf("=") > 0 && line.slice(0, line.indexOf("=")).trim().toLowerCase() === want)
  if (at !== -1) {
    s.lines[at] = `${key}=${value}`
    return
  }
  let end = s.lines.length
  while (end > 1 && s.lines[end - 1].trim() === "") end--
  s.lines.splice(end, 0, `${key}=${value}`)
}

export function removeKey(parsed, section, key) {
  const s = sectionOf(parsed, section)
  if (!s) return
  const want = key.toLowerCase()
  s.lines = s.lines.filter((line, i) => i === 0 || line.indexOf("=") <= 0 || line.slice(0, line.indexOf("=")).trim().toLowerCase() !== want)
}

export function readFltFile(path) {
  return parseFlt(readFileSync(path, "latin1"))
}

export function writeFltFile(path, parsed) {
  writeFileSync(path, renderFlt(parsed), "latin1")
}

// ---------------------------------------------------------------- positions

export function dms(text) {
  const m = /^([NSEW])\s*([\d.]+)\D+([\d.]+)'\s*([\d.]+)"?$/.exec(text ?? "")
  if (!m) return null
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600
  return m[1] === "S" || m[1] === "W" ? -v : v
}

// The sim's own form, `N16° 45' 0.6666"`, with the degree sign as latin1 0xB0.
export function toDms(value, positive, negative) {
  const hemi = value < 0 ? negative : positive
  let abs = Math.abs(value)
  let deg = Math.floor(abs)
  let min = Math.floor((abs - deg) * 60)
  let sec = Math.round(((abs - deg) * 60 - min) * 60 * 1e4) / 1e4
  if (sec >= 60) { sec -= 60; min += 1 }
  if (min >= 60) { min -= 60; deg += 1 }
  return `${hemi}${deg}° ${min}' ${sec}"`
}

export const latText = (v) => toDms(v, "N", "S")
export const lonText = (v) => toDms(v, "E", "W")

export function distance(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || !Number.isFinite(v))) return Infinity
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a))
}

// ---------------------------------------------------------------- one flight

// What a load gate needs from a flight file, and what a dry run prints.
export function readFlight(path) {
  const text = readFileSync(path, "latin1")
  const parsed = parseFlt(text)
  const get = (section, key) => getKey(parsed, section, key)
  const flight = {
    path,
    rel: repoRelative(path),
    bytes: Buffer.byteLength(text, "latin1"),
    crlf: text.includes("\r\n") && !/[^\r]\n/.test(text),
    title: get("Sim.0", "Sim"),
    livery: get("Sim.0", "Livery"),
    tail: get("Sim.0", "TailNumber"),
    latText: get("SimVars.0", "Latitude"),
    lonText: get("SimVars.0", "Longitude"),
    lat: dms(get("SimVars.0", "Latitude")),
    lon: dms(get("SimVars.0", "Longitude")),
    altFt: Number(get("SimVars.0", "Altitude")),
    headingDeg: Number(get("SimVars.0", "Heading")),
    onGround: /^true$/i.test(get("SimVars.0", "SimOnGround") ?? "") ? 1 : 0,
    firstState: get("FreeFlight", "FirstFlightState"),
    departure: [
      get("Departure", "ICAO"),
      get("Departure", "GateName") && get("Departure", "GateName") !== "NONE"
        ? `${get("Departure", "GateName")} ${get("Departure", "GateNumber")}${get("Departure", "GateSuffix") && get("Departure", "GateSuffix") !== "NONE" ? get("Departure", "GateSuffix") : ""}`
        : get("Departure", "RunwayNumber") ? `runway ${get("Departure", "RunwayNumber")}` : null,
    ].filter(Boolean).join(" "),
    localVars: (sectionOf(parsed, "LocalVars.0")?.lines ?? []).filter((l, i) => i > 0 && l.indexOf("=") > 0).length,
  }
  const missing = ["title", "lat", "lon"].filter((k) => flight[k] === null)
  if (missing.length) throw new Error(`${flight.rel}: no ${missing.join(", ")} in [Sim.0] or [SimVars.0]`)
  return flight
}

// ---------------------------------------------------------------- packages

export function simDir() {
  return join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024")
}

export function packagesDir() {
  const cfg = join(simDir(), "UserCfg.opt")
  if (!existsSync(cfg)) return null
  const m = /InstalledPackagesPath\s+"([^"]+)"/.exec(readFileSync(cfg, "latin1"))
  return m ? m[1] : null
}

export function communityDir() {
  const p = packagesDir()
  return p ? join(p, "Community") : null
}

export function dirs(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
  } catch {
    return []
  }
}

// Community holds community packages; a marketplace package sits in Official2024,
// either at its top or one folder down.
export function packageRoots() {
  const p = packagesDir()
  if (!p) return []
  const roots = [join(p, "Community")]
  const official = join(p, "Official2024")
  roots.push(official, ...dirs(official).map((d) => join(official, d)))
  return roots.filter((r) => existsSync(r))
}

export function findPackage(name) {
  for (const root of packageRoots()) {
    const p = join(root, name)
    if (existsSync(join(p, "manifest.json")) || existsSync(join(p, "SimObjects"))) return p
  }
  return null
}

// Looks only where MSFS 2024 packages keep aircraft.cfg and livery folders, so it
// reads a few hundred directories, never a whole tree.
export function findAircraft(title, livery, packages = null) {
  const found = { title: null, livery: null }
  const want = title.toLowerCase()
  const candidates = packages
    ? packages.map(findPackage).filter(Boolean)
    : packageRoots().flatMap((root) => dirs(root).map((d) => join(root, d)))
  for (const pkg of candidates) {
    const planes = join(pkg, "SimObjects", "Airplanes")
    for (const plane of dirs(planes)) {
      const base = join(planes, plane)
      const cfgs = [join(base, "aircraft.cfg"), join(base, "common", "config", "aircraft.cfg")]
      for (const a of dirs(join(base, "presets"))) {
        for (const b of dirs(join(base, "presets", a))) cfgs.push(join(base, "presets", a, b, "config", "aircraft.cfg"))
      }
      for (const cfg of cfgs) {
        if (found.title || !existsSync(cfg)) continue
        const titles = [...readFileSync(cfg, "latin1").matchAll(/^\s*title\s*=\s*"?([^";\r\n]*?)"?\s*(?:;.*)?$/gim)]
        if (titles.some((m) => m[1].trim().toLowerCase() === want)) found.title = `${pkg.split(/[\\/]/).pop()}: ${relative(pkg, cfg)}`
      }
      if (!livery || found.livery) continue
      for (const a of dirs(join(base, "liveries"))) {
        const hit = dirs(join(base, "liveries", a)).find((b) => b.toLowerCase() === livery.toLowerCase())
        if (hit) found.livery = `${pkg.split(/[\\/]/).pop()}: ${relative(pkg, join(base, "liveries", a, hit))}`
      }
    }
  }
  return found
}
