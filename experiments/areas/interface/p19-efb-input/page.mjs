/*
 * The code p19 runs in the sim: build.mjs writes it into the EFB app's script,
 * and p19-efb-input.mjs into the frame's page. The functions are written in
 * ES2017's syntax, since Coherent GT runs them, and travel as their source, so
 * each may call only the others here.
 */

export const PORT = 47_819
export const ORIGIN = `http://127.0.0.1:${PORT}`

// Every event either document logs, in the capture phase, without stopping any.
export const TYPES = [
  "pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel",
  "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave", "click", "dblclick", "auxclick", "contextmenu",
  "wheel", "mousewheel", "touchstart", "touchmove", "touchend", "touchcancel",
  "focus", "blur", "focusin", "focusout", "keydown", "keypress", "keyup", "beforeinput", "input", "change",
  "compositionstart", "compositionupdate", "compositionend",
]

export const SAMPLE = "Dual Input: The quick brown fox, 0123456789"
export const BOX = "background: #1e6a91; color: #fff; height: 56px; line-height: 56px; text-align: center; font-size: 18px; border-radius: 10px; margin-top: 8px"
export const FIELD = "display: block; width: 100%; box-sizing: border-box; height: 36px; margin-top: 8px; padding: 0 10px; font-size: 16px; color: #fafafa; background: #0a0a0a; border: 1px solid #3a3a3a; border-radius: 8px"

export const fontCss = (family, src, format) => `@font-face { font-family: "${family}"; src: url("${src}") format("${format}"); font-weight: 400; font-style: normal; }`

// A line in each face, and off-screen copies to measure.
export const fontBlock = (faces) => `
  ${faces.map((f) => `<div style="font-family: '${f.family}', monospace; font-size: 15px; margin-top: 4px">${f.label}: ${SAMPLE}</div>`).join("\n  ")}
  <div style="position: absolute; left: -4000px; top: 0; white-space: nowrap; font-size: 20px">
    ${faces.map((f) => `<span id="p19-measure-${f.family}" style="font-family: '${f.family}', monospace">${SAMPLE}</span><br>`).join("")}
    <span id="p19-measure-mono" style="font-family: monospace">${SAMPLE}</span>
  </div>`

// Keeps every event's count per step, and the first four of each type per step.
export function recorder(types) {
  var rec = { step: "setup", counts: {}, log: [] }
  rec.handler = function (e) {
    var t = e.target
    var target = (t && t.id) || (t && t.nodeName) || "?"
    var key = rec.step + " " + e.type
    rec.counts[key] = (rec.counts[key] || 0) + 1
    if (rec.counts[key] > 4) return
    rec.log.push({
      step: rec.step, type: e.type, target: target, trusted: e.isTrusted, prevented: e.defaultPrevented, cls: e.constructor && e.constructor.name,
      button: e.button, x: e.clientX, y: e.clientY, keyCode: e.keyCode, charCode: e.charCode, key: e.key, data: e.data, t: Date.now(),
    })
  }
  for (var i = 0; i < types.length; i++) document.addEventListener(types[i], rec.handler, true)
  rec.stop = function () { for (var j = 0; j < types.length; j++) document.removeEventListener(types[j], rec.handler, true) }
  rec.env = {
    href: location.href, userAgent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight,
    PointerEvent: typeof window.PointerEvent, TouchEvent: typeof window.TouchEvent, Coherent: typeof window.Coherent,
  }
  return rec
}

// A face drew if the same text in it, with a monospace fallback, differs in
// width from the text in monospace alone.
export function measureFonts(faces) {
  var out = {}
  var mono = document.getElementById("p19-measure-mono")
  for (var i = 0; i < faces.length; i++) {
    var a = document.getElementById("p19-measure-" + faces[i])
    out[faces[i]] = { width: a ? a.offsetWidth : -1, monospace: mono ? mono.offsetWidth : -1, drew: !!(a && mono && a.offsetWidth !== mono.offsetWidth) }
  }
  return out
}

