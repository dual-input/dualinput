/*
 * p15: what p13 and p14 left unmeasured about how the sim's pages reach the
 * core, which node 1.2's answer leans on (record/areas/architecture/plan.md;
 * record/areas/interface/log.md, 2026-10-08):
 *   1. whether Node's own WebSocket client sends an Origin, which decides
 *      whether the core's Origin check lets our apps in;
 *   2. the CommBus handshake in every cockpit panel, where p14 tried one of
 *      the PA-24's 16, and in the pages whose listener never reported ready,
 *      asking anyway;
 *   3. whether a page's WebSocket closes when the page goes away: our banner
 *      panel closed, which destroys its page (interface log, 2026-10-04), a
 *      cockpit panel reloaded, and every cockpit panel at once when the pilot
 *      leaves the flight;
 *   4. the CommBus handshake in the main menu, before any flight, where the
 *      menu script does it and p14 never ran.
 *
 *   node experiments/areas/interface/p15-links-coverage.mjs
 *
 * With a flight loaded and crosscheck-p13-links in Community (links/build.mjs).
 * It runs steps 1 to 3 by itself, then beeps and asks the pilot to go to the
 * main menu, waits until the inspector lists no cockpit panel, and runs step 4.
 *
 * The CommBus code is p14's (p14-commbus-pages.mjs): the sim's
 * RegisterCommBusListener, after loading Services/CommBus.js where a page has
 * common.js but not it, and otherwise ADD_VIEW_LISTENER on engine with
 * EVENT_FROM_VIEW_LISTENER, as mainUi's own view listeners take events (read
 * in fs-base-ui 0.1.10, html_ui/Global/lib.js, ViewListenerMgr). A page that
 * hasn't heard ready after 1.5s asks anyway.
 *
 * The panel it reloads is one of the PA-24's GNS_DISABLED panels, a disabled
 * GNS that draws nothing, so the reload costs the aircraft nothing. Nothing it
 * adds is in the pilot's input path.
 */

import { createHash } from "node:crypto"
import { createServer } from "node:http"

import { CommBusBroadcastTo } from "node-simconnect"

