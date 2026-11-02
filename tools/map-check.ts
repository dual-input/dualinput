// Dual Input's code is split so that deleting a feature leaves everything else building
// and passing its tests, and so that an engine works outside Dual Input. The code map is
// the design that says which code may use which, and this checks our code against it.
//
// The map sorts code into tiers by folder, and each folder in a tier, such as
// src/engines/messages, is a unit:
//
//   src/engines/    libraries that know nothing of Dual Input, such as the message crate
//   src/platform/   the services features run on: in the core, Dual Input's main program,
//                   and outside it, in our WASM module inside the sim, in the sim's cockpit
//                   panels, and in the EFB and desktop apps
//   src/features/   one folder for each thing a pilot gets, such as pointer sync
//   src/apps/, src/sim-package/, and tools/   the programs and packages built from the rest
//   src/packages/   what the apps' pages draw with, which only those pages use
//
// Code may use only the tiers below its own, and the rules below narrow that further.
//
// The core does its work on one loop that takes every input from a queue, so a recording
// of those inputs can replay a run exactly. So code on the loop may not do I/O. That's the
// edge's job: the code that talks to the sim and the network, and turns what arrives into
// the loop's inputs.
//
// The check reads crates' dependencies from Cargo and TypeScript's imports from the
// compiler, and searches the source for the few rules neither shows
// (record/areas/architecture/02-code-map.md).
//
//   node tools/map-check.ts [root]
//
// The root defaults to the repository's; tools/map-check.test.ts passes a temporary tree.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { fromRoot, ROOT } from "./lib/repo.ts"

/**
 * The rules the check holds, each named in its findings.
 *
 * A feature has up to five parts, each in a folder of its own: its crate in the core
 * (`core/`), routines that run in our WASM module on the routine host (`routines/`), panel
 * modules that run in cockpit panels on the panel bridge (`panel/`), and sections of the
 * EFB and desktop apps, on each app's shell (`efb/`, `desktop/`).
 *
 * The message crate and the profile engine, which reads the aircraft profiles that say
 * what to sync, hold a module for each feature. So the crate graph can't show one feature
 * using another's module there, and the check searches the source for it instead.
 */
export type Rule =
  | "unmapped" // a crate or file is in a folder the code map has no unit for
  | "down-the-tiers" // a feature may use the platform and engines, the platform may use engines, and an engine neither
  | "lines-below" // an engine, or a crate of the core's platform, may use only units on lower lines (see ENGINE_LINES)
  | "outside-the-core" // the platform outside the core and the core's crates may not use each other, and the routine host may use only messages
  | "feature-on-feature" // a feature may not use another feature's code, or name its module in messages or the profile engine
  | "feature-parts" // each part may use messages and its own platform: routines the routine host and loop engines, panel modules the panel bridge, sections their app's shell
  | "nothing-on-apps" // nothing may use src/apps/, src/sim-package/, or tools/
  | "loop-io" // a loop crate may not reach a crate that does I/O, directly or through others (see EDGE_ENGINES)
  | "foreign-functions" // only the sim edge and our WASM module may declare foreign functions, and src/apps/core only _set_FMA3_enable
  | "feature-moments" // a feature may not implement Moment, since only the platform raises moments, the events features learn of each other through
  | "platform-names-feature" // the platform may not name a feature's module in messages
  | "packages" // a package may use only packages, and only the pages' shells, their sections, and the programs may use one
  | "pages-apart" // neither page's code may reach into the other's, so what both draw goes in a package

export type Finding = { rule: Rule; where: string; detail: string }