// The app's screen, built in `root` once the EFB renders the app's view. Field 2
// takes focus the way the EFB's own text box does: it cancels the press, focuses
// the input itself, and asks the sim for the keyboard (read in MSFS 2024's
// efb_os.js, the text box's onmousedown and onFocusIn).
export function mountApp(root, cfg) {
  if (window.DUALINPUT_P19) return "mounted already"
  var rec = recorder(cfg.types)
  var state = window.DUALINPUT_P19 = { rec: rec, triggers: [], textFromOS: [], focused: {}, hoverBg: null, views: [] }
  root.innerHTML = cfg.html

  function trigger(name, a, b, c, d, e) {
    var args = [a, b, c, d, e].filter(function (x) { return x !== undefined })
    state.triggers.push({ name: name, args: args, step: rec.step, t: Date.now() })
    try { Coherent.trigger.apply(Coherent, [name].concat(args)) } catch (err) { state.triggers.push({ name: name, error: String(err) }) }
  }

  var box = document.getElementById("p19-box")
  box.addEventListener("mouseover", function () {
    setTimeout(function () { state.hoverBg = getComputedStyle(box).backgroundColor }, 50)
  })

  var plain = document.getElementById("p19-plain")
  var focused = document.getElementById("p19-focused")
  function fromOS(text) { state.textFromOS.push({ text: String(text), step: rec.step, t: Date.now() }); focused.value = String(text) }
  function outside() { focused.blur() }
  document.getElementById("p19-focused-wrap").addEventListener("mousedown", function (e) {
    e.preventDefault()
    if (document.activeElement !== focused) focused.focus()
  })
  focused.addEventListener("focus", function () {
    state.focused.DUALINPUT_P19_FIELD = true
    trigger("FOCUS_INPUT_FIELD", { title: "Title", description: "", default_text: "", is_numeric: false, is_efb: true })
    try { Coherent.on("mousePressOutsideView", outside); Coherent.on("SetInputTextFromOS", fromOS) } catch (err) { /* in a browser */ }
  })
  focused.addEventListener("blur", function () {
    trigger("UNFOCUS_INPUT_FIELD", "DUALINPUT_P19_FIELD")
    try { Coherent.off("mousePressOutsideView", outside); Coherent.off("SetInputTextFromOS", fromOS) } catch (err) { /* in a browser */ }
  })

  // The frame asks for the keyboard the way Fenix's EFB app's frame does
  // (read in fnx-aircraft-320 2.4.0.4720, FenixSimEfbApp.js, IframeListener).
  window.addEventListener("message", function (e) {
    var d = e.data
    if (!d || !d.command || !d.guid) return
    if (d.command === "FOCUS") { state.focused[d.guid] = true; trigger("FOCUS_INPUT_FIELD", d.guid, "", "", "", false) }
    if (d.command === "UNFOCUS") trigger("UNFOCUS_INPUT_FIELD", d.guid)
  })

  var frame = document.getElementById("p19-frame")
  var scroller = document.getElementById("p19-scroll")

  // Gives the sim its keyboard back, whatever holds it.
  state.release = function () {
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() } catch (err) { /* nothing focused */ }
    for (var g in state.focused) trigger("UNFOCUS_INPUT_FIELD", g)
    return "released"
  }
  window.DUALINPUT_P19_UNLOCK = state.release
  window.DUALINPUT_P19_STEP = function (id, text, highlight) {
    rec.step = id
    document.getElementById("p19-step").textContent = text
    var all = root.querySelectorAll("[data-p19-target]")
    for (var i = 0; i < all.length; i++) all[i].style.outline = all[i].getAttribute("data-p19-target") === highlight ? "3px solid #f1be4d" : "none"
    try { frame.contentWindow.postMessage({ p19Step: id }, "*") } catch (err) { /* no frame yet */ }
    if (highlight === "frame") scroller.scrollTop = frame.offsetTop - 120
    if (highlight === "click") scroller.scrollTop = 0
    return id
  }
  window.DUALINPUT_P19_LOAD_FRAME = function (src) { frame.src = src; return src }
  window.DUALINPUT_P19_START_P18 = function (reportUrl) {
    window.DUALINPUT_P18_REPORT_URL = reportUrl
    var host = document.getElementById("dualinput-p18")
    window.DUALINPUT_P18_START(host)
    scroller.scrollTop = host.offsetTop - 8
    return "started"
  }
  window.DUALINPUT_P19_READ = function () {
    var r = root.getBoundingClientRect()
    return {
      env: rec.env, counts: rec.counts, log: rec.log, triggers: state.triggers, textFromOS: state.textFromOS, views: state.views,
      plain: plain.value, focused: focused.value, listScroll: document.getElementById("p19-list").scrollTop, hoverBg: state.hoverBg,
      active: document.activeElement ? document.activeElement.id || document.activeElement.nodeName : null,
      root: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      fonts: measureFonts(cfg.faces),
    }
  }
  return "mounted"
}

// The frame's page: the same recorder, a box, and a field that asks the EFB's
// document for the keyboard. It posts what it saw every 400ms for 10 minutes.
export function framePage(cfg) {
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
  var timer = setInterval(post, 400)
  setTimeout(function () { clearInterval(timer); rec.stop() }, 600000)
}
