/*
 * Builds crosscheck-p09-efb for p09-crowded-efb.mjs and installs it into the
 * Community folder: one EFB app of ours, "ZZ Crosscheck P09", and FILLERS apps
 * that do nothing, so the EFB holds far more apps than its dock and the first
 * page of its app list show. Ours is named to sort after every filler, by
 * display name and by folder, so it lands off the first page whichever order
 * the EFB lists apps in.
 *
 *   node experiments/areas/interface/efb/build.mjs [--no-install]
 *
 * An EFB app is html_ui/efb_ui/efb_apps/<Name>/<Name>.js, a CSS file, and
 * Assets/app-icon.svg, and its script registers the app with
 * window.EFB_API.use(AppClass), as GSX's and Navigraph's do (read in
 * fsdreamteam-gsx-efb, GSX_EFB.js.map, and navigraph-efb-chartsapp 1.0.9,
 * NavigraphChartsApp.js). Both bundle the EFB API; ours writes the same app
 * shape by hand instead, from that API's App and AppView classes (efb_api,
 * EfbApiVersion 1.0.3, in GSX's source map): the container calls new on the
 * class, then _install(props), and the EFB renders app.render().
 *
 * Our app's code talks to p09 over HTTP on 127.0.0.1:47809, which an EFB
 * document can reach (measured on MSFS 2024, 2026-10-05, record/areas/
 * interface/log.md). It polls every 250ms, which is also the evidence that it
 * runs while the EFB is closed, and runs the steps p09 answers with: open the
 * EFB, fire an event, list or click the app buttons on screen. It never touches
 * the pilot's input, so it has nothing to fail open from, and it stops polling
 * after 30 minutes or once p09 says stop.
 *
 * Nothing goes through fspackagetool: a Copy-only package is the files, a
 * layout.json, and a manifest.json, as Navigraph's EFB app ships. The sim reads
 * packages when it starts, so start MSFS after this. To take the package out,
 * delete crosscheck-p09-efb from Community.
 */

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NAME = "crosscheck-p09-efb"
const OUT = path.join(HERE, "package", NAME)
const FILLERS = 48
const PORT = 47_809
const APP = { internal: "ZzCrosscheckP09", name: "ZZ Crosscheck P09" }
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

const write = (rel, text) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

const icon = (label, color) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="${color}"/>
  <text x="32" y="40" font-family="Arial" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">${label}</text>