// The code map draws the engines, and the core's platform, as units in stacked lines, top
// line first, and a unit may use only units on lower lines, so messages, on the bottom
// line, may use no other engine. These copy that picture, in the code map's "The units".
// When you add a unit, add it to the picture and here; until it's here, the check reports
// it as unmapped.
const ENGINE_LINES = [
  ["sync-engine", "profile-build", "sim-edge", "stand-in-sim"],
  ["sandbox", "profile-engine", "recording-format", "aircraft-model", "sim-client", "sim-awareness", "transport", "page-client"],
  ["messages", "simconnect-types", "msfs-gltf", "msfs-rpn", "ray-cast", "object-mirror"],
]
const CORE_PLATFORM_LINES = [
  ["profile-loader", "cockpit-stream"],
  ["session"],
  ["sim-service", "network", "core-helper-service", "recording"],
  ["clients"],
  ["kernel"],
]
const OUTSIDE_PLATFORM = ["routine-host", "panel-bridge", "efb-shell", "banner", "desktop-shell"]
const FEATURE_PARTS = ["core", "routines", "panel", "efb", "desktop"]
// The pages that draw with the kit.
const PAGE_SHELLS = ["efb-shell", "banner", "desktop-shell"]

// The engines that are edge code, the stand-in sim included, which takes the sim's place
// in tests. The loop's rules don't hold for them. The comments on the loop's lints in the
// root Cargo.toml and clippy.toml list the same crates, so change all three together.
const EDGE_ENGINES = ["sim-edge", "transport", "stand-in-sim"]

// The crates that do I/O, which no loop crate may reach. A crate that does I/O but isn't
// listed passes, so when you add a dependency to a loop crate, check what it does, and
// list it here and in the code map's "The map check" if it does I/O.
const IO_CRATES = new Set([
  ...["tokio", "mio", "async-std", "smol", "async-io", "polling"],
  ...["socket2", "hyper", "reqwest", "ureq", "tungstenite", "tokio-tungstenite", "axum", "iroh", "iroh-relay", "quinn", "noq"],
  ...["windows", "windows-sys", "winapi"],
  "getrandom",
  ...["notify", "sysinfo", "tempfile", "walkdir", "dirs"],
  ...["tracing-subscriber", "tracing-appender", "env_logger"],
  ...["tauri", "wry", "cpal", "wasapi"],
])

type Unit =
  | { tier: "engine"; name: string; line: number }
  | { tier: "core-platform"; name: string; line: number }
  | { tier: "outside-platform"; name: string }
  | { tier: "feature"; name: string; part: string }
  | { tier: "app" | "sim-package" | "tool" | "package"; name: string }

/**
 * The unit a crate's folder or a TypeScript file belongs to, from its path from the root,
 * such as `src/features/traffic/core`.
 * Returns undefined for a path in one of the map's folders that matches no unit, which is
 * a finding, and null for a path outside them, such as `src/backend/`, which the check skips.
 */
function unitOf(rel: string): Unit | undefined | null {
  // The tiers are folders under src/, and the tools a folder at the root.
  const parts = rel.split("/")
  const [top, name, part] = parts[0] === "src" ? parts.slice(1) : parts[0] === "tools" ? parts : []
  if (!name) return null
  const lineOf = (lines: string[][]) => lines.findIndex((line) => line.includes(name))
  switch (top) {
    case "engines": {
      const line = lineOf(ENGINE_LINES)
      return line < 0 ? undefined : { tier: "engine", name, line }
    }
    case "platform": {
      if (OUTSIDE_PLATFORM.includes(name)) return { tier: "outside-platform", name }
      const line = lineOf(CORE_PLATFORM_LINES)
      return line < 0 ? undefined : { tier: "core-platform", name, line }
    }
    case "features":
      return part && FEATURE_PARTS.includes(part) ? { tier: "feature", name, part } : undefined
    case "packages":
      return { tier: "package", name }
    case "apps":
      return { tier: "app", name }
    case "sim-package":
      return { tier: "sim-package", name }
    case "tools":
      return { tier: "tool", name: name.replace(/\.ts$/, "") }
    default:
      return null
  }
}

