/*
 * p31's look inside the sim while a Dual Input session flies, to find what of ours costs the sim's
 * frame beyond the figures: which of the sim's documents run our code, what each shows, how much
 * time each document's animation-frame and timer callbacks take, and the sim's frame rate. Start
 * `run.ts hold` first, and wait for target/p31/hold/ready.json.
 *
 *   node experiments/areas/product/p31-tool-cost/pages.mjs look
 *   node experiments/areas/product/p31-tool-cost/pages.mjs meter [seconds]
 *   node experiments/areas/product/p31-tool-cost/pages.mjs fps [seconds]
 *
 * Each command prints its report and saves it in experiments/areas/product/results/.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { Recorder } from "../../aircraft/lib/out.mjs"
import { Sim } from "../../aircraft/lib/sim.mjs"
import { Inspector, listPages } from "../../../tools/inspector.mjs"

const RESULTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "results")
const [command, arg] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Runs `expression` in every inspectable document, each answer or error by its page. */
async function everywhere(expression) {
  const out = []
  for (const page of await listPages()) {
    const insp = new Inspector(page.id)
    try {
      await insp.open(4000)
      out.push({ page, value: await insp.evaluate(expression) })
    } catch (e) {
      out.push({ page, error: e.message })
    } finally {
      insp.close()
    }
  }
  return out
}

// What a document holds of ours and what it shows. It runs in Coherent GT, so it keeps to ES5.
const LOOK = `(function () {
  var scripts = [].slice.call(document.scripts).map(function (s) { return s.src || "" })
  var ours = scripts.filter(function (s) { return /DualInput/i.test(s) })
  var shown = function (e) { if (!e || e.offsetParent === null) return false; var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  var canvases = [].slice.call(document.querySelectorAll("canvas"))
  var body = document.body ? document.body.getBoundingClientRect() : null
  return {
    ours: ours.map(function (s) { return s.replace(/^.*html_ui\\//i, "") }),
    scripts: scripts.length,
    visibility: document.visibilityState,
    body: body ? [Math.round(body.width), Math.round(body.height)] : null,
    elements: document.getElementsByTagName("*").length,
    canvases: canvases.length,
    canvasesShown: canvases.filter(shown).length,
    text: document.body ? String(document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 160) : ""
  }
})()`

// Times every animation-frame and timer callback scheduled from now on, and every timer that
// fires. The first call installs it and the second reads and removes it, putting each original back.
// It's a panel global, so it takes our probe's name in the sim's shared namespace.
const METER = `(function () {
  var m = window.DUALINPUT_P31_METER
  if (m) {
    window.requestAnimationFrame = m.raf0; window.setTimeout = m.st0; window.setInterval = m.si0
    delete window.DUALINPUT_P31_METER
    return { seconds: (performance.now() - m.t0) / 1000, frames: m.frames, frameMs: m.frameMs, timers: m.timers, timerMs: m.timerMs, longest: m.longest }
  }
  m = window.DUALINPUT_P31_METER = { t0: performance.now(), frames: 0, frameMs: 0, timers: 0, timerMs: 0, longest: 0,
    raf0: window.requestAnimationFrame, st0: window.setTimeout, si0: window.setInterval }
  function timed(cb, kind) {
    return function () {
      var s = performance.now()
      try { return cb.apply(this, arguments) } finally {
        var d = performance.now() - s
        if (kind === "frame") { m.frames++; m.frameMs += d } else { m.timers++; m.timerMs += d }
        if (d > m.longest) m.longest = d
      }
    }
  }
  window.requestAnimationFrame = function (cb) { return m.raf0.call(window, typeof cb === "function" ? timed(cb, "frame") : cb) }
  window.setTimeout = function (cb) { var a = [].slice.call(arguments); if (typeof cb === "function") a[0] = timed(cb, "timer"); return m.st0.apply(window, a) }
  window.setInterval = function (cb) { var a = [].slice.call(arguments); if (typeof cb === "function") a[0] = timed(cb, "timer"); return m.si0.apply(window, a) }
  return "installed"
})()`

