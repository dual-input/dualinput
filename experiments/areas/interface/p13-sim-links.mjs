/*
 * p13: whether each kind of page in the sim that our components run in can
 * read an L: variable an outside program writes and hold a WebSocket to that
 * program, and what sockets in every cockpit panel cost in frame time. Node
 * 1.2.1 of the architecture plan (record/areas/architecture/plan.md).
 *
 *   node experiments/areas/interface/links/build.mjs      once, with the sim closed
 *   node experiments/areas/interface/p13-sim-links.mjs
 *
 * It runs the design it checks (user, 2026-10-08): the core listens on a port
 * Windows picks and announces it in an L: variable, and a cockpit panel
 * connects only while a session flag is 1. So the probe serves a WebSocket
 * endpoint on a port Windows picks, and writes it to L:CROSSCHECK_P13_PORT
 * through SimConnect, which our harness has done for reads and never for
 * writes (experiments/areas/aircraft/lib/sim.mjs).
 *
 * Phases, each started by the sim's own state:
 *   1. The main menu. Once SimConnect answers and the inspector lists mainUi,
 *      it writes the port, reads it back through SimConnect, and runs the page
 *      test below in every page the inspector lists.
 *   2. The pilot loads any aircraft, parked, and clicks Ready to fly. 15s after
 *      the last RTC_END, it reads the variable through SimConnect without
 *      writing it again, which is whether a value survives a flight load. It
 *      opens our panel, crosscheck-p13-links's, from the toolbar's document,
 *      and runs the page test in every page again.
 *   3. Frame time. The pilot looks forward from the cockpit with the sim in
 *      front and presses Page Down. It puts a poller in every cockpit panel
 *      that reads L:CROSSCHECK_P13_SESSION every 500ms and holds a socket
 *      while it's 1, then measures 10s windows: nothing of ours; pollers only;
 *      sockets, idle; sockets with a 200-byte state message to each every 2s,
 *      as FS Copilot's app renews its panels (FS Copilot fork,
 *      record/pointer-forwarding/docs/13-pr-prep.md, Â§8, StateRenewal); and
 *      sockets with 30 messages a second to each, as an upper bound. The four
 *      with ours run twice, and nothing of ours closes the run.
 * At the end it takes the pollers out, closes our panel, and writes both
 * variables to 0. Ctrl+C does the same and writes the report.
 *
 * The page test: whether SimVar, the sim's native simvar object, Coherent,
 * engine, and WebSocket exist, what SimVar.GetSimVarValue and
 * simvar.getValue read for the port, and a WebSocket to the port the page
 * read, or to the probe's own if it read none, which sends a line and waits
 * for the echo. The server logs each socket's Origin. It runs through the
 * inspector, with DevMode off (experiments/tools/inspector.mjs), so every page
 * gets the same code. Nothing it adds is in the pilot's input path.
 */

import { createHash } from "node:crypto"
import { createServer } from "node:http"

import { Recorder, plural, repoRelative, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { Inspector, listPages } from "../../tools/inspector.mjs"
import { START, SKIP, startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"

const PORT_VAR = "L:CROSSCHECK_P13_PORT"
const SESSION_VAR = "L:CROSSCHECK_P13_SESSION"
const PANEL_ID = "PANEL_CROSSCHECK_P13"
const SIM_PROCESS = "FlightSimulator2024"
const CONNECT_RETRY_MS = 1_000
const CONNECT_CAP_MS = 10 * 60_000
const TEST_WAIT_MS = 4_000
const SETTLE_MS = 15_000
const MEASURE_MS = 10_000
// Poller and socket changes settle before a window measures.
const SWITCH_MS = 4_000
const RENEW_MS = 2_000
const BUSY_MS = 33

const rec = new Recorder("p13-sim-links", { area: "interface" })
const findings = []
const find = (text, fields = {}) => { findings.push(text); rec.log("finding", text, fields) }

// ---------------------------------------------------------------- the server

// A WebSocket server's minimum, from RFC 6455: the accept key, and text frames
// both ways, the client's masked and ours not, as p06-websocket.mjs serves.
const accept = (key) => createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")

function frame(text) {
  const body = Buffer.from(text)
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
  return Buffer.concat([head, body])
}

function readFrames(buf, onText, onClose) {
  let o = 0
  while (buf.length - o >= 2) {
    const op = buf[o] & 0x0f
    let len = buf[o + 1] & 0x7f
    let p = o + 2
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2 }
    else if (len === 127) return buf.length
    const masked = (buf[o + 1] & 0x80) !== 0
    const mask = masked ? buf.subarray(p, p + 4) : null
    if (masked) p += 4
    if (buf.length < p + len) break
    const data = Buffer.from(buf.subarray(p, p + len))
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4]
    if (op === 1) onText(data.toString("utf8"))
    if (op === 8) onClose()
    o = p + len
  }
  return o
}

