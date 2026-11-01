/*
 * The screen of p23's EFB app: React drawing in the EFB's own document, as the product's app would,
 * with a button, a list, and a controlled field that take the pilot's real mouse and keyboard.
 * build-efb.mjs bundles this with the app's registration, and p23-page-frameworks.mjs drives it through
 * the inspector. It also loads each framework's timed page into this document on request, so each runs
 * as the product's page would, in an element of the app's screen with no frame around it.
 *
 * The field takes the keyboard from the sim, so the app gives it back at each step's end, when it
 * leaves the screen, and from window.DUALINPUT_P23_UNLOCK(), which the script calls at exit
 * (CLAUDE.md, Before writing code that runs in a panel).
 */

import { useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

import { BOX, FIELD, recorder, TYPES } from "../p19-efb-input/page.mjs"

const w = window as any
const seen = { clicks: 0, mouseDowns: 0, mouseEnters: 0, wheels: 0, focuses: 0, blurs: 0, changes: [] as string[], osText: [] as string[], triggers: [] as unknown[] }
let setStepText: (text: string) => void = () => {}
let setFieldText: (text: string) => void = () => {}
let shownText = ""
let shownPresses = 0
let rec: any

function trigger(name: string, ...args: unknown[]) {
  seen.triggers.push({ name, args })
  try { w.Coherent.trigger(name, ...args) } catch (e) { seen.triggers.push({ name, error: String(e) }) }
}

function fromOS(text: unknown) {
  seen.osText.push(String(text))
  setFieldText(String(text))
}
const clickedOutside = () => (document.getElementById("p23-field") as HTMLInputElement | null)?.blur()

function Room({ open, children }: { open: boolean; children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const measured = inner.current?.offsetHeight ?? 0
    if (measured !== height) setHeight(measured)
  })
  return (
    <div id="p23-room" style={{ height: open ? height : 0, overflow: "hidden", transition: "height 220ms ease-in-out" }}>
      <div ref={inner} style={{ padding: "8px 0", color: "#a3a3a3" }}>{children}</div>
    </div>
  )
}

