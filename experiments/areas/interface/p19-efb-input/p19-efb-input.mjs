/*
 * p19: what an app in the EFB gets from the pilot's mouse and keyboard, and
 * which font files it can load, in the EFB's document and in an iframe of a
 * page on 127.0.0.1, the two places Dual Input's EFB app could draw. Stage 11b's
 * one-front-end question (record/areas/interface/decisions.md).
 *
 *   node experiments/areas/interface/p19-efb-input/p19-efb-input.mjs
 *
 * Open the EFB first, from the world map or in a flight. The probe puts a panel
 * over the EFB through the inspector (experiments/tools/inspector.mjs), and each
 * step's instruction shows on that panel, with a beep as it starts:
 *   1. click the box;
 *   2. scroll the list with the wheel;
 *   3. click field 1 and type abc, with nothing else done;
 *   4. click field 2 and type abc, where the field calls
 *      Coherent.trigger("FOCUS_INPUT_FIELD", {...}) on focus, as Fenix's EFB
 *      app's text box does (read in fnx-aircraft-320 2.4.0.4720,
 *      FenixSimEfbApp.js, onFocusIn);
 *   5. click the box in the frame;
 *   6. click the frame's field and type abc, where the frame posts FOCUS to the
 *      EFB's document, which calls the trigger's five-argument form, as Fenix's
 *      EFB app does for its iframe (same file, IframeListener).
 * A step ends on its own once its action is seen, or after 25s; Page Up skips it.
 * Meanwhile it loads Geist as TTF and as WOFF2, from data: URLs in the EFB's
 * document and from 127.0.0.1 in the frame, and measures whether each drew.
 * Last, it shows p18's page in the frame, if p18 has built it, so its own checks
 * run in Coherent GT, and screenshots that.
 *
 * Every listener only watches. The focus trigger takes the keyboard from the
 * sim, so the probe releases it at each step's end, at exit, and on a 10-minute
 * deadman timer in the page, and window.DUALINPUT_P19_UNLOCK() in the EFB's
 * document removes everything (CLAUDE.md, Before writing code that runs in a
 * panel).
 */

import fs from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { startBeeper, startKeys } from "../../../tools/guide.mjs"
import { Inspector, listPages } from "../../../tools/inspector.mjs"
import { repoRelative, resultFile, stamp } from "../../../tools/results.mjs"
import { startShooter } from "../../../tools/shot.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FONTS = path.join(HERE, "node_modules/geist/dist/fonts/geist-sans")
const P18 = path.join(HERE, "../p18-fscomponent/out/modules")
const RESULTS = path.join(HERE, "../results")
const PORT = 47_819
const STEP_MS = 25_000
const ORIGIN = `http://127.0.0.1:${PORT}`
const when = stamp()

const STEPS = [
  { id: "click", text: "Click the blue box once." },
  { id: "wheel", text: "Scroll the list below the box with the mouse wheel." },
  { id: "plain", text: "Click field 1 and type abc." },
  { id: "focused", text: "Click field 2 and type abc." },
  { id: "frameClick", text: "Click the blue box inside the frame." },
  { id: "frameType", text: "Click the frame's field and type abc." },
]

// ---------------------------------------------------------------- in the pages

// Both documents log the same events, capture phase, without stopping any.
const TYPES = [
  "pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel",
  "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave", "click", "dblclick", "auxclick", "contextmenu",
  "wheel", "mousewheel", "touchstart", "touchmove", "touchend", "touchcancel",
  "focus", "blur", "focusin", "focusout", "keydown", "keypress", "keyup", "beforeinput", "input", "change",
  "compositionstart", "compositionupdate", "compositionend",
]