const server = { port: null, sockets: new Set(), mode: "idle", sent: 0, connects: [] }

const http = createServer((req, res) => {
  rec.log("http", `${req.method} ${req.url} (origin ${req.headers.origin ?? "none"})`)
  res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" })
  res.end("crosscheck p13")
})

http.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://127.0.0.1")
  const from = url.searchParams.get("from") ?? "?"
  const kind = url.searchParams.get("kind") ?? "test"
  const origin = req.headers.origin ?? "none"
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept(req.headers["sec-websocket-key"])}\r\n\r\n`)
  const s = { socket, from, kind, origin, at: Date.now(), timer: null, said: [] }
  server.sockets.add(s)
  server.connects.push({ from, kind, origin, at: s.at })
  rec.data("socket", `${kind} socket from ${from}, origin ${origin}`, { from, kind, origin })
  if (kind === "test") rec.log("socket", `from ${from}, origin ${origin}`, { from, origin })
  arm(s)
  let pending = Buffer.alloc(0)
  socket.on("data", (d) => {
    pending = Buffer.concat([pending, d])
    const used = readFrames(pending,
      (text) => { s.said.push(text); if (kind === "test") socket.write(frame(`echo: ${text}`)) },
      () => socket.end())
    pending = pending.subarray(used)
  })
  const gone = () => { clearInterval(s.timer); server.sockets.delete(s) }
  socket.on("close", gone)
  socket.on("error", gone)
})

// What a load socket receives in each mode: nothing, a state message every
// 2s, or 30 messages a second.
const PAD = "x".repeat(120)
function arm(s) {
  clearInterval(s.timer)
  s.timer = null
  if (s.kind !== "load" || server.mode === "idle") return
  let seq = 0
  const every = server.mode === "renew" ? RENEW_MS : BUSY_MS
  s.timer = setInterval(() => {
    if (s.socket.destroyed) return
    s.socket.write(frame(JSON.stringify({ t: "state", sync: "live", role: "follower", seq: ++seq, at: Date.now(), pad: PAD })))
    server.sent++
  }, every)
}

function setMode(mode) {
  server.mode = mode
  for (const s of server.sockets) arm(s)
}

// ---------------------------------------------------------------- in each page

// Runs in Coherent GT: no arrow functions, optional chaining, or ??
// (CLAUDE.md, "Before writing code that runs in a panel").
const TEST = (label, fallbackPort) => `(function () {
  var r = window.CROSSCHECK_P13_TEST = { label: ${JSON.stringify(label)}, simVar: typeof SimVar, nativeSimvar: typeof simvar, coherent: typeof Coherent, engine: typeof engine, webSocket: typeof WebSocket, viaSimVar: null, viaNative: null, port: null, portFrom: null, ws: "not tried", echo: null, errors: [] };
  try { if (typeof SimVar !== "undefined" && SimVar.GetSimVarValue) r.viaSimVar = SimVar.GetSimVarValue(${JSON.stringify(PORT_VAR)}, "number"); } catch (e) { r.errors.push("SimVar: " + e.message); }
  try { if (typeof simvar !== "undefined" && simvar.getValue) r.viaNative = simvar.getValue(${JSON.stringify(PORT_VAR)}, "number", ""); } catch (e) { r.errors.push("simvar: " + e.message); }
  if (r.viaSimVar) { r.port = r.viaSimVar; r.portFrom = "SimVar"; }
  else if (r.viaNative) { r.port = r.viaNative; r.portFrom = "simvar"; }
  else { r.port = ${fallbackPort}; r.portFrom = "the probe"; }
  try {
    var s = new WebSocket("ws://127.0.0.1:" + r.port + "/?kind=test&from=" + encodeURIComponent(r.label));
    r.ws = "connecting";
    s.onopen = function () { r.ws = "open"; s.send("hello from " + r.label); };
    s.onmessage = function (e) { r.echo = String(e.data); };
    s.onerror = function () { r.ws = "error"; };
    s.onclose = function (e) { if (r.ws !== "open") r.ws = "closed " + e.code; };
    r.socket = s;
  } catch (e) { r.ws = "threw"; r.errors.push("ws: " + e.message); }
  return "started";
})()`

const TEST_READ = `(function () {
  var r = window.CROSSCHECK_P13_TEST;
  if (!r) return null;
  var out = { label: r.label, simVar: r.simVar, nativeSimvar: r.nativeSimvar, coherent: r.coherent, engine: r.engine, webSocket: r.webSocket, viaSimVar: r.viaSimVar, viaNative: r.viaNative, port: r.port, portFrom: r.portFrom, ws: r.ws, echo: r.echo, errors: r.errors };
  try { if (r.socket) r.socket.close(); } catch (e) {}
  window.CROSSCHECK_P13_TEST = undefined;
  return out;
})()`

// The poller the design puts in a cockpit panel, minus everything a session
// does with the socket: it reads the session flag every 500ms, holds a socket
// while it's 1, parses each message as the real panel would, and counts.
const POLLER = (label) => `(function () {
  if (window.CROSSCHECK_P13) return "already";
  var S = window.CROSSCHECK_P13 = { reads: 0, connects: 0, messages: 0, bytes: 0, parseErrors: 0, socket: null };
  function read(name) {
    try { if (typeof SimVar !== "undefined") return SimVar.GetSimVarValue(name, "number"); } catch (e) {}
    try { if (typeof simvar !== "undefined") return simvar.getValue(name, "number", ""); } catch (e) {}
    return 0;
  }
  S.timer = setInterval(function () {
    S.reads++;
    var on = read(${JSON.stringify(SESSION_VAR)}) === 1;
    if (on && !S.socket) {
      var port = read(${JSON.stringify(PORT_VAR)});
      if (!port) return;
      var s = S.socket = new WebSocket("ws://127.0.0.1:" + port + "/?kind=load&from=" + encodeURIComponent(${JSON.stringify(label)}));
      S.connects++;
      s.onmessage = function (e) { S.messages++; S.bytes += String(e.data).length; try { JSON.parse(e.data); } catch (x) { S.parseErrors++; } };
      s.onclose = function () { if (S.socket === s) S.socket = null; };
      s.onerror = function () {};
    } else if (!on && S.socket) {
      try { S.socket.close(); } catch (e) {}
      S.socket = null;
    }
  }, 500);
  return "installed";
})()`

const POLLER_REMOVE = `(function () {
  var S = window.CROSSCHECK_P13;
  if (!S) return null;
  clearInterval(S.timer);
  try { if (S.socket) S.socket.close(); } catch (e) {}
  window.CROSSCHECK_P13 = undefined;
  return { reads: S.reads, connects: S.connects, messages: S.messages, bytes: S.bytes, parseErrors: S.parseErrors };
})()`

const label = (p) => String(p.title || "") || String(p.url || "").split("/").slice(-2).join("/") || `page ${p.id}`

// One inspector connection per page, opened for one call and closed again, so
// none stays attached while frame time is measured.
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

async function testPages(when) {
  const pages = await listPages()
  rec.log("pages", `${when}: ${plural(pages.length, "page")}: ${pages.map(label).join(" | ")}`, { when, pages: pages.map((p) => ({ id: p.id, title: p.title, url: p.url })) })
  const started = []
  for (const p of pages) {
    const r = await inPage(p, TEST(`${when}: ${label(p)}`, server.port))
    if (r.ok) started.push(p)
    else rec.log("page", `${when}: ${label(p)}: couldn't run: ${r.error}`)
  }
  await sleep(TEST_WAIT_MS)
  const rows = []
  for (const p of started) {
    const r = await inPage(p, TEST_READ)
    const v = r.ok ? r.value : { error: r.error }
    rows.push({ page: label(p), url: p.url, ...v })
    rec.log("page", `${when}: ${label(p)}: ${JSON.stringify(v)}`, { when, page: label(p), url: p.url, result: v })
  }
  return rows
}