const inlineStyle = (css: string) => {
  const style: Record<string, string> = {}
  for (const part of css.split(";")) {
    const at = part.indexOf(":")
    if (at < 0) continue
    style[part.slice(0, at).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = part.slice(at + 1).trim()
  }
  return style
}

function Guided() {
  const [step, setStep] = useState("Waiting for p23 to start.")
  const [presses, setPresses] = useState(0)
  const [text, setText] = useState("")
  const field = useRef<HTMLInputElement>(null)
  setStepText = setStep
  setFieldText = setText
  shownText = text
  shownPresses = presses
  return (
    <div style={{ padding: "36px 14px 14px", fontSize: 14 }}>
      <div style={{ fontSize: 12, color: "#a3a3a3" }}>Dual Input p23: React in the EFB. Page Up skips a step.</div>
      <div id="p23-step" style={{ fontSize: 18, color: "#74d4ff", marginTop: 6, minHeight: 44 }}>{step}</div>
      <button
        id="p23-press"
        className="p23-box"
        style={{ ...inlineStyle(BOX), display: "block", width: "100%", border: 0 }}
        onMouseEnter={() => { seen.mouseEnters++ }}
        onMouseDown={() => { seen.mouseDowns++ }}
        onClick={() => { seen.clicks++; setPresses((n) => n + 1) }}
      >
        Press
      </button>
      <div style={{ marginTop: 6 }}>Pressed {presses} {presses === 1 ? "time" : "times"}</div>
      <Room open={presses % 2 === 1}>React opened this room after your click, and measured its height.</Room>
      <div id="p23-list" onWheel={() => { seen.wheels++ }} style={{ height: 72, overflowY: "auto", marginTop: 8, background: "#262626", borderRadius: 8, padding: "0 10px" }}>
        {Array.from({ length: 30 }, (_, i) => <div key={i} style={{ height: 24, lineHeight: "24px" }}>List row {i + 1}</div>)}
      </div>
      {/* The field cancels the press and focuses itself, as the EFB's own text box does (decisions.md). */}
      <div onMouseDown={(e) => { e.preventDefault(); if (document.activeElement !== field.current) field.current?.focus() }}>
        <input
          id="p23-field"
          ref={field}
          className="p23-field"
          style={inlineStyle(FIELD)}
          placeholder="Type here"
          value={text}
          onChange={(e) => { seen.changes.push(e.target.value); setText(e.target.value) }}
          onFocus={() => {
            seen.focuses++
            trigger("FOCUS_INPUT_FIELD", { title: "Title", description: "", default_text: "", is_numeric: false, is_efb: true })
            try { w.Coherent.on("mousePressOutsideView", clickedOutside); w.Coherent.on("SetInputTextFromOS", fromOS) } catch { /* nothing to listen on */ }
          }}
          onBlur={() => {
            seen.blurs++
            trigger("UNFOCUS_INPUT_FIELD", "DUALINPUT_P23_FIELD")
            try { w.Coherent.off("mousePressOutsideView", clickedOutside); w.Coherent.off("SetInputTextFromOS", fromOS) } catch { /* nothing to listen on */ }
          }}
        />
      </div>
      <div style={{ marginTop: 6 }}>Typed: <span id="p23-mirror" style={{ fontFamily: "monospace" }}>{text}</span></div>
    </div>
  )
}

w.DUALINPUT_P23_MOUNT = (root: HTMLElement) => {
  if (w.DUALINPUT_P23_MOUNTED) return "mounted already"
  rec = recorder(TYPES)
  root.innerHTML = `<div id="p23-scroll" style="height: 100%; overflow-y: auto; box-sizing: border-box; background: #0a0a0a; color: #fafafa; font-family: sans-serif"><div id="p23-guided"></div><div id="dualinput-p18"></div></div>`
  createRoot(document.getElementById("p23-guided") as HTMLElement).render(<Guided />)
  return "mounted"
}

w.DUALINPUT_P23_STEP = (id: string, text: string) => {
  rec.step = id
  setStepText(text)
  return id
}

w.DUALINPUT_P23_READ = () => {
  const room = document.getElementById("p23-room")
  const list = document.getElementById("p23-list")
  const field = document.getElementById("p23-field") as HTMLInputElement | null
  return {
    seen,
    env: rec?.env,
    counts: rec?.counts,
    presses: shownPresses,
    state: shownText,
    field: field?.value,
    mirror: document.getElementById("p23-mirror")?.textContent,
    roomHeight: room?.offsetHeight,
    listScroll: list?.scrollTop,
    active: document.activeElement ? document.activeElement.id || document.activeElement.nodeName : null,
  }
}

w.DUALINPUT_P23_UNLOCK = () => {
  try { (document.activeElement as HTMLElement | null)?.blur?.() } catch { /* nothing focused */ }
  trigger("UNFOCUS_INPUT_FIELD", "DUALINPUT_P23_FIELD")
  return "released"
}

// Timing shouldn't carry the listeners the recorder keeps on every event.
w.DUALINPUT_P23_STOP_RECORDER = () => { rec?.stop(); return "stopped" }

// A fresh element for each timed page, since a page's framework leaves its listeners on the one it had.
w.DUALINPUT_P23_RESET_HOST = () => {
  const old = document.getElementById("dualinput-p18") as HTMLElement
  const fresh = document.createElement("div")
  fresh.id = "dualinput-p18"
  old.parentNode?.replaceChild(fresh, old)
  return "reset"
}

// Fetches a timed page's bundle first, so the time it reports is parse and first run, with no loading.
w.DUALINPUT_P23_LOAD = (file: string, framework: string, origin: string) => {
  w.P23_ERRORS = []
  w.P23_FRAMEWORK = framework
  w.P23_REPORT_URL = `${origin}/result`
  w.P23_RAN = false
  const x = new XMLHttpRequest()
  x.open("GET", `${origin}/bundle/${file}.js`)
  x.onload = () => {
    const s = document.createElement("script")
    s.text = x.responseText
    const t0 = performance.now()
    document.head.appendChild(s)
    w.P23_EVAL_MS = Math.round((performance.now() - t0) * 100) / 100
    if (!w.P23_RAN) {
      const r = new XMLHttpRequest()
      r.open("POST", w.P23_REPORT_URL)
      r.setRequestHeader("content-type", "text/plain")
      r.send(JSON.stringify({ framework, evalMs: w.P23_EVAL_MS, checks: [], bursts: [], errors: w.P23_ERRORS, threw: true }))
    }
  }
  x.send()
  return "loading"
}
