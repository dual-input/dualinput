/*
 * Builds p02's package, crosscheck-p02-panel: the floating panel as two
 * SimObjects and the module that places one of them in front of the pilot's
 * view every frame.
 *
 *   node experiments/areas/interface/panel/build.mjs             sources and module, for Build and Mount
 *   node experiments/areas/interface/panel/build.mjs --install   also fspackagetool and a copy into Community, with MSFS closed
 *
 * Without --install it writes the package's sources under package/ and
 * compiles the module into them, so the Project Editor's Build and Mount can
 * take package/project.xml with the sim running: a rebuilt model reached a
 * fresh spawn that way with no restart (record/areas/avatars/log.md, "Build and
 * Mount gives a freshly spawned figure a rebuilt model with no restart").
 * Whether Build and Mount also loads a new module is untested.
 *
 *   CROSSCHECK_P02_Gauge   the panel's surface is the material
 *                          $CROSSCHECK_P02_PANEL, and the object's own
 *                          panel.cfg puts an HTML gauge on it, the way an
 *                          aircraft's screen is made (read in
 *                          bksq-aircraft-baronpro 0.1.1, BaronProfessional_Base_INT.gltf
 *                          and panel.CGVGI/PANEL.CFG). Whether the sim runs a
 *                          gauge on an object that isn't the pilot's aircraft
 *                          is what p02 asks first.
 *   CROSSCHECK_P02_Baked   the same surface with the card baked into a
 *                          see-through texture. The packager dropped its PNG
 *                          (p02's first run), and it's parked.
 *   CROSSCHECK_P02_Painted the card as a livery painting, a [VPainting01]
 *                          section in the object's own panel.cfg.
 *   CROSSCHECK_P02_Tablet  the surface's material named $TabletScreen, the
 *                          Baron's tablet screen.
 *
 * Both are StaticObjects, as the figure is, 16cm by 8cm and curved to a 35cm
 * radius, their faces toward an eye 35cm behind their origin. A uniform scale
 * animation reads the global L:CROSSCHECK_P02_SCALE, 0.25 to 4, so a probe
 * can move the panel farther and keep its size in the view; a uniform scale
 * played where a stretch along one axis didn't (record/areas/avatars/log.md,
 * "The sim doesn't play a scale animation that stretches a stick").
 *
 * Everything under package/ is written here, and .gitignore keeps it out.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { BANNER, BANNER_CSS, CARD_CSS, HEIGHT, PANEL, WIDTH, bannerMarkup, cardMarkup, slotTitle } from "./card.mjs"
import { drawPng, pngToDds } from "./render.mjs"
import { writeKtx2 } from "./tools/ktx2.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, "package")
const NAME = "crosscheck-p02-panel"
const SDK = process.env.MSFS_SDK ?? process.env.MSFS2024_SDK ?? "C:/MSFS 2024 SDK"
const PACKAGE_TOOL = path.join(SDK, "Tools", "bin", "fspackagetool.exe")
const BUILT = path.join(OUT, "Packages", NAME)
const WASM = path.join(OUT, "PackageSources", "Modules", `${NAME}.wasm`)
const install = process.argv.includes("--install")

const PANEL_W = PANEL.width
const PANEL_H = PANEL.height
const CURVE_R = PANEL.radius
const COLUMNS = 24
const SCALE_MIN = 0.25
const SCALE_MAX = 4
const SCALE_FRAMES = 100
const GAUGE_DIR = "CrosscheckP02"
const SCREEN = "$CROSSCHECK_P02_PANEL"
const PAINT = "$CROSSCHECK_P02_PAINT"
const CARD_PNG = "CROSSCHECK_P02_CARD.PNG"

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

// ------------------------------------------------ before anything

if (install) {
  const tasks = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" })
  if (/"FlightSimulator2024\.exe"/i.test(tasks)) die("MSFS is running. fspackagetool drives the sim's executable and hangs while it runs: close the sim, or Build and Mount from the Project Editor instead.")
  if (!fs.existsSync(PACKAGE_TOOL)) die(`No fspackagetool at ${PACKAGE_TOOL}: set MSFS_SDK.`)
}
const msbuild = process.env.MSBUILD ?? ["Enterprise", "Professional", "Community", "BuildTools"]
  .map((e) => `C:/Program Files/Microsoft Visual Studio/2022/${e}/MSBuild/Current/Bin/MSBuild.exe`)
  .find((p) => fs.existsSync(p))
if (!msbuild) die("No MSBuild found: install Visual Studio 2022 with the MSFS platform toolset, or set MSBUILD.")
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p))
if (!edge) die("No Microsoft Edge found, which renders the baked card.")

const write = (rel, data) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

// A GUID from a name, so a rebuild writes the same file.
function guid(name) {
  const hex = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let h = seed >>> 0
    for (const ch of `${NAME}/${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    return h.toString(16).padStart(8, "0")
  }).join("")
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`
}

// ------------------------------------------------ 1. the module

fs.rmSync(WASM, { force: true })
console.log("building the module (MSFS2024 toolset)...")
const b = spawnSync(msbuild, [path.join(HERE, `${NAME}.vcxproj`), "-p:Configuration=Release", "-p:Platform=MSFS", "-v:minimal", "-nologo"], { stdio: "inherit" })
if (b.status !== 0 || !fs.existsSync(WASM)) die("The build produced no module.")

// The list experiments/areas/avatars/wasm/build.mjs checks, from fsc-editor's
// link/tools/check.mjs: without the allocator's exports the sim loads a
// module and never runs it.
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

// ------------------------------------------------ 2. the panel's model

// One curved strip, COLUMNS wide, under a node the scale animation sizes.
// glTF space here is the sim's model space: +x left, y up, +z forward
// (experiments/areas/avatars/lib/pick.mjs). The eye sits CURVE_R behind the
// origin, looking along +z, so the face points to -z, the texture's left edge
// is +x, and every column is CURVE_R from the eye.
function panelGltf(material, images, size = { width: PANEL_W, height: PANEL_H }) {
  const pos = [], nrm = [], uv = [], idx = []
  const half = size.width / 2 / CURVE_R
  for (let i = 0; i <= COLUMNS; i++) {
    const a = -half + (2 * half * i) / COLUMNS
    const x = -CURVE_R * Math.sin(a), z = CURVE_R * Math.cos(a) - CURVE_R
    for (const [y, v] of [[size.height / 2, 0], [-size.height / 2, 1]]) {
      pos.push(x, y, z)
      nrm.push(Math.sin(a), 0, -Math.cos(a))
      uv.push(i / COLUMNS, v)
    }
  }
  for (let i = 0; i < COLUMNS; i++) {
    const t = i * 2
    idx.push(t, t + 1, t + 2, t + 1, t + 3, t + 2)
  }
  const parts = []
  let offset = 0
  const view = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
    const pad = (4 - (bytes.length % 4)) % 4
    parts.push(bytes, Buffer.alloc(pad))
    const v = { buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) }
    offset += bytes.length + pad
    return v
  }
  const seconds = SCALE_FRAMES / 30
  const bufferViews = [
    view(new Float32Array(pos), 34962),
    view(new Float32Array(nrm), 34962),
    view(new Float32Array(uv), 34962),
    view(new Uint16Array(idx), 34963),
    view(new Float32Array([0, seconds])),
    view(new Float32Array([SCALE_MIN, SCALE_MIN, SCALE_MIN, SCALE_MAX, SCALE_MAX, SCALE_MAX])),
  ]
  const count = pos.length / 3
  const xs = pos.filter((_, i) => i % 3 === 0), ys = pos.filter((_, i) => i % 3 === 1), zs = pos.filter((_, i) => i % 3 === 2)
  const json = {
    asset: { version: "2.0", generator: "Crosscheck experiments/areas/interface/panel/build.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "panel", children: [1] },
      { name: "panel_scale", children: [2] },
      { name: "panel_face", mesh: 0 },
    ],
    meshes: [{ name: "panel_face", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [material],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)] },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: idx.length, type: "SCALAR" },
      { bufferView: 4, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [seconds] },
      { bufferView: 5, componentType: 5126, count: 2, type: "VEC3" },
    ],
    animations: [{ name: "CROSSCHECK_P02_SCALE", samplers: [{ input: 4, output: 5, interpolation: "LINEAR" }], channels: [{ sampler: 0, target: { node: 1, path: "scale" } }] }],
    bufferViews,
    buffers: [{ byteLength: offset }],
    extensionsUsed: Object.keys(material.extensions ?? {}),
  }
  if (images) {
    json.images = images.map((uri) => ({ uri }))
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }]
    json.textures = images.map((_, i) => ({ source: i, sampler: 0 }))
  }
  return { json, bin: Buffer.concat(parts) }
}

// The panel shouldn't throw a shadow on the cockpit or smear when the head turns.
const noShadowNoBlur = { ASOBO_material_shadow_options: { noCastShadow: true }, ASOBO_material_disable_motion_blur: { enabled: true } }

// Earlier rounds, all on StaticObjects in SimObjects/Misc: a gauge from the
// object's own panel.cfg never ran; a material named $TabletScreen stayed
// black; livery paintings opened their documents and drew nothing on the panel
// in four variants (location exterior and interior, opaque, see-through, and
// the Baron's registration material, and the calls RegistrationNumberLoaded
// and VLIVERY_DATA_LOADED); and Build and Mount left the card's PNG out of the
// package, from texture/ and from beside the model (record/areas/interface/
// log.md, 2026-10-04).
//
// Round 2, built by fspackagetool with the sim closed (--install):
//   Baked, Baked2     the card's PNG in texture/, with and without a
//                     texture.cfg, as the standalone packager takes it
//   Paint*            the round-0 painting, location=exterior on the
//                     see-through material with RegistrationNumberLoaded, on
//                     objects of other categories, each in the folder its kind
//                     ships in: the sim may bind a painting only on some
//                     kinds. FSLTL's AI traffic paints its registrations
//                     (read in fsltl-traffic-base, FSLTL_LJ25/panel/panel.cfg);
//                     GSX's seat object is a Viewer in GroundVehicles, and
//                     Aerosoft's VDGS a Human in Misc (read in
//                     fsdreamteam-gsx-pro 4.0.19 and aerosoft-airport-edlp-paderborn)
//   Aircraft          the same painting on a minimal aircraft of our own,
//                     with no engines, which p02 spawns last in case it takes
//                     the sim down
const paintMaterial = { name: PAINT, doubleSided: true, alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, extensions: noShadowNoBlur }
const painting = { texture: PAINT, location: "exterior", capture: "registration" }
const bakedMaterial = {
  name: "CROSSCHECK_P02_CARD", doubleSided: true, alphaMode: "BLEND", emissiveFactor: [1, 1, 1], emissiveTexture: { index: 0 },
  pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
  extensions: noShadowNoBlur,
}
const OBJECTS = [
  { title: "CROSSCHECK_P02_Baked", material: bakedMaterial, images: [`../texture/${CARD_PNG}`], textureCfg: true, flags: true },
  { title: "CROSSCHECK_P02_Baked2", material: bakedMaterial, images: [`../texture/${CARD_PNG}`], flags: true },
  { title: "CROSSCHECK_P02_PaintStatic", material: paintMaterial, painting },
  { title: "CROSSCHECK_P02_PaintBoat", folder: "Boats", category: "Boat", material: paintMaterial, painting },
  { title: "CROSSCHECK_P02_PaintVehicle", folder: "GroundVehicles", category: "GroundVehicle", material: paintMaterial, painting },
  { title: "CROSSCHECK_P02_PaintViewer", folder: "GroundVehicles", category: "Viewer", material: paintMaterial, painting },
  { title: "CROSSCHECK_P02_PaintHuman", category: "Human", material: paintMaterial, painting },
  { title: "CROSSCHECK_P02_Aircraft", folder: "Airplanes", aircraft: true, material: paintMaterial, painting },
  // The banner's pool, for p05-banner.mjs: each slot a strip of its own, with
  // its own texture file that p05 writes a notice into before spawning it.
  ...Array.from({ length: BANNER.slots }, (_, i) => ({
    title: slotTitle(i), material: { ...bakedMaterial, name: "CROSSCHECK_P02_BANNER" },
    images: [`../texture/${BANNER.texture}`], size: BANNER.panel, banner: true,
  })),
]
const folderOf = (o) => o.folder ?? "Misc"

// A minimal aircraft for AI: the sections FSLTL's AI-only Learjet carries
// (read in fsltl-traffic-base, FSLTL_LJ25), each cut to what an object that
// never flies needs, with engine_type 2, no engine. Its values are ours.
const AIRCRAFT_CFG = (title) => `[VERSION]
major = 1
minor = 0

[GENERAL]
atc_type = "CROSSCHECK"
atc_model = "P02"
Category = "airplane"
editable = 0
icao_type_designator = "ZZZZ"
icao_engine_count = 0

[FLTSIM.0]
title = "${title}"
model = ""
panel = ""
texture = ""
sound = ""
atc_id_enable = 0
isairtraffic = 0
isUserSelectable = 0
ui_manufacturer = "Crosscheck"
ui_type = "p02 panel"
ui_variation = "probe"
`
const FLIGHT_MODEL_CFG = `[VERSION]
major = 1
minor = 0

[WEIGHT_AND_BALANCE]
max_gross_weight = 100
empty_weight = 100
reference_datum_position = 0, 0, 0
empty_weight_CG_position = 0, 0, 0
empty_weight_pitch_MOI = 10
empty_weight_roll_MOI = 10
empty_weight_yaw_MOI = 10
empty_weight_coupled_MOI = 0

[AIRPLANE_GEOMETRY]
wing_area = 1
wing_span = 1
wing_root_chord = 1
`
const ENGINES_CFG = `[VERSION]
major = 1
minor = 0

[GENERALENGINEDATA]
engine_type = 2
`

const scaleCode = `(L:CROSSCHECK_P02_SCALE) ${SCALE_MIN} - ${SCALE_FRAMES / (SCALE_MAX - SCALE_MIN)} * 0 max ${SCALE_FRAMES} min`
fs.rmSync(path.join(OUT, "PackageSources", "SimObjects"), { recursive: true, force: true })
for (const o of OBJECTS) {
  const dir = `PackageSources/SimObjects/${folderOf(o)}/${o.title}`
  fs.rmSync(path.join(OUT, dir), { recursive: true, force: true })
  const { json, bin } = panelGltf(o.material, o.images, o.size)
  json.buffers[0].uri = `${o.title}.bin`
  write(`${dir}/model/${o.title}.gltf`, JSON.stringify(json, null, 1))
  write(`${dir}/model/${o.title}.bin`, bin)
  write(`${dir}/model/model.cfg`, `[models]\nnormal=${o.title}.xml\n`)
  write(`${dir}/model/${o.title}.xml`, [
    `<?xml version="1.0" encoding="utf-8" ?>`,
    `<!-- Written by experiments/areas/interface/panel/build.mjs. -->`,
    `<ModelInfo version="1.1" guid="${guid(o.title)}">`,
    `\t<LODS>`,
    `\t\t<LOD MinSize="0" ModelFile="${o.title}.gltf"/>`,
    `\t</LODS>`,
    `\t<Animation name="CROSSCHECK_P02_SCALE" guid="${guid(`${o.title}/scale`)}" type="Sim" />`,
    `\t<Behaviors>`,
    `\t\t<Include ModelBehaviorFile="Asobo\\Generic.xml"/>`,
    `\t\t<Component ID="CROSSCHECK_P02_SCALE">`,
    `\t\t\t<UseTemplate Name="ASOBO_GT_Anim_Code">`,
    `\t\t\t\t<ANIM_LENGTH>${SCALE_FRAMES}</ANIM_LENGTH>`,
    `\t\t\t\t<ANIM_NAME>CROSSCHECK_P02_SCALE</ANIM_NAME>`,
    `\t\t\t\t<ANIM_CODE>${scaleCode}</ANIM_CODE>`,
    `\t\t\t</UseTemplate>`,
    `\t\t</Component>`,
    `\t</Behaviors>`,
    `</ModelInfo>`,
    ``,
  ].join("\n"))
  if (o.aircraft) {
    write(`${dir}/aircraft.cfg`, AIRCRAFT_CFG(o.title))
    write(`${dir}/flight_model.cfg`, FLIGHT_MODEL_CFG)
    write(`${dir}/engines.cfg`, ENGINES_CFG)
  } else {
    write(`${dir}/sim.cfg`, `[VERSION]\nmajor=1\nminor=0\n\n[fltsim.0]\ntitle=${o.title}\nmodel=\n${o.panel || o.painting ? "panel=\n" : ""}texture=\n\n[General]\ncategory=${o.category ?? "StaticObject"}\n`)
  }
  if (o.textureCfg) write(`${dir}/texture/texture.cfg`, `[fltsim]\n`)
  if (o.painting) {
    write(`${dir}/panel/panel.cfg`, [
      `[VERSION]`, `major=1`, `minor=0`, ``,
      `[VPainting01]`,
      `size_mm=${WIDTH},${HEIGHT}`,
      `texture=${o.painting.texture}`,
      `location=${o.painting.location}`,
      `painting00=${GAUGE_DIR}/painting.html?capture=${o.painting.capture}, 0, 0, ${WIDTH}, ${HEIGHT}`,
      ``,
    ].join("\n"))
  }
  if (o.panel) {
    write(`${dir}/panel/panel.cfg`, [
      `[VERSION]`, `major=1`, `minor=0`, ``,
      `[VCockpit01]`,
      `size_mm=${WIDTH},${HEIGHT}`,
      `pixel_size=${WIDTH},${HEIGHT}`,
      `texture=${SCREEN}`,
      `background_color=0,0,0`,
      `htmlgauge00=${GAUGE_DIR}/panel.html, 0,0,${WIDTH},${HEIGHT}`,
      ``,
    ].join("\n"))
  }
}

// ------------------------------------------------ 3. the gauge

// Runs in Coherent GT: no class fields, optional chaining, or ??
// (CLAUDE.md, Before writing code that runs in a panel).
const gaugeJs = `// Written by experiments/areas/interface/panel/build.mjs.
// Counts its frames into L:CROSSCHECK_P02_GAUGE_FRAMES, so p02 can tell from
// outside whether the sim runs this gauge at all, and any mouse press or
// interaction event that reaches it into L:CROSSCHECK_P02_GAUGE_CLICKS.
class CrosscheckP02Panel extends BaseInstrument {
  constructor() {
    super();
    this.frames = 0;
    this.clicks = 0;
    this.started = Date.now();
    this.live = null;
  }
  get templateID() { return "crosscheck-p02-panel"; }
  get isInteractive() { return true; }
  connectedCallback() {
    super.connectedCallback();
    this.live = this.querySelector("#crosscheck-live");
    var self = this;
    this.addEventListener("mousedown", function () { self.countClick(); });
  }
  countClick() {
    this.clicks++;
    SimVar.SetSimVarValue("L:CROSSCHECK_P02_GAUGE_CLICKS", "number", this.clicks);
  }
  onInteractionEvent(args) {
    this.countClick();
  }
  Update() {
    super.Update();
    this.frames++;
    if (this.live) this.live.textContent = "live " + ((Date.now() - this.started) / 1000).toFixed(1) + " s, frame " + this.frames + ", " + this.clicks + " clicks";
    SimVar.SetSimVarValue("L:CROSSCHECK_P02_GAUGE_FRAMES", "number", this.frames);
  }
}
registerInstrument("crosscheck-p02-panel", CrosscheckP02Panel);
`
const gaugeRoot = `PackageSources/html_ui/Pages/VCockpit/Instruments/${GAUGE_DIR}`
fs.rmSync(path.join(OUT, gaugeRoot), { recursive: true, force: true })
write(`${gaugeRoot}/panel.css`, `crosscheck-p02-panel { display: block; position: absolute; left: 0; top: 0; width: 100%; height: 100%; }\n${CARD_CSS}`)
write(`${gaugeRoot}/panel.js`, gaugeJs)
write(`${gaugeRoot}/panel.html`, [
  `<link rel="stylesheet" href="/Pages/VCockpit/Instruments/${GAUGE_DIR}/panel.css" />`,
  `<script type="text/html" id="crosscheck-p02-panel">${cardMarkup({ live: true, opaque: true })}`,
  `</script>`,
  `<script type="text/html" import-script="/Pages/VCockpit/Instruments/${GAUGE_DIR}/panel.js"></script>`,
  ``,
].join("\n"))
const check = spawnSync(process.execPath, ["--check", path.join(OUT, gaugeRoot, "panel.js")], { stdio: "inherit" })
if (check.status !== 0) die("panel.js doesn't parse.")

// The painting runs its own frame loop, as the Baron's registration does, and
// after drawing it calls Coherent.trigger("RegistrationNumberLoaded"), which
// the Baron calls once its tail number is drawn (read in bksq-aircraft-baronpro
// 0.1.1, html_ui/Pages/VLivery/Liveries/Registration/bksq_baron_registration.js).
// The sim may capture the painting only then, so this redraws a clock every
// second and triggers again on the frame after each redraw, to see whether
// the texture follows.
const paintingJs = `// Written by experiments/areas/interface/panel/build.mjs.
// Counts its frames into L:CROSSCHECK_P02_PAINT_FRAMES, its redraws into
// L:CROSSCHECK_P02_PAINT_CAPTURES, and any mouse press that reaches it into
// L:CROSSCHECK_P02_PAINT_CLICKS.
class CrosscheckP02Painting extends TemplateElement {
  constructor() {
    super();
    this.frames = 0;
    this.captures = 0;
    this.clicks = 0;
    this.started = Date.now();
    this.lastDraw = 0;
    this.pending = false;
    this.running = false;
    this.live = null;
  }
  get templateID() { return "CrosscheckP02Painting"; }
  connectedCallback() {
    super.connectedCallback();
    this.live = this.querySelector("#crosscheck-live");
    // capture= in the painting's URL: registration, the Baron's call after
    // each redraw; live, VLIVERY_DATA_LOADED with false once, as Asobo's VDGS
    // display does; static, VLIVERY_DATA_LOADED with true after each redraw.
    var m = /capture=(\\w+)/.exec(this.getAttribute("Url") || "");
    this.capture = m ? m[1] : "registration";
    var self = this;
    if (this.capture === "live") setTimeout(function () { Coherent.trigger("VLIVERY_DATA_LOADED", false); }, 100);
    this.addEventListener("mousedown", function () {
      self.clicks++;
      SimVar.SetSimVarValue("L:CROSSCHECK_P02_PAINT_CLICKS", "number", self.clicks);
    });
    this.running = true;
    var loop = function () {
      if (!self.running) return;
      self.Update();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  disconnectedCallback() { this.running = false; }
  Update() {
    this.frames++;
    var now = Date.now();
    if (this.pending) {
      this.pending = false;
      if (this.capture === "registration") Coherent.trigger("RegistrationNumberLoaded");
      else if (this.capture === "static") Coherent.trigger("VLIVERY_DATA_LOADED", true);
    } else if (now - this.lastDraw >= 1000) {
      this.lastDraw = now;
      this.captures++;
      if (this.live) this.live.textContent = this.capture + " " + ((now - this.started) / 1000).toFixed(0) + " s, redraw " + this.captures;
      this.pending = true;
      SimVar.SetSimVarValue("L:CROSSCHECK_P02_PAINT_CAPTURES", "number", this.captures);
    }
    SimVar.SetSimVarValue("L:CROSSCHECK_P02_PAINT_FRAMES", "number", this.frames);
  }
}
registerLivery("crosscheck-p02-painting-element", CrosscheckP02Painting);
`
const paintingRoot = `PackageSources/html_ui/Pages/VLivery/Liveries/${GAUGE_DIR}`
fs.rmSync(path.join(OUT, paintingRoot), { recursive: true, force: true })
write(`${paintingRoot}/painting.css`, CARD_CSS)
write(`${paintingRoot}/painting.js`, paintingJs)
write(`${paintingRoot}/painting.html`, [
  `<link rel="stylesheet" href="painting.css" />`,
  `<script type="text/html" id="CrosscheckP02Painting">${cardMarkup({ live: true })}`,
  `</script>`,
  `<script type="text/html" import-script="/Pages/VLivery/Liveries/${GAUGE_DIR}/painting.js"></script>`,
  ``,
].join("\n"))
const checkPainting = spawnSync(process.execPath, ["--check", path.join(OUT, paintingRoot, "painting.js")], { stdio: "inherit" })
if (checkPainting.status !== 0) die("painting.js doesn't parse.")

// ------------------------------------------------ 4. the baked card

// The card's scratch files live outside the project folder: the sim's
// package builder watches that folder and tries to reload an asset group for
// every file that changes in it (p02, 2026-10-04).
const CARD_DIR = path.join(HERE, "build", "card")
fs.mkdirSync(CARD_DIR, { recursive: true })
const cardHtml = path.join(CARD_DIR, "card.html")
fs.writeFileSync(cardHtml, `<!doctype html><html><head><meta charset="utf-8"><style>html, body { margin: 0; background: transparent; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }${CARD_CSS}</style></head><body>${cardMarkup()}</body></html>\n`)
const png = path.join(CARD_DIR, CARD_PNG)
const shot = spawnSync(edge, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${png}`, pathToFileURL(cardHtml).href], { stdio: "ignore", timeout: 60_000 })
if (!fs.existsSync(png)) die(`Edge rendered no card (status ${shot.status}).`)
console.log(`card rendered: ${fs.statSync(png).size} bytes`)
// Both packagers left a lone PNG out without an error, though they took a
// texture.cfg from the same folder (p02 rounds 1 and 2). Packaged textures
// carry a flags file beside them, such as ChasePlane's
// P42_FLASHLIGHT_BODY_ALBEDO.PNG.KTX2.json (read in p42-util-chaseplane
// 2026.39.1.16), so each PNG gets a .PNG.json of the same form, for the
// packager to find, with the date as a Windows FILETIME number.
// The banner slots' placeholder, until p05 writes a notice over it.
const bannerPng = drawPng({ css: BANNER_CSS, body: bannerMarkup({ severity: "info", title: "Banner slot", body: "p05 writes each notice into a free slot." }), width: BANNER.width, height: BANNER.height, name: "banner-placeholder" })
for (const o of OBJECTS.filter((x) => x.images)) {
  const to = path.join(OUT, "PackageSources", "SimObjects", folderOf(o), o.title, o.pngInModel ? "model" : "texture", o.banner ? BANNER.texture : CARD_PNG)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(o.banner ? bannerPng : png, to)
  if (o.flags) {
    const date = ((BigInt(Math.floor(fs.statSync(to).mtimeMs)) + 11644473600000n) * 10000n).toString()
    fs.writeFileSync(`${to}.json`, `{"Version":2,"SourceFileDate":${date},"Flags":["FL_BITMAP_COMPRESSION","FL_BITMAP_MIPMAP"],"HasTransp":true}`)
  }
}

// The flags file didn't help either (p02 round 2), so the card also ships
// ready-made, through Copy asset groups, under the name the compiled model
// points at, ..\TEXTURE\CROSSCHECK_P02_CARD.PNG.KTX2 (read in the build's
// output): an uncompressed DDS under that name for Baked, and an uncompressed
// KTX2 for Baked2 (tools/ktx2.mjs), to tell a refused name from a refused file.
const dds = path.join(CARD_DIR, `${CARD_PNG}.DDS`)
const conv = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "tools", "png-to-dds.ps1"), "-In", png, "-Out", dds], { encoding: "utf8" })
if (conv.status !== 0 || !fs.existsSync(dds)) die(`png-to-dds.ps1 failed: ${conv.stderr || conv.stdout}`)
const ddsBytes = fs.readFileSync(dds)
// The DDS holds BGRA rows, top first, after its 128-byte header.
const rgba = Buffer.from(ddsBytes.subarray(128))
for (let i = 0; i < rgba.length; i += 4) { const b = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = b }
const bannerDds = pngToDds(bannerPng)
const READY = [
  { group: "CROSSCHECK_P02_Baked_texture", object: "CROSSCHECK_P02_Baked", file: `${CARD_PNG}.KTX2`, bytes: ddsBytes },
  { group: "CROSSCHECK_P02_Baked2_texture", object: "CROSSCHECK_P02_Baked2", file: `${CARD_PNG}.KTX2`, bytes: writeKtx2(rgba, WIDTH, HEIGHT) },
  ...OBJECTS.filter((o) => o.banner).map((o) => ({ group: `${o.title}_texture`, object: o.title, file: `${BANNER.texture}.KTX2`, bytes: bannerDds })),
]
fs.rmSync(path.join(OUT, "PackageSources", "Textures"), { recursive: true, force: true })
// Package validation fails a KTX2 without its .KTX2.json, "Can't find
// associate json for ktx2 texture" (the sim's BuilderLogError.txt, 2026-10-04).
// This one has the form of ChasePlane's, with no compression or mipmap flags,
// since ours has neither.
for (const r of READY) {
  write(`PackageSources/Textures/${r.object}/${r.file}`, r.bytes)
  const date = ((BigInt(Date.now()) + 11644473600000n) * 10000n).toString()
  write(`PackageSources/Textures/${r.object}/${r.file}.json`, `{"Version":2,"SourceFileDate":${date},"Flags":[],"HasTransp":true}`)
}
console.log(`ready-made textures: ${READY.length}, the card ${ddsBytes.length} bytes, each banner slot ${bannerDds.length} bytes`)

// ------------------------------------------------ 5. the package definition

write(`PackageDefinitions/${NAME}.xml`, [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<AssetPackage Version="0.1.0">`,
  `\t<ItemSettings>`,
  `\t\t<ContentType>MISC</ContentType>`,
  `\t\t<Title>Crosscheck p02 floating panel probe</Title>`,
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
  `\t\t<AssetGroup Name="html_ui">`,
  `\t\t\t<Type Version="0">Copy</Type>`,
  `\t\t\t<Flags>`,
  `\t\t\t\t<FSXCompatibility>false</FSXCompatibility>`,
  `\t\t\t</Flags>`,
  `\t\t\t<AssetDir>PackageSources\\html_ui\\</AssetDir>`,
  `\t\t\t<OutputDir>html_ui\\</OutputDir>`,
  `\t\t</AssetGroup>`,
  ...OBJECTS.flatMap((o) => [
    `\t\t<AssetGroup Name="${o.title}">`,
    `\t\t\t<Type Version="1">SimObject</Type>`,
    `\t\t\t<Flags>`,
    `\t\t\t\t<FSXCompatibility>false</FSXCompatibility>`,
    `\t\t\t</Flags>`,
    `\t\t\t<AssetDir>PackageSources\\SimObjects\\${folderOf(o)}\\${o.title}\\</AssetDir>`,
    `\t\t\t<OutputDir>SimObjects\\${folderOf(o)}\\${o.title}\\</OutputDir>`,
    `\t\t</AssetGroup>`,
  ]),
  // Last, so they write after the models are compiled into the same folders.
  ...READY.flatMap((r) => [
    `\t\t<AssetGroup Name="${r.group}">`,
    `\t\t\t<Type Version="0">Copy</Type>`,
    `\t\t\t<Flags>`,
    `\t\t\t\t<FSXCompatibility>false</FSXCompatibility>`,
    `\t\t\t</Flags>`,
    `\t\t\t<AssetDir>PackageSources\\Textures\\${r.object}\\</AssetDir>`,
    `\t\t\t<OutputDir>SimObjects\\Misc\\${r.object}\\TEXTURE\\</OutputDir>`,
    `\t\t</AssetGroup>`,
  ]),
  `\t</AssetGroups>`,
  `</AssetPackage>`,
  ``,
].join("\n"))
write("project.xml", [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Project Version="2" Name="CrosscheckP02Panel" FolderName="Packages" MetadataFolderName="PackagesMetadata">`,
  `\t<OutputDirectory>.</OutputDirectory>`,
  `\t<TemporaryOutputDirectory>_PackageInt</TemporaryOutputDirectory>`,
  `\t<Packages>`,
  `\t\t<Package>PackageDefinitions\\${NAME}.xml</Package>`,
  `\t</Packages>`,
  `\t<PublishingGroups/>`,
  `</Project>`,
  ``,
].join("\n"))
console.log(`sources written to ${path.relative(process.cwd(), OUT)}`)
if (!install) {
  console.log(`\nIn the sim: Dev Mode, Project Editor, open ${path.join(OUT, "project.xml")}, then Build and Mount ${NAME}.`)
  process.exit(0)
}

// ------------------------------------------------ 6. --install

console.log("packaging (fspackagetool)...")
fs.rmSync(BUILT, { recursive: true, force: true })
const p = spawnSync(PACKAGE_TOOL, [path.join(OUT, "project.xml"), "-nopause"], { stdio: "inherit", cwd: OUT })
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

const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
const community = path.join(line.match(/"([^"]+)"/)[1], "Community")
const target = path.join(community, NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(BUILT, target, { recursive: true })
console.log(`\ninstalled to Community\\${NAME}. Start MSFS: packages are read at startup.`)