// The shell each kind of feature module may use: a panel module the panel bridge, and an
// app section its app's shell.
const PART_SHELLS: Record<string, string> = { panel: "panel-bridge", efb: "efb-shell", desktop: "desktop-shell" }

const sameUnit = (a: Unit, b: Unit) =>
  a.tier === b.tier && a.name === b.name && (a.tier !== "feature" || (b.tier === "feature" && a.part === b.part))

/** Whether one of our crates may depend on another, or the rule it breaks. */
function crateRule(from: Unit, to: Unit): Rule | null {
  if (to.tier === "app" || to.tier === "sim-package" || to.tier === "tool") {
    // The one exception, which the note at the top of the code map allows: src/apps/core links
    // src/sim-package/routines, so tests can run our WASM module's routines inside the core,
    // and src/sim-package/wasm-module links it as well.
    const routines = to.tier === "sim-package" && to.name === "routines"
    if (routines && ((from.tier === "app" && from.name === "core") || from.tier === "sim-package")) return null
    if (from.tier === "tool" && to.tier === "tool") return null
    return "nothing-on-apps"
  }
  switch (from.tier) {
    case "engine":
      if (to.tier !== "engine") return "down-the-tiers"
      return to.line > from.line ? null : "lines-below"
    case "core-platform":
      if (to.tier === "engine") return null
      if (to.tier === "core-platform") return to.line > from.line ? null : "lines-below"
      if (to.tier === "outside-platform") return "outside-the-core"
      return "down-the-tiers"
    case "outside-platform":
      if (from.name === "routine-host") return to.tier === "engine" && to.name === "messages" ? null : "outside-the-core"
      if (to.tier === "engine" || to.tier === "outside-platform") return null
      return to.tier === "core-platform" ? "outside-the-core" : "down-the-tiers"
    case "feature":
      if (to.tier === "feature" && to.name !== from.name) return "feature-on-feature"
      if (from.part === "routines") {
        const loopEngine = to.tier === "engine" && !EDGE_ENGINES.includes(to.name)
        const host = to.tier === "outside-platform" && to.name === "routine-host"
        return loopEngine || host ? null : "feature-parts"
      }
      if (to.tier === "engine" || to.tier === "core-platform") return null
      return to.tier === "outside-platform" ? "outside-the-core" : "feature-parts"
    default:
      return null
  }
}

/** Whether one of our TypeScript files may import another, or the rule it breaks. */
function importRule(from: Unit, to: Unit, toRel: string, features: Set<string>): Rule | null {
  if (sameUnit(from, to)) return null
  // The message crate's TypeScript types for a feature sit in src/engines/messages/ts/<feature>/.
  const typesOf = /^src\/engines\/messages\/ts\/([^/]+)\//.exec(toRel)?.[1]
  const featureTypes = typesOf && features.has(typesOf) ? typesOf : null

  if (to.tier === "app" || to.tier === "sim-package" || to.tier === "tool") {
    return from.tier === "tool" && to.tier === "tool" ? null : "nothing-on-apps"
  }
  if (from.tier === "package") return to.tier === "package" ? null : "packages"
  if (to.tier === "package") {
    if (from.tier === "app" || from.tier === "sim-package" || from.tier === "tool") return null
    if (from.tier === "outside-platform" && PAGE_SHELLS.includes(from.name)) return null
    return from.tier === "feature" && (from.part === "efb" || from.part === "desktop") ? null : "packages"
  }
  switch (from.tier) {
    case "engine":
      if (to.tier !== "engine") return "down-the-tiers"
      return to.line > from.line ? null : "lines-below"
    case "core-platform":
    case "outside-platform":
      if (featureTypes) return "platform-names-feature"
      if (to.tier === "outside-platform" && PAGE_SHELLS.includes(from.name) && PAGE_SHELLS.includes(to.name)) return "pages-apart"
      if (to.tier === "engine" || to.tier === "outside-platform") return null
      return to.tier === "core-platform" ? "outside-the-core" : "down-the-tiers"
    case "feature": {
      if (to.tier === "feature") return to.name === from.name ? null : "feature-on-feature"
      if (featureTypes) return featureTypes === from.name ? null : "feature-on-feature"
      if (to.tier === "engine" && to.name === "messages") return null
      return to.tier === "outside-platform" && to.name === PART_SHELLS[from.part] ? null : "feature-parts"
    }
    default:
      return null
  }
}

