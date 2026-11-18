/*
 * The sim, as p31 drives it with nobody at it: started through Steam, taken from its first screen
 * to a flight through code the inspector runs in the menu's document, mainUi, set to a fixed time,
 * and closed again, with a crash or a hang at any step thrown as `SimDown`, so the run starts over.
 *
 * The menu's steps are the ones p10 ran from a closed sim to Ready to fly with nobody at it, and the
 * product's menu script runs: the first screen's Start, the home page's Free flight, the world map's
 * departure, aircraft, and livery through its store, Fly, then Ready to fly (measured on MSFS 2024,
 * 2026-10-06, record/areas/interface/log.md, "Our copy of BlurPage brings our script into the menu";
 * src/sim-package/pages/world-map.ts). Flow Pro presses Start and Free flight on this PC on its
 * own, so each step looks at which page is up rather than assuming the one before. The runway's
 * request, `setDepartureRunwayIndex`, is the world map's own (read in fs-base-ui 0.1.10,
 * base.bundle.js), and no run of ours has tried it.
 */

import { spawnSync } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"

import { simRunning } from "../../../../tools/lib/install.ts"
import { evaluate, listPages, type Page } from "../../../../tools/sim/inspector.ts"
import { processes, SIM_EXE } from "./measure.ts"

const STEAM_URL = "steam://rungameid/2537590"
/** What the sim starts and leaves running after it quits, which then makes Steam refuse to start it again (our notes of 2026-11-05). */
const LEFTOVERS = ["FenixBootstrapper", "TDSGTNXiFlightSimEXE", "TDSROARService", "roar", "gtn_simulator"]

/** The flight every run loads: the user's last flight's airport and runway, in the 58P and its livery N515MR. */
export const FLIGHT = { icao: "SEGS", runway: "14", folder: "bksq-aircraft-baronpropress", livery: "N515MR" }

/**
 * Where the flight starts: runway 14, where the sim puts the pilot in the cockpit with the engines
 * running, unless the world map refuses the runway, whose request no run of ours has tried. Then the
 * airport's first stand, from that run on, so every run of the schedule after it starts alike.
 */
let departure: "runway" | "stand" = "runway"
/** Noon at Seymour, on a fixed date, set after each load, since the world map keeps whatever time the pilot last chose. */
export const TIME = { year: 2026, dayOfYear: 172, localHour: 12 }

/** The sim quit or stopped answering, so the attempt starts over from a closed sim. */
export class SimDown extends Error {}

type Say = (line: string) => void

function powershell(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { encoding: "utf8" }).stdout
}

export function simPid(): number | undefined {
  return processes().find((p) => p.name.toLowerCase() === SIM_EXE.toLowerCase())?.pid
}

export function killLeftovers(): void {
  if (simRunning()) return
  powershell(`Get-Process -Name ${LEFTOVERS.join(",")} -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`)
}

