/*
 * Builds the figure's package, crosscheck-figure, from figure.json, and
 * installs it into the Community folder, with MSFS closed.
 *
 *   node experiments/areas/avatars/figure/build.mjs
 *   node experiments/areas/avatars/figure/build.mjs --no-color-animation
 *   node experiments/areas/avatars/figure/build.mjs --write-only
 *   node experiments/areas/avatars/figure/build.mjs --write-only --set nose.length=0.3
 *
 * --set overrides one number of figure.json for this build only, without
 * changing the file, so a test can make a change anyone can see at a glance.
 *
 * One SimObject, CROSSCHECK_Figure, a StaticObject as p17's hand sphere was.
 * Its joints read global L:CROSSCHECK_* variables, which p24 sets through
 * SimConnect, so a probe needs no module. Its colors come from
 * ASOBO_property_animation (model.mjs); --no-color-animation leaves that out,
 * for when fspackagetool refuses it. --write-only writes the package's
 * sources without compiling them, to check them with the sim running.
 *
 * The steps after writing are wasm/build.mjs's, without the module:
 * fspackagetool, which drives the sim's executable and so hangs while MSFS
 * runs; layout.json, which fspackagetool doesn't write, with each date as a
 * bare Windows FILETIME number; and a copy into Community. A package is read
 * when the sim starts, so start MSFS after this.
 *
 * Everything under package/ is written here, and .gitignore keeps it out.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CHANNELS, FRAMES, animCode, buildGltf, colorChannel, variable } from "./model.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "package")
const NAME = "crosscheck-figure"
const TITLE = "CROSSCHECK_Figure"
const SDK = process.env.MSFS_SDK ?? process.env.MSFS2024_SDK ?? "C:/MSFS 2024 SDK"
const PACKAGE_TOOL = path.join(SDK, "Tools", "bin", "fspackagetool.exe")
const BUILT = path.join(OUT, "Packages", NAME)
const colorAnimation = !process.argv.includes("--no-color-animation")
const writeOnly = process.argv.includes("--write-only")

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

// ------------------------------------------------ before anything

if (!writeOnly) {
  const tasks = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" })
  if (/"FlightSimulator2024\.exe"/i.test(tasks)) die("MSFS is running. fspackagetool drives the sim's executable and hangs while it runs: close the sim and run this again.")
  if (!fs.existsSync(PACKAGE_TOOL)) die(`No fspackagetool at ${PACKAGE_TOOL}: set MSFS_SDK.`)
}

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

// ------------------------------------------------ 1. the sources

// A GUID from a name, so a rebuild writes the same file.
function guid(name) {
  const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let h = seed >>> 0
    for (const ch of `${TITLE}/${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    return h.toString(16).padStart(8, "0")
  }).join("")
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`
}

const write = (rel, text) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

const spec = JSON.parse(fs.readFileSync(path.join(HERE, "figure.json"), "utf8"))
process.argv.forEach((arg, i) => {
  if (arg !== "--set") return
  const [key, value] = (process.argv[i + 1] ?? "").split("=")
  const keys = key.split(".")
  const owner = keys.slice(0, -1).reduce((o, k) => o?.[k], spec)
  if (!owner || typeof owner[keys.at(-1)] !== "number" || !Number.isFinite(Number(value))) die(`--set ${process.argv[i + 1]}: not a number in figure.json`)
  owner[keys.at(-1)] = Number(value)
  console.log(`--set ${key} = ${value} for this build only`)
})
const { json, bin } = buildGltf(spec, 0, { colorAnimation })
const objectDir = `PackageSources/SimObjects/Misc/${TITLE}`
json.buffers[0].uri = `${TITLE}.bin`

const animated = colorAnimation ? [...CHANNELS, colorChannel(spec)] : CHANNELS
const xml = [
  `<?xml version="1.0" encoding="utf-8" ?>`,
  `<!-- Written by experiments/areas/avatars/figure/build.mjs from figure.json. Each joint is one animation, its frame read from a global L: variable. -->`,
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
    `\t\t\t\t<ANIM_CODE>${animCode(ch, "L")}</ANIM_CODE>`,
    `\t\t\t</UseTemplate>`,
    `\t\t</Component>`,
  ]),
  `\t</Behaviors>`,
  `</ModelInfo>`,
  ``,
].join("\n")

fs.rmSync(path.join(OUT, objectDir), { recursive: true, force: true })
write(`${objectDir}/model/${TITLE}.gltf`, JSON.stringify(json, null, 1))
fs.writeFileSync(path.join(OUT, objectDir, "model", `${TITLE}.bin`), bin)
write(`${objectDir}/model/${TITLE}.xml`, xml)
write(`${objectDir}/model/model.cfg`, `[models]\nnormal=${TITLE}.xml\n`)
write(`${objectDir}/sim.cfg`, `[VERSION]\nmajor=1\nminor=0\n\n[fltsim.0]\ntitle=${TITLE}\nmodel=\ntexture=\n\n[General]\ncategory=StaticObject\n`)
write(`PackageDefinitions/${NAME}.xml`, [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<AssetPackage Version="0.1.0">`,
  `\t<ItemSettings>`,
  `\t\t<ContentType>MISC</ContentType>`,
  `\t\t<Title>Crosscheck figure probe</Title>`,
  `\t\t<Manufacturer/>`,
  `\t\t<Creator>Crosscheck</Creator>`,
  `\t</ItemSettings>`,
  `\t<Flags>`,
  `\t\t<VisibleInStore>false</VisibleInStore>`,
  `\t\t<CanBeReferenced>false</CanBeReferenced>`,
  `\t</Flags>`,
  `\t<AssetGroups>`,
  `\t\t<AssetGroup Name="${TITLE}">`,
  // Version 1: the in-sim Project Editor offered to upgrade version 0 to it.
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
  `<Project Version="2" Name="CrosscheckFigure" FolderName="Packages" MetadataFolderName="PackagesMetadata">`,
  `\t<OutputDirectory>.</OutputDirectory>`,
  `\t<TemporaryOutputDirectory>_PackageInt</TemporaryOutputDirectory>`,
  `\t<Packages>`,
  `\t\t<Package>PackageDefinitions\\${NAME}.xml</Package>`,
  `\t</Packages>`,
  `\t<PublishingGroups/>`,
  `</Project>`,
  ``,
].join("\n"))
console.log(`sources written: ${json.nodes.length} nodes, ${json.animations.length} animations${colorAnimation ? ", colors by ASOBO_property_animation" : ""}, ${bin.length} bytes of buffer`)
if (writeOnly) process.exit(0)

// ------------------------------------------------ 2. the package

console.log("packaging (fspackagetool)...")
fs.rmSync(BUILT, { recursive: true, force: true })
const p = spawnSync(PACKAGE_TOOL, [path.join(OUT, "project.xml"), "-nopause"], { stdio: "inherit", cwd: OUT })
if (p.status !== 0 || !fs.existsSync(path.join(BUILT, "manifest.json"))) die(`fspackagetool wrote no package at ${BUILT}.${colorAnimation ? " If it refused the color animation, try --no-color-animation." : ""}`)

// ------------------------------------------------ 3. layout.json

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

// ------------------------------------------------ install

const target = path.join(community(), NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(BUILT, target, { recursive: true })
console.log(`\ninstalled to Community\\${NAME}. Start MSFS: packages are read at startup.`)
