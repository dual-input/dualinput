/*
 * Builds crosscheck-p10-menu for p10-menu-package.mjs and installs it into the
 * Community folder, with MSFS closed: a script of ours, p10-menu.js, that sets
 * the world map's departure, stand, and aircraft and starts the flight when
 * p10 tells it to, and two ways for a package to put it into the menu's
 * documents.
 *
 *   node experiments/areas/interface/menu/build.mjs [--cookedcomp <guid>[,<guid>]] [--no-install]
 *
 * The way in that always ships is our toolbar icon: the toolbar inlines a
 * panel's icon SVG into its own document, so an <img src onerror> in the icon
 * appends our script there (measured on MSFS 2024, 2026-10-04,
 * record/areas/interface/log.md, "Our toolbar icon loads a script of ours into
 * the toolbar's document"), and the toolbar's document is one of the 8 world
 * map documents that hold engine and the store (measured 2026-10-05, same log,
 * "Code in the menu's document sets the world map's departure"). Whether the
 * toolbar draws our icon while the world map is open is what p10 finds out.
 *
 * --cookedcomp <guid> adds the second way, Flow Pro's: our own copy of one of
 * fs-base-ui's UI components, with the same <img src onerror> added (read in
 * p42-util-flow-pro 26.33.5, cookedcomps/{3A799C8C-...}.html; same log, "A
 * package reaches the menu's document"). It copies the stock component from
 * the sim's install folder. Pick a component that no other package copies,
 * because two copies of one component load only one, and one that the menu
 * shows where the script is needed: MenuBarPage,
 * {37E4C836-61EF-469A-BDF6-DB44BAAE15B5}, which reached mainUi on the first
 * menu visit (p10, 2026-10-06), and the start screen's button, TileButton_Start,
 * {AB166825-B19B-4425-8E08-00C3B322976A}, for the screen before it (read in
 * fs-base-ui 0.1.10, html_ui/Global/pkg/base.bundle.js, the page GUIDs, and
 * cookedcomps/{3A799C8C-...}.html).
 *
 * The script touches no input and does nothing until p10 answers its polls on
 * 127.0.0.1:47810, so it has nothing to fail open from; it stops polling an
 * hour after it loads.
 *
 * The SPB asset group for the panel needs fspackagetool, which hangs while
 * MSFS runs, so close the sim first; a package is read when the sim starts. To
 * take it out, delete crosscheck-p10-menu from Community.
 */

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NAME = "crosscheck-p10-menu"
const PANEL_ID = "PANEL_CROSSCHECK_P10"
const DIR = "CrosscheckP10"
const ICON = "ICON_TOOLBAR_CROSSCHECK_P10"
const PORT = 47_810
const SDK = process.env.MSFS_SDK ?? process.env.MSFS2024_SDK ?? "C:/MSFS 2024 SDK"
const PACKAGE_TOOL = path.join(SDK, "Tools", "bin", "fspackagetool.exe")
const OUT = path.join(HERE, "package")
const BUILT = path.join(OUT, "Packages", NAME)
// The sim's own copies of its UI components are files in its install folder,
// Packages/fs-base-ui/cookedcomps/, named {GUID}.html and .json with the GUID
// in capitals; MSFS 2024 on Steam installs to steamapps/common/Limitless.
// No script in the menu can read them: an XHR for coui://cookedcomps/ errors,
// and the inspector lists none among mainUi's resources (2026-10-06).
function stockDir() {
  const vdf = "C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf"
  const libraries = fs.existsSync(vdf) ? [...fs.readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, "/")) : []
  for (const lib of libraries) {
    const dir = path.join(lib, "steamapps", "common", "Limitless", "Packages", "fs-base-ui", "cookedcomps")
    if (fs.existsSync(dir)) return dir
  }
  return null
}

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null }
// One GUID, or several separated by commas.
const cookedcomps = (opt("--cookedcomp") ?? "").split(",").map((g) => g.replace(/[{}\s]/g, "").toLowerCase()).filter(Boolean)