// The recorder both documents run, in ES2017's syntax for Coherent GT. It keeps
// every event's count per step, and the first four of each type per step.
function recorder(types) {
  var rec = { step: "setup", counts: {}, log: [], seen: {} }
  rec.handler = function (e) {
    var t = e.target
    var target = (t && t.id) || (t && t.nodeName) || "?"
    var key = rec.step + " " + e.type
    rec.counts[key] = (rec.counts[key] || 0) + 1
    if (rec.counts[key] > 4) return
    rec.log.push({
      step: rec.step, type: e.type, target: target, trusted: e.isTrusted, cls: e.constructor && e.constructor.name,
      pointerType: e.pointerType, button: e.button, buttons: e.buttons, x: e.clientX, y: e.clientY,
      key: e.key, code: e.code, keyCode: e.keyCode, charCode: e.charCode, data: e.data, t: Date.now(),
    })
  }
  for (var i = 0; i < types.length; i++) document.addEventListener(types[i], rec.handler, true)
  rec.stop = function () { for (var j = 0; j < types.length; j++) document.removeEventListener(types[j], rec.handler, true) }
  rec.env = {
    href: location.href, userAgent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight,
    PointerEvent: typeof window.PointerEvent, TouchEvent: typeof window.TouchEvent, ontouchstart: "ontouchstart" in window,
    maxTouchPoints: navigator.maxTouchPoints, fonts: typeof document.fonts, Coherent: typeof window.Coherent,
  }
  return rec
}

// Whether a face drew: the same text in the face with a monospace fallback, and
// in monospace alone, differs in width only if the face loaded.
function measureFonts(faces) {
  var out = {}
  for (var i = 0; i < faces.length; i++) {
    var a = document.getElementById("p19-measure-" + faces[i])
    var b = document.getElementById("p19-measure-mono")
    out[faces[i]] = { width: a ? a.offsetWidth : -1, monospace: b ? b.offsetWidth : -1, drew: !!(a && b && a.offsetWidth !== b.offsetWidth) }
  }
  if (document.fonts && document.fonts.status) out.documentFontsStatus = document.fonts.status
  return out
}

const fontCss = (family, src, format) => `@font-face { font-family: "${family}"; src: url(${src}) format("${format}"); font-weight: 400; font-style: normal; }`
const SAMPLE = "Dual Input: The quick brown fox, 0123456789"
const fontBlock = (faces) => `
  ${faces.map((f) => `<div style="font-family: '${f.family}', monospace; font-size: 15px; margin-top: 4px">${f.label}: ${SAMPLE}</div>`).join("\n  ")}
  <div style="position: absolute; left: -4000px; top: 0; white-space: nowrap; font-size: 20px">
    ${faces.map((f) => `<span id="p19-measure-${f.family}" style="font-family: '${f.family}', monospace">${SAMPLE}</span><br>`).join("")}
    <span id="p19-measure-mono" style="font-family: monospace">${SAMPLE}</span>
  </div>`

const BOX = "background: #1e6a91; color: #fff; height: 64px; line-height: 64px; text-align: center; font-size: 18px; border-radius: 10px; margin-top: 8px"
const FIELD = "display: block; width: 100%; box-sizing: border-box; height: 36px; margin-top: 8px; padding: 0 10px; font-size: 16px; color: #fafafa; background: #0a0a0a; border: 1px solid #3a3a3a; border-radius: 8px"

