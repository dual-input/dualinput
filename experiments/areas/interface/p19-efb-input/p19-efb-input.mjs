/*
 * p19: what an EFB app gets from the pilot's mouse and keyboard, which font
 * files it can load, and whether p18's page, the MSFS Avionics Framework
 * outside the sim's own build of it, renders inside an app. Stage 11b's
 * one-front-end question (record/areas/interface/decisions.md).
 *
 *   node experiments/areas/interface/p18-fscomponent/p18-fscomponent.mjs
 *   node experiments/areas/interface/p19-efb-input/build.mjs
 *   (start the sim, open the EFB, open the app "Dual Input P19")
 *   node experiments/areas/interface/p19-efb-input/p19-efb-input.mjs
 *
 * The app, which build.mjs packages, holds every target; this script serves
 * the app's frame on 127.0.0.1, reads the app through the inspector
 * (experiments/tools/inspector.mjs), and runs the steps, each shown on the
 * app's screen with a beep:
 *   1. click the box;
 *   2. scroll the list with the wheel;
 *   3. click field 1, a plain input, and type abc;
 *   4. click field 2 and type abc, where the field takes focus the way the
 *      EFB's own text box does (page.mjs, mountApp);
 *   5. click the box in the frame;
 *   6. click the frame's field and type abc, where the frame asks the app for
 *      the keyboard, as Fenix's EFB app's frame does.
 * A step ends on its own once its action is seen, or after 25s; Page Up skips it.
 * Then it starts p18's page inside the app, and screenshots it.
 *
 * Field 2 and the frame's field take the keyboard from the sim, so the app
 * gives it back at each step's end, when it leaves the screen, and from
 * window.DUALINPUT_P19_UNLOCK() in the EFB's document, which this script calls
 * at exit (CLAUDE.md, Before writing code that runs in a panel).
 */

import fs from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { startBeeper, startKeys } from "../../../tools/guide.mjs"
import { Inspector, listPages } from "../../../tools/inspector.mjs"
import { repoRelative, resultFile, stamp } from "../../../tools/results.mjs"
import { startShooter } from "../../../tools/shot.mjs"
import { BOX, FIELD, ORIGIN, PORT, TYPES, fontBlock, fontCss, framePage, measureFonts, recorder } from "./page.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FONTS = path.join(HERE, "node_modules/geist/dist/fonts/geist-sans")
const RESULTS = path.join(HERE, "../results")
const STEP_MS = 25_000
const when = stamp()

const STEPS = [
  { id: "click", text: "Click the blue box once.", highlight: "click" },
  { id: "wheel", text: "Scroll the list below the box with the mouse wheel.", highlight: "wheel" },
  { id: "plain", text: "Click field 1 and type abc.", highlight: "plain" },
  { id: "focused", text: "Click field 2 and type abc.", highlight: "focused" },
  { id: "frameClick", text: "Click the blue box inside the frame.", highlight: "frame" },
  { id: "frameType", text: "Click the frame's field and type abc.", highlight: "frame" },
]

// ---------------------------------------------------------------- the frame

const FRAME_FACES = [
  { family: "P19-Http-TTF", label: "TTF, from 127.0.0.1", css: fontCss("P19-Http-TTF", "/fonts/Geist-Regular.ttf", "truetype") },
  { family: "P19-Http-WOFF2", label: "WOFF2, from 127.0.0.1", css: fontCss("P19-Http-WOFF2", "/fonts/Geist-Regular.woff2", "woff2") },
]