const die = (why) => { console.error(`\n${why}`); process.exit(1) }

const tasks = execFileSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8" })
if (/"FlightSimulator2024\.exe"/i.test(tasks)) die("MSFS is running. fspackagetool hangs while it runs: close the sim and run this again.")
if (!fs.existsSync(PACKAGE_TOOL)) die(`No fspackagetool at ${PACKAGE_TOOL}: set MSFS_SDK.`)

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
const check = (file) => {
  const c = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" })
  if (c.status !== 0) die(`${path.basename(file)} doesn't parse.`)
}

fs.rmSync(path.join(OUT, "PackageSources"), { recursive: true, force: true })

// Loads our script once per document, however many of our injections run there.
const LOADER = `(function () { if (!window.CROSSCHECK_P10_INJECTED) { window.CROSSCHECK_P10_INJECTED = 'VIA'; var script = document.createElement('script'); script.type = 'text/javascript'; script.src = 'coui://html_ui/InGamePanels/${DIR}/p10-menu.js'; document.head.appendChild(script); } })()`
const loader = (via) => LOADER.replace("VIA", via)

// ---------------------------------------------------------------- the panel and its icon

write(`PackageSources/InGamePanels/crosscheck-p10.xml`, `<?xml version="1.0" encoding="Windows-1252"?>
<SimBase.Document Type="InGamePanels" version="1,0">
  <Filename>InGamePanel_CrosscheckP10.spb</Filename>
  <InGamePanels.InGamePanelDefinition id="${PANEL_ID}" Name="Crosscheck P10" url="html_UI/InGamePanels/${DIR}/p10.html" resizeDirections="None" minWidth="20" minHeight="10" defaultWidth="20" defaultHeight="10" icon="${ICON}" buttonVisible="true">
  </InGamePanels.InGamePanelDefinition>
</SimBase.Document>
`)

// The icon's markup as p05's, which loaded p05's script into the toolbar's
// document (interface/ingame/build.mjs).
write(`PackageSources/html_ui/icons/toolbar/${ICON}.svg`, `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M14 20 L32 10 L50 20 M14 44 L32 54 L50 44" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="32" y="38" font-family="Arial" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">10</text>
  <foreignObject>
    <img src onerror="${loader("toolbar icon")}"></img>
  </foreignObject>
</svg>
`)

write(`PackageSources/html_ui/InGamePanels/${DIR}/p10.html`, `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="text/javascript" src="/JS/coherent.js"></script>
  <script type="text/javascript" src="/JS/common.js"></script>
  <link rel="import" href="/templates/ingameUi/ingameUi.html" />
</head>
<body>
  <ingame-ui id="CrosscheckP10" panel-id="${PANEL_ID}" title="Crosscheck P10" class="ingameUiFrame">
    <div style="color: #ffffff; font-size: 2vh; padding: 1vh;">Crosscheck p10 probe</div>
  </ingame-ui>
</body>
</html>
`)

// ---------------------------------------------------------------- the script

