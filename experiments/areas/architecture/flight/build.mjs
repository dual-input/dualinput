/*
 * Builds what p08-flight.mjs runs, and with --install puts its three packages
 * in the Community folder:
 *
 *   client/   the SimConnect client, on declarations bindgen generates from the
 *             SDK's SimConnect.h, and SimConnect.dll beside it
 *   helper/   Raw Input in sink mode, keys and flight-hardware buttons
 *   module/   the standalone module, built by cargo-msfs, on declarations
 *             bindgen generates from the SDK cargo-msfs fetched
 *   crosscheck-p08-module   the module, in a package of its own, as p03's were
 *   crosscheck-p08-banner   p05's in-game panel, compiled by the Project Editor
 *             on 2026-10-04, with a toolbar script that opens it when the
 *             client asks over the CommBus
 *   crosscheck-p08-efb      one EFB app whose code does the same from the EFB's
 *             document, which runs from the sim's start with the EFB closed
 *             (measured on MSFS 2024, 2026-10-06, record/areas/interface/log.md)
 *
 *   node experiments/areas/architecture/flight/build.mjs [--install]
 *
 * Needs Rust, cargo-msfs with its SDK (module/build.mjs in p03 says how), and
 * LLVM for bindgen's libclang, which scoop installs with `scoop install llvm`.
 * The packages are Copy-only: their files, a layout.json, and a manifest.json,
 * as Navigraph's EFB app ships, so nothing goes through fspackagetool. The sim
 * reads packages when it starts, so --install refuses while it runs.
 *
 * The scripts run in Coherent GT, so they're written without the syntax it
 * rejects (CLAUDE.md, Before writing code that runs in a panel), and node
 * --check parses each before it's packaged. They touch nothing in the pilot's
 * input path.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { REPO } from "../../../tools/results.mjs"

const HERE = path.join(REPO, "experiments", "areas", "architecture", "flight")
const BUILD = path.join(HERE, "build")
const P05 = path.join(REPO, "experiments", "areas", "interface", "ingame", "package", "Packages", "crosscheck-p05-ingame")
const PANEL_ID = "PANEL_CROSSCHECK_P05"
const ICON = "ICON_TOOLBAR_CROSSCHECK_P05"
const EFB_APP = { internal: "CrosscheckP08", name: "Crosscheck P08" }
const EFB_API_VERSION = "1.0.3"
const PACKAGES = ["crosscheck-p08-module", "crosscheck-p08-banner", "crosscheck-p08-efb"]

const die = (why) => { console.error(`\n${why}`); process.exit(1) }
const llvm = path.join(process.env.USERPROFILE, "scoop", "apps", "llvm", "current", "bin")
const env = { ...process.env, LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? llvm, PATH: `${llvm};${process.env.PATH}` }

// ---------------------------------------------------------------- Rust

execFileSync("cargo", ["build", "--release"], { cwd: HERE, stdio: "inherit", env })
fs.rmSync(BUILD, { recursive: true, force: true })
fs.mkdirSync(BUILD, { recursive: true })
const wasm = path.join(BUILD, "crosscheck-p08.wasm")
execFileSync("cargo-msfs", ["build", "msfs2024", "-i", path.join(HERE, "module"), "-o", wasm], { stdio: "inherit", env })

// ---------------------------------------------------------------- packages

const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()

function writeFile(pkg, rel, content) {
  const file = path.join(BUILD, pkg, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

function checkParses(file) {
  if (spawnSync(process.execPath, ["--check", file], { stdio: "inherit" }).status !== 0) die(`${path.basename(file)} doesn't parse.`)
}

// layout.json lists every file with its size and a FILETIME date, past
// Number.MAX_SAFE_INTEGER, written as a bare number (fsc-editor,
// link/tools/layout.mjs); manifest.json names the package.
function finish(pkg, title) {
  const dir = path.join(BUILD, pkg)
  const files = []
  ;(function walk(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(a, r)
      else files.push({ path: r, size: fs.statSync(a).size })
    }
  })(dir, "")
  const date = filetime(Date.now())
  fs.writeFileSync(path.join(dir, "layout.json"), `{\n  "content": [\n${files.map((f) => `    {\n      "path": "${f.path}",\n      "size": ${f.size},\n      "date": ${date}\n    }`).join(",\n")}\n  ]\n}\n`)
  const total = files.reduce((s, f) => s + f.size, 0)
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    dependencies: [],
    content_type: "MISC",
    title,
    manufacturer: "",
    creator: "Crosscheck",
    package_version: "0.1.0",
    minimum_game_version: "1.8.14",
    export_type: "Community",
    builder: "Microsoft Flight Simulator 2024",
    package_order_hint: "",
    release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
    total_package_size: String(total),
  }, null, 2) + "\n")
  console.log(`packaged ${pkg}: ${files.length} files`)
}

// The module.
fs.mkdirSync(path.join(BUILD, PACKAGES[0], "modules"), { recursive: true })
fs.copyFileSync(wasm, path.join(BUILD, PACKAGES[0], "modules", "crosscheck-p08.wasm"))
finish(PACKAGES[0], "Crosscheck p08 module")

// The CommBus listener both scripts use, p14's and p15's: the sim's
// RegisterCommBusListener, after loading Services/CommBus.js where a page has
// common.js but not it, and otherwise ADD_VIEW_LISTENER on engine, as mainUi's
// own view listeners take events (read in fs-base-ui 0.1.10,
// html_ui/Global/lib.js, ViewListenerMgr). The toolbar in the main menu has no
// Coherent and takes calls the second way (measured on MSFS 2024, 2026-10-08,
// record/areas/interface/log.md).
//
// The client calls CROSSCHECK_P08_BANNER with { n, via, open }: "ping" asks
// every script to answer, and "toolbar" or "efb" asks that script to open or
// close the banner's panel. Each answers on CROSSCHECK_P08_ANSWER.
const listener = (role) => `
  var S = window.CROSSCHECK_P08_${role.toUpperCase()} = { role: "${role}", loaded: Date.now(), way: null, ready: false, heard: 0, calls: 0, errors: [], last: null };
  var answerWith = null;
  function panelState() {
    var els = document.querySelectorAll("ui-resource-element");
    for (var k = 0; k < els.length; k++) {
      var m = els[k].manipulator;
      var d = m && m.m_toolBarButtonData && m.m_toolBarButtonData.panelData;
      if (d && d.id === "${PANEL_ID}") return d.state;
    }
    return null;
  }
  function answer(o) {
    o.from = S.role; o.way = S.way; o.ready = S.ready; o.heard = S.heard; o.loadedAgoMs = Date.now() - S.loaded; o.panel = panelState();
    try { if (answerWith) answerWith("COMM_BUS_SIMCONNECT_CALLBACK", "CROSSCHECK_P08_ANSWER", JSON.stringify(o)); } catch (e) { S.errors.push("answer: " + e); }
  }
  function onMessage(data) {
    S.heard++;
    var m = null;
    try { m = JSON.parse(String(data)); } catch (e) { S.errors.push("bad message: " + e); return; }
    S.last = m;
    if (m.via === "ping") return answer({ n: m.n, what: "ping" });
    if (m.via !== S.role) return;
    var r = { n: m.n, what: m.open ? "open" : "close" };
    try {
      var p = Coherent.call("TOOLBAR_BUTTON_TOGGLE", "${PANEL_ID}", !!m.open);
      S.calls++;
      r.called = true;
      if (p && p.then) p.then(function () { answer({ n: m.n, what: r.what + " resolved" }); }, function (e) { answer({ n: m.n, what: r.what + " rejected", error: String(e) }); });
    } catch (e) { r.called = false; r.error = String(e); }
    answer(r);
  }
  function viaCommonJs() {
    S.way = "common.js";
    var l = RegisterCommBusListener(function () { S.ready = true; answer({ what: "ready" }); });
    answerWith = function (n, x, y) { return l.call(n, x, y); };
    l.on("CROSSCHECK_P08_BANNER", onMessage);
  }
  try {
    if (typeof RegisterCommBusListener !== "undefined") viaCommonJs();
    else if (typeof RegisterViewListenerT !== "undefined" && typeof Coherent !== "undefined") {
      var s = document.createElement("script");
      s.src = "coui://html_ui/JS/Services/CommBus.js";
      s.onload = function () { try { viaCommonJs(); } catch (e) { S.errors.push("common.js way: " + e); } };
      s.onerror = function () { S.errors.push("CommBus.js didn't load"); };
      document.head.appendChild(s);
    } else if (typeof engine !== "undefined") {
      S.way = "view listener";
      answerWith = function (n, x, y) { return engine.call(n, x, y); };
      engine.on("EVENT_FROM_VIEW_LISTENER", function (listener, name, data) {
        if (String(listener).toUpperCase() === "JS_LISTENER_COMM_BUS" && name === "CROSSCHECK_P08_BANNER") onMessage(data);
      });
      engine.trigger("ADD_VIEW_LISTENER", "JS_LISTENER_COMM_BUS", window.location.pathname);
      S.ready = true;
    } else S.way = "none";
  } catch (e) { S.errors.push("setup: " + e); }
`

// The banner: p05's compiled panel and page, and an icon that loads our
// toolbar script, Parallel 42's way (read in p42-util-chaseplane 2026.39.1.16,
// HTML_UI/icons/toolbar/P42_PANEL_CHASEPLANE.svg), as p05's did.
const banner = PACKAGES[1]
for (const rel of ["InGamePanels/crosscheck-p05.spb", "html_ui/InGamePanels/CrosscheckP05/p05.html", "html_ui/InGamePanels/CrosscheckP05/p05.css", "html_ui/InGamePanels/CrosscheckP05/p05.js"]) {
  const from = path.join(P05, rel)
  if (!fs.existsSync(from)) die(`${rel} is missing from p05's built package; Build and Mount it from experiments/areas/interface/ingame first.`)
  writeFile(banner, rel, fs.readFileSync(from))
}
writeFile(banner, `html_ui/icons/toolbar/${ICON}.svg`, `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M14 20 L32 10 L50 20 M14 44 L32 54 L50 44" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="6" fill="#ffffff"/>
  <foreignObject>
    <img src onerror="(function () { if (!window.CROSSCHECK_P08_INJECTED) { window.CROSSCHECK_P08_INJECTED = true; var script = document.createElement('script'); script.type = 'text/javascript'; script.src = 'coui://html_ui/InGamePanels/CrosscheckP05/p08-toolbar.js'; document.head.appendChild(script); } })()"></img>
  </foreignObject>
</svg>
`)
checkParses(writeFile(banner, "html_ui/InGamePanels/CrosscheckP05/p08-toolbar.js", `// Written by experiments/areas/architecture/flight/build.mjs. Runs in the
// toolbar's document, and opens or closes the banner's panel when the client
// asks over the CommBus. window.CROSSCHECK_P08_TOOLBAR keeps its state.
(function () {
  if (window.CROSSCHECK_P08_TOOLBAR) return;
${listener("toolbar")}
})();
`))
finish(banner, "Crosscheck p08 banner")

// The EFB app, registered as p09's was (experiments/areas/interface/efb/build.mjs),
// with the EFB API's App and AppView written by hand from GSX's source map
// (fsdreamteam-gsx-efb, GSX_EFB.js.map, efb_api 1.0.3). Its code runs from the
// sim's start, whether or not anyone opens the app.
const efb = PACKAGES[2]
const efbDir = `html_ui/efb_ui/efb_apps/${EFB_APP.internal}`
checkParses(writeFile(efb, `${efbDir}/${EFB_APP.internal}.js`, `// Written by experiments/areas/architecture/flight/build.mjs. Listens on the
// CommBus from the EFB's document, and opens or closes the banner's panel when
// the client asks. window.CROSSCHECK_P08_EFB keeps its state.
(function () {
  if (window.CROSSCHECK_P08_EFB) return;
${listener("efb")}

  function make() {
    class CrosscheckP08View extends msfssdk.DisplayComponent {
      onOpen() {}
      onClose() {}
      onResume() {}
      onPause() {}
      onUpdate(time) {}
      registerViews() {}
      routeGamepadInteractionEvent(e) {}
      handlePageKeyAction(key, args) {}
      render() { return msfssdk.FSComponent.buildComponent("div", { class: "cc-p08" }, "Crosscheck P08"); }
    }
    class CrosscheckP08App {
      constructor() {
        this._isInstalled = false;
        this._isReady = false;
        this._favoriteIndex = -1;
        this.available = msfssdk.Subject.create(true);
        this.BootMode = 1;
        this.SuspendMode = 0;
        this.name = ${JSON.stringify(EFB_APP.name)};
        this.icon = "coui://${efbDir}/Assets/app-icon.svg";
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
        Coherent.trigger("EFB_APP_INSTALLED", this.name, this.internalName, "${EFB_API_VERSION}", this.getVersion());
        S.installed = Date.now();
        return Promise.resolve();
      }
      install() { return Promise.resolve(); }
      get isReady() { return this._isReady; }
      get internalName() { return ${JSON.stringify(EFB_APP.internal)}; }
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
      render() { return msfssdk.FSComponent.buildComponent(CrosscheckP08View, { app: this, bus: this.bus }); }
    }
    return CrosscheckP08App;
  }
  // use() throws "Bus has not been initialized yet." until the EFB's container
  // has its bus, so it retries for 30s, as p09's did.
  var tries = 0;
  (function attempt() {
    if (S.registered) return;
    try {
      if (typeof msfssdk !== "undefined" && window.EFB_API && window.EFB_API.bus) { window.EFB_API.use(make()); S.registered = Date.now(); return; }
    } catch (e) { S.errors.push("register: " + e); }
    if (++tries < 150) setTimeout(attempt, 200);
  })();
})();
`))
writeFile(efb, `${efbDir}/${EFB_APP.internal}.css`, `/* Written by experiments/areas/architecture/flight/build.mjs. */
.cc-p08 { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background-color: #0c121e; color: #9db8ff; font-family: "Roboto", sans-serif; font-size: 40px; font-weight: bold; }
`)
writeFile(efb, `${efbDir}/Assets/app-icon.svg`, `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="#3d7bff"/>
  <text x="32" y="40" font-family="Arial" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">P08</text>
</svg>
`)
finish(efb, "Crosscheck p08 EFB app")

// ---------------------------------------------------------------- install

if (process.argv.includes("--install")) {
  const running = execFileSync("tasklist", ["/FI", "IMAGENAME eq FlightSimulator2024.exe", "/NH"], { encoding: "utf8" }).includes("FlightSimulator2024.exe")
  if (running) die("not installed: the sim is running, and reads packages only at boot")
  const cfg = fs.readFileSync(path.join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "UserCfg.opt"), "utf8")
  const root = /InstalledPackagesPath\s+"([^"]+)"/.exec(cfg)?.[1]
  if (!root) die("not installed: no InstalledPackagesPath in UserCfg.opt")
  for (const pkg of PACKAGES) {
    const dest = path.join(root, "Community", pkg)
    // Replaces only our own probe package of the same name.
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(path.join(BUILD, pkg), dest, { recursive: true })
  }
  console.log(`installed into the Community folder: ${PACKAGES.join(", ")}`)
}
