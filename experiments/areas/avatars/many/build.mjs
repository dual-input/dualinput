/*
 * Builds crosscheck-p28-figures, the module and the figure for
 * experiments/areas/avatars/p28-many-figures.mjs, and installs the package into
 * the Community folder, with MSFS closed.
 *
 *   node experiments/areas/avatars/many/build.mjs
 *
 * The figure, CROSSCHECK_FigureZ, is the one figure/build.mjs builds from
 * figure.json, with every joint and its color read from the object's own Z:
 * variables (figure/model.mjs, animCode and visibilityCode with scope "Z"), so
 * each copy of it can hold a pose of its own. figure/ and its package stay as
 * they are.
 *
 * The steps after writing the sources are wasm/build.mjs's: MSBuild through the
 * MSFS2024 toolset, the export check, fspackagetool, which hangs while MSFS
 * runs, layout.json, and a copy into Community. A package is read when the sim
 * starts, so start MSFS after this.
 *
 * To take it out again, delete the crosscheck-p28-figures folder from
 * Community.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CHANNELS, FRAMES, animCode, buildGltf, colorChannel, variable, visibilityCode } from "../figure/model.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NAME = "crosscheck-p28-figures"
const TITLE = "CROSSCHECK_FigureZ"
const SDK = process.env.MSFS_SDK ?? process.env.MSFS2024_SDK ?? "C:/MSFS 2024 SDK"
const PACKAGE_TOOL = path.join(SDK, "Tools", "bin", "fspackagetool.exe")
const WASM = path.join(HERE, "PackageSources", "Modules", `${NAME}.wasm`)
const BUILT = path.join(HERE, "Packages", NAME)

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

// ------------------------------------------------ before anything

const tasks = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" })
if (/"FlightSimulator2024\.exe"/i.test(tasks)) die("MSFS is running. fspackagetool drives the sim's executable and hangs while it runs: close the sim and run this again.")
const msbuild = process.env.MSBUILD ?? ["Enterprise", "Professional", "Community", "BuildTools"]
  .map((e) => `C:/Program Files/Microsoft Visual Studio/2022/${e}/MSBuild/Current/Bin/MSBuild.exe`)
  .find((p) => fs.existsSync(p))
if (!msbuild) die("No MSBuild found: install Visual Studio 2022 with the MSFS platform toolset, or set MSBUILD.")
if (!fs.existsSync(PACKAGE_TOOL)) die(`No fspackagetool at ${PACKAGE_TOOL}: set MSFS_SDK.`)

// UserCfg.opt's InstalledPackagesPath, as wasm/build.mjs finds it.
function community() {
  const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  if (!fs.existsSync(cfg)) die(`No UserCfg.opt at ${cfg}.`)
  const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
  const packages = line?.match(/"([^"]+)"/)?.[1]
  const dir = packages && path.join(packages, "Community")
  if (!dir || !fs.existsSync(dir)) die(`No Community folder from ${cfg}.`)
  return dir
}

// A GUID from a name, so a rebuild writes the same file; seeded with this
// figure's title, so none matches CROSSCHECK_Figure's.
function guid(name) {
  const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let h = seed >>> 0
    for (const ch of `${TITLE}/${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    return h.toString(16).padStart(8, "0")
  }).join("")
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`
}

const write = (rel, text) => {
  const file = path.join(HERE, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

// ------------------------------------------------ 1. the sources

const spec = JSON.parse(fs.readFileSync(path.join(HERE, "..", "figure", "figure.json"), "utf8"))
const { json, bin, visibility } = buildGltf(spec, 0, { colorAnimation: true })
const xmlText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const objectDir = `PackageSources/SimObjects/Misc/${TITLE}`
json.buffers[0].uri = `${TITLE}.bin`
const color = colorChannel(spec)
const animated = [...CHANNELS, color]

fs.rmSync(path.join(HERE, "PackageSources"), { recursive: true, force: true })
write(`${objectDir}/model/${TITLE}.gltf`, JSON.stringify(json, null, 1))
fs.writeFileSync(path.join(HERE, objectDir, "model", `${TITLE}.bin`), bin)
write(`${objectDir}/model/${TITLE}.xml`, [
  `<?xml version="1.0" encoding="utf-8" ?>`,
  `<!-- Written by experiments/areas/avatars/many/build.mjs from figure/figure.json. Each joint is one animation, its frame read from a Z: variable of the object's own. -->`,
  `<ModelInfo version="1.1" guid="${guid("model")}">`,
  `\t<LODS>`,
  `\t\t<LOD MinSize="0" ModelFile="${TITLE}.gltf"/>`,
  `\t</LODS>`,
  ...animated.map((ch) => `\t<Animation name="${variable(ch)}" guid="${guid(ch.name)}" type="Sim" />`),
  `\t<Behaviors>`,
  `\t\t<Include ModelBehaviorFile="Asobo\\Generic.xml"/>`,
  ...animated.flatMap((ch) => [
    `\t\t<Component ID="${variable(ch)}">`,
    `\t\t\t<UseTemplate Name="ASOBO_GT_Anim_Code">`,
    `\t\t\t\t<ANIM_LENGTH>${FRAMES}</ANIM_LENGTH>`,
    `\t\t\t\t<ANIM_NAME>${variable(ch)}</ANIM_NAME>`,
    `\t\t\t\t<ANIM_CODE>${animCode(ch, "Z")}</ANIM_CODE>`,
    `\t\t\t</UseTemplate>`,
    `\t\t</Component>`,
  ]),
  ...visibility.flatMap((rule) => [
    `\t\t<Component ID="CROSSCHECK_SHOW_${rule.node}" Node="${rule.node}">`,
    `\t\t\t<UseTemplate Name="ASOBO_GT_Visibility_Code">`,
    `\t\t\t\t<VISIBILITY_CODE>${xmlText(visibilityCode(rule, "Z"))}</VISIBILITY_CODE>`,
    `\t\t\t</UseTemplate>`,
    `\t\t</Component>`,
  ]),
  `\t</Behaviors>`,
  `</ModelInfo>`,
  ``,
].join("\n"))
write(`${objectDir}/model/model.cfg`, `[models]\nnormal=${TITLE}.xml\n`)
write(`${objectDir}/sim.cfg`, `[VERSION]\nmajor=1\nminor=0\n\n[fltsim.0]\ntitle=${TITLE}\nmodel=\ntexture=\n\n[General]\ncategory=StaticObject\n`)
fs.mkdirSync(path.join(HERE, "PackageSources", "Modules"), { recursive: true })

write("src/channels.h", [
  `// Written by build.mjs from figure/model.mjs: the Z: variables the figure reads.`,
  `#pragma once`,
  `struct Channel { const char* name; double min; double max; bool color; };`,
  `const int CHANNEL_COUNT = ${animated.length};`,
  `const Channel CHANNELS[CHANNEL_COUNT] = {`,
  ...animated.map((ch) => `    {"${variable(ch)}", ${ch.min}, ${ch.max}, ${ch === color ? "true" : "false"}},`),
  `};`,
  ``,
].join("\n"))

write(`PackageDefinitions/${NAME}.xml`, [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<AssetPackage Version="0.1.0">`,
  `\t<ItemSettings>`,
  `\t\t<ContentType>MISC</ContentType>`,
  `\t\t<Title>Crosscheck p28 figures probe</Title>`,
  `\t\t<Manufacturer/>`,
  `\t\t<Creator>Crosscheck</Creator>`,
  `\t</ItemSettings>`,
  `\t<Flags>`,
  `\t\t<VisibleInStore>false</VisibleInStore>`,
  `\t\t<CanBeReferenced>false</CanBeReferenced>`,
  `\t</Flags>`,
  `\t<PackageOrderHint>CUSTOM_SIMOBJECTS</PackageOrderHint>`,
  `\t<AssetGroups>`,
  `\t\t<AssetGroup Name="modules">`,
  `\t\t\t<Type Version="0">Copy</Type>`,
  `\t\t\t<Flags>`,
  `\t\t\t\t<FSXCompatibility>false</FSXCompatibility>`,
  `\t\t\t</Flags>`,
  `\t\t\t<AssetDir>PackageSources\\Modules\\</AssetDir>`,
  `\t\t\t<OutputDir>modules\\</OutputDir>`,
  `\t\t</AssetGroup>`,
  `\t\t<AssetGroup Name="${TITLE}">`,
  `\t\t\t<Type Version="1">SimObject</Type>`,
  `\t\t\t<Flags>`,
  `\t\t\t\t<FSXCompatibility>false</FSXCompatibility>`,
  `\t\t\t</Flags>`,
  `\t\t\t<AssetDir>${objectDir.replaceAll("/", "\\")}\\</AssetDir>`,
  `\t\t\t<OutputDir>SimObjects\\Misc\\${TITLE}\\</OutputDir>`,
  `\t\t</AssetGroup>`,
  `\t</AssetGroups>`,
  `</AssetPackage>`,
  ``,
].join("\n"))
write("project.xml", [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Project Version="2" Name="CrosscheckP28Figures" FolderName="Packages" MetadataFolderName="PackagesMetadata">`,
  `\t<OutputDirectory>.</OutputDirectory>`,
  `\t<TemporaryOutputDirectory>_PackageInt</TemporaryOutputDirectory>`,
  `\t<Packages>`,
  `\t\t<Package>PackageDefinitions\\${NAME}.xml</Package>`,
  `\t</Packages>`,
  `\t<PublishingGroups/>`,
  `</Project>`,
  ``,
].join("\n"))
console.log(`sources written: ${animated.length} channels, ${json.nodes.length} nodes, ${bin.length} bytes of buffer`)

// ------------------------------------------------ 2. the module

console.log("building the module (MSFS2024 toolset)...")
const b = spawnSync(msbuild, [path.join(HERE, `${NAME}.vcxproj`), "-p:Configuration=Release", "-p:Platform=MSFS", "-v:minimal", "-nologo"], { stdio: "inherit" })
if (b.status !== 0 || !fs.existsSync(WASM)) die("The build produced no module.")

// wasm/build.mjs's list, from fsc-editor's link/tools/check.mjs.
const REQUIRED = ["malloc", "free", "mallinfo", "mchunkit_begin", "mchunkit_next", "get_pages_state", "mark_decommit_pages", "__wasm_call_ctors", "GetSimConnectVersion", "module_init", "module_deinit", "Update_StandAlone"]
function exportsOf(file) {
  const buf = fs.readFileSync(file)
  let o = 8
  const u = () => { let r = 0, s = 0, y; do { y = buf[o++]; r |= (y & 0x7f) << s; s += 7 } while (y & 0x80); return r >>> 0 }
  const str = () => { const n = u(); const s = buf.toString("utf8", o, o + n); o += n; return s }
  const names = []
  while (o < buf.length) {
    const id = buf[o++]
    const size = u()
    const end = o + size
    if (id === 7) {
      const n = u()
      for (let i = 0; i < n; i++) { const nm = str(); const kind = buf[o++]; u(); if (kind === 0) names.push(nm) }
    }
    o = end
  }
  return new Set(names)
}
const missing = REQUIRED.filter((n) => !exportsOf(WASM).has(n))
if (missing.length) die(`The module is missing exports MSFS needs: ${missing.join(", ")}. It would load and never run.`)
console.log(`exports OK: all ${REQUIRED.length} present`)

// ------------------------------------------------ 3. the package

console.log("packaging (fspackagetool)...")
fs.rmSync(BUILT, { recursive: true, force: true })
const p = spawnSync(PACKAGE_TOOL, [path.join(HERE, "project.xml"), "-nopause"], { stdio: "inherit", cwd: HERE })
if (p.status !== 0 || !fs.existsSync(path.join(BUILT, "manifest.json"))) die(`fspackagetool wrote no package at ${BUILT}.`)

const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()
const files = []
;(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(abs, r)
    else if (e.name !== "layout.json" && e.name !== "manifest.json") files.push({ path: r.toLowerCase(), size: fs.statSync(abs).size, date: filetime(fs.statSync(abs).mtimeMs) })
  }
})(BUILT, "")
const rows = files.map((f) => `    {\n      "path": ${JSON.stringify(f.path)},\n      "size": ${f.size},\n      "date": ${f.date}\n    }`).join(",\n")
fs.writeFileSync(path.join(BUILT, "layout.json"), `{\n  "content": [\n${rows}\n  ]\n}\n`)
console.log(`layout.json written: ${files.length} file(s)`)

const target = path.join(community(), NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(BUILT, target, { recursive: true })
console.log(`\ninstalled to Community\\${NAME}. Start MSFS: packages are read at startup.`)