// The world map's chain as p07 and p08 ran it through the inspector in mainUi
// (record/areas/interface/log.md, 2026-10-05): the airport search's view
// listener events, the store's requests by engine.call("requestData", path,
// arg), and its lists by requestArrayElements. In Coherent GT's syntax.
const SCRIPT = `// Written by experiments/areas/interface/menu/build.mjs.
// Says hello to p10 on 127.0.0.1:${PORT} from each document it loads in, and runs
// the world map's requests when p10 answers a poll with a goto.
(function () {
  if (window.CROSSCHECK_P10) return;
  var BASE = "http://127.0.0.1:${PORT}/p10";
  var CAP_MS = 60 * 60 * 1000;
  var UID = "CROSSCHECK_P10";
  var S = window.CROSSCHECK_P10 = { id: Math.floor(Math.random() * 1e9), loaded: Date.now(), via: window.CROSSCHECK_P10_INJECTED, seq: 0, polls: 0, results: [], handles: [], steps: [] };

  function post(path, body) {
    try {
      var x = new XMLHttpRequest();
      x.open("POST", BASE + path, true);
      x.setRequestHeader("Content-Type", "text/plain");
      body.id = S.id;
      x.send(JSON.stringify(body));
    } catch (e) {}
  }
  function report(step, detail) {
    var r = { step: step, t: Date.now(), detail: detail === undefined ? null : detail };
    S.steps.push(r);
    post("/report", r);
  }
  function info() {
    return { title: document.title, href: String(location.href).slice(0, 160), via: S.via, engine: typeof engine, coherent: typeof Coherent,
      loader: typeof window._globalDataLoader, registerViewListener: typeof RegisterViewListener };
  }

  function call(name, args) {
    return new Promise(function (resolve) {
      try {
        engine.call.apply(engine, [name].concat(args)).then(
          function (v) { resolve({ ok: true, value: v === undefined ? null : v }); },
          function (e) { resolve({ ok: false, error: String(e) }); });
      } catch (e) { resolve({ ok: false, error: String(e) }); }
    });
  }
  function get(path) {
    var l = window._globalDataLoader;
    if (!l) return null;
    var d = l.getData(path);
    try { return d ? JSON.parse(JSON.stringify(d.value)) : null; } catch (e) { return null; }
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function until(test, ms, every) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function check() {
        var v = test();
        if (v) return resolve(v);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(check, every || 150);
      })();
    });
  }

  function listen() {
    if (S.handles.length) return;
    var onResults = function (uid, list) { if (uid === UID) S.results.push(list); };
    try { S.handles.push(engine.on("ResultsUpdated", onResults)); } catch (e) {}
    try { S.handles.push(engine.on("EVENT_FROM_VIEW_LISTENER", function (name, ev, uid, list) { if (ev === "ResultsUpdated") onResults(uid, list); })); } catch (e) {}
  }

  function departure(icao) {
    var dep = get("game/currentFlight/gameFlight/departure");
    if (!dep || JSON.stringify(dep.worldLocation || {}).indexOf('"' + icao + '"') < 0) return null;
    var infos = dep.worldLocation.airportInfos || {};
    return (infos.taxis || []).length ? dep : null;
  }

  // The search's listener may only answer in a document that registered it,
  // as the world map's own does, so the second try registers it here first.
  function search(icao) {
    S.results.length = 0;
    engine.trigger("EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "AIRPORT_INPUT_TEXT", UID, icao, "ON_DEPARTURE_AIRPORT_SELECTED");
    return until(function () {
      var list = S.results.length ? S.results[S.results.length - 1] : null;
      if (!list) return null;
      for (var i = 0; i < list.length; i++) if (list[i].ICAO === icao) return list[i];
      return { none: list.length };
    }, 4000);
  }

  function setAirport(icao) {
    listen();
    return search(icao).then(function (hit) {
      report("search", hit ? hit : "no results in 4s");
      if (hit && !hit.none) return hit;
      if (typeof RegisterViewListener === "undefined") return null;
      try { S.viewListener = RegisterViewListener("JS_LISTENER_AIRPORT_SEARCH"); } catch (e) { report("registerViewListener", String(e)); return null; }
      return wait(1000).then(function () { return search(icao); }).then(function (again) {
        report("search after registering the listener", again ? again : "no results in 4s");
        return again && !again.none ? again : null;
      });
    }).then(function (hit) {
      if (!hit) return null;
      engine.trigger("EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "ON_DEPARTURE_AIRPORT_SELECTED", hit.index, hit.database);
      return until(function () { return departure(icao); }, 5000);
    });
  }

  function pickStand(dep, match) {
    var taxis = dep.worldLocation.airportInfos.taxis;
    var re = match ? new RegExp(match, "i") : null;
    for (var i = 0; re && i < taxis.length; i++) if (re.test(taxis[i].name)) return taxis[i];
    return taxis[Math.floor(taxis.length / 2)];
  }

  function readAircraft() {
    var path = "game/aircraft/aircraftList";
    return call("requestData", ["game/aircraft/updateAircraftList", ""]).then(function () {
      return call("requestArrayElements", [path, 0, 400]);
    }).then(function (r) {
      var n = r.ok && typeof r.value === "number" ? r.value : 0;
      var list = [];
      for (var i = 0; i < Math.min(n, 400); i++) list.push(get(path + "/" + i));
      return { reply: r, list: list };
    });
  }

  // The menu's screens, by the names their components give their buttons
  // (read in fs-base-ui 0.1.10, cookedcomps/{3A799C8C-...}.html, the start
  // page, and {D4E935FB-...}.html, the home page's tiles).
  function named(name) {
    var els = document.querySelectorAll('[name="' + name + '"]');
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0) return els[i];
    }
    return null;
  }
  function screen() {
    return { start: !!named("Startpage"), home: !!named("Homepage") && !!named("Home_TileRegular_Freeflight"), menuBar: !!named("MenuBarPage"), ready: !!exposed(["Career_ConfirmationPage", "ReadyButton"]) };
  }
  // A button by the names a page exposes, the way the page's own code takes
  // it, such as this.elt.getExposedChild("Button_Start") (read in base.bundle.js,
  // StartPageManipulator). Element names mislead: on the start screen the one
  // named TileButton_Start is Accessibility, and Start is
  // TileButton_Start_Special (p10, 2026-10-06; cookedcomps/{3A799C8C-...}.json,
  // exposedChildren).
  function exposed(path) {
    var el = named(path[0]);
    for (var i = 1; el && i < path.length; i++) el = typeof el.getExposedChild === "function" ? el.getExposedChild(path[i]) : null;
    return el || null;
  }
  // Mouse events at the button's center, on whatever element is on top there,
  // as a pilot's click would land.
  function press(path) {
    var el = exposed(path);
    if (!el) return { found: false };
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var target = document.elementFromPoint(x, y) || el;
    var types = ["mouseover", "mousedown", "mouseup", "click"];
    for (var i = 0; i < types.length; i++) {
      var ev = document.createEvent("MouseEvents");
      ev.initMouseEvent(types[i], true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);
      target.dispatchEvent(ev);
    }
    return { found: true, name: el.getAttribute("name"), x: Math.round(x), y: Math.round(y), target: target.tagName + (target.getAttribute("name") ? " " + target.getAttribute("name") : "") };
  }
  // The Start button's own handler sends this flow event (read in base.bundle.js,
  // StartPageManipulator.setButtons), and LaunchFlowEvent is
  // engine.trigger("LAUNCH_FLOW_EVENT_FROM_VIEW", ...) (read in Global/lib.js).
  function flow(args) {
    if (typeof LaunchFlowEvent === "function") { LaunchFlowEvent.apply(null, args); return "LaunchFlowEvent"; }
    engine.trigger.apply(engine, ["LAUNCH_FLOW_EVENT_FROM_VIEW"].concat(args));
    return "engine.trigger";
  }

  function readList(path, max) {
    return call("requestArrayElements", [path, 0, max]).then(function (r) {
      var n = r.ok && typeof r.value === "number" ? r.value : 0;
      var list = [];
      for (var i = 0; i < Math.min(n, max); i++) list.push(get(path + "/" + i));
      return { reply: r, list: list };
    });
  }

  function pickLivery(match) {
    return readList("game/aircraft/configurator/liveries", 100).then(function (l) {
      var pick = null;
      for (var i = 0; match && i < l.list.length; i++) if (l.list[i] && JSON.stringify(l.list[i]).toLowerCase().indexOf(match.toLowerCase()) >= 0) { pick = l.list[i]; break; }
      if (!pick && l.list.length > 1) pick = l.list[1];
      if (!pick) { report("livery", { entries: l.list.length, picked: null }); return true; }
      return call("requestData", ["game/aircraft/configurator/saveVariationId", String(pick.id)]).then(function (r) {
        return wait(800).then(function () {
          var now = get("game/aircraft/currentAircraft");
          report("livery", { entries: l.list.length, picked: JSON.stringify(pick).slice(0, 300), call: r, variation: now && (now.variationDisplayName || now.variation) });
          return true;
        });
      });
    });
  }

  function goto(cmd) {
    var t0 = Date.now();
    report("goto", { cmd: cmd, info: info() });
    return setAirport(cmd.airport).then(function (dep) {
      if (!dep) { report("departure", "not set"); return false; }
      report("departure", { ms: Date.now() - t0, taxis: dep.worldLocation.airportInfos.taxis.length });
      var stand = pickStand(dep, cmd.stand);
      return call("requestData", ["game/currentFlight/setDepartureTaxiIndex", String(stand.ID)]).then(function (r) {
        return until(function () { var d = get("game/currentFlight/gameFlight/departure"); return d && String(d.taxiIndex) === String(stand.ID) ? d : null; }, 3000).then(function (d) {
          report("stand", { name: stand.name, id: stand.ID, call: r, readBack: !!d });
          return true;
        });
      });
    }).then(function (ok) {
      if (!ok || !cmd.aircraft) return ok;
      return readAircraft().then(function (a) {
        var hit = null;
        for (var i = 0; i < a.list.length; i++) if (a.list[i] && a.list[i].displayName === cmd.aircraft) { hit = a.list[i]; break; }
        report("aircraft list", { reply: a.reply, entries: a.list.length, hit: hit });
        if (!hit) return false;
        var before = get("game/aircraft/currentAircraft");
        return call("requestData", ["game/aircraft/configurator/setAircraftForConfigurator", hit.aircraftId + "||" + hit.variationIndex]).then(function (r) {
          return wait(1000).then(function () {
            var after = get("game/aircraft/currentAircraft");
            report("aircraft", { call: r, before: before && before.displayName, after: after && after.displayName });
            return true;
          });
        });
      });
    }).then(function (ok) {
      if (!ok || cmd.livery === undefined || cmd.livery === null) return ok;
      return pickLivery(cmd.livery);
    }).then(function (ok) {
      if (!ok || !cmd.launch) return ok;
      return call("requestData", ["game/currentFlight/launchFlight", ""]).then(function (r) { report("launch", r); return true; });
    }).then(function (ok) { report("done", { ok: ok, ms: Date.now() - t0 }); }, function (e) { report("failed", String(e)); });
  }

  function poll() {
    if (Date.now() - S.loaded > CAP_MS) return;
    S.polls++;
    var x = new XMLHttpRequest();
    x.open("GET", BASE + "/next?id=" + S.id + "&since=" + S.seq, true);
    x.onload = function () {
      try {
        var cmds = JSON.parse(x.responseText || "[]");
        for (var i = 0; i < cmds.length; i++) {
          if (cmds[i].seq <= S.seq) continue;
          S.seq = cmds[i].seq;
          if (cmds[i].op === "goto") goto(cmds[i]);
          else if (cmds[i].op === "screen") report("screen", screen());
          else if (cmds[i].op === "press") report("press", { path: cmds[i].path, result: press(cmds[i].path), after: screen() });
          else if (cmds[i].op === "flow") report("flow", { args: cmds[i].args, via: flow(cmds[i].args) });
          else if (cmds[i].op === "launch") call("requestData", ["game/currentFlight/launchFlight", ""]).then(function (r) { report("launch", r); });
          else if (cmds[i].op === "hello") post("/hello", info());
        }
      } catch (e) {}
      setTimeout(poll, 500);
    };
    x.onerror = function () { setTimeout(poll, 2000); };
    x.send();
  }
  post("/hello", info());
  poll();
})();
`
check(write(`PackageSources/html_ui/InGamePanels/${DIR}/p10-menu.js`, SCRIPT))