type Crate = { id: string; name: string; dir: string; rel: string; unit: Unit | undefined | null }

type Metadata = {
  packages: { id: string; name: string; manifest_path: string; targets: { kind: string[] }[] }[]
  workspace_members: string[]
  resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] }
}

/** Every finding for the tree at `root`. */
export function checkMap(root = ROOT): Finding[] {
  const findings: Finding[] = []
  const features = new Set(listDirs(path.join(root, "src", "features")))
  if (fs.existsSync(path.join(root, "Cargo.toml"))) checkCrates(root, features, findings)
  checkImports(root, features, findings)
  return findings
}

function checkCrates(root: string, features: Set<string>, findings: Finding[]): void {
  const result = spawnSync("cargo", ["metadata", "--format-version", "1"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 })
  if (result.status !== 0) throw new Error(`cargo metadata failed in ${root}:\n${result.stderr}`)
  const meta = JSON.parse(result.stdout) as Metadata

  const names = new Map(meta.packages.map((p) => [p.id, p.name]))
  const ours = new Map<string, Crate>()
  for (const p of meta.packages) {
    if (!meta.workspace_members.includes(p.id)) continue
    const dir = path.dirname(p.manifest_path)
    const rel = fromRoot(dir, root)
    ours.set(p.id, { id: p.id, name: p.name, dir, rel, unit: unitOf(rel) })
  }

  // Normal dependencies only. A build dependency, such as bindgen reading the SDK's
  // headers, runs while a crate compiles, never on the loop.
  const deps = new Map<string, string[]>()
  for (const node of meta.resolve.nodes) {
    deps.set(node.id, node.deps.filter((d) => d.dep_kinds.some((k) => k.kind === null)).map((d) => d.pkg))
  }
  // A proc macro runs in the compiler too, so what it reaches is no loop crate's I/O: ts-rs's
  // derive reaches windows-sys through termcolor. Its dependencies still count for the
  // tiers, so a proc macro of ours keeps every other rule.
  const procMacros = new Set(meta.packages.filter((p) => p.targets.some((t) => t.kind.includes("proc-macro"))).map((p) => p.id))
  const runtimeDeps = new Map([...deps].map(([id, list]) => [id, procMacros.has(id) ? [] : list]))

  for (const crate of ours.values()) {
    if (!crate.unit) {
      findings.push({ rule: "unmapped", where: crate.rel, detail: `crate ${crate.name} is in no unit of the code map's picture` })
      continue
    }
    for (const dep of deps.get(crate.id) ?? []) {
      const to = ours.get(dep)
      if (!to?.unit) continue
      const rule = crateRule(crate.unit, to.unit)
      if (rule) findings.push({ rule, where: crate.rel, detail: `depends on ${to.rel}` })
    }
    if (isLoopCrate(crate.unit)) {
      for (const io of ioReached(crate.id, runtimeDeps, names, ours)) {
        findings.push({ rule: "loop-io", where: crate.rel, detail: `reaches ${io}` })
      }
    }
    checkRustSource(crate, features, findings, root)
  }
  // The desktop app is a workspace of its own, which this one's metadata leaves out. Its one dependency of ours is the message crate, which no rule forbids an app, so only its source needs reading.
  const desktop = path.join(root, "src", "apps", "desktop")
  if (fs.existsSync(path.join(desktop, "Cargo.toml"))) checkRustSource({ id: "", name: "dualinput-desktop", dir: desktop, rel: "src/apps/desktop", unit: { tier: "app", name: "desktop" } }, features, findings, root)
}

