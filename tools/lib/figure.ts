// The figure's SimObject: the sources src/features/avatars/figure/model.ts builds from
// figure.json, what fspackagetool compiled from them in compiled/, and source.json, each
// source's SHA-256 as of that compile (record/areas/build/01-the-build.md, "Files compiled with
// the sim").

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { buildGltf, DETAILS, FRAMES, TITLE, animCode, channels, colorChannel, variable, visibilityCode, type Spec } from "../../src/features/avatars/figure/model.ts"
import { ROOT } from "./repo.ts"

export const FIGURE = path.join(ROOT, "src", "features", "avatars", "figure")
export const SOURCE = path.join(FIGURE, "source")
export const COMPILED = path.join(FIGURE, "compiled")
export const HASHES = path.join(FIGURE, "source.json")
/** The package fspackagetool builds the figure in, which only the recompile sees. */
export const PACKAGE = "dualinput-figure"
/** Where the SimObject sits, in the sources and in a package. */
export const OBJECT = `SimObjects/Misc/${TITLE}`

/**
 * The most each level of detail draws, a starting value this stage sets from the viewer's
 * look against p28's figure, which cost 16µs to 21µs a frame in view standing still (measured
 * on MSFS 2024, 2026-10-05, record/areas/avatars/log.md, "Each figure poses from its own
 * object's variables").
 */
export const BUDGET: Record<string, { triangles: number; draws: number }> = {
  LOD00: { triangles: 6_000, draws: 60 },
  LOD01: { triangles: 2_500, draws: 60 },
  LOD02: { triangles: 900, draws: 60 },
}

export function spec(figure = FIGURE): Spec {
  return JSON.parse(fs.readFileSync(path.join(figure, "figure.json"), "utf8")) as Spec
}