const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
${FRAME_FACES.map((f) => f.css).join("\n")}
body { margin: 0; padding: 10px; background: #171717; color: #fafafa; font-family: sans-serif; font-size: 14px; }
#p19-frame-box { ${BOX} }
#p19-frame-box:hover { background: #2a86b6; }
#p19-frame-field { ${FIELD} }
#p19-frame-field:hover { border-color: #74d4ff; }
#p19-frame-field:focus { border-color: #f1be4d; outline: none; }
</style></head><body>
<div style="font-size: 12px; color: #a3a3a3">Frame from ${ORIGIN}</div>
<div id="p19-frame-box">Box in the frame</div>
<input id="p19-frame-field" placeholder="Frame field">
<div style="position: relative">${fontBlock(FRAME_FACES)}</div>
<script>
${recorder.toString()}
${measureFonts.toString()}
(${framePage.toString()})(${JSON.stringify({ types: TYPES, faces: FRAME_FACES.map((f) => f.family) })})
</script></body></html>`

// ---------------------------------------------------------------- the server

let frameState = null
let p18Result = null

const send = (res, type, body) => { res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" }); res.end(body) }
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => resolve(b)) })

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN)
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" })
    res.end()
    return
  }
  if (req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    if (url.pathname === "/frame-log") frameState = body
    if (url.pathname === "/result") p18Result = body
    res.writeHead(204, { "access-control-allow-origin": "*" })
    res.end()
    return
  }
  if (url.pathname === "/frame") return send(res, "text/html", FRAME_HTML)
  if (url.pathname.startsWith("/fonts/")) {
    const file = path.join(FONTS, path.basename(url.pathname))
    if (fs.existsSync(file)) return send(res, file.endsWith(".ttf") ? "font/ttf" : "font/woff2", fs.readFileSync(file))
  }
  res.writeHead(404)
  res.end()
})

// ---------------------------------------------------------------- the steps

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const count = (counts, step, types) => types.reduce((n, t) => n + (counts?.[`${step} ${t}`] || 0), 0)

// Whether a step's action happened, from what the app and the frame read back.
function stepDone(id, app, frame) {
  if (id === "click") return count(app.counts, id, ["click"]) > 0
  if (id === "wheel") return app.listScroll > 0
  if (id === "plain") return app.plain.length >= 3
  if (id === "focused") return app.focused.length >= 3
  if (id === "frameClick") return count(frame?.counts, id, ["click"]) > 0
  if (id === "frameType") return (frame?.value ?? "").length >= 3
  return false
}

// Keys pressed with no text arriving end a typing step 6s after the first key.
const typed = (id, app, frame) => count(id === "frameType" ? frame?.counts : app.counts, id, ["keydown", "keypress"]) > 0

// Waits for the EFB's document, then for the app's screen in it, which exists
// once the EFB has started with the package installed.
async function findApp() {
  for (;;) {
    let pages = []
    try { pages = await listPages() } catch (e) { console.log(e.message.split("\n")[0]) }
    const efb = pages.find((p) => String(p.title || "") === "Electronic Flight Bag")
    if (efb) {
      const insp = new Inspector(efb.id)
      await insp.open()
      const state = await insp.evaluate("({ mounted: window.DUALINPUT_P19_MOUNTED || null, registered: window.DUALINPUT_P19_REGISTERED || null, error: window.DUALINPUT_P19_REGISTER_ERROR || null })")
      if (state.mounted) return { insp, page: efb, state }
      console.log(`The app isn't on screen yet (${JSON.stringify(state)}); open "Dual Input P19" in the EFB. Retrying in 3s.`)
      insp.close()
    } else console.log("No EFB document yet; open the EFB. Retrying in 3s.")
    await sleep(3000)
  }
}

// Set once connected, so an error or Ctrl+C still gives the sim its keyboard back.
let unlock = async () => "not connected"