// The EFB's document: the panel, the faces as data: URLs, the frame, and the
// focus triggers. Returns "installed".
function installPanel(cfg) {
  if (window.DUALINPUT_P19_UNLOCK) window.DUALINPUT_P19_UNLOCK()
  var rec = recorder(cfg.types)
  var state = window.DUALINPUT_P19 = { rec: rec, triggers: [], textFromOS: [], focusedGuids: {} }

  var style = document.createElement("style")
  style.textContent = cfg.fontCss
  document.head.appendChild(style)

  var panel = document.createElement("div")
  panel.id = "p19-panel"
  panel.style.cssText = "position: fixed; top: 12px; right: 12px; width: 460px; z-index: 2147483647; box-sizing: border-box; padding: 14px; background: #171717; color: #fafafa; border: 2px solid #74d4ff; border-radius: 12px; font-family: sans-serif; font-size: 14px; overflow-y: auto; max-height: " + (window.innerHeight - 24) + "px"
  panel.innerHTML = cfg.panelHtml
  document.body.appendChild(panel)

  function trigger(name, a, b, c, d, e) {
    state.triggers.push({ name: name, args: [a, b, c, d, e].filter(function (x) { return x !== undefined }), t: Date.now() })
    try { Coherent.trigger(name, a, b, c, d, e) } catch (err) { state.triggers.push({ name: name, error: String(err) }) }
  }
  function onTextFromOS(text) { state.textFromOS.push({ text: String(text), t: Date.now() }) }
  try { Coherent.on("SetInputTextFromOS", onTextFromOS) } catch (err) { /* recorded by its absence */ }

  var focused = document.getElementById("p19-focused")
  focused.addEventListener("focus", function () {
    state.focusedGuids["DUALINPUT_P19_FIELD"] = true
    trigger("FOCUS_INPUT_FIELD", { title: "Title", description: "", default_text: "", is_numeric: false, is_efb: true })
  })
  focused.addEventListener("blur", function () { trigger("UNFOCUS_INPUT_FIELD", "DUALINPUT_P19_FIELD") })

  function onMessage(e) {
    var d = e.data
    if (!d || !d.command || !d.guid) return
    if (d.command === "FOCUS") { state.focusedGuids[d.guid] = true; trigger("FOCUS_INPUT_FIELD", d.guid, "", "", "", false) }
    if (d.command === "UNFOCUS") trigger("UNFOCUS_INPUT_FIELD", d.guid)
  }
  window.addEventListener("message", onMessage)

  state.release = function () {
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() } catch (err) { /* nothing focused */ }
    for (var g in state.focusedGuids) trigger("UNFOCUS_INPUT_FIELD", g)
  }
  var deadman = setTimeout(function () { window.DUALINPUT_P19_UNLOCK() }, cfg.deadmanMs)
  window.DUALINPUT_P19_UNLOCK = function () {
    clearTimeout(deadman)
    try { state.release() } catch (err) { /* keep going */ }
    try { rec.stop() } catch (err) { /* keep going */ }
    try { window.removeEventListener("message", onMessage) } catch (err) { /* keep going */ }
    try { Coherent.off("SetInputTextFromOS", onTextFromOS) } catch (err) { /* keep going */ }
    try { if (panel.parentNode) panel.parentNode.removeChild(panel) } catch (err) { /* keep going */ }
    try { if (style.parentNode) style.parentNode.removeChild(style) } catch (err) { /* keep going */ }
    window.DUALINPUT_P19_UNLOCK = undefined
    return "unlocked"
  }
  window.DUALINPUT_P19_STEP = function (id, text, highlight) {
    rec.step = id
    document.getElementById("p19-step").textContent = text
    var all = panel.querySelectorAll("[data-p19-target]")
    for (var i = 0; i < all.length; i++) all[i].style.outline = all[i].getAttribute("data-p19-target") === highlight ? "3px solid #f1be4d" : "none"
    return id
  }
  window.DUALINPUT_P19_READ = function () {
    var list = document.getElementById("p19-list")
    return {
      env: rec.env, counts: rec.counts, log: rec.log, triggers: state.triggers, textFromOS: state.textFromOS,
      plain: document.getElementById("p19-plain").value, focused: focused.value, listScroll: list ? list.scrollTop : -1,
      active: document.activeElement ? document.activeElement.id || document.activeElement.nodeName : null,
      fonts: measureFonts(cfg.faces),
    }
  }
  window.DUALINPUT_P19_SHOW_P18 = function (src) {
    var f = document.getElementById("p19-frame")
    f.style.height = (window.innerHeight - 140) + "px"
    f.src = src
    return "showing"
  }
  return "installed"
}

// The frame's page: the same recorder, a box, a field that asks the EFB's
// document for the keyboard, and the faces from 127.0.0.1. It posts what it saw.
function framePage(cfg) {
  var rec = recorder(cfg.types)
  var field = document.getElementById("p19-frame-field")
  field.addEventListener("focus", function () { parent.postMessage({ command: "FOCUS", guid: "DUALINPUT_P19_FRAME" }, "*") })
  field.addEventListener("blur", function () { parent.postMessage({ command: "UNFOCUS", guid: "DUALINPUT_P19_FRAME" }, "*") })
  window.addEventListener("message", function (e) { if (e.data && e.data.p19Step) rec.step = e.data.p19Step })
  function post() {
    var x = new XMLHttpRequest()
    x.open("POST", "/frame-log")
    x.setRequestHeader("content-type", "application/json")
    x.send(JSON.stringify({ env: rec.env, counts: rec.counts, log: rec.log, value: field.value, step: rec.step, fonts: measureFonts(cfg.faces) }))
  }
  setInterval(post, 400)
  setTimeout(function () { rec.stop() }, cfg.deadmanMs)
}

