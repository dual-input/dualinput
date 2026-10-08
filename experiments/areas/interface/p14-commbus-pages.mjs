/*
 * p14: whether the CommBus carries a message from a SimConnect client to the
 * pages p13 found it didn't reach, the menu's page, mainUi, above all. Node
 * 1.2.1 of the architecture plan (record/areas/architecture/plan.md): if every
 * page can hear the core's answer on the CommBus, a page asks the core for its
 * port there, and no port is fixed or kept in an L: variable.
 *
 *   node experiments/areas/interface/p14-commbus-pages.mjs
 *
 * With a flight loaded and crosscheck-p13-links in Community
 * (links/build.mjs); about a minute, through the inspector, with nothing for
 * the pilot to do.
 *
 * p13's second run found that a page's CROSSCHECK_P13_ASK reached the probe
 * through SimConnect's CommBus from mainUi and every other page but
 * "transition", while the probe's CROSSCHECK_P13_HELLO, called for JavaScript,
 * reached only the two pages that registered with the sim's own
 * RegisterCommBusListener: the EFB's and a cockpit panel's
 * (results/p13-sim-links-2026-10-08-13-54-50.txt). Elsewhere p13 registered
 * the view listener by hand on engine and listened for the event by name, and
 * heard nothing. The sim's listeners take events by two routes: common.js's
 * ViewListener listens for each event by name and for EVENT_FROM_VIEW_LISTENER
 * carrying the listener's name, and mainUi's own, in Global/lib.js, only for
 * EVENT_FROM_VIEW_LISTENER, after it triggers ADD_VIEW_LISTENER and hears
 * VIEW_LISTENER_REGISTERED (read in fs-base-ui, html_ui/JS/common.js and
 * html_ui/Global/lib.js, ViewListenerMgr). So in each page this tries:
 *   1. common.js's way, RegisterCommBusListener, loading the sim's
 *      Services/CommBus.js first where the page has common.js but not it, as
 *      the toolbar and our panel do;
 *   2. engine's way, where the page can't take the first: ADD_VIEW_LISTENER, then
 *      counting VIEW_LISTENER_REGISTERED, the event by name, and
 *      EVENT_FROM_VIEW_LISTENER for JS_LISTENER_COMM_BUS, each apart.
 * The probe calls CROSSCHECK_P14_HELLO for JavaScript every 500ms, and each
 * page asks once with CROSSCHECK_P14_ASK, which the probe subscribes to.
 * It runs in every page but the cockpit panels, and in one of those as a
 * control, and opens our panel from the toolbar's document as p13 does.
 * Nothing it adds is in the pilot's input path.
 */

import { CommBusBroadcastTo } from "node-simconnect"