/** Every crate outside src/apps/, src/sim-package/, tools/, and the edge engines runs on the loop. */
function isLoopCrate(u: Unit): boolean {
  if (u.tier === "app" || u.tier === "sim-package" || u.tier === "tool") return false
  return !(u.tier === "engine" && EDGE_ENGINES.includes(u.name))
}

/** Each I/O crate that `start` reaches through normal dependencies, as the chain of crates that leads to it, such as `helper -> tokio`. */
function ioReached(start: string, deps: Map<string, string[]>, names: Map<string, string>, ours: Map<string, Crate>): string[] {
  const found: string[] = []
  const via = new Map<string, string>([[start, ""]])
  const queue = [start]
  while (queue.length) {
    const id = queue.shift()!
    for (const dep of deps.get(id) ?? []) {
      if (via.has(dep)) continue
      via.set(dep, id)
      const unit = ours.get(dep)?.unit
      const io = unit ? unit.tier === "engine" && EDGE_ENGINES.includes(unit.name) : IO_CRATES.has(names.get(dep)!)
      if (io) {
        const chain = []
        for (let at = dep; at !== start; at = via.get(at)!) chain.unshift(names.get(at)!)
        found.push(chain.join(" -> "))
      } else {
        queue.push(dep)
      }
    }
  }
  return found
}

function checkRustSource(crate: Crate, features: Set<string>, findings: Finding[], root: string): void {
  const unit = crate.unit!
  const modules = new Map([...features].map((f) => [f.replaceAll("-", "_"), f]))
  for (const file of listFiles(crate.dir, (f) => f.endsWith(".rs"), ["target"])) {
    const rel = fromRoot(file, root)
    const source = withoutComments(fs.readFileSync(file, "utf8"))

    // Foreign functions are declared in `extern "ABI" { ... }` blocks, which the crate graph
    // can't show. src/apps/core may declare one, _set_FMA3_enable, which turns off the C
    // runtime's FMA3 math so the core's results don't depend on whether the CPU has FMA3.
    for (const block of externBlocks(source)) {
      const declared = [...block.matchAll(/\bfn\s+(\w+)/g)].map((m) => m[1])
      const edge = unit.tier === "engine" ? unit.name === "sim-edge" : unit.tier === "sim-package" && unit.name === "wasm-module"
      const fma3 = unit.tier === "app" && unit.name === "core" && declared.every((f) => f === "_set_FMA3_enable")
      if (!edge && !fma3) findings.push({ rule: "foreign-functions", where: rel, detail: `declares ${declared.join(", ") || "a foreign block"}` })
    }

    if (unit.tier === "feature" && /\bimpl\b[^;{]*\bMoment\s+for\b/.test(source)) {
      findings.push({ rule: "feature-moments", where: rel, detail: "implements Moment" })
    }

    for (const named of namedModules(source)) {
      const feature = modules.get(named.module)
      if (!feature) continue
      if (unit.tier === "feature" && feature !== unit.name) {
        findings.push({ rule: "feature-on-feature", where: rel, detail: `names ${named.crate}::${named.module}` })
      }
      if ((unit.tier === "core-platform" || unit.tier === "outside-platform") && named.crate === "messages") {
        findings.push({ rule: "platform-names-feature", where: rel, detail: `names messages::${named.module}` })
      }
    }
  }
}

/** Each module named under `messages::` or `profile_engine::`, including those in a grouped `use` such as `messages::{ids, pointer_sync}`. */
function namedModules(source: string): { crate: string; module: string }[] {
  const named: { crate: string; module: string }[] = []
  for (const m of source.matchAll(/\b(messages|profile_engine)::(?:\{([^}]*)\}|(\w+))/g)) {
    const items = m[2] !== undefined ? m[2].split(",") : [m[3]!]
    for (const item of items) {
      const module = item.trim().split(/[\s:]/)[0]
      if (module) named.push({ crate: m[1]!, module })
    }
  }
  return named
}