// ---------------------------------------------------------------- the server

const font = (file) => fs.readFileSync(path.join(FONTS, file))
const EFB_FACES = [
  { family: "P19-Data-TTF", label: "TTF, data: URL", css: fontCss("P19-Data-TTF", `data:font/ttf;base64,${font("Geist-Regular.ttf").toString("base64")}`, "truetype") },
  { family: "P19-Data-WOFF2", label: "WOFF2, data: URL", css: fontCss("P19-Data-WOFF2", `data:font/woff2;base64,${font("Geist-Regular.woff2").toString("base64")}`, "woff2") },
]
const FRAME_FACES = [
  { family: "P19-Http-TTF", label: "TTF, 127.0.0.1", css: fontCss("P19-Http-TTF", "/fonts/Geist-Regular.ttf", "truetype") },
  { family: "P19-Http-WOFF2", label: "WOFF2, 127.0.0.1", css: fontCss("P19-Http-WOFF2", "/fonts/Geist-Regular.woff2", "woff2") },
]

const PANEL_HTML = `
  <div style="font-size: 12px; color: #a3a3a3">Dual Input p19 &middot; Page Up skips a step</div>
  <div id="p19-step" style="font-size: 18px; color: #74d4ff; margin-top: 6px; min-height: 44px">Press Page Down to start.</div>
  <div id="p19-box" data-p19-target="click" style="${BOX}">Box</div>
  <div id="p19-list" data-p19-target="wheel" style="height: 72px; overflow-y: auto; margin-top: 8px; background: #262626; border-radius: 8px; padding: 0 10px">
    ${Array.from({ length: 30 }, (_, i) => `<div style="height: 24px; line-height: 24px">List row ${i + 1}</div>`).join("")}
  </div>
  <input id="p19-plain" data-p19-target="plain" placeholder="Field 1" style="${FIELD}">
  <input id="p19-focused" data-p19-target="focused" placeholder="Field 2" style="${FIELD}">
  <div style="position: relative; margin-top: 8px">${fontBlock(EFB_FACES)}</div>
  <iframe id="p19-frame" data-p19-target="frame" src="${ORIGIN}/frame" style="display: block; width: 100%; height: 240px; margin-top: 8px; border: 0; border-radius: 8px; background: #0a0a0a"></iframe>`