import { Recorder, plural, repoRelative, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { Inspector, listPages } from "../../tools/inspector.mjs"

const ASK = "CROSSCHECK_P14_ASK"
const HELLO = "CROSSCHECK_P14_HELLO"
const ASK_EVENT_ID = 7_014
const HELLO_EVERY_MS = 500
const LISTEN_MS = 6_000
const PANEL_ID = "PANEL_CROSSCHECK_P13"

const rec = new Recorder("p14-commbus-pages", { area: "interface" })

// Runs in Coherent GT: no arrow functions, optional chaining, or ??
// (CLAUDE.md, "Before writing code that runs in a panel").
const SETUP = (label) => `(function () {
  var r = window.CROSSCHECK_P14 = { label: ${JSON.stringify(label)}, coherent: typeof Coherent, engine: typeof engine, commonJs: typeof RegisterViewListenerT, commBusJs: typeof RegisterCommBusListener,
    a: { tried: false, loaded: null, ready: false, heard: 0, asked: false, askOk: null }, b: { tried: false, registered: 0, byName: 0, fromView: 0, fromViewOther: 0, last: null, asked: false, askOk: null }, errors: [], handles: [] };
  function ask(call, s) {
    try {
      var p = call("COMM_BUS_SIMCONNECT_CALLBACK", ${JSON.stringify(ASK)}, JSON.stringify({ from: r.label, way: s === r.a ? "common.js" : "engine" }));
      s.asked = true;
      if (p && p.then) p.then(function () { s.askOk = true; }, function (e) { s.askOk = false; r.errors.push("ask rejected: " + JSON.stringify(e)); });
    } catch (e) { r.errors.push("ask: " + e.message); }
  }
  function viaCommonJs() {
    r.a.tried = true;
    var l = r.a.listener = RegisterCommBusListener(function () { r.a.ready = true; setTimeout(function () { ask(function (n, x, y) { return l.call(n, x, y); }, r.a); }, 0); });
    r.a.onHello = function () { r.a.heard++; };
    l.on(${JSON.stringify(HELLO)}, r.a.onHello);
  }
  try {
    if (typeof RegisterCommBusListener !== "undefined") viaCommonJs();
    else if (typeof RegisterViewListenerT !== "undefined" && typeof Coherent !== "undefined") {
      var s = document.createElement("script");
      s.src = "coui://html_ui/JS/Services/CommBus.js";
      s.onload = function () { r.a.loaded = true; try { viaCommonJs(); } catch (e) { r.errors.push("common.js way: " + e.message); } };
      s.onerror = function () { r.a.loaded = false; };
      document.head.appendChild(s);
    }
  } catch (e) { r.errors.push("common.js way: " + e.message); }
  var commonJsPossible = typeof RegisterCommBusListener !== "undefined" || (typeof RegisterViewListenerT !== "undefined" && typeof Coherent !== "undefined");
  try {
    if (!commonJsPossible && typeof engine !== "undefined") {
      r.b.tried = true;
      r.handles.push(engine.on("VIEW_LISTENER_REGISTERED", function (name) { if (String(name).toUpperCase() === "JS_LISTENER_COMM_BUS") r.b.registered++; }));
      r.handles.push(engine.on(${JSON.stringify(HELLO)}, function () { r.b.byName++; }));
      r.handles.push(engine.on("EVENT_FROM_VIEW_LISTENER", function (listener, name) {
        if (String(listener).toUpperCase() !== "JS_LISTENER_COMM_BUS") return;
        if (name === ${JSON.stringify(HELLO)}) { r.b.fromView++; r.b.last = String(arguments[2]).slice(0, 80); } else r.b.fromViewOther++;
      }));
      engine.trigger("ADD_VIEW_LISTENER", "JS_LISTENER_COMM_BUS", window.location.pathname);
      setTimeout(function () { ask(function (n, x, y) { return engine.call(n, x, y); }, r.b); }, 1000);
    }
  } catch (e) { r.errors.push("engine way: " + e.message); }
  return "started";
})()`

// Takes our handlers out and leaves the page's own listeners as they were;
// the native JS_LISTENER_COMM_BUS listener that the engine way added stays, as
// the sim's own code keeps one per page.
const READ = `(function () {
  var r = window.CROSSCHECK_P14;
  if (!r) return null;
  var out = { label: r.label, coherent: r.coherent, engine: r.engine, commonJs: r.commonJs, commBusJs: r.commBusJs, errors: r.errors,
    a: { tried: r.a.tried, loaded: r.a.loaded, ready: r.a.ready, heard: r.a.heard, asked: r.a.asked, askOk: r.a.askOk },
    b: { tried: r.b.tried, registered: r.b.registered, byName: r.b.byName, fromView: r.b.fromView, fromViewOther: r.b.fromViewOther, last: r.b.last, asked: r.b.asked, askOk: r.b.askOk } };
  try { if (r.a.listener && r.a.onHello) r.a.listener.off(${JSON.stringify(HELLO)}, r.a.onHello); } catch (e) {}
  for (var i = 0; i < r.handles.length; i++) { try { if (r.handles[i] && r.handles[i].clear) r.handles[i].clear(); } catch (e) {} }
  window.CROSSCHECK_P14 = undefined;
  return out;
})()`

const label = (p) => String(p.title || "") || String(p.url || "").split("/").slice(-2).join("/") || `page ${p.id}`

async function inPage(page, expression) {
  const insp = new Inspector(page.id)
  try {
    await insp.open()
    return { ok: true, value: await insp.evaluate(expression) }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    insp.close()
  }
}

async function main() {
  rec.open()
  const sim = await Sim.connect(rec, { name: "CROSSCHECK p14 commbus pages" })
  const asks = []
  sim.handle.on("commBusEvent", (e) => {
    asks.push(e.data)
    rec.log("commbus", `${ASK}: ${e.data}`, { eventId: e.eventId, data: e.data })
  })
  sim.send(`subscribe ${ASK}`, () => sim.handle.subscribeToCommBusEvent(ASK_EVENT_ID, ASK))

  let pages = await listPages()
  const toolbar = pages.find((p) => /toolbar/i.test(String(p.title)) || /toolbar/i.test(String(p.url)))
  if (toolbar && !pages.some((p) => /CrosscheckP13/i.test(String(p.url)))) {
    rec.log("panel", `TOOLBAR_BUTTON_TOGGLE: ${JSON.stringify(await inPage(toolbar, `(function () { Coherent.call("TOOLBAR_BUTTON_TOGGLE", ${JSON.stringify(PANEL_ID)}, true); return "called"; })()`))}`)
    await sleep(4000)
    pages = await listPages()
  }
  let control = false
  const targets = pages.filter((p) => {
    if (!/^VCockpit/i.test(String(p.title))) return true
    if (control) return false
    control = true
    return true
  })
  rec.log("pages", `${plural(targets.length, "page")}: ${targets.map(label).join(" | ")}`)

  const hello = setInterval(() => {
    if (!sim.gone) sim.send(`call ${HELLO}`, () => sim.handle.callCommBusEvent(HELLO, CommBusBroadcastTo.JS, JSON.stringify({ port: 1, at: Date.now() })))
  }, HELLO_EVERY_MS)
  const started = []
  for (const p of targets) {
    const r = await inPage(p, SETUP(label(p)))
    if (r.ok) started.push(p)
    else rec.log("page", `${label(p)}: couldn't run: ${r.error}`)
  }
  await sleep(LISTEN_MS)
  clearInterval(hello)

  const rows = []
  for (const p of started) {
    const r = await inPage(p, READ)
    const v = r.ok ? r.value : { label: label(p), error: r.error }
    rows.push(v)
    rec.log("page", `${label(p)}: ${JSON.stringify(v)}`, { page: label(p), url: p.url, result: v })
  }
  if (toolbar) await inPage(toolbar, `(function () { Coherent.call("TOOLBAR_BUTTON_TOGGLE", ${JSON.stringify(PANEL_ID)}, false); return "called"; })()`)

  const way = (s, name) => !s?.tried ? null
    : name === "a" ? `common.js${s.loaded === true ? " (CommBus.js loaded)" : s.loaded === false ? " (CommBus.js failed to load)" : ""}: ready ${s.ready}, heard ${s.heard}, asked ${s.asked}${s.askOk === null ? "" : `, ${s.askOk ? "resolved" : "rejected"}`}`
      : `engine: registered ${s.registered}, by name ${s.byName}, from the view listener ${s.fromView}${s.fromViewOther ? ` (+${s.fromViewOther} other)` : ""}${s.last ? ` (last ${s.last})` : ""}, asked ${s.asked}${s.askOk === null ? "" : `, ${s.askOk ? "resolved" : "rejected"}`}`
  const lines = [
    `p14-commbus-pages, ${new Date(rec.started).toISOString()}`,
    `Sim: ${sim.version}. ${HELLO} called for JavaScript every ${HELLO_EVERY_MS}ms for ${LISTEN_MS / 1000}s after the last page was set up.`,
    "",
    "By page:",
    ...rows.map((r) => `- ${r.label}: Coherent ${r.coherent}, common.js ${r.commonJs}, CommBus.js ${r.commBusJs}; ${[way(r.a, "a"), way(r.b, "b")].filter(Boolean).join("; ") || "no way tried"}${r.errors?.length ? `; errors: ${r.errors.join("; ")}` : ""}${r.error ? `; couldn't read: ${r.error}` : ""}`),
    "",
    `${ASK} calls that reached the probe through SimConnect's CommBus:`,
    ...(asks.length ? asks.map((a) => `- ${a}`) : ["- none"]),
  ]
  rec.writeReport(lines.join("\n"))
  console.log("\n" + lines.join("\n"))
  console.log(`\nsaved ${repoRelative(rec.files.txt)} and the .ndjson beside it`)
  sim.close()
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  console.error(e.stack ?? String(e))
  await rec.close()
  process.exit(1)
})
