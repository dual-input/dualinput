/*
 * Builds dualinput-p23-efb for p23-page-frameworks.mjs and installs it into the Community folder: one
 * EFB app, "Dual Input P23", whose screen is React in the EFB's own document, with p18's stylesheet for
 * the timed pages that run under it. The app's shape follows p19's builder.
 *
 *   node experiments/areas/interface/p18-fscomponent/p18-fscomponent.mjs
 *   node experiments/areas/interface/p23-page-frameworks/build-efb.mjs [--no-install]
 *
 * The Community folder is under %APPDATA%, which the Claude desktop app's shell sees through a private
 * copy, so run this from a terminal outside it. The sim reads packages when it starts. To take the
 * package out, delete dualinput-p23-efb from Community.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as esbuild from "esbuild"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const P18_CSS = path.resolve(HERE, "../p18-fscomponent/out/efb/app.css")
const NAME = "dualinput-p23-efb"
const OUT = path.join(HERE, "package", NAME)
const APP = { internal: "DualInputP23", name: "Dual Input P23" }
const ASSETS = `coui://html_ui/efb_ui/efb_apps/${APP.internal}/Assets`
const EFB_API_VERSION = "1.0.3"

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

function community() {
  const cfg = path.join(process.env.APPDATA ?? "", "Microsoft Flight Simulator 2024", "UserCfg.opt")
  if (!fs.existsSync(cfg)) die("No UserCfg.opt in its usual folder.")
  const line = fs.readFileSync(cfg, "utf8").split(/\r?\n/).find((l) => /^\s*InstalledPackagesPath/i.test(l))
  const packages = line?.match(/"([^"]+)"/)?.[1]
  const dir = packages && path.join(packages, "Community")
  if (!dir || !fs.existsSync(dir)) die("No Community folder from UserCfg.opt.")
  return dir
}

const write = (rel, data) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  return file
}

// The App class's members the EFB reads, as p19's builder writes them. BootMode 1 renders the view when
// the EFB starts.
const APP_CLASS = `
  class DualInputP23App {
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
    render() { return msfssdk.FSComponent.buildComponent(DualInputP23View, { app: this, bus: this.bus }); }
  }`

// The view mounts React once the EFB has rendered it, and gives the sim its keyboard back whenever the
// app leaves the screen.
const VIEW_CLASS = `
  class DualInputP23View extends msfssdk.DisplayComponent {
    constructor(props) { super(props); this.rootRef = msfssdk.FSComponent.createRef(); }
    onAfterRender() { window.DUALINPUT_P23_MOUNTED = window.DUALINPUT_P23_MOUNT(this.rootRef.instance); }
    onOpen() {}
    onClose() { window.DUALINPUT_P23_UNLOCK(); }
    onResume() {}
    onPause() { window.DUALINPUT_P23_UNLOCK(); }
    onUpdate(time) {}
    registerViews() {}
    routeGamepadInteractionEvent(e) {}
    handlePageKeyAction(key, args) {}
    render() { return msfssdk.FSComponent.buildComponent("div", { class: "dualinput-p23", ref: this.rootRef }); }
  }`

if (!fs.existsSync(P18_CSS)) die("p18 hasn't built its page: run node experiments/areas/interface/p18-fscomponent/p18-fscomponent.mjs first.")

const bundled = await esbuild.build({
  entryPoints: [path.join(HERE, "app-efb.tsx")],
  absWorkingDir: HERE,
  bundle: true,
  format: "iife",
  target: "es2017",
  minify: true,
  legalComments: "none",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
  logLevel: "warning",
})

// Registers once the EFB's container exists and has its bus, retrying for 30s, as p19's does.
const JS = `// Written by experiments/areas/interface/p23-page-frameworks/build-efb.mjs.
${bundled.outputFiles[0].text}
(function () {
  if (window.DUALINPUT_P23_REGISTERED) return;
  function make() {
${VIEW_CLASS}
${APP_CLASS}
    return DualInputP23App;
  }
  var tries = 0;
  (function attempt() {
    if (window.DUALINPUT_P23_REGISTERED) return;
    try {
      if (typeof msfssdk !== "undefined" && window.EFB_API && window.EFB_API.bus) { window.EFB_API.use(make()); window.DUALINPUT_P23_REGISTERED = Date.now(); return; }
    } catch (e) { window.DUALINPUT_P23_REGISTER_ERROR = String(e); }
    if (++tries < 150) setTimeout(attempt, 200);
  })();
})();
`

const APP_CSS = `/* Written by experiments/areas/interface/p23-page-frameworks/build-efb.mjs. */
.dualinput-p23 { width: 100%; height: 100%; }
.p23-box:hover { background: #2a86b6 !important; }
.p23-field:hover { border-color: #74d4ff !important; }
.p23-field:focus { border-color: #f1be4d !important; outline: none; }
`

const icon = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="#74d4ff"/>
  <text x="32" y="40" font-family="Arial" font-size="20" font-weight="bold" fill="#0a0a0a" text-anchor="middle">P23</text>
</svg>
`

fs.rmSync(path.join(HERE, "package"), { recursive: true, force: true })
const dir = `html_ui/efb_ui/efb_apps/${APP.internal}`
const jsFile = write(`${dir}/${APP.internal}.js`, JS)
write(`${dir}/${APP.internal}.css`, `${APP_CSS}\n${fs.readFileSync(P18_CSS, "utf8")}`)
write(`${dir}/Assets/app-icon.svg`, icon)

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
  title: "Dual Input p23 page frameworks probe",
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
