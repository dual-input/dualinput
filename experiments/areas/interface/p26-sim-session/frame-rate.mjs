/*
 * How often the EFB's document draws with our app open, idle and while its tabs change, beside the toolbar's document
 * for the sim's own rate. It waits for the sim to have the focus, since the rates fall without it, and beeps as it
 * starts and ends. Open the EFB on Dual Input's Session tab first.
 *
 *   node experiments/areas/interface/p26-sim-session/frame-rate.mjs
 */

import { spawnSync } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"

import { Inspector, listPages, selectPage } from "../../../tools/inspector.mjs"
import { saveResult } from "../../../tools/results.mjs"

const WAIT_FOR_FOCUS = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class Focus { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }
'@
$sim = (Get-Process FlightSimulator2024).Id
for ($i = 0; $i -lt 600; $i++) {
  $p = 0; [void][Focus]::GetWindowThreadProcessId([Focus]::GetForegroundWindow(), [ref]$p)
  if ($p -eq $sim) { exit 0 }
  Start-Sleep -Milliseconds 500
}
exit 1
`
const beep = (hz) => spawnSync("powershell", ["-NoProfile", "-Command", `[console]::Beep(${hz}, 250)`])

const START = `(function(){ var f = window.__diFrames = { gaps: [], on: true }; var last = performance.now(); function tick(){ var n = performance.now(); f.gaps.push(n - last); last = n; if (f.on) requestAnimationFrame(tick); } requestAnimationFrame(tick); return "on"; })()`
const STOP = `(function(){ var f = window.__diFrames; f.on = false; var a = f.gaps.slice(1).sort(function(x, y){ return x - y; }); var sum = a.reduce(function(s, x){ return s + x; }, 0); function at(p){ return Math.round(a[Math.floor((a.length - 1) * p)] * 10) / 10; } return { frames: a.length, perSecond: Math.round(a.length / (sum / 1000) * 10) / 10, p50: at(0.5), p99: at(0.99), max: at(1) }; })()`
const tabClick = (label) => `(function(){ var b = document.querySelector('[data-app-frame] button[aria-label="${label}"]'); if (!b) return "no ${label} tab"; b.click(); return "clicked"; })()`

const lines = []
const say = (line) => {
  lines.push(line)
  console.log(line)
}

if (spawnSync("powershell", ["-NoProfile", "-Command", WAIT_FOR_FOCUS]).status !== 0) throw new Error("the sim never had the focus")
beep(800)

const pages = await listPages()
const efb = new Inspector(selectPage(pages, "Electronic Flight Bag").id)
const toolbar = new Inspector(selectPage(pages, "Toolbar").id)
await efb.open()
await toolbar.open()

say(`shown: ${String(await efb.evaluate(`(function(){ var f = document.querySelector('[data-app-frame]'); return f ? f.innerText.slice(0, 60).replace(/\\n/g, " / ") : "no frame"; })()`))}`)

await efb.evaluate(START)
await toolbar.evaluate(START)
await sleep(8000)
say(`idle, EFB's document: ${JSON.stringify(await efb.evaluate(STOP))}`)
say(`idle, toolbar's document: ${JSON.stringify(await toolbar.evaluate(STOP))}`)

await efb.evaluate(START)
for (let i = 0; i < 4; i++) {
  await efb.evaluate(tabClick("Settings"))
  await sleep(1000)
  await efb.evaluate(tabClick("Session"))
  await sleep(1000)
}
say(`tabs changing every 1s, EFB's document: ${JSON.stringify(await efb.evaluate(STOP))}`)

beep(500)
console.log(`saved ${saveResult("interface", "p26-frame-rate", lines.join("\n"))}`)
process.exit(0)