/** A GUID from a name, so a rebuild writes the same file. */
function guid(name: string): string {
  const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let h = seed >>> 0
    for (const ch of `${TITLE}/${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    return h.toString(16).padStart(8, "0")
  }).join("")
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Every source file, by its path under source/, with what each level of detail costs. */
export function sources(s: Spec = spec()) {
  const files = new Map<string, string | Uint8Array>()
  const costs: { name: string; cost: ReturnType<typeof buildGltf>["cost"] }[] = []
  const object = `PackageSources/${OBJECT}`
  let rules: ReturnType<typeof buildGltf>["rules"] = []
  for (const d of DETAILS) {
    const built = buildGltf(s, d)
    const file = `${TITLE}_${d.name}`
    ;(built.json.buffers as { uri?: string }[])[0]!.uri = `${file}.bin`
    files.set(`${object}/model/${file}.gltf`, JSON.stringify(built.json, null, 1) + "\n")
    files.set(`${object}/model/${file}.bin`, built.bin)
    costs.push({ name: d.name, cost: built.cost })
    rules = built.rules
  }
  const animated = [...channels(s), colorChannel(s)]
  files.set(`${object}/model/${TITLE}.xml`, [
    `<?xml version="1.0" encoding="utf-8" ?>`,
    `<!-- Written by node tools/figure.ts generate from figure.json. Each joint is one animation, its frame read from a Z: variable of the figure's own object. -->`,
    `<ModelInfo version="1.1" guid="${guid("model")}">`,
    `\t<LODS>`,
    ...DETAILS.map((d) => `\t\t<LOD minSize="${d.minSize}" ModelFile="${TITLE}_${d.name}.gltf"/>`),
    `\t</LODS>`,
    ...animated.map((ch) => `\t<Animation name="${variable(ch.name)}" guid="${guid(ch.name)}" type="Sim" />`),
    `\t<Behaviors>`,
    `\t\t<Include ModelBehaviorFile="Asobo\\Generic.xml"/>`,
    ...animated.flatMap((ch) => [
      `\t\t<Component ID="${variable(ch.name)}">`,
      `\t\t\t<UseTemplate Name="ASOBO_GT_Anim_Code">`,
      `\t\t\t\t<ANIM_LENGTH>${FRAMES}</ANIM_LENGTH>`,
      `\t\t\t\t<ANIM_NAME>${variable(ch.name)}</ANIM_NAME>`,
      `\t\t\t\t<ANIM_CODE>${animCode(ch)}</ANIM_CODE>`,
      `\t\t\t</UseTemplate>`,
      `\t\t</Component>`,
    ]),
    ...rules.flatMap((rule) => [
      `\t\t<Component ID="${variable(`SHOW_${rule.node}`)}" Node="${rule.node}">`,
      `\t\t\t<UseTemplate Name="ASOBO_GT_Visibility_Code">`,
      `\t\t\t\t<VISIBILITY_CODE>${escape(visibilityCode(rule))}</VISIBILITY_CODE>`,
      `\t\t\t</UseTemplate>`,
      `\t\t</Component>`,
    ]),
    `\t</Behaviors>`,
    `</ModelInfo>`,
    ``,
  ].join("\n"))
  files.set(`${object}/model/model.cfg`, `[models]\nnormal=${TITLE}.xml\n`)
  files.set(`${object}/sim.cfg`, `[VERSION]\nmajor=1\nminor=0\n\n[fltsim.0]\ntitle=${TITLE}\nmodel=\ntexture=\n\n[General]\ncategory=StaticObject\n`)
  files.set(`PackageDefinitions/${PACKAGE}.xml`, [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<AssetPackage Version="0.1.0">`,
    `\t<ItemSettings>`,
    `\t\t<ContentType>MISC</ContentType>`,
    `\t\t<Title>Dual Input figure</Title>`,
    `\t\t<Manufacturer/>`,
    `\t\t<Creator>Dual Input</Creator>`,
    `\t</ItemSettings>`,
    `\t<Flags>`,
    `\t\t<VisibleInStore>false</VisibleInStore>`,
    `\t\t<CanBeReferenced>false</CanBeReferenced>`,
    `\t</Flags>`,
    `\t<PackageOrderHint>CUSTOM_SIMOBJECTS</PackageOrderHint>`,
    `\t<AssetGroups>`,
    `\t\t<AssetGroup Name="${TITLE}">`,
    `\t\t\t<Type Version="1">SimObject</Type>`,
    `\t\t\t<Flags>`,
    `\t\t\t\t<FSXCompatibility>false</FSXCompatibility>`,
    `\t\t\t</Flags>`,
    `\t\t\t<AssetDir>${object.replaceAll("/", "\\")}\\</AssetDir>`,
    `\t\t\t<OutputDir>${OBJECT.replaceAll("/", "\\")}\\</OutputDir>`,
    `\t\t</AssetGroup>`,
    `\t</AssetGroups>`,
    `</AssetPackage>`,
    ``,
  ].join("\n"))
  files.set("project.xml", [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<Project Version="2" Name="DualInputFigure" FolderName="Packages" MetadataFolderName="PackagesMetadata">`,
    `\t<OutputDirectory>.</OutputDirectory>`,
    `\t<TemporaryOutputDirectory>_PackageInt</TemporaryOutputDirectory>`,
    `\t<Packages>`,
    `\t\t<Package>PackageDefinitions\\${PACKAGE}.xml</Package>`,
    `\t</Packages>`,
    `\t<PublishingGroups/>`,
    `</Project>`,
    ``,
  ].join("\n"))
  return { files, costs }
}

export const sha256 = (bytes: string | Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex")

/** Every file under `dir`, by its path from `dir` with `/` between its folders. */
export function walk(dir: string, rel = ""): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name
    return e.isDirectory() ? walk(path.join(dir, e.name), r) : [r]
  })
}

/**
 * Why the figure's sources in `figure` don't match: a source the generator would write
 * differently, or one fspackagetool didn't compile, by source.json. Empty when they match.
 */
export function mismatches(figure = FIGURE): string[] {
  const { files } = sources(spec(figure))
  const found: string[] = []
  const source = path.join(figure, "source")
  const onDisk = new Set(walk(source))
  for (const [rel, content] of files) {
    const file = path.join(source, rel)
    if (!fs.existsSync(file)) found.push(`source/${rel} is missing; run node tools/figure.ts generate`)
    else if (sha256(fs.readFileSync(file)) !== sha256(content)) found.push(`source/${rel} isn't what figure.json and model.ts give; run node tools/figure.ts generate`)
    onDisk.delete(rel)
  }
  for (const rel of onDisk) found.push(`source/${rel} is one the generator doesn't write`)
  const hashesFile = path.join(figure, "source.json")
  const hashes: Record<string, string> = fs.existsSync(hashesFile) ? JSON.parse(fs.readFileSync(hashesFile, "utf8")) : {}
  for (const rel of walk(source)) {
    if (hashes[rel] !== sha256(fs.readFileSync(path.join(source, rel)))) {
      found.push(`source/${rel} changed since compiled/ was compiled; recompile it with the sim closed: node tools/figure.ts recompile`)
    }
  }
  return found
}