async function main() {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve))
  const { insp, page, state } = await findApp()
  unlock = async () => { try { return await insp.evaluate("window.DUALINPUT_P19_UNLOCK ? window.DUALINPUT_P19_UNLOCK() : 'nothing'") } catch (e) { return e.message } }
  process.on("SIGINT", async () => { console.log(`unlock: ${await unlock()}`); process.exit(130) })
  console.log(`EFB document ${page.id}: the app is ${state.mounted}`)
  await insp.evaluate(`DUALINPUT_P19_LOAD_FRAME(${JSON.stringify(`${ORIGIN}/frame`)})`)

  const keys = await startKeys()
  const beep = startBeeper()
  await insp.evaluate(`DUALINPUT_P19_STEP("ready", "Press Page Down to start.", "")`)
  console.log("Press Page Down in the sim to start.")
  for (;;) { const k = await keys.next(); if (k.key === "START") break }

  const outcomes = []
  let skipped = false
  const stopListening = keys.listen((k) => { if (k.key === "SKIP") skipped = true })
  for (const [i, step] of STEPS.entries()) {
    const text = `Step ${i + 1} of ${STEPS.length}: ${step.text}`
    await insp.evaluate(`DUALINPUT_P19_STEP(${JSON.stringify(step.id)}, ${JSON.stringify(text)}, ${JSON.stringify(step.highlight)})`)
    console.log(text)
    beep(880, 150)
    skipped = false
    const started = Date.now()
    let outcome = "timed out"
    let firstKey = 0
    while (Date.now() - started < STEP_MS) {
      await sleep(300)
      const app = await insp.evaluate("DUALINPUT_P19_READ()")
      if (stepDone(step.id, app, frameState)) { outcome = "done"; await sleep(1500); break }
      if (/plain|focused|frameType/.test(step.id) && typed(step.id, app, frameState)) {
        firstKey ||= Date.now()
        if (Date.now() - firstKey > 6000) { outcome = "keys pressed, no text arrived"; break }
      }
      if (skipped) { outcome = "skipped"; break }
    }
    await insp.evaluate("DUALINPUT_P19_UNLOCK()")
    outcomes.push({ step: step.id, outcome, ms: Date.now() - started })
    console.log(`  ${outcome}`)
    beep(660, 80)
  }
  stopListening()

  const app = await insp.evaluate("DUALINPUT_P19_READ()")
  const frame = frameState

  await insp.evaluate(`DUALINPUT_P19_STEP("p18", "p18's page, rendered in this app. Nothing to do.", "")`)
  await insp.evaluate(`DUALINPUT_P19_START_P18(${JSON.stringify(`${ORIGIN}/result`)})`)
  for (let i = 0; i < 30 && !p18Result; i++) await sleep(300)
  await sleep(1000)
  const shooter = startShooter(path.join(RESULTS, `p19-efb-input-${when}`))
  const shot = await shooter.shot("p18-in-app")
  shooter.close()

  console.log(`unlock: ${await unlock()}`)
  insp.close()

  const lines = [`p19-efb-input, ${new Date().toISOString()}`, ""]
  lines.push(`EFB document: ${JSON.stringify(app.env)}`)
  lines.push(`App's screen: ${JSON.stringify(app.root)}; views ${JSON.stringify(app.views)}`)
  lines.push(`Frame: ${frame ? JSON.stringify(frame.env) : "never posted"}`)
  lines.push("", "Steps:")
  for (const o of outcomes) lines.push(`  ${o.step}: ${o.outcome} (${(o.ms / 1000).toFixed(1)}s)`)
  const counted = (counts, step) => Object.entries(counts || {}).filter(([k]) => k.startsWith(`${step} `)).map(([k, n]) => `${k.slice(step.length + 1)} ${n}`).join(", ")
  lines.push("", "Events per step (EFB document):")
  for (const s of STEPS) lines.push(`  ${s.id}: ${counted(app.counts, s.id) || "none"}`)
  lines.push("", "Events per step (frame):")
  for (const s of STEPS) lines.push(`  ${s.id}: ${frame ? counted(frame.counts, s.id) || "none" : "no frame"}`)
  lines.push("", `Fields: plain ${JSON.stringify(app.plain)}, focused ${JSON.stringify(app.focused)}, frame ${JSON.stringify(frame ? frame.value : null)}; list scrolled to ${app.listScroll}px; box's background under the mouse ${app.hoverBg}`)
  lines.push(`Triggers: ${JSON.stringify(app.triggers)}`)
  lines.push(`SetInputTextFromOS: ${JSON.stringify(app.textFromOS)}`)
  lines.push("", `Fonts (app): ${JSON.stringify(app.fonts)}`)
  lines.push(`Fonts (frame): ${frame ? JSON.stringify(frame.fonts) : "no frame"}`)
  lines.push("", `p18 in the app: ${p18Result ? "" : "no result"}`)
  if (p18Result) {
    lines.push(`  sim globals ${JSON.stringify(p18Result.simGlobals)}`)
    for (const c of p18Result.checks) lines.push(`    ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`)
    if (p18Result.errors.length) lines.push(`  errors: ${p18Result.errors.slice(0, 10).join(" | ")}`)
  }
  lines.push(`  screenshot: ${shot.error ? shot.error : repoRelative(shot.file)}`)
  lines.push("", "First events of each type, per step:")
  for (const e of app.log) lines.push(`  app   ${JSON.stringify(e)}`)
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