// ---------------------------------------------------------------- the run

const run = { sim: null, cockpit: [], pollers: false, finished: false, menu: [], flight: [], frames: [], reads: {} }

async function connectWhenUp() {
  const t0 = Date.now()
  for (;;) {
    try {
      return await Sim.connect(rec, { name: "CROSSCHECK p13 sim links" })
    } catch (e) {
      if (Date.now() - t0 > CONNECT_CAP_MS) throw e
      await sleep(CONNECT_RETRY_MS)
    }
  }
}

async function waitForPage(test, ms, what) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const hit = (await listPages()).find(test)
      if (hit) return hit
    } catch { /* the inspector comes up with the sim */ }
    await sleep(1000)
  }
  rec.log("wait", `no ${what} after ${Math.round(ms / 1000)}s`)
  return null
}

async function readPort(when) {
  const v = await run.sim.readOne(PORT_VAR, "number")
  run.reads[when] = v
  rec.log("read", `${when}: SimConnect reads ${PORT_VAR} = ${v}`, { when, value: v })
  return v
}

async function main() {
  rec.open()
  process.on("SIGINT", () => { finish("interrupted").catch(() => process.exit(1)) })
  const keys = await startKeys()
  const beep = startBeeper()
  const say = startSpeaker()

  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve))
  server.port = http.address().port
  rec.log("serve", `serving on 127.0.0.1:${server.port}, a port Windows picked`)

  console.log("\nâ–¶ Start MSFS if it isn't running, and leave it at the main menu. The probe waits for it.")
  const sim = run.sim = await connectWhenUp()
  const main = await waitForPage((p) => /mainUi/i.test(String(p.title)) || /mainUI\.html/i.test(String(p.url)), CONNECT_CAP_MS, "mainUi")
  if (!main) throw new Error("the inspector never listed mainUi; is the sim at the main menu?")
  await sleep(3000)

  // ------------------------------------------------ 1. the main menu

  sim.write(PORT_VAR, "number", server.port, { label: `write ${PORT_VAR}` })
  sim.write(SESSION_VAR, "number", 0, { label: `write ${SESSION_VAR}` })
  await sleep(1000)
  const back = await readPort("in the menu, after the write")
  find(back === server.port
    ? `In the main menu, SimConnect wrote ${PORT_VAR} = ${server.port} and read it back.`
    : `In the main menu, SimConnect wrote ${PORT_VAR} = ${server.port} and read back ${back}.`)
  run.menu = await testPages("menu")

  // ------------------------------------------------ 2. a flight

  beep(880, 150)
  say("Load any aircraft, parked, and click Ready to fly.")
  console.log("\nâ–¶ Load any aircraft, parked, from the world map, and click Ready to fly.\n  The probe goes on by itself 15s after Ready to fly.")
  let lastReady = 0
  sim.flowHandlers.add((name) => { if (name === "RTC_END") lastReady = Date.now() })
  while (!lastReady || Date.now() - lastReady < SETTLE_MS) await sleep(500)
  const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
  rec.log("loaded", `Ready to fly ${SETTLE_MS / 1000}s ago, TITLE ${JSON.stringify(title)}`, { title })

  const kept = await readPort("in the flight, before any write")
  find(kept === server.port
    ? `After a flight load, ${PORT_VAR} still held ${kept}, written in the menu.`
    : `After a flight load, ${PORT_VAR} read ${kept}, not the ${server.port} written in the menu.`)
  if (kept !== server.port) {
    sim.write(PORT_VAR, "number", server.port, { label: `write ${PORT_VAR} again` })
    await sleep(1000)
    await readPort("in the flight, after writing again")
  }

  const toolbar = (await listPages()).find((p) => /toolbar/i.test(String(p.title)) || /toolbar/i.test(String(p.url)))
  if (toolbar) {
    const r = await inPage(toolbar, `(function () { Coherent.call("TOOLBAR_BUTTON_TOGGLE", ${JSON.stringify(PANEL_ID)}, true); return "called"; })()`)
    rec.log("panel", `TOOLBAR_BUTTON_TOGGLE from ${label(toolbar)}: ${JSON.stringify(r)}`)
  } else rec.log("panel", "no toolbar page listed")
  let ours = await waitForPage((p) => /CrosscheckP13/i.test(String(p.url)), 10_000, "page of our panel")
  if (!ours) {
    beep(880, 150)
    say("Open Crosscheck P13 from the toolbar, then press Page Down.")
    console.log(`\nâ–¶ Our panel didn't open from code. Open "Crosscheck P13", the toolbar button marked 13, then press ${START}.`)
    await keys.next()
    ours = await waitForPage((p) => /CrosscheckP13/i.test(String(p.url)), 10_000, "page of our panel")
  }
  find(ours ? `Our panel's page: ${label(ours)}, ${ours.url}.` : "Our panel never opened, so the flight's test has no panel of ours.")
  run.flight = await testPages("flight")
  if (toolbar && ours) await inPage(toolbar, `(function () { Coherent.call("TOOLBAR_BUTTON_TOGGLE", ${JSON.stringify(PANEL_ID)}, false); return "called"; })()`)

  // ------------------------------------------------ 3. frame time

  run.cockpit = (await listPages()).filter((p) => /^VCockpit/i.test(String(p.title)))
  if (!run.cockpit.length) { find("No cockpit panels listed, so no frame time was measured."); return finish("done") }
  for (;;) {
    beep(800, 150)
    say("Look forward from the cockpit, keep the sim in front, hands off, and press Page Down.")
    console.log(`\nâ–¶ Look forward from the cockpit, keep the sim in front, and take your hands off.\n  ${START} to measure, about 2 minutes; ${SKIP} to skip.`)
    const k = await keys.next()
    rec.log("key", `${k.key}, with ${k.foreground} in front`, k)
    if (k.key !== "START") { find("Frame time skipped."); return finish("done") }
    if (k.foreground === SIM_PROCESS) break
    console.log(`  ${k.foreground} was in front, not the sim. Click into the sim, then press ${START} again.`)
  }
  say("Measuring. Hands off.")

  const measure = async (name) => {
    const r = await sim.frameRate(MEASURE_MS)
    const loads = [...server.sockets].filter((s) => s.kind === "load").length
    const row = { name, fps: r.fps, frameMs: r.fps ? 1000 / r.fps : null, maxGapMs: r.maxGapMs, sockets: loads, sent: server.sent }
    run.frames.push(row)
    rec.log("fps", `${name}: ${r.fps ? `${r.fps.toFixed(1)} fps, ${(1000 / r.fps).toFixed(2)}ms` : "no frames"}, ${plural(loads, "socket")} open`, row)
  }
  const session = async (on) => {
    const t0 = Date.now()
    const before = server.connects.length
    sim.write(SESSION_VAR, "number", on ? 1 : 0, { label: `write ${SESSION_VAR} = ${on ? 1 : 0}` })
    if (on) {
      while (Date.now() - t0 < SWITCH_MS * 2 && server.connects.length - before < run.cockpit.length) await sleep(50)
      const got = server.connects.slice(before).filter((c) => c.kind === "load")
      const ms = got.map((c) => c.at - t0)
      rec.log("session", `flag 1: ${got.length} of ${run.cockpit.length} panels connected, the first after ${ms.length ? Math.min(...ms) : "-"}ms and the last after ${ms.length ? Math.max(...ms) : "-"}ms`, { connected: got.length, of: run.cockpit.length, firstMs: ms.length ? Math.min(...ms) : null, lastMs: ms.length ? Math.max(...ms) : null })
    }
    await sleep(SWITCH_MS)
  }

  await measure("nothing of ours")
  for (const p of run.cockpit) {
    const r = await inPage(p, POLLER(label(p)))
    if (!r.ok) rec.log("poller", `${label(p)}: ${r.error}`)
  }
  run.pollers = true
  await sleep(SWITCH_MS)
  for (const round of [1, 2]) {
    await measure(`round ${round}: pollers, no sockets`)
    setMode("idle")
    await session(true)
    await measure(`round ${round}: sockets, idle`)
    setMode("renew")
    await sleep(SWITCH_MS)
    await measure(`round ${round}: sockets, a message every 2s`)
    setMode("busy")
    await sleep(SWITCH_MS)
    await measure(`round ${round}: sockets, 30 messages a second`)
    setMode("idle")
    await session(false)
  }
  await removePollers()
  await sleep(SWITCH_MS)
  await measure("nothing of ours, again")
  beep(1000, 100)
  say("Done.")
  return finish("done")
}

