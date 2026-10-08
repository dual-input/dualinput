/*
 * Builds p03's Rust module in three variants with Navigraph's cargo-msfs,
 * compares each with fsc-editor's module built by the SDK's MSBuild toolset, and
 * packages each in a package of its own, with our own manifest.json and
 * layout.json and no fspackagetool. A package gets one standalone module: with
 * two in one package's modules folder, the sim compiled and ran only the first
 * (measured on MSFS 2024, 2026-10-08, p03's second run).
 *
 *   node experiments/areas/architecture/module/build.mjs [--install]
 *
 * Needs `cargo install --git https://github.com/navigraph/cargo-msfs --tag v1.1.0`,
 * then `cargo-msfs install msfs2024`, and `rustup target add wasm32-wasip1`.
 * --install copies the packages into the Community folder, and refuses while the
 * sim is running, because the sim reads packages only at boot.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { REPO } from "../../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "architecture", "module")
const BUILD = path.join(HERE, "build")
const REFERENCE = path.join(REPO, "..", "fsc-editor", "link", "Packages", "fsc-editor-link", "modules", "fsc-editor-link.wasm")

// What the sim calls in a standalone module, from fsc-editor's export check
// (fsc-editor, link/tools/check.mjs) and 05-03.
const REQUIRED = ["module_init", "module_deinit", "Update_StandAlone", "malloc", "free", "mallinfo", "mchunkit_begin", "mchunkit_next", "get_pages_state", "mark_decommit_pages", "__wasm_call_ctors"]

// A: as cargo-msfs builds it. B: linked with the SDK's MSFS_WasmVersions.a
// (build.rs), with the StackSizesSection custom section that its object brings
// along removed. C: B with that section kept, which the sim didn't compile in
// p03's third run. IDs start at 0xC300, as fsc-editor's start at 0xE000.
const VARIANTS = [
  { tag: "A", pkg: "crosscheck-p03-rust", env: { P03_TAG: "A", P03_BASE_ID: String(0xc300) } },
  { tag: "B", pkg: "crosscheck-p03b-rust", env: { P03_TAG: "B", P03_BASE_ID: String(0xc300), P03_VERSIONS: "1" }, drop: ["StackSizesSection"] },
  { tag: "C", pkg: "crosscheck-p03c-rust", env: { P03_TAG: "C", P03_BASE_ID: String(0xc300), P03_VERSIONS: "1" } },
]

// Rewrites a .wasm without the named custom sections.
function dropSections(file, names) {
  const bytes = fs.readFileSync(file)
  const parts = [bytes.subarray(0, 8)]
  let p = 8
  const leb = () => { let r = 0, s = 0, b; do { b = bytes[p++]; r |= (b & 0x7f) << s; s += 7 } while (b & 0x80); return r >>> 0 }
  while (p < bytes.length) {
    const from = p, id = bytes[p++], size = leb(), start = p
    let keep = true
    if (id === 0) { const n = leb(); keep = !names.includes(bytes.subarray(p, p + n).toString()) }
    if (keep) parts.push(bytes.subarray(from, start + size))
    p = start + size
  }
  fs.writeFileSync(file, Buffer.concat(parts))
}

function shape(file) {
  const bytes = fs.readFileSync(file)
  const m = new WebAssembly.Module(bytes)
  const imports = {}
  for (const i of WebAssembly.Module.imports(m)) (imports[i.module] ??= []).push(i.name)
  const sections = []
  let p = 8
  const leb = () => { let r = 0, s = 0, b; do { b = bytes[p++]; r |= (b & 0x7f) << s; s += 7 } while (b & 0x80); return r >>> 0 }
  while (p < bytes.length) {
    const id = bytes[p++], size = leb(), start = p
    if (id === 0) { const n = leb(); sections.push(bytes.subarray(p, p + n).toString()) }
    p = start + size
  }
  return { size: bytes.length, exports: WebAssembly.Module.exports(m).map((e) => e.name), imports, sections }
}

// fsc-editor's working manifest, with our names (fsc-editor,
// link/Packages/fsc-editor-link/manifest.json), and a layout.json whose date is
// a Windows FILETIME, past Number.MAX_SAFE_INTEGER, written from a BigInt as a
// bare number (fsc-editor, link/tools/layout.mjs).
function writePackage(dir, title, rel, size) {
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    dependencies: [],
    content_type: "MISC",
    title,
    manufacturer: "",
    creator: "Crosscheck",
    package_version: "0.1.0",
    minimum_game_version: "1.8.14",
    minimum_compatibility_version: "8.11.0.236",
    export_type: "Community",
    builder: "Microsoft Flight Simulator 2024",
    package_order_hint: "",
    release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
    total_package_size: String(size),
  }, null, 2) + "\n")
  const filetime = ((BigInt(Math.floor(Date.now())) + 11644473600000n) * 10000n).toString()
  fs.writeFileSync(path.join(dir, "layout.json"), `{\n  "content": [\n    {\n      "path": "${rel}",\n      "size": ${size},\n      "date": ${filetime}\n    }\n  ]\n}\n`)
}

fs.rmSync(BUILD, { recursive: true, force: true })
const ref = shape(REFERENCE)
for (const v of VARIANTS) {
  const dir = path.join(BUILD, v.pkg)
  fs.mkdirSync(path.join(dir, "modules"), { recursive: true })
  const wasm = path.join(BUILD, `crosscheck-p03${v.tag.toLowerCase()}.wasm`)
  execFileSync("cargo-msfs", ["build", "msfs2024", "-i", HERE, "-o", wasm], { stdio: "inherit", env: { ...process.env, ...v.env } })
  if (v.drop) dropSections(wasm, v.drop)
  const ours = shape(wasm)
  const missing = REQUIRED.filter((e) => !ours.exports.includes(e))
  console.log(`\n${v.pkg}, ${path.basename(wasm)}: ${ours.size} bytes`)
  console.log(`  exports: ${ours.exports.join(", ")}`)
  console.log(`  imports: ${Object.entries(ours.imports).map(([mod, names]) => `${mod} (${names.length}): ${names.join(", ")}`).join("; ")}`)
  console.log(`  custom sections: ${ours.sections.join(", ") || "none"}`)
  console.log(`  required exports missing: ${missing.join(", ") || "none"}`)
  console.log(`  in fsc-editor's toolset build and not this one: exports ${ref.exports.filter((e) => !e.startsWith("_Z") && !e.startsWith("__cxa") && !ours.exports.includes(e)).join(", ") || "none"}; sections ${ref.sections.filter((s) => !ours.sections.includes(s)).join(", ") || "none"}`)
  if (missing.length) process.exit(1)
  const rel = `modules/${path.basename(wasm)}`
  fs.copyFileSync(wasm, path.join(dir, rel))
  writePackage(dir, `Crosscheck p03 Rust module ${v.tag}`, rel, ours.size)
}
console.log(`\npackaged ${VARIANTS.map((v) => v.pkg).join(", ")} in ${path.relative(REPO, BUILD)}`)

if (process.argv.includes("--install")) {
  const running = execFileSync("tasklist", ["/FI", "IMAGENAME eq FlightSimulator2024.exe", "/NH"], { encoding: "utf8" }).includes("FlightSimulator2024.exe")
  if (running) { console.log("not installed: the sim is running, and reads packages only at boot"); process.exit(1) }
  const cfg = fs.readFileSync(path.join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "UserCfg.opt"), "utf8")
  const root = /InstalledPackagesPath\s+"([^"]+)"/.exec(cfg)?.[1]
  if (!root) { console.log("not installed: no InstalledPackagesPath in UserCfg.opt"); process.exit(1) }
  for (const v of VARIANTS) {
    const dest = path.join(root, "Community", v.pkg)
    // Replaces only our own probe package of the same name.
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(path.join(BUILD, v.pkg), dest, { recursive: true })
  }
  console.log(`installed into the Community folder: ${VARIANTS.map((v) => v.pkg).join(", ")}`)
}