function save(name, lines) {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-")
  const file = path.join(RESULTS, `p31-pages-${name}-${stamp}.txt`)
  fs.mkdirSync(RESULTS, { recursive: true })
  fs.writeFileSync(file, `${lines.join("\n")}\n`)
  console.log(lines.join("\n"))
  console.log(`\nsaved ${path.relative(process.cwd(), file)}`)
}

const label = (page) => `${String(page.id).padStart(3)}  ${String(page.title || "(untitled)").slice(0, 40).padEnd(40)} ${page.url || ""}`

async function look() {
  const lines = [`p31 pages: what each of the sim's documents holds of ours, ${new Date().toString()}`, ""]
  for (const { page, value, error } of await everywhere(LOOK)) {
    lines.push(label(page))
    if (error) lines.push(`       error: ${error}`)
    else {
      lines.push(`       ours: ${value.ours.join(", ") || "none"}; ${value.scripts} scripts; ${value.visibility}; body ${value.body?.join("x") ?? "none"}; ${value.elements} elements; canvases ${value.canvasesShown} shown of ${value.canvases}`)
      if (value.text) lines.push(`       text: ${value.text}`)
    }
  }
  save("look", lines)
}

async function meter(seconds) {
  const lines = [`p31 pages: each document's animation-frame and timer callbacks over ${seconds}s, ${new Date().toString()}`, ""]
  const installed = await everywhere(METER)
  for (const { page, error } of installed) if (error) lines.push(`${label(page)}\n       not metered: ${error}`)
  await sleep(seconds * 1000)
  const read = await everywhere(`window.DUALINPUT_P31_METER ? ${METER} : null`)
  const rows = read.filter((r) => r.value).map((r) => ({ page: r.page, ...r.value }))
  rows.sort((a, b) => b.frameMs + b.timerMs - (a.frameMs + a.timerMs))
  let total = 0
  for (const r of rows) {
    const msPerSecond = (r.frameMs + r.timerMs) / r.seconds
    total += msPerSecond
    lines.push(label(r.page))
    lines.push(`       ${msPerSecond.toFixed(2)}ms of callbacks a second: ${(r.frames / r.seconds).toFixed(1)} frame callbacks a second, ${(r.frameMs / r.seconds).toFixed(2)}ms; ${(r.timers / r.seconds).toFixed(1)} timers a second, ${(r.timerMs / r.seconds).toFixed(2)}ms; longest ${r.longest.toFixed(2)}ms`)
  }
  for (const r of read.filter((r) => r.error)) lines.push(`${label(r.page)}\n       not read: ${r.error}`)
  lines.push("", `every document together: ${total.toFixed(2)}ms of callbacks a second`)
  save("meter", lines)
}

async function fps(seconds) {
  const sim = await Sim.connect(new Recorder("p31-pages", { area: "product" }), { name: "DUALINPUT P31 pages" })
  try {
    const r = await sim.frameRate(seconds * 1000)
    save("fps", [`p31 pages: the sim's frame rate over ${seconds}s, ${new Date().toString()}`, "", `${r.fps?.toFixed(2)} fps from ${r.deliveries} frames' data, ${(1000 / r.fps).toFixed(2)}ms a frame; the Frame event's mean ${r.frameEventFps?.toFixed(2)} fps over ${r.frameEvents}; longest gap ${r.maxGapMs?.toFixed(1)}ms`])
  } finally {
    sim.close?.()
  }
}

if (command === "look") await look()
else if (command === "meter") await meter(Number(arg ?? 20))
else if (command === "fps") await fps(Number(arg ?? 30))
else {
  console.error("usage: node experiments/areas/product/p31-tool-cost/pages.mjs look | meter [seconds] | fps [seconds]")
  process.exit(1)
}