// ---------------------------------------------------------------- Flow Pro's way, optional

let cookedcompGroup = ""
const STOCK = cookedcomps.length ? stockDir() : null
if (cookedcomps.length && !STOCK) die("No fs-base-ui/cookedcomps under any Steam library's steamapps/common/Limitless.")
for (const cookedcomp of cookedcomps) {
  const name = `{${cookedcomp.toUpperCase()}}`
  const html = path.join(STOCK, `${name}.html`)
  const json = path.join(STOCK, `${name}.json`)
  if (!fs.existsSync(html)) die(`No stock ${name}.html in ${STOCK}.`)
  const stock = fs.readFileSync(html, "utf8")
  const tag = `<svg style="display:none"><foreignObject><img src onerror="${loader(`cookedcomp ${cookedcomp}`)}"></img></foreignObject></svg>`
  // Before the component's last closing tag, so it sits inside its root
  // element, as Flow Pro's hidden svg does.
  const at = stock.lastIndexOf("</")
  if (at < 0) die(`{${cookedcomp}}.html has no closing tag to put ours before.`)
  write(`PackageSources/cookedcomps/${name}.html`, stock.slice(0, at) + tag + stock.slice(at))
  if (fs.existsSync(json)) fs.copyFileSync(json, path.join(OUT, "PackageSources", "cookedcomps", `${name}.json`))
  cookedcompGroup = `
		<AssetGroup Name="cookedcomps">
			<Type>Copy</Type>
			<Flags>
				<FSXCompatibility>false</FSXCompatibility>
			</Flags>
			<AssetDir>PackageSources\\cookedcomps\\</AssetDir>
			<OutputDir>cookedcomps\\</OutputDir>
		</AssetGroup>`
  console.log(`added our copy of {${cookedcomp}}: ${stock.length} bytes stock, ${stock.length + tag.length} ours`)
}