</svg>
`

// The App class's members the EFB reads, from efb_api's App (GSX_EFB.js.map),
// in the syntax Coherent GT parses: no class fields, optional chaining, or ??
// (CLAUDE.md, Before writing code that runs in a panel). BootMode 0 is COLD and
// SuspendMode 0 is SLEEP (efb_api, AppBootMode and AppSuspendMode).
const appClass = (cls, internal, display, viewCls, bootMode) => `
  class ${cls} {
    constructor() {
      this._isInstalled = false;
      this._isReady = false;
      this._favoriteIndex = -1;
      this.available = msfssdk.Subject.create(true);
      this.BootMode = ${bootMode};
      this.SuspendMode = 0;
      this.name = ${JSON.stringify(display)};
      this.icon = "coui://html_ui/efb_ui/efb_apps/${internal}/Assets/app-icon.svg";
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
      if (this.onInstalled) this.onInstalled();
      return Promise.resolve();
    }
    install() { return Promise.resolve(); }
    get isReady() { return this._isReady; }
    get internalName() { return ${JSON.stringify(internal)}; }
    get unitsSettingsManager() { return this._unitsSettingsManager; }
    get efbSettingsManager() { return this._efbSettingsManager; }
    get notificationManager() { return this._notificationManager; }
    get onboardingManager() { return this._onboardingManager; }
    get compatibleAircraftModels() { return undefined; }
    get favoriteIndex() { return this._favoriteIndex; }
    set favoriteIndex(i) { this._favoriteIndex = i; }
    getIsSearchable() { return this.options.isSearchable !== undefined ? this.options.isSearchable : true; }
    getIsFavoritable() { return this.options.isFavoritable !== undefined ? this.options.isFavoritable : true; }
    getVersion() { return "0.1.0"; }
    render() { return msfssdk.FSComponent.buildComponent(${viewCls}, { app: this, bus: this.bus }); }
  }`

// AppView's lifecycle, which the EFB calls on the rendered view (efb_api,
// AppView): onOpen once, onResume each time it comes back, onPause when left.
const viewClass = (cls, body, hooks = "") => `
  class ${cls} extends msfssdk.DisplayComponent {
    onOpen() { ${hooks.includes("open") ? 'this.props.app.onView("onOpen");' : ""} }
    onClose() { ${hooks.includes("open") ? 'this.props.app.onView("onClose");' : ""} }
    onResume() { ${hooks.includes("open") ? 'this.props.app.onView("onResume");' : ""} }
    onPause() { ${hooks.includes("open") ? 'this.props.app.onView("onPause");' : ""} }
    onUpdate(time) {}
    registerViews() {}
    routeGamepadInteractionEvent(e) {}
    handlePageKeyAction(key, args) { ${hooks.includes("open") ? 'this.props.app.onView("handlePageKeyAction", { key: key, args: args });' : ""} }
    render() { return ${body}; }
  }`

// Registers once the EFB's container exists and has its bus, retrying for 30s,
// since use() throws "Bus has not been initialized yet." before then (efb_api,
// Container.use). The classes are made only then too, because a class that
// extends msfssdk.DisplayComponent throws where it's defined if msfssdk isn't
// loaded yet.
const register = (make, flag) => `
  var tries = 0;
  (function attempt() {
    if (window.${flag}) return;
    try {
      if (typeof msfssdk !== "undefined" && window.EFB_API && window.EFB_API.bus) { window.EFB_API.use(${make}()); window.${flag} = Date.now(); return; }
    } catch (e) { window.${flag}_ERROR = String(e); }
    if (++tries < 150) setTimeout(attempt, 200);
  })();`

// ---------------------------------------------------------------- our app

const OURS = `// Written by experiments/areas/interface/efb/build.mjs.
// "ZZ Crosscheck P09": polls p09 on 127.0.0.1:${PORT} and runs the steps it
// answers with. window.CROSSCHECK_P09 keeps its state for the inspector.
(function () {
  if (window.CROSSCHECK_P09) return;
  var BASE = "http://127.0.0.1:${PORT}/p09";
  var POLL_MS = 250;
  var CAP_MS = 30 * 60 * 1000;
  var S = window.CROSSCHECK_P09 = { loaded: Date.now(), installed: null, polls: 0, failures: 0, seq: 0, stopped: false, views: [], last: null };

  function post(path, body) {
    try {
      var x = new XMLHttpRequest();
      x.open("POST", BASE + path, true);
      x.setRequestHeader("Content-Type", "text/plain");
      x.send(JSON.stringify(body));
    } catch (e) { S.last = "post threw: " + e; }
  }

  // The action bar carries panel-ui-actions--hidden exactly while the EFB is
  // closed (measured on MSFS 2024, 2026-10-04, record/areas/interface/log.md).
  function efbState() {
    var bar = document.querySelector('[class*="panel-ui-actions"]');
    if (!bar) return "unknown";
    return String(bar.className).indexOf("panel-ui-actions--hidden") >= 0 ? "closed" : "open";
  }

  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) return null;
    var cur = el;
    while (cur && cur.nodeType === 1) {
      var cs = window.getComputedStyle(cur);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
      cur = cur.parentElement;
    }
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  // Every element that shows an app's icon, the way the dock and the app list
  // draw one: an img or a CSS background whose url is under efb_apps/.
  function appButtons() {
    var out = [];
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var src = el.tagName === "IMG" ? el.getAttribute("src") : null;
      if (!src) {
        var bg = el.style && el.style.backgroundImage;
        if (bg && bg.indexOf("efb_apps") >= 0) src = bg;
      }
      if (!src || src.indexOf("efb_apps/") < 0 && src.indexOf("efb_apps\\\\") < 0 && src.indexOf("app-icon") < 0) continue;
      var m = /efb_apps[\\/\\\\]([^\\/\\\\]+)/.exec(src);
      out.push({ el: el, app: m ? m[1] : src.slice(-60), rect: visible(el) });
    }
    return out;
  }

  function press(el) {
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var target = document.elementFromPoint(x, y) || el;
    var types = ["mouseover", "mousedown", "mouseup", "click"];
    for (var i = 0; i < types.length; i++) {
      var ev = document.createEvent("MouseEvents");
      ev.initMouseEvent(types[i], true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);
      target.dispatchEvent(ev);
    }
    return { x: Math.round(x), y: Math.round(y), tag: target.tagName, cls: String(target.className).slice(0, 80) };
  }

  function step(s) {
    var r = { op: s.op, t: Date.now(), efbBefore: efbState() };
    try {
      if (s.op === "toggle" || (s.op === "toggleIfClosed" && r.efbBefore === "closed")) { Coherent.call("TOGGLE_EFB"); r.toggled = true; }
      else if (s.op === "toggleIfClosed") r.toggled = false;
      else if (s.op === "trigger") { engine.trigger.apply(engine, s.args); r.sent = s.args; }
      else if (s.op === "coherentTrigger") { Coherent.trigger.apply(Coherent, s.args); r.sent = s.args; }
      else if (s.op === "launchFlowEvent") { LaunchFlowEvent.apply(null, s.args); r.sent = s.args; }
      else if (s.op === "apps") {
        var list = appButtons();
        r.apps = [];
        for (var i = 0; i < list.length; i++) r.apps.push({ app: list[i].app, rect: list[i].rect, tag: list[i].el.tagName, cls: String(list[i].el.className).slice(0, 60) });
      } else if (s.op === "click") {
        var hits = appButtons().filter(function (b) { return b.app === s.app && b.rect; });
        r.found = hits.length;
        if (hits.length) r.pressed = press(hits[0].el);
      } else if (s.op === "findText" || s.op === "clickText") {
        // The innermost elements whose own text holds s.text: the app list may
        // draw an icon inline, with only the name to find it by.
        var found = [];
        var every = document.querySelectorAll("*");
        for (var q = 0; q < every.length; q++) {
          var node = every[q];
          var text = node.textContent ? node.textContent.trim() : "";
          if (!text || text.indexOf(s.text) < 0 || text.length > s.text.length + 40) continue;
          var inner = false;
          for (var c = 0; c < node.children.length; c++) if (node.children[c].textContent && node.children[c].textContent.indexOf(s.text) >= 0) inner = true;
          if (inner) continue;
          found.push({ el: node, rect: visible(node), tag: node.tagName, cls: String(node.className).slice(0, 60) });
        }
        r.found = found.map(function (f) { return { rect: f.rect, tag: f.tag, cls: f.cls }; });
        if (s.op === "clickText") {
          var shown = found.filter(function (f) { return f.rect; });
          if (shown.length) r.pressed = press(shown[0].el);
        }
      } else if (s.op === "clickSelector") {
        var els = document.querySelectorAll(s.selector);
        r.found = els.length;
        var idx = s.index || 0;
        if (els.length > idx && visible(els[idx])) r.pressed = press(els[idx]);
        else r.visible = false;
      } else if (s.op === "html") {
        var el = document.querySelector(s.selector);
        r.html = el ? String(el.outerHTML).slice(0, s.max || 3000) : null;
      } else if (s.op === "classes") {
        // The class names in the document, counted, to find the dock and the
        // app list's pager without reading the EFB's code.
        var counts = {};
        var nodes = document.querySelectorAll("[class]");
        for (var j = 0; j < nodes.length; j++) {
          var parts = String(nodes[j].className).split(/\\s+/);
          for (var k = 0; k < parts.length; k++) if (parts[k]) counts[parts[k]] = (counts[parts[k]] || 0) + 1;
        }
        r.classes = counts;
      } else if (s.op === "stop") { S.stopped = true; }
      else r.error = "unknown op";
    } catch (e) { r.error = String(e); }
    r.efbAfter = efbState();
    return r;
  }

  function run(steps, id) {
    var i = 0;
    var results = [];
    (function next() {
      if (i >= steps.length) { post("/result", { id: id, results: results }); return; }
      var s = steps[i++];
      if (s.op === "wait") { setTimeout(next, s.ms || 100); return; }
      results.push(step(s));
      next();
    })();
  }

  function poll() {
    if (S.stopped || Date.now() - S.loaded > CAP_MS) return;
    S.polls++;
    var x = new XMLHttpRequest();
    x.open("GET", BASE + "/next?since=" + S.seq + "&polls=" + S.polls + "&efb=" + efbState() + "&installed=" + (S.installed ? 1 : 0), true);
    x.onload = function () {
      try {
        var cmds = JSON.parse(x.responseText || "[]");
        for (var i = 0; i < cmds.length; i++) { if (cmds[i].seq > S.seq) { S.seq = cmds[i].seq; run(cmds[i].steps, cmds[i].seq); } }
      } catch (e) { S.last = "bad reply: " + e; }
      setTimeout(poll, POLL_MS);
    };
    x.onerror = function () { S.failures++; setTimeout(poll, 1000); };
    x.send();
  }
  setTimeout(poll, 0);

  function make() {
${appClass("CrosscheckP09App", APP.internal, APP.name, "CrosscheckP09View", 1)}

    CrosscheckP09App.prototype.onInstalled = function () {
      S.installed = Date.now();
      post("/event", { what: "installed", t: S.installed, efb: efbState() });
    };
    CrosscheckP09App.prototype.onView = function (what, detail) {
      var e = { what: what, t: Date.now(), efb: efbState(), detail: detail || null };
      S.views.push(e);
      post("/event", e);
    };

${viewClass("CrosscheckP09View", `msfssdk.FSComponent.buildComponent("div", { class: "cc-p09" },
        msfssdk.FSComponent.buildComponent("div", { class: "cc-p09-title" }, "Crosscheck P09"),
        msfssdk.FSComponent.buildComponent("div", { class: "cc-p09-body" }, "Opened by the probe."))`, "open")}

    return CrosscheckP09App;
  }