async function removePollers() {
  if (!run.pollers) return
  run.pollers = false
  let messages = 0
  let parseErrors = 0
  let counted = 0
  for (const p of run.cockpit) {
    const r = await inPage(p, POLLER_REMOVE)
    if (r.ok && r.value) { counted++; messages += r.value.messages; parseErrors += r.value.parseErrors }
  }
  find(`The pollers in ${counted} of ${plural(run.cockpit.length, "cockpit panel")} got ${messages.toLocaleString("en-US")} of the ${server.sent.toLocaleString("en-US")} messages the probe sent, with ${parseErrors} that didn't parse.`)
}

// ---------------------------------------------------------------- the report

async function finish(how) {
  if (run.finished) return
  run.finished = true
  try { await removePollers() } catch { /* the sim may be gone */ }
  try {
    if (run.sim && !run.sim.gone) {
      run.sim.write(SESSION_VAR, "number", 0, { label: `write ${SESSION_VAR} = 0` })
      run.sim.write(PORT_VAR, "number", 0, { label: `write ${PORT_VAR} = 0` })
      await sleep(500)
    }
  } catch { /* the sim may be gone */ }
  for (const s of server.sockets) { clearInterval(s.timer); s.socket.destroy() }
  http.close()

  const kinds = (rows) => rows.map((r) => `- ${r.page}: SimVar ${r.simVar}, simvar ${r.nativeSimvar}, Coherent ${r.coherent}, engine ${r.engine}, WebSocket ${r.webSocket}; read ${r.viaSimVar ?? "-"} by SimVar and ${r.viaNative ?? "-"} by simvar; socket to the port from ${r.portFrom ?? "-"}: ${r.ws}${r.echo ? `, echo "${r.echo}"` : ""}${r.errors?.length ? `; errors: ${r.errors.join("; ")}` : ""}${r.error ? `; couldn't read: ${r.error}` : ""}`)
  const origins = [...new Set(server.connects.filter((c) => c.kind === "test").map((c) => `${c.from.replace(/^(menu|flight): /, "")}: ${c.origin}`))]
  const lines = [
    `p13-sim-links, ${new Date(rec.started).toISOString()}, ${how}`,
    `Sim: ${run.sim?.version ?? "not connected"}. Served on 127.0.0.1:${server.port ?? "-"}.`,
    "",
    "Findings:",
    ...findings.map((f) => `- ${f}`),
    "",
    `SimConnect's reads of ${PORT_VAR}: ${JSON.stringify(run.reads)}`,
    "",
    "In the main menu:",
    ...(run.menu.length ? kinds(run.menu) : ["- not run"]),
    "",
    "In a flight:",
    ...(run.flight.length ? kinds(run.flight) : ["- not run"]),
    "",
    "Origins the server saw, by page:",
    ...(origins.length ? origins.map((o) => `- ${o}`) : ["- none"]),
    "",
    `Frame time, ${MEASURE_MS / 1000}s windows, ${plural(run.cockpit.length, "cockpit panel")}:`,
    ...(run.frames.length ? run.frames.map((f) => `- ${f.name}: ${f.fps ? `${f.fps.toFixed(1)} fps, ${f.frameMs.toFixed(2)}ms a frame, longest gap ${Math.round(f.maxGapMs)}ms` : "no frames"}, ${plural(f.sockets, "socket")}`) : ["- not measured"]),
  ]
  rec.writeReport(lines.join("\n"))
  console.log("\n" + lines.join("\n"))
  console.log(`\nsaved ${repoRelative(rec.files.txt)} and the .ndjson beside it`)
  try { run.sim?.close() } catch { /* already closed */ }
  await rec.close()
  process.exit(0)
}

main().catch(async (e) => {
  rec.log("error", e.stack ?? String(e))
  await finish(`stopped: ${e.message}`)
})