const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
${FRAME_FACES.map((f) => f.css).join("\n")}
body { margin: 0; padding: 10px; background: #0a0a0a; color: #fafafa; font-family: sans-serif; font-size: 14px; }
</style></head><body>
<div style="font-size: 12px; color: #a3a3a3">Frame from ${ORIGIN}</div>
<div id="p19-frame-box" style="${BOX}">Box in the frame</div>
<input id="p19-frame-field" placeholder="Frame field" style="${FIELD}">
<div style="position: relative">${fontBlock(FRAME_FACES)}</div>
<script>
${recorder.toString()}
${measureFonts.toString()}
(${framePage.toString()})(${JSON.stringify({ types: TYPES, faces: FRAME_FACES.map((f) => f.family), deadmanMs: 600_000 })})
</script></body></html>`

const PANEL_CONFIG = {
  types: TYPES, panelHtml: PANEL_HTML, fontCss: EFB_FACES.map((f) => f.css).join("\n"),
  faces: EFB_FACES.map((f) => f.family), deadmanMs: 600_000,
}
const PANEL_SOURCE = `${recorder.toString()}\n${measureFonts.toString()}\n(${installPanel.toString()})(${JSON.stringify(PANEL_CONFIG)})`

let frameState = null
let p18Result = null

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json", ".ttf": "font/ttf", ".woff2": "font/woff2" }
const send = (res, type, body) => { res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" }); res.end(body) }
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => resolve(b)) })

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN)
  if (req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    if (url.pathname === "/frame-log") frameState = body
    if (url.pathname === "/result") p18Result = body
    res.writeHead(204, { "access-control-allow-origin": "*" })
    res.end()
    return
  }
  if (url.pathname === "/frame") return send(res, "text/html", FRAME_HTML)
  // The panel in any browser, without Coherent, for checking it outside the sim.
  if (url.pathname === "/desk") return send(res, "text/html", `<!doctype html><html><head><meta charset="utf-8"></head><body style="background: #333"><script>${PANEL_SOURCE}</script></body></html>`)
  if (url.pathname.startsWith("/fonts/")) {
    const file = path.join(FONTS, path.basename(url.pathname))
    if (fs.existsSync(file)) return send(res, MIME[path.extname(file)], fs.readFileSync(file))
  }
  if (url.pathname.startsWith("/p18/")) {
    const file = path.join(P18, path.basename(url.pathname) || "index.html")
    if (fs.existsSync(file)) return send(res, MIME[path.extname(file)] || "application/octet-stream", fs.readFileSync(file))
  }
  res.writeHead(404)
  res.end()
})

// ---------------------------------------------------------------- the steps

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const count = (counts, step, types) => types.reduce((n, t) => n + (counts[`${step} ${t}`] || 0), 0)

// Whether a step's action happened, from what the documents read back.
function stepDone(id, efb, frame) {
  const c = efb.counts
  if (id === "click") return count(c, id, ["click", "mouseup", "pointerup", "touchend"]) > 0
  if (id === "wheel") return efb.listScroll > 0 || count(c, id, ["wheel", "mousewheel"]) > 2
  if (id === "plain") return efb.plain.length >= 3
  if (id === "focused") return efb.focused.length >= 3
  if (!frame) return false
  if (id === "frameClick") return count(frame.counts, id, ["click", "mouseup", "pointerup", "touchend"]) > 0
  if (id === "frameType") return frame.value.length >= 3
  return false
}

// Keys pressed with no text arriving also end a typing step, 6s after the first.
function typedNothing(id, efb, frame) {
  const counts = id === "frameType" ? frame && frame.counts : efb.counts
  if (!counts) return false
  return count(counts, id, ["keydown", "keypress", "keyup"]) > 0
}

async function findEfb() {
  for (;;) {
    let pages = []
    try { pages = await listPages() } catch (e) { console.log(e.message.split("\n")[0]) }
    const efb = pages.find((p) => String(p.title || "") === "Electronic Flight Bag")
    if (efb) return efb
    console.log("No EFB document yet; open the EFB. Retrying in 3s.")
    await sleep(3000)
  }
}

// Set once the panel is in, so an error or Ctrl+C still gives the sim its keyboard back.
let unlock = async () => "nothing installed"

async function main() {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve))
  const page = await findEfb()
  const insp = new Inspector(page.id)
  await insp.open()
  unlock = async () => { try { return await insp.evaluate("window.DUALINPUT_P19_UNLOCK ? window.DUALINPUT_P19_UNLOCK() : 'nothing'") } catch (e) { return e.message } }
  process.on("SIGINT", async () => { console.log(`unlock: ${await unlock()}`); process.exit(130) })

  console.log(`EFB document ${page.id}: ${await insp.evaluate(PANEL_SOURCE)}`)

  const keys = await startKeys()
  const beep = startBeeper()
  console.log("Press Page Down in the sim to start.")
  for (;;) { const k = await keys.next(); if (k.key === "START") break }

  const outcomes = []
  let skipped = false
  const stopListening = keys.listen((k) => { if (k.key === "SKIP") skipped = true })
  for (const [i, step] of STEPS.entries()) {
    const text = `Step ${i + 1} of ${STEPS.length}: ${step.text}`
    const highlight = step.id.startsWith("frame") ? "frame" : step.id
    await insp.evaluate(`DUALINPUT_P19_STEP(${JSON.stringify(step.id)}, ${JSON.stringify(text)}, ${JSON.stringify(highlight)})`)
    await insp.evaluate(`document.getElementById("p19-frame").contentWindow.postMessage({ p19Step: ${JSON.stringify(step.id)} }, "*")`)
    console.log(text)
    beep(880, 150)
    skipped = false
    const started = Date.now()
    let outcome = "timed out"
    let firstKeys = 0
    while (Date.now() - started < STEP_MS) {
      await sleep(300)
      const efb = await insp.evaluate("DUALINPUT_P19_READ()")
      if (stepDone(step.id, efb, frameState)) { outcome = "done"; await sleep(1500); break }
      if (/plain|focused|frameType/.test(step.id) && typedNothing(step.id, efb, frameState)) {
        firstKeys ||= Date.now()
        if (Date.now() - firstKeys > 6000) { outcome = "keys pressed, no text arrived"; break }
      }
      if (skipped) { outcome = "skipped"; break }
    }
    await insp.evaluate("DUALINPUT_P19.release()")
    outcomes.push({ step: step.id, outcome, ms: Date.now() - started })
    console.log(`  ${outcome}`)
    beep(660, 80)
  }
  stopListening()

  const efb = await insp.evaluate("DUALINPUT_P19_READ()")
  const frame = frameState

  let shot = null
  if (fs.existsSync(path.join(P18, "index.html"))) {
    await insp.evaluate(`DUALINPUT_P19_STEP("p18", "p18's page, in Coherent GT. Nothing to do.", "frame")`)
    await insp.evaluate(`DUALINPUT_P19_SHOW_P18(${JSON.stringify(`${ORIGIN}/p18/index.html`)})`)
    for (let i = 0; i < 30 && !p18Result; i++) await sleep(300)
    await sleep(1000)
    const shooter = startShooter(path.join(RESULTS, `p19-efb-input-${when}`))
    shot = await shooter.shot("p18-in-efb")
    shooter.close()
  }

  console.log(`unlock: ${await unlock()}`)
  insp.close()

  const lines = [`p19-efb-input, ${new Date().toISOString()}`, ""]
  lines.push(`EFB document: ${JSON.stringify(efb.env)}`)
  lines.push(`Frame: ${frame ? JSON.stringify(frame.env) : "never posted"}`)
  lines.push("", "Steps:")
  for (const o of outcomes) lines.push(`  ${o.step}: ${o.outcome} (${(o.ms / 1000).toFixed(1)}s)`)
  const counted = (counts, step) => Object.entries(counts || {}).filter(([k]) => k.startsWith(`${step} `)).map(([k, n]) => `${k.slice(step.length + 1)} ${n}`).join(", ")
  lines.push("", "Events per step (EFB document):")
  for (const s of STEPS) lines.push(`  ${s.id}: ${counted(efb.counts, s.id) || "none"}`)
  lines.push("", "Events per step (frame):")
  for (const s of STEPS) lines.push(`  ${s.id}: ${frame ? counted(frame.counts, s.id) || "none" : "no frame"}`)
  lines.push("", `Fields: plain ${JSON.stringify(efb.plain)}, focused ${JSON.stringify(efb.focused)}, frame ${JSON.stringify(frame ? frame.value : null)}; list scrolled to ${efb.listScroll}px`)
  lines.push(`Triggers: ${JSON.stringify(efb.triggers)}`)
  lines.push(`SetInputTextFromOS: ${JSON.stringify(efb.textFromOS)}`)
  lines.push("", `Fonts (EFB document): ${JSON.stringify(efb.fonts)}`)
  lines.push(`Fonts (frame): ${frame ? JSON.stringify(frame.fonts) : "no frame"}`)
  lines.push("", `p18 in Coherent GT: ${p18Result ? "" : "no result"}`)
  if (p18Result) {
    lines.push(`  ${p18Result.userAgent}; sim globals ${JSON.stringify(p18Result.simGlobals)}`)
    for (const c of p18Result.checks) lines.push(`    ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`)
    if (p18Result.errors.length) lines.push(`  errors: ${p18Result.errors.join(" | ")}`)
  }
  if (shot) lines.push(`  screenshot: ${shot.error ? shot.error : repoRelative(shot.file)}`)
  lines.push("", "First events of each type, per step:")
  for (const e of efb.log) lines.push(`  efb   ${JSON.stringify(e)}`)
  for (const e of frame ? frame.log : []) lines.push(`  frame ${JSON.stringify(e)}`)
  const file = resultFile("interface", "p19-efb-input", "txt", when)
  fs.writeFileSync(file, lines.join("\n") + "\n")
  console.log(lines.slice(0, lines.indexOf("First events of each type, per step:")).join("\n"))
  console.log(`saved ${repoRelative(file)}`)
  server.close()
  process.exit(0)
}

main().catch(async (e) => {
  console.error(e.stack ?? String(e))
  console.log(`unlock: ${await unlock()}`)
  process.exit(1)
})