${register("make", "CROSSCHECK_P09_REGISTERED")}
})();
`

// ---------------------------------------------------------------- fillers

const filler = (n) => {
  const id = String(n).padStart(2, "0")
  const internal = `CrosscheckP09Filler${id}`
  const cls = `CrosscheckP09Filler${id}App`
  const view = `CrosscheckP09Filler${id}View`
  return {
    internal,
    js: `// Written by experiments/areas/interface/efb/build.mjs: filler ${id}, which
// only takes up a place in the EFB's app list.
(function () {
  function make() {
${appClass(cls, internal, `Filler ${id}`, view, 0)}
${viewClass(view, `msfssdk.FSComponent.buildComponent("div", { class: "cc-p09" }, "Filler ${id}")`)}
    return ${cls};
  }
${register("make", `CROSSCHECK_P09_FILLER_${id}`)}
})();
`,
  }
}

// ---------------------------------------------------------------- the package

fs.rmSync(OUT, { recursive: true, force: true })
const css = `/* Written by experiments/areas/interface/efb/build.mjs. */
.cc-p09 { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background-color: #0c121e; color: #f2f5fa; font-family: "Roboto", sans-serif; }
.cc-p09-title { font-size: 40px; font-weight: bold; color: #9db8ff; }
.cc-p09-body { font-size: 22px; margin-top: 12px; }
`
const apps = [{ internal: APP.internal, js: OURS, label: "CC", color: "#3d7bff" }, ...Array.from({ length: FILLERS }, (_, i) => ({ ...filler(i + 1), label: String(i + 1).padStart(2, "0"), color: "#55606f" }))]
for (const a of apps) {
  const dir = `html_ui/efb_ui/efb_apps/${a.internal}`
  const file = write(`${dir}/${a.internal}.js`, a.js)
  const check = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" })
  if (check.status !== 0) die(`${a.internal}.js doesn't parse.`)
  write(`${dir}/${a.internal}.css`, css)
  write(`${dir}/Assets/app-icon.svg`, icon(a.label, a.color))
}

const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()
const files = []
;(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(abs, r)
    else files.push({ path: r, size: fs.statSync(abs).size, date: filetime(fs.statSync(abs).mtimeMs) })
  }
})(OUT, "")
fs.writeFileSync(path.join(OUT, "layout.json"), JSON.stringify({ content: files }, null, 2) + "\n")
const total = files.reduce((s, f) => s + f.size, 0)
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  dependencies: [],
  content_type: "MISC",
  title: "Crosscheck p09 crowded EFB probe",
  manufacturer: "",
  creator: "Crosscheck",
  package_version: "0.1.0",
  minimum_game_version: "0.0.0",
  release_notes: { neutral: { LastUpdate: "", OlderHistory: "" } },
  package_order_hint: "NONE",
  total_package_size: total,
}, null, 2) + "\n")
console.log(`${apps.length} apps written: ${APP.name} and ${FILLERS} fillers, ${files.length} files`)
if (process.argv.includes("--no-install")) process.exit(0)

const target = path.join(community(), NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(OUT, target, { recursive: true })
console.log(`installed to Community\\${NAME}. Start MSFS: packages are read at startup.`)