write(`PackageDefinitions/${NAME}.xml`, `<?xml version="1.0" encoding="utf-8"?>
<AssetPackage Version="0.1.0">
	<ItemSettings>
		<ContentType>MISC</ContentType>
		<Title>Crosscheck p10 menu package probe</Title>
		<Manufacturer/>
		<Creator>Crosscheck</Creator>
	</ItemSettings>
	<Flags>
		<VisibleInStore>false</VisibleInStore>
		<CanBeReferenced>false</CanBeReferenced>
	</Flags>
	<PackageOrderHint>UI_PATCH</PackageOrderHint>
	<AssetGroups>
		<AssetGroup Name="InGamePanels">
			<Type>SPB</Type>
			<Flags>
				<FSXCompatibility>false</FSXCompatibility>
			</Flags>
			<AssetDir>PackageSources\\InGamePanels\\</AssetDir>
			<OutputDir>InGamePanels\\</OutputDir>
		</AssetGroup>
		<AssetGroup Name="html_ui">
			<Type>Copy</Type>
			<Flags>
				<FSXCompatibility>false</FSXCompatibility>
			</Flags>
			<AssetDir>PackageSources\\html_ui\\</AssetDir>
			<OutputDir>html_ui\\</OutputDir>
		</AssetGroup>${cookedcompGroup}
	</AssetGroups>
</AssetPackage>
`)
write("project.xml", `<?xml version="1.0" encoding="utf-8"?>
<Project Version="2" Name="CrosscheckP10Menu" FolderName="Packages" MetadataFolderName="PackagesMetadata">
	<OutputDirectory>.</OutputDirectory>
	<TemporaryOutputDirectory>_PackageInt</TemporaryOutputDirectory>
	<Packages>
		<Package>PackageDefinitions\\${NAME}.xml</Package>
	</Packages>
	<PublishingGroups/>
</Project>
`)

// ---------------------------------------------------------------- package and install

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
console.log(`layout.json written: ${files.length} file(s)`)
if (argv.includes("--no-install")) process.exit(0)

const target = path.join(community(), NAME)
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(BUILT, target, { recursive: true })
console.log(`\ninstalled to Community\\${NAME}. Start MSFS: packages are read at startup.`)