import { Recorder, plural, repoRelative, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { Inspector, listPages } from "../../tools/inspector.mjs"
import { startBeeper, startSpeaker } from "../../tools/guide.mjs"

const ASK = "CROSSCHECK_P15_ASK"
const HELLO = "CROSSCHECK_P15_HELLO"
const ASK_EVENT_ID = 7_015
const HELLO_EVERY_MS = 500
const LISTEN_MS = 6_000
const GONE_WAIT_MS = 6_000
const MENU_WAIT_MS = 10 * 60_000
const PANEL_ID = "PANEL_CROSSCHECK_P13"

const rec = new Recorder("p15-links-coverage", { area: "interface" })
const findings = []
const find = (text, fields = {}) => { findings.push(text); rec.log("finding", text, fields) }

// ---------------------------------------------------------------- the server

// A WebSocket server's minimum, from RFC 6455, as p13 serves it, recording
// when each socket's close frame came and when its connection ended.
const accept = (key) => createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
const sockets = []
const http = createServer((req, res) => { res.writeHead(404); res.end() })
http.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://127.0.0.1")
  const s = { from: url.searchParams.get("from") ?? "?", kind: url.searchParams.get("kind") ?? "?", origin: req.headers.origin ?? null, openedAt: Date.now(), closeFrameAt: null, endedAt: null }
  sockets.push(s)
  rec.log("socket", `${s.kind} from ${s.from}, origin ${s.origin ?? "none"}`, { from: s.from, kind: s.kind, origin: s.origin })
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept(req.headers["sec-websocket-key"])}\r\n\r\n`)
  socket.on("data", (d) => {
    // A close frame has opcode 8 in its first byte's low four bits.
    if ((d[0] & 0x0f) === 8 && !s.closeFrameAt) { s.closeFrameAt = Date.now(); socket.end() }
  })
  const ended = () => { if (!s.endedAt) { s.endedAt = Date.now(); rec.log("closed", `${s.kind} from ${s.from}: ${s.closeFrameAt ? "close frame, then" : "no close frame,"} connection ended`, { from: s.from, kind: s.kind, closeFrame: !!s.closeFrameAt }) } }
  socket.on("close", ended)
  socket.on("error", ended)
})

// ---------------------------------------------------------------- in each page

// Runs in Coherent GT: no arrow functions, optional chaining, or ??
// (CLAUDE.md, "Before writing code that runs in a panel").
const COMMBUS = (label) => `(function () {
  var r = window.CROSSCHECK_P15 = { label: ${JSON.stringify(label)}, way: null, loaded: null, ready: false, heard: 0, fromView: 0, asked: false, askedBeforeReady: false, askOk: null, errors: [], handles: [] };
  function ask(call) {
    if (r.asked) return;
    try {
      var p = call("COMM_BUS_SIMCONNECT_CALLBACK", ${JSON.stringify(ASK)}, JSON.stringify({ from: r.label, way: r.way, beforeReady: !r.ready }));
      r.asked = true;
      r.askedBeforeReady = !r.ready;
      if (p && p.then) p.then(function () { r.askOk = true; }, function (e) { r.askOk = false; r.errors.push("ask rejected: " + JSON.stringify(e)); });
    } catch (e) { r.errors.push("ask: " + e.message); }
  }
  function viaCommonJs() {
    r.way = "common.js";
    var l = r.listener = RegisterCommBusListener(function () { r.ready = true; setTimeout(function () { ask(function (n, x, y) { return l.call(n, x, y); }); }, 0); });
    r.onHello = function () { r.heard++; };
    l.on(${JSON.stringify(HELLO)}, r.onHello);
    setTimeout(function () { ask(function (n, x, y) { return l.call(n, x, y); }); }, 1500);
  }
  try {
    if (typeof RegisterCommBusListener !== "undefined") viaCommonJs();
    else if (typeof RegisterViewListenerT !== "undefined" && typeof Coherent !== "undefined") {
      var s = document.createElement("script");
      s.src = "coui://html_ui/JS/Services/CommBus.js";
      s.onload = function () { r.loaded = true; try { viaCommonJs(); } catch (e) { r.errors.push("common.js way: " + e.message); } };
      s.onerror = function () { r.loaded = false; };
      document.head.appendChild(s);
    } else if (typeof engine !== "undefined") {
      r.way = "engine";
      r.handles.push(engine.on("EVENT_FROM_VIEW_LISTENER", function (listener, name) {
        if (String(listener).toUpperCase() === "JS_LISTENER_COMM_BUS" && name === ${JSON.stringify(HELLO)}) r.fromView++;
      }));
      engine.trigger("ADD_VIEW_LISTENER", "JS_LISTENER_COMM_BUS", window.location.pathname);
      setTimeout(function () { ask(function (n, x, y) { return engine.call(n, x, y); }); }, 1000);
    } else r.way = "none";
  } catch (e) { r.errors.push("setup: " + e.message); }
  return "started";
})()`

// Takes our handlers out; the page's own listeners keep theirs
// (record/areas/commbus/log.md, 2026-09-28).
const COMMBUS_READ = `(function () {
  var r = window.CROSSCHECK_P15;
  if (!r) return null;
  var out = { label: r.label, way: r.way, loaded: r.loaded, ready: r.ready, heard: r.heard + r.fromView, asked: r.asked, askedBeforeReady: r.askedBeforeReady, askOk: r.askOk, errors: r.errors };
  try { if (r.listener && r.onHello) r.listener.off(${JSON.stringify(HELLO)}, r.onHello); } catch (e) {}
  for (var i = 0; i < r.handles.length; i++) { try { if (r.handles[i] && r.handles[i].clear) r.handles[i].clear(); } catch (e) {} }
  window.CROSSCHECK_P15 = undefined;
  return out;
})()`

// A socket the page never closes itself, so only the page going away can.
const GONE = (port, label) => `(function () {
  window.CROSSCHECK_P15_GONE = new WebSocket("ws://127.0.0.1:${port}/?kind=gone&from=" + encodeURIComponent(${JSON.stringify(label)}));
  return "opened";
})()`

const label = (p) => String(p.title || "") || String(p.url || "").split("/").slice(-2).join("/") || `page ${p.id}`
const cockpit = (p) => /^VCockpit/i.test(String(p.title))

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

// ---------------------------------------------------------------- the run

const run = { sim: null, asks: [], commbus: { flight: [], menu: [] }, gone: [] }

async function commbusIn(when, pages) {
  const hello = setInterval(() => {
    if (!run.sim.gone) run.sim.send(`call ${HELLO}`, () => run.sim.handle.callCommBusEvent(HELLO, CommBusBroadcastTo.JS, JSON.stringify({ at: Date.now() })))
  }, HELLO_EVERY_MS)
  const started = []
  for (const p of pages) {
    const r = await inPage(p, COMMBUS(`${when}: ${label(p)}`))
    if (r.ok) started.push(p)
    else rec.log("page", `${when}: ${label(p)}: couldn't run: ${r.error}`)
  }
  await sleep(LISTEN_MS)
  clearInterval(hello)
  const rows = []
  for (const p of started) {
    const r = await inPage(p, COMMBUS_READ)
    const v = r.ok && r.value ? r.value : { label: `${when}: ${label(p)}`, error: r.ok ? "no state" : r.error }
    rows.push(v)
    rec.log("commbus", `${v.label}: ${JSON.stringify(v)}`, { when, result: v })
  }
  const asked = (v) => run.asks.some((a) => { try { return JSON.parse(a).from === v.label } catch { return false } })
  for (const v of rows) v.reachedCore = asked(v)
  const both = rows.filter((v) => v.heard > 0 && v.reachedCore)
  find(`${when}: ${both.length} of ${plural(rows.length, "page")} both heard the core and reached it over the CommBus.`)
  return rows
}

