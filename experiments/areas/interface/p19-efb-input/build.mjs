/*
 * Builds dualinput-p19-efb for p19-efb-input.mjs and installs it into the
 * Community folder: one EFB app, "Dual Input P19", whose screen holds p19's
 * targets and p18's page, rendered by p18's own bundle inside the app.
 *
 *   node experiments/areas/interface/p18-fscomponent/p18-fscomponent.mjs
 *   node experiments/areas/interface/p19-efb-input/build.mjs [--no-install]
 *
 * The app's shape follows p09's builder (experiments/areas/interface/efb/
 * build.mjs): the script registers an App class with window.EFB_API.use once the
 * EFB's container has its bus, and the view extends the EFB's own copy of the
 * SDK, the global msfssdk. p18's bundle brings its own 16 SDK modules and
 * renders into an element of that view, as a front end shared with the desktop
 * app would. Its CSS is p18's without Tailwind's reset, scoped to
 * #dualinput-p18, so it leaves the EFB's look alone.
 *
 * The Community folder is under %APPDATA%, which the Claude desktop app's shell
 * sees through a private copy, so run this from a terminal outside it. The sim
 * reads packages when it starts. To take the package out, delete
 * dualinput-p19-efb from Community.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { BOX, FIELD, TYPES, fontBlock, fontCss, measureFonts, mountApp, recorder } from "./page.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const P18 = path.resolve(HERE, "../p18-fscomponent/out")
const FONTS = path.join(HERE, "node_modules/geist/dist/fonts/geist-sans")
const NAME = "dualinput-p19-efb"
const OUT = path.join(HERE, "package", NAME)
const APP = { internal: "DualInputP19", name: "Dual Input P19" }
const ASSETS = `coui://html_ui/efb_ui/efb_apps/${APP.internal}/Assets`
const EFB_API_VERSION = "1.0.3"

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

function community() {
  const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  if (!fs.existsSync(cfg)) die(`No UserCfg.opt at ${cfg}.`)
  const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
  const packages = line?.match(/"([^"]+)"/)?.[1]
  const dir = packages && path.join(packages, "Community")
  if (!dir || !fs.existsSync(dir)) die(`No Community folder from ${cfg}.`)
  return dir
}

const write = (rel, data) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  return file
}

// ---------------------------------------------------------------- the screen

const FACES = [
  { family: "P19-Coui-TTF", label: "TTF, from the package", css: fontCss("P19-Coui-TTF", `${ASSETS}/fonts/Geist-Regular.ttf`, "truetype") },
  { family: "P19-Coui-WOFF2", label: "WOFF2, from the package", css: fontCss("P19-Coui-WOFF2", `${ASSETS}/fonts/Geist-Regular.woff2`, "woff2") },
]

// Colors to read back from a screenshot, against the hex they were given.
const SWATCHES = ["#0a0a0a", "#171717", "#1e6a91", "#74d4ff", "#ffffff"]

const HTML = `
<div id="p19-scroll" style="height: 100%; overflow-y: auto; box-sizing: border-box; padding: 36px 14px 14px; background: #0a0a0a; color: #fafafa; font-family: sans-serif; font-size: 14px">
  <div style="font-size: 12px; color: #a3a3a3">Dual Input p19. Page Up skips a step.</div>
  <div id="p19-step" style="font-size: 18px; color: #74d4ff; margin-top: 6px; min-height: 44px">Run p19 in the terminal, then press Page Down.</div>
  <div id="p19-box" class="p19-box" data-p19-target="click">Box</div>
  <div id="p19-list" data-p19-target="wheel" style="height: 72px; overflow-y: auto; margin-top: 8px; background: #262626; border-radius: 8px; padding: 0 10px">
    ${Array.from({ length: 30 }, (_, i) => `<div style="height: 24px; line-height: 24px">List row ${i + 1}</div>`).join("")}
  </div>
  <input id="p19-plain" class="p19-field" data-p19-target="plain" placeholder="Field 1: a plain input">
  <div id="p19-focused-wrap" data-p19-target="focused"><input id="p19-focused" class="p19-field" placeholder="Field 2: focused the EFB's way"></div>
  <div style="position: relative; margin-top: 8px">${fontBlock(FACES)}</div>
  <div style="margin-top: 8px">${SWATCHES.map((c) => `<div style="display: inline-block; width: 48px; height: 32px; margin-right: 6px; background: ${c}; border: 1px solid #3a3a3a"></div>`).join("")}</div>
  <div style="font-size: 11px; color: #a3a3a3">${SWATCHES.join(", ")}</div>
  <iframe id="p19-frame" data-p19-target="frame" style="display: block; width: 100%; height: 240px; margin-top: 8px; border: 0; border-radius: 8px; background: #171717"></iframe>
  <div id="dualinput-p18" style="margin-top: 8px"></div>
</div>`

const APP_CSS = `/* Written by experiments/areas/interface/p19-efb-input/build.mjs. */
${FACES.map((f) => f.css).join("\n")}
.dualinput-p19 { width: 100%; height: 100%; }
.p19-box { ${BOX} }
.p19-box:hover { background: #2a86b6; }
.p19-field { ${FIELD} }
.p19-field:hover { border-color: #74d4ff; }
.p19-field:focus { border-color: #f1be4d; outline: none; }
`

// ---------------------------------------------------------------- the app

// The App class's members the EFB reads, as p09's builder writes them (efb_api's
// App, read in GSX_EFB.js.map). BootMode 1 renders the view when the EFB starts.
const APP_CLASS = `
  class DualInputP19App {
    constructor() {
      this._isInstalled = false;
      this._isReady = false;
      this._favoriteIndex = -1;
      this.available = msfssdk.Subject.create(true);
      this.BootMode = 1;
      this.SuspendMode = 0;
      this.name = ${JSON.stringify(APP.name)};
      this.icon = "${ASSETS}/app-icon.svg";
      this.options = {};
    }
    _install(props) {
      if (this._isInstalled) return Promise.reject("App already installed.");
      this._isInstalled = true;
      this.bus = props.bus;
      this._unitsSettingsManager = props.unitsSettingManager;
      this._efbSettingsManager = props.efbSettingsManager;
      this._notificationManager = props.notificationManager;
      this._onboardingManager = props.onboardingManager;
      this._favoriteIndex = props.favoriteIndex !== undefined && props.favoriteIndex !== null ? props.favoriteIndex : -1;
      this.options = props.options || {};
      this._isReady = true;
      // The EFB loads no app's CSS: each adds its own link, as efb_api's loadCss
      // does for CIVA's install() (read in MSFS 2024's WTCivaApp.js).
      if (!document.querySelector('link[href*="${APP.internal}.css"]')) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "coui://html_ui/efb_ui/efb_apps/${APP.internal}/${APP.internal}.css";
        document.head.appendChild(link);
      }
      Coherent.trigger("EFB_APP_INSTALLED", this.name, this.internalName, "${EFB_API_VERSION}", this.getVersion());
      return Promise.resolve();
    }
    install() { return Promise.resolve(); }
    get isReady() { return this._isReady; }
    get internalName() { return ${JSON.stringify(APP.internal)}; }
    get unitsSettingsManager() { return this._unitsSettingsManager; }
    get efbSettingsManager() { return this._efbSettingsManager; }
    get notificationManager() { return this._notificationManager; }
    get onboardingManager() { return this._onboardingManager; }
    get compatibleAircraftModels() { return undefined; }
    get favoriteIndex() { return this._favoriteIndex; }
    set favoriteIndex(i) { this._favoriteIndex = i; }
    getIsSearchable() { return true; }
    getIsFavoritable() { return true; }
    getVersion() { return "0.1.0"; }
    render() { return msfssdk.FSComponent.buildComponent(DualInputP19View, { app: this, bus: this.bus }); }
  }`

// The view mounts p19's screen once the EFB has rendered it, and gives the sim
// its keyboard back whenever the app leaves the screen.
const VIEW_CLASS = `
  class DualInputP19View extends msfssdk.DisplayComponent {
    constructor(props) { super(props); this.rootRef = msfssdk.FSComponent.createRef(); }
    note(what) { if (window.DUALINPUT_P19) window.DUALINPUT_P19.views.push({ what: what, t: Date.now() }); }
    onAfterRender() { window.DUALINPUT_P19_MOUNTED = mountApp(this.rootRef.instance, CFG); }
    onOpen() { this.note("onOpen"); }
    onClose() { this.note("onClose"); if (window.DUALINPUT_P19) window.DUALINPUT_P19.release(); }
    onResume() { this.note("onResume"); }
    onPause() { this.note("onPause"); if (window.DUALINPUT_P19) window.DUALINPUT_P19.release(); }
    onUpdate(time) {}
    registerViews() {}
    routeGamepadInteractionEvent(e) {}
    handlePageKeyAction(key, args) {}
    render() { return msfssdk.FSComponent.buildComponent("div", { class: "dualinput-p19", ref: this.rootRef }); }
  }`

const p18Js = path.join(P18, "modules", "app.js")
const p18Css = path.join(P18, "efb", "app.css")
if (!fs.existsSync(p18Js) || !fs.existsSync(p18Css)) die("p18 hasn't built its page: run node experiments/areas/interface/p18-fscomponent/p18-fscomponent.mjs first.")

const CFG = { types: TYPES, html: HTML, faces: FACES.map((f) => f.family) }

// Registers once the EFB's container exists and has its bus, retrying for 30s,
// since use() throws "Bus has not been initialized yet." before then (efb_api,
// Container.use, as p09's builder found). The classes are made only then,
// because a class that extends msfssdk.DisplayComponent throws where it's
// defined if msfssdk isn't loaded yet.
const JS = `// Written by experiments/areas/interface/p19-efb-input/build.mjs.
// p18's page, which waits for DUALINPUT_P18_START rather than starting itself.
window.DUALINPUT_P18_MANUAL = true;
${fs.readFileSync(p18Js, "utf8").replace(/\/\/# sourceMappingURL=.*\s*$/, "")}
// p19's screen and the app around it.
(function () {
  if (window.DUALINPUT_P19_REGISTERED) return;
${recorder.toString()}
${measureFonts.toString()}
${mountApp.toString()}
  var CFG = ${JSON.stringify(CFG)};
  function make() {
${VIEW_CLASS}
${APP_CLASS}
    return DualInputP19App;
  }
  var tries = 0;
  (function attempt() {
    if (window.DUALINPUT_P19_REGISTERED) return;
    try {
      if (typeof msfssdk !== "undefined" && window.EFB_API && window.EFB_API.bus) { window.EFB_API.use(make()); window.DUALINPUT_P19_REGISTERED = Date.now(); return; }
    } catch (e) { window.DUALINPUT_P19_REGISTER_ERROR = String(e); }
    if (++tries < 150) setTimeout(attempt, 200);
  })();
})();
`

const icon = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="#74d4ff"/>
  <text x="32" y="40" font-family="Arial" font-size="20" font-weight="bold" fill="#0a0a0a" text-anchor="middle">P19</text>
</svg>
`

fs.rmSync(path.join(HERE, "package"), { recursive: true, force: true })
const dir = `html_ui/efb_ui/efb_apps/${APP.internal}`
const jsFile = write(`${dir}/${APP.internal}.js`, JS)
write(`${dir}/${APP.internal}.css`, `${APP_CSS}\n${fs.readFileSync(p18Css, "utf8")}`)
write(`${dir}/Assets/app-icon.svg`, icon)
for (const f of ["Geist-Regular.ttf", "Geist-Regular.woff2"]) write(`${dir}/Assets/fonts/${f}`, fs.readFileSync(path.join(FONTS, f)))

const syntax = spawnSync(process.execPath, ["--check", jsFile], { stdio: "inherit" })
if (syntax.status !== 0) die(`${APP.internal}.js doesn't parse.`)
const coherent = spawnSync(process.execPath, ["node_modules/coherent-checks/dist/main.js", jsFile], { cwd: ROOT, stdio: "inherit" })
if (coherent.status !== 0) die(`${APP.internal}.js fails the Coherent GT check.`)

const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()
const files = []
;(function walk(d, rel) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const abs = path.join(d, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(abs, r)
    else files.push({ path: r, size: fs.statSync(abs).size, date: filetime(fs.statSync(abs).mtimeMs) })
  }
})(OUT, "")
fs.writeFileSync(path.join(OUT, "layout.json"), JSON.stringify({ content: files }, null, 2) + "\n")
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  dependencies: [],
  content_type: "MISC",
  title: "Dual Input p19 EFB input probe",
  manufacturer: "",
  creator: "Dual Input",
  package_version: "0.1.0",
  minimum_game_version: "0.0.0",
  release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
  package_order_hint: "NONE",
  total_package_size: files.reduce((s, f) => s + f.size, 0),
}, null, 2) + "\n")
console.log(`${APP.name} written: ${files.length} files, ${(fs.statSync(jsFile).size / 1024).toFixed(0)} KB of script`)
if (process.argv.includes("--no-install")) process.exit(0)

const target = path.join(community(), NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(OUT, target, { recursive: true })
console.log(`installed to Community\\${NAME}. Start MSFS: packages are read at startup.`)
