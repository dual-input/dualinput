/*
 * p24's press check: why a quick click shows no feedback and hover feels late in the sim's EFB. It
 * records, inside the EFB's document, every frame's time and every press and hover with the frame it
 * fell in, while a pilot clicks quickly and sweeps the mouse over buttons on the kit's page.
 *
 *   node experiments/areas/interface/p24-efb-scale/press.mjs
 *
 * Page Down starts the 15s, a beep says so, and a higher beep ends it. The recorder takes its listeners
 * out when it's read, and goes by itself after 60s.
 */

import { startBeeper, startKeys } from "../../../tools/guide.mjs"
import { Inspector, listPages } from "../../../tools/inspector.mjs"
import { repoRelative, saveResult } from "../../../tools/results.mjs"

const NAME = "p24-efb-scale-press"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)

// ES2017's syntax. It reads, on each frame after a press, whether :active shows on the pressed button
// and where the button sits, and on each frame after a hover begins, the button's background.
const INSTALL = `(function () {
  var old = window.DUALINPUT_P24_PRESS;
  if (old) old.stop();
  var r = { frames: [], events: [], watched: [], t0: performance.now(), running: true };
  var now = function () { return Math.round((performance.now() - r.t0) * 10) / 10; };
  var isButton = function (e) { return e && e.closest ? e.closest("button") : null; };
  var hovered = null, hoverAt = 0, hoverFrom = "", pressed = null, pressAt = 0, pressTop = 0, sawActive = false, sawMoved = false;
  var frame = function () {
    if (!r.running) return;
    var t = now();
    r.frames.push(t);
    if (hovered) {
      var bg = getComputedStyle(hovered).backgroundColor;
      if (bg !== hoverFrom) { r.watched.push({ kind: "hover shows", after: Math.round(t - hoverAt), bg: bg, frames: r.frames.length }); hoverFrom = bg; }
    }
    if (pressed) {
      if (pressed.matches(":active")) sawActive = true;
      if (Math.abs(pressed.getBoundingClientRect().top - pressTop) > 0.05) sawMoved = true;
    }
    requestAnimationFrame(frame);
  };
  var on = function (name, f) { window.addEventListener(name, f, true); return function () { window.removeEventListener(name, f, true); }; };
  var offs = [
    on("mouseover", function (e) { var b = isButton(e.target); if (b && b !== hovered) { hovered = b; hoverAt = now(); hoverFrom = getComputedStyle(b).backgroundColor; r.events.push({ t: hoverAt, type: "enter", frame: r.frames.length, text: b.textContent.slice(0, 16), transition: getComputedStyle(b).transitionDuration }); } else if (!b) hovered = null; }),
    on("mousedown", function (e) { var b = isButton(e.target); pressed = b; pressAt = now(); sawActive = false; sawMoved = false; if (b) pressTop = b.getBoundingClientRect().top; r.events.push({ t: pressAt, type: "down", frame: r.frames.length, button: !!b }); }),
    on("mouseup", function () { var t = now(); r.events.push({ t: t, type: "up", frame: r.frames.length, heldFor: Math.round(t - pressAt), sawActive: sawActive, sawMoved: sawMoved }); }),
    on("click", function () { r.events.push({ t: now(), type: "click", frame: r.frames.length }); })
  ];
  r.stop = function () { r.running = false; offs.forEach(function (f) { f(); }); };
  window.DUALINPUT_P24_PRESS = r;
  requestAnimationFrame(frame);
  setTimeout(r.stop, 60000);
  return "recording";
})()`

const READ = `(function () { var r = window.DUALINPUT_P24_PRESS; r.stop(); return { frames: r.frames, events: r.events, watched: r.watched }; })()`

const page = (await listPages()).find((p) => String(p.title || "") === "Electronic Flight Bag")
if (!page) throw new Error("no EFB document")
const keys = await startKeys()
const beep = startBeeper()
console.log("In the sim, with the EFB open on Dual Input P24: scroll to the buttons, then press Page Down.")
await keys.next()
const efb = new Inspector(page.id)
await efb.open()
console.log(await efb.evaluate(INSTALL))
efb.close()
beep(1000, 150)
console.log("Recording for 15s: click buttons quickly a few times, then sweep the mouse over them.")
await sleep(15000)
beep(1500, 200)
const reader = new Inspector(page.id)
await reader.open()
const r = await reader.evaluate(READ)
reader.close()

const gaps = r.frames.slice(1).map((t, i) => Math.round((t - r.frames[i]) * 10) / 10)
const ups = r.events.filter((e) => e.type === "up")
const lines = [
  `${NAME}, ${new Date().toISOString()}`,
  "",
  `Frames: ${r.frames.length} in ${Math.round(r.frames[r.frames.length - 1] / 100) / 10}s; between frames, median ${median(gaps)}ms, longest ${Math.max(...gaps)}ms`,
  "",
  `Presses: ${ups.length}`,
  ...ups.map((u) => `  held ${u.heldFor}ms, :active seen on a frame ${u.sawActive}, the button moved on a frame ${u.sawMoved}`),
  "",
  `Hovers: ${r.events.filter((e) => e.type === "enter").length} entered, ${r.watched.length} color changes`,
  `  The first color change after an enter, by the frames' clock: ${JSON.stringify(r.watched.slice(0, 12))}`,
  `  Transition durations on what was entered: ${[...new Set(r.events.filter((e) => e.type === "enter").map((e) => e.transition))].join(", ")}`,
  "",
  "Every event:",
  ...r.events.slice(0, 120).map((e) => `  ${JSON.stringify(e)}`),
]
const text = lines.join("\n")
console.log(text)
console.log(`saved ${repoRelative(saveResult("interface", NAME, text))}`)
process.exit(0)