async function goneAfter(label_, act) {
  const before = sockets.length
  const t0 = Date.now()
  await act()
  await sleep(GONE_WAIT_MS)
  const mine = sockets.slice(0, before).filter((s) => s.kind === "gone" && s.from === label_)
  const s = mine[mine.length - 1]
  const row = { what: label_, closed: !!s?.endedAt, closeFrame: !!s?.closeFrameAt, ms: s?.endedAt ? s.endedAt - t0 : null }
  run.gone.push(row)
  find(`${label_}: ${row.closed ? `its socket ${row.closeFrame ? "sent a close frame and" : "sent no close frame, and"} ended ${row.ms}ms after` : `its socket was still open ${GONE_WAIT_MS / 1000}s after`}.`)
}

async function main() {
  rec.open()
  const beep = startBeeper()
  const say = startSpeaker()
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve))
  const port = http.address().port
  rec.log("serve", `serving on 127.0.0.1:${port}`)

  // ------------------------------------------------ 1. Node's own client

  const node = new WebSocket(`ws://127.0.0.1:${port}/?kind=node&from=${encodeURIComponent(`Node ${process.version}`)}`)
  await new Promise((resolve) => { node.onopen = resolve; node.onerror = resolve; setTimeout(resolve, 2000) })
  node.close()
  const n = sockets.find((s) => s.kind === "node")
  find(`Node ${process.version}'s built-in WebSocket sent ${n ? (n.origin ? `the Origin ${n.origin}` : "no Origin") : "nothing the server saw"}.`)

  const sim = run.sim = await Sim.connect(rec, { name: "CROSSCHECK p15 links coverage" })
  sim.handle.on("commBusEvent", (e) => { run.asks.push(e.data); rec.data("ask", `${ASK}: ${e.data}`, { data: e.data }) })
  sim.send(`subscribe ${ASK}`, () => sim.handle.subscribeToCommBusEvent(ASK_EVENT_ID, ASK))
  const flows = []
  sim.flowHandlers.add((name) => flows.push({ name, at: Date.now() }))

  // ------------------------------------------------ 2. the CommBus in a flight

  let pages = await listPages()
  if (!pages.some(cockpit)) throw new Error("no cockpit panels listed; load a flight first")
  run.commbus.flight = await commbusIn("flight", pages)

  // ------------------------------------------------ 3. sockets when a page goes away

  const toolbar = pages.find((p) => /toolbar/i.test(String(p.title)) || /toolbar/i.test(String(p.url)))
  if (toolbar) {
    await inPage(toolbar, `(function () { Coherent.call("TOOLBAR_BUTTON_TOGGLE", ${JSON.stringify(PANEL_ID)}, true); return "called"; })()`)
    await sleep(4000)
    const ours = (await listPages()).find((p) => /CrosscheckP13/i.test(String(p.url)))
    if (ours) {
      await inPage(ours, GONE(port, "our banner panel, closed"))
      await sleep(1000)
      await goneAfter("our banner panel, closed", () => inPage(toolbar, `(function () { Coherent.call("TOOLBAR_BUTTON_TOGGLE", ${JSON.stringify(PANEL_ID)}, false); return "called"; })()`))
    } else find("Our panel didn't open, so its socket wasn't tried.")
  } else find("No toolbar page, so our panel's socket wasn't tried.")

  pages = await listPages()
  const gns = pages.find((p) => /GNS_DISABLED/i.test(String(p.title)))
  if (gns) {
    await inPage(gns, GONE(port, `${label(gns)}, reloaded`))
    await sleep(1000)
    await goneAfter(`${label(gns)}, reloaded`, () => inPage(gns, "(function () { setTimeout(function () { location.reload(); }, 0); return 'reloading'; })()"))
  } else find("No GNS_DISABLED panel, so no cockpit panel was reloaded.")

  pages = await listPages()
  const panels = pages.filter(cockpit)
  for (const p of panels) await inPage(p, GONE(port, `${label(p)}, left with the flight`))
  await sleep(1000)
  const leaving = sockets.length

  beep(880, 150)
  say("Go to the main menu.")
  console.log("\n▶ Go to the main menu: Escape, then quit to the main menu. The probe goes on by itself once the cockpit is gone.")
  const t0 = Date.now()
  let goneAt = null
  while (Date.now() - t0 < MENU_WAIT_MS) {
    try {
      const now = await listPages()
      if (!now.some(cockpit) && now.some((p) => /mainUi/i.test(String(p.title)))) { goneAt = Date.now(); break }
    } catch { /* the inspector answers again once the menu loads */ }
    await sleep(1000)
  }
  const left = sockets.slice(0, leaving).filter((s) => s.kind === "gone" && /left with the flight/.test(s.from))
  const ended = left.filter((s) => s.endedAt)
  const framed = ended.filter((s) => s.closeFrameAt)
  const spread = ended.map((s) => s.endedAt - t0)
  find(`Leaving the flight: ${ended.length} of ${plural(left.length, "cockpit panel socket")} ended (${framed.length} with a close frame), ${spread.length ? `${Math.round(Math.min(...spread) / 1000)}s to ${Math.round(Math.max(...spread) / 1000)}s after the prompt` : "none"}; the inspector listed no cockpit panel ${goneAt ? `${Math.round((goneAt - t0) / 1000)}s after it` : "within the wait"}.`)
  rec.log("flows", `flow events since the prompt: ${flows.filter((f) => f.at >= t0).map((f) => `${f.name} +${Math.round((f.at - t0) / 1000)}s`).join(", ") || "none"}`)

  // ------------------------------------------------ 4. the CommBus in the main menu

  if (goneAt) {
    await sleep(5000)
    run.commbus.menu = await commbusIn("menu", await listPages())
  } else find("The cockpit never went away, so the main menu wasn't tried.")
  beep(1000, 100)
  say("Done.")
  return finish("done")
}