/** Waits for `get` to give a value, every second, and throws `SimDown` if the sim's process `pid` ends first, or `ms` passes. */
async function until<T>(pid: number | undefined, get: () => T | undefined | null | Promise<T | undefined | null>, ms: number, what: string): Promise<T> {
  const started = Date.now()
  for (;;) {
    if (pid !== undefined && !alive(pid)) throw new SimDown(`the sim quit while the run waited for ${what}`)
    const value = await get()
    if (value !== undefined && value !== null) return value
    if (Date.now() - started > ms) throw new SimDown(`the sim never reached ${what} in ${Math.round(ms / 1000)}s`)
    await sleep(1_000)
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Starts the sim through Steam, once more if Steam ignored the first launch, and returns its process ID. */
export async function launchSim(say: Say): Promise<number> {
  killLeftovers()
  for (let attempt = 0; attempt < 2; attempt++) {
    spawnSync("cmd", ["/c", "start", "", STEAM_URL], { stdio: "ignore" })
    say(attempt === 0 ? "started the sim through Steam" : "no sim process after 60s, so the run asked Steam again")
    // Steam can ignore a launch sent seconds after the sim last quit (our notes of 2026-10-04).
    const pid = await until(undefined, () => simPid(), 60_000, "a process").catch(() => undefined)
    if (pid) return pid
  }
  throw new SimDown("Steam started no sim in two tries")
}

/**
 * Closes the sim as its window's close button does, and kills it after 3 minutes, since with nobody
 * at the PC a sim that won't quit holds every run after it.
 */
export async function closeSim(say: Say): Promise<void> {
  if (!simRunning()) return killLeftovers()
  powershell("Get-Process FlightSimulator2024 -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }")
  for (const started = Date.now(); simRunning() && Date.now() - started < 180_000; ) await sleep(2_000)
  if (simRunning()) {
    say("the sim hadn't quit 3 minutes after its close, so the run ended it")
    spawnSync("taskkill", ["/IM", SIM_EXE, "/F"], { stdio: "ignore" })
    for (const started = Date.now(); simRunning() && Date.now() - started < 30_000; ) await sleep(1_000)
  }
  killLeftovers()
  say("the sim has quit")
}

/**
 * Brings the sim's window to the front, where MSFS 2024 draws its full frame rate. Windows lets a
 * process take the foreground only right after input, so a press of Alt, which no cockpit binds
 * alone, comes first when the plain call doesn't take.
 */
export function focusSim(): boolean {
  const out = powershell(`
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class DualInputP31Focus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$p = Get-Process FlightSimulator2024 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if (-not $p) { "none"; exit }
$h = $p.MainWindowHandle
if ([DualInputP31Focus]::GetForegroundWindow() -eq $h) { "front"; exit }
[void][DualInputP31Focus]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 300
if ([DualInputP31Focus]::GetForegroundWindow() -ne $h) {
  [DualInputP31Focus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [DualInputP31Focus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][DualInputP31Focus]::ShowWindow($h, 9)
  [void][DualInputP31Focus]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 300
}
if ([DualInputP31Focus]::GetForegroundWindow() -eq $h) { "front" } else { "behind" }`)
  return out.trim() === "front"
}

/**
 * The code put into mainUi once per document, at `window.DUALINPUT_P31_MENU` (record/areas/
 * architecture/02-code-map.md, "Names the sim shares"). It runs in Coherent GT, so it keeps to
 * ES2017, and each awaited value goes into a variable before anything reads it, since Coherent GT
 * rejects `if (!await x)` (src/sim-package/pages/world-map.ts). Its calls are the ones world-map.ts
 * makes, so change both together.
 */
const MENU_JS = `(function () {
  if (window.DUALINPUT_P31_MENU) return "had";
  var UID = "DUALINPUT_P31_SEARCH";
  var m = { result: null, step: "" };
  window.DUALINPUT_P31_MENU = m;
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0; }
  function named(name) { var els = document.querySelectorAll('[name="' + name + '"]'); for (var i = 0; i < els.length; i++) if (visible(els[i])) return els[i]; return null; }
  function child(path) {
    var el = named(path[0]);
    for (var i = 1; el && i < path.length; i++) {
      var next = typeof el.getExposedChild === "function" ? el.getExposedChild(path[i]) : null;
      el = next || el.querySelector('[name="' + path[i] + '"]');
    }
    return el;
  }
  m.screen = function () {
    return { start: !!child(["Startpage", "Button_Start"]), home: !!child(["Homepage", "Tiles", "FreeflightButton"]), map: !!named("FreeFlightPage"), ready: !!child(["Career_ConfirmationPage", "ReadyButton"]), inGame: !!named("MasterPage_InGame") };
  };
  m.press = function (path) {
    var el = child(path);
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var target = document.elementFromPoint(x, y) || el;
    ["mouseover", "mousedown", "mouseup", "click"].forEach(function (type) {
      var e = document.createEvent("MouseEvents");
      e.initMouseEvent(type, true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);
      target.dispatchEvent(e);
    });
    return true;
  };
  function get(path) { var d = window._globalDataLoader && window._globalDataLoader.getData(path); return d ? JSON.parse(JSON.stringify(d.value)) : null; }
  function wait(test, ms) {
    var t0 = Date.now();
    return new Promise(function (resolve) { (function look() { var v = test(); if (v) resolve(v); else if (Date.now() - t0 > ms) resolve(null); else setTimeout(look, 150); })(); });
  }
  function timed(p) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("the store didn't answer in 10s")); }, 10000);
      p.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }
  function request(path, arg) { return timed(engine.call("requestData", path, arg)).then(function () { return true; }, function () { return false; }); }
  function readList(path) {
    return timed(engine.call("requestArrayElements", path, 0, 1000)).then(function (n) {
      var list = [];
      for (var i = 0; i < Math.min(Number(n) || 0, 1000); i++) { var e = get(path + "/" + i); if (e) list.push(e); }
      return list;
    });
  }
  var results = [];
  var listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    var heard = function (uid, list) { if (uid === UID) results.push(list); };
    engine.on("ResultsUpdated", heard);
    engine.on("EVENT_FROM_VIEW_LISTENER", function (name, event, uid, list) { if (event === "ResultsUpdated") heard(uid, list); });
  }
  function search(icao) {
    results.length = 0;
    engine.trigger("EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "AIRPORT_INPUT_TEXT", UID, icao, "ON_DEPARTURE_AIRPORT_SELECTED");
    return wait(function () { var last = results[results.length - 1] || []; for (var i = 0; i < last.length; i++) if (last[i].ICAO === icao) return last[i]; return null; }, 4000);
  }
  function departure() { return get("game/currentFlight/gameFlight/departure"); }
  m.go = function (o) {
    m.result = null;
    (async function () {
      listen();
      m.step = "airport";
      var hit = await search(o.icao);
      if (!hit && typeof RegisterViewListener === "function") {
        RegisterViewListener("JS_LISTENER_AIRPORT_SEARCH");
        var paused = await wait(function () { return null; }, 1000);
        hit = await search(o.icao);
      }
      if (!hit) throw new Error("the airport search found no " + o.icao);
      engine.trigger("EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "ON_DEPARTURE_AIRPORT_SELECTED", hit.index, hit.database);
      var at = await wait(function () {
        var d = departure();
        var infos = d && d.worldLocation && d.worldLocation.airportInfos;
        var n = infos ? (infos.taxis || []).length + (infos.runways || []).length : 0;
        return d && n > 0 && JSON.stringify(d.worldLocation).indexOf('"' + o.icao + '"') >= 0 ? d : null;
      }, 5000);
      if (!at) throw new Error("the departure didn't become " + o.icao);
      var place = null;
      if (o.departure === "runway") {
        m.step = "runway";
        var runways = at.worldLocation.airportInfos.runways || [];
        var runway = null;
        for (var i = 0; i < runways.length && !runway; i++) if (String(runways[i].name).toUpperCase().split(/[^0-9A-Z]+/).indexOf(o.runway) >= 0) runway = runways[i];
        if (runway) {
          var tookRunway = await request("game/currentFlight/setDepartureRunwayIndex", String(runway.ID));
          var onRunway = await wait(function () { var d = departure(); return d && d.runwayIndex === runway.ID ? d : null; }, 5000);
          if (tookRunway && onRunway) place = "runway " + runway.name;
        }
        if (!place && !o.standIfNeeded) throw new Error("the departure didn't take runway " + o.runway + " of " + runways.map(function (r) { return r.name; }).join(", "));
      }
      if (!place) {
        m.step = "stand";
        var stands = at.worldLocation.airportInfos.taxis || [];
        var stand = stands[0];
        if (!stand) throw new Error(o.icao + " lists no stand");
        var tookStand = await request("game/currentFlight/setDepartureTaxiIndex", String(stand.ID));
        var onStand = await wait(function () { var d = departure(); return d && d.taxiIndex === stand.ID ? d : null; }, 5000);
        if (!tookStand || !onStand) throw new Error("the departure took neither runway " + o.runway + " nor the stand " + stand.name);
        place = "stand " + stand.name;
      }
      m.step = "aircraft";
      var updated = await request("game/aircraft/updateAircraftList", "");
      var list = await readList("game/aircraft/aircraftList");
      var found = null;
      for (var j = 0; j < list.length && !found; j++) {
        var folder = /\\/SimObjects\\/Airplanes\\/([^/]+)\\//i.exec(list[j].thumbnailPath || "");
        if (list[j].isUsable !== false && folder && folder[1].toLowerCase() === o.folder) found = list[j];
      }
      if (!found) throw new Error("the aircraft list holds nothing in " + o.folder);
      var tookAircraft = await request("game/aircraft/configurator/setAircraftForConfigurator", found.aircraftId + "||" + found.variationIndex);
      if (!tookAircraft) throw new Error("the store refused the aircraft");
      var current = await wait(function () { var c = get("game/aircraft/currentAircraft"); return c && c.aircraftId === found.aircraftId ? c : null; }, 5000);
      if (!current) throw new Error("the world map didn't take the aircraft");
      m.step = "livery";
      var liveries = await readList("game/aircraft/configurator/liveries");
      var livery = null;
      for (var k = 0; k < liveries.length && !livery; k++) if (String(liveries[k].title || "").toLowerCase() === o.livery.toLowerCase()) livery = liveries[k];
      if (livery) { var tookLivery = await request("game/aircraft/configurator/saveVariationId", String(livery.id)); }
      m.step = "launch";
      var launched = await request("game/currentFlight/launchFlight", "");
      if (!launched) throw new Error("the store refused the flight's start");
      m.result = { ok: true, place: place, livery: livery ? livery.title : "the aircraft's own" };
    })().catch(function (e) { m.result = { ok: false, step: m.step, why: String((e && e.message) || e) }; });
    return "started";
  };
  return "put";
})()`

type Screen = { start: boolean; home: boolean; map: boolean; ready: boolean; inGame: boolean }

/** mainUi, once the inspector lists it and it takes our code. */
async function mainUi(): Promise<Page | undefined> {
  const page = (await listPages()).find((p) => /mainui\.html/i.test(p.url))
  if (!page) return undefined
  try {
    await evaluate<string>(page, MENU_JS)
    return page
  } catch {
    return undefined
  }
}

async function menu<T>(expression: string): Promise<T | undefined> {
  const page = await mainUi()
  if (!page) return undefined
  return evaluate<T>(page, `(function () { var m = window.DUALINPUT_P31_MENU; return ${expression}; })()`).catch(() => undefined)
}

const screen = () => menu<Screen>("m.screen()")
const press = (path: string[]) => menu<boolean>(`m.press(${JSON.stringify(path)})`)

/**
 * Takes the sim `pid` from wherever its menu is to the 58P on runway 14 at Seymour, in the cockpit
 * with the user in control, and returns what it set. p10 reached its script in mainUi 132s after the
 * launch and Ready to fly 32s after that, so each wait allows a few times as long.
 */
export async function loadFlight(pid: number, say: Say): Promise<string[]> {
  const said: string[] = []
  const once = new Set<string>()
  const step = (line: string) => {
    if (once.has(line)) return
    once.add(line)
    said.push(line)
    say(line)
  }
  await until(pid, async () => {
    const now = await screen()
    return now && Object.values(now).some(Boolean) ? now : undefined
  }, 8 * 60_000, "its first screen")
  // Each page gets its action at most every few seconds, since a press takes a moment to change the page.
  const last = new Map<string, number>()
  const due = (action: string, every: number) => {
    const at = last.get(action)
    if (at !== undefined && Date.now() - at < every) return false
    last.set(action, Date.now())
    return true
  }
  let flown = false
  let tries = 0
  for (const deadline = Date.now() + 12 * 60_000; ; await sleep(1_000)) {
    if (!alive(pid)) throw new SimDown("the sim quit while it loaded the flight")
    if (Date.now() > deadline) throw new SimDown("the sim didn't reach the flight within 12 minutes of its first screen")
    const s = await screen()
    if (!s) continue
    if (s.inGame && !s.ready) break
    if (s.ready) {
      // Ready to fly can be up before the flight has loaded, so it's pressed every 5s until the in-game page shows, as p10 pressed it.
      if (due("ready", 5_000)) await press(["Career_ConfirmationPage", "ReadyButton"])
      step("pressed Ready to fly")
    } else if (s.map && !flown && due("fly", 10_000)) {
      // The world map's store fills in a moment after the page shows; p10 waited 3s, and tried its requests up to 6 times.
      await sleep(3_000)
      await menu<string>(`m.go(${JSON.stringify({ ...FLIGHT, departure, standIfNeeded: true })})`)
      const went = await until(pid, () => menu<{ ok: boolean; step?: string; why?: string; place?: string; livery?: string } | null>("m.result"), 90_000, "the world map's requests")
      tries++
      if (went.ok) {
        flown = true
        if (departure === "runway" && went.place?.startsWith("stand")) {
          departure = "stand"
          step(`the world map refused runway ${FLIGHT.runway}, so this run and every later one start at the stand`)
        }
        step(`set ${FLIGHT.icao}, the ${went.place}, the 58P, and the livery ${went.livery}, and pressed Fly`)
      } else if (tries >= 4) throw new SimDown(`the world map's ${went.step} failed four times, last: ${went.why}`)
      else say(`the world map's ${went.step} failed, try ${tries}: ${went.why}`)
    } else if (s.home && due("free flight", 10_000)) {
      await press(["Homepage", "Tiles", "FreeflightButton"])
      step("pressed Free flight")
    } else if (s.start && due("start", 10_000)) {
      await press(["Startpage", "Button_Start"])
      step("pressed Start")
    }
  }
  step("in the flight")
  for (const line of await settleFlight(pid)) step(line)
  return said
}

/** The first cockpit panel that answers, which runs `SimVar`, found again on each try. */
async function inPanel<T>(expression: string): Promise<T | undefined> {
  for (const page of (await listPages()).filter((p) => /^VCockpit/i.test(p.title))) {
    try {
      return await evaluate<T>(page, expression)
    } catch {
      // A panel that's reloading answers nothing for a moment.
    }
  }
  return undefined
}

/**
 * Sets the fixed time, and the cockpit view if the flight started elsewhere. The time events held
 * when SimConnect sent them (measured on MSFS 2024, 2026-10-03, record/areas/environment/log.md);
 * from a panel's `SimVar`, as here, they're unverified, so the time is read back and reported.
 */
async function settleFlight(pid: number): Promise<string[]> {
  await until(pid, () => inPanel<number>("1"), 120_000, "a cockpit panel")
  const set = `(function () {
    SimVar.SetSimVarValue("K:ZULU_YEAR_SET", "number", ${TIME.year});
    SimVar.SetSimVarValue("K:ZULU_DAY_SET", "number", ${TIME.dayOfYear});
    SimVar.SetSimVarValue("K:CLOCK_HOURS_SET", "number", ${TIME.localHour});
    SimVar.SetSimVarValue("K:ZULU_MINUTES_SET", "number", 0);
    return 0;
  })()`
  await inPanel(set)
  await sleep(2_000)
  const local = await inPanel<number>(`SimVar.GetSimVarValue("E:LOCAL TIME", "hours")`)
  let camera = await inPanel<number>(`SimVar.GetSimVarValue("A:CAMERA STATE", "number")`)
  const lines = [`the local time reads ${local === undefined ? "nothing" : `${Math.floor(local)}:${String(Math.round((local % 1) * 60)).padStart(2, "0")}`} after setting ${TIME.localHour}:00`]
  // CAMERA STATE 2 is the cockpit; a write of 2 held in p01's run, with ChasePlane running (record/areas/aircraft/log.md, 2026-10-01).
  if (camera !== 2) {
    await inPanel(`SimVar.SetSimVarValue("A:CAMERA STATE", "number", 2)`)
    await sleep(2_000)
    const before = camera
    camera = await inPanel<number>(`SimVar.GetSimVarValue("A:CAMERA STATE", "number")`)
    lines.push(`the camera read ${before}, not the cockpit's 2, and reads ${camera} after setting 2`)
  } else lines.push("the camera is in the cockpit")
  return lines
}