function externBlocks(source: string): string[] {
  const blocks: string[] = []
  for (const m of source.matchAll(/\bextern\s+"[^"]*"\s*\{/g)) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++
      if (source[i] === "}") depth--
      i++
    }
    blocks.push(source.slice(start, i - 1))
  }
  return blocks
}

/**
 * The source without its comments, so a comment that mentions `messages::traffic` or an
 * extern block isn't a finding. A string that holds `//`, such as a URL, also loses the
 * rest of its line, which can hide a finding on that line.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

// TypeScript's imports come from the compiler, through --explainFiles, which also lists
// `import type` imports. esbuild's metafile leaves those out, so we don't use it.
// tools/map-check.test.ts has a case that fails if they go missing.
function checkImports(root: string, features: Set<string>, findings: Finding[]): void {
  const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc")
  const folders = ["src/engines", "src/platform", "src/features", "src/apps", "src/sim-package", "src/packages", "tools"].map((f) => path.join(root, f))
  const configs = folders.flatMap((f) => listFiles(f, (file) => path.basename(file) === "tsconfig.json", ["node_modules", "target"]))
  const seen = new Set<string>()
  for (const config of configs) {
    const result = spawnSync(process.execPath, [tsc, "-p", config, "--noEmit", "--explainFiles", "--pretty", "false"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    })
    const edges = importEdges(result.stdout, root)
    if (!edges.files) throw new Error(`tsc listed no file for ${fromRoot(config, root)}:\n${result.stdout}${result.stderr}`)
    for (const { from, to } of edges.imports) {
      const key = `${from}\n${to}`
      if (seen.has(key)) continue
      seen.add(key)
      const fromUnit = unitOf(from)
      const toUnit = unitOf(to)
      if (fromUnit === null || toUnit === null) continue
      if (!fromUnit || !toUnit) {
        findings.push({ rule: "unmapped", where: fromUnit ? to : from, detail: "is in no unit of the code map's picture" })
        continue
      }
      const rule = importRule(fromUnit, toUnit, to, features)
      if (rule) findings.push({ rule, where: from, detail: `imports ${to}` })
    }
  }
}

/** The imports --explainFiles reports between files under `root`, outside node_modules. */
function importEdges(text: string, root: string): { files: number; imports: { from: string; to: string }[] } {
  const imports: { from: string; to: string }[] = []
  let files = 0
  let current: string | null = null
  const ours = (p: string) => {
    const rel = fromRoot(path.resolve(root, p), root)
    return rel.startsWith("..") || rel.includes("node_modules/") ? null : rel
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!/^\s/.test(line)) {
      // Each file of the program starts a line, and so do errors and counts, so only a line
      // that names a source file starts a new file's list.
      const heading = /^[^(]+\.[cm]?[jt]sx?$/.test(line.trim())
      current = heading ? ours(line.trim()) : null
      if (current) files++
      continue
    }
    // Under each file, --explainFiles lists the files that import it, so the file above is
    // the import's target and the "from file" path is the importer.
    const m = /^\s+Imported via (["']).*?\1 from file (["'])(.+?)\2/.exec(line)
    const from = m && ours(m[3]!)
    if (current && from) imports.push({ from, to: current })
  }
  return { files, imports }
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
}

function listFiles(dir: string, keep: (file: string) => boolean, skip: string[]): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!skip.includes(entry.name)) files.push(...listFiles(full, keep, skip))
    } else if (keep(full)) {
      files.push(full)
    }
  }
  return files
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? ROOT)
  const findings = checkMap(root)
  for (const f of findings) console.error(`${f.rule}: ${f.where} ${f.detail}`)
  if (findings.length) {
    console.error(`\nmap check: ${findings.length} finding${findings.length === 1 ? "" : "s"}`)
    process.exit(1)
  }
  console.log("map check: every dependency and import follows the code map")
}