async function finish(how) {
  http.close()
  const row = (v) => `- ${v.label}: ${v.way ?? "?"}${v.loaded === true ? " (CommBus.js loaded)" : v.loaded === false ? " (CommBus.js failed to load)" : ""}, ready ${v.ready}, heard ${v.heard}, asked ${v.asked}${v.askedBeforeReady ? " before ready" : ""}${v.askOk === null || v.askOk === undefined ? "" : `, ${v.askOk ? "resolved" : "rejected"}`}, reached the core ${v.reachedCore}${v.errors?.length ? `; errors: ${v.errors.join("; ")}` : ""}${v.error ? `; ${v.error}` : ""}`
  const lines = [
    `p15-links-coverage, ${new Date(rec.started).toISOString()}, ${how}`,
    `Sim: ${run.sim?.version ?? "not connected"}.`,
    "",
    "Findings:",
    ...findings.map((f) => `- ${f}`),
    "",
    "The CommBus in a flight:",
    ...(run.commbus.flight.length ? run.commbus.flight.map(row) : ["- not run"]),
    "",
    "The CommBus in the main menu:",
    ...(run.commbus.menu.length ? run.commbus.menu.map(row) : ["- not run"]),
  ]
  rec.writeReport(lines.join("\n"))
  console.log("\n" + lines.join("\n"))
  console.log(`\nsaved ${repoRelative(rec.files.txt)} and the .ndjson beside it`)
  try { run.sim?.close() } catch { /* already closed */ }
  await rec.close()
  process.exit(0)
}

process.on("SIGINT", () => { finish("interrupted").catch(() => process.exit(1)) })
main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await finish(`stopped: ${e.message}`)
})
