/*
 * p17: a hand sphere of our own in the cockpit, on MSFS 2024: whether we can
 * change its size and color from outside in real time, and whether it can
 * follow the cursor and stay where the pilot clicks.
 *
 * The sphere, CROSSCHECK_HandSphere, ships in our probe package beside the
 * module (experiments/areas/avatars/wasm/). Its model reads two variables of
 * its own object: Z:CROSSCHECK_SCALE (0 to 100, 2cm to 20cm) and
 * L:1:CROSSCHECK_COLOR (0 red, 1 green, 2 blue, 3 yellow), which
 * MSFS_Vars.h says are two spellings of one kind of per-object variable. The
 * module (crosscheck-p12-follow 0.5.0) sets them on the sphere every frame.
 *
 * The cursor ray: the sim window's cursor position, read here, and the
 * camera's world pose and field of view, read by the module inside the frame
 * with fsCameraGet, give the ray from the eye through the cursor. The module
 * puts the sphere 0.6m along it (mode 4), and when the pilot clicks, holds it
 * there, fixed to the aircraft (mode 5), for 2s.
 *
 * In the C152, in flight or parked, the sim in front; about 2 minutes:
 *
 *   channels   Press Page Down and watch the sphere ahead of you for 12s: its
 *              color changes every 1.5s and its size sweeps up twice.
 *   signs      Press Page Down; at the first beep look up at the roof, at the
 *              second look right, 3s each.
 *   cursor     The sphere follows the cursor; click switches and knobs, and it
 *              stays on the spot for 2s. Page Down switches the field of view
 *              between vertical and horizontal, to see which keeps the sphere
 *              under the cursor. Page Up ends.
 *
 * Nothing touches the pilot's input: the cursor and clicks are read, not
 * changed. The probe turns the module off and removes the sphere at the end and
 * on Ctrl+C.
 *
 *   node experiments/areas/avatars/p17-hand.mjs
 */

import { createInterface } from "node:readline"

import { InitPosition } from "node-simconnect"

import { SKIP, START, powershell, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { wrap } from "./lib/pose.mjs"

const POS = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"]]
const SPHERE = "CROSSCHECK_HandSphere"
// p15: nose up and right wing down are both negative; lead 1 frame (p16).
const SIGNS = [-1, -1]
const LEAD = 1
const DIST_M = 0.6
const HOLD_MS = 2000
const CAP_MS = 20 * 60_000
const L = (n) => [`L:CROSSCHECK_P12_${n}`, "number"]

// The cursor inside the sim window's client area, -1 to 1 right and up, the
// area's size, and left-button presses. GetAsyncKeyState reads the button
// without taking it, so the sim still gets the click.
const CURSOR_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CrosscheckCursor {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
}
"@
$h = [IntPtr]::Zero
$was = $false
$last = ""
while ($true) {
  if ($h -eq [IntPtr]::Zero) {
    $p = Get-Process -Name FlightSimulator2024 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if ($p) { $h = $p.MainWindowHandle } else { Start-Sleep -Milliseconds 500; continue }
  }
  $r = New-Object CrosscheckCursor+RECT
  [void][CrosscheckCursor]::GetClientRect($h, [ref]$r)
  $o = New-Object CrosscheckCursor+POINT
  [void][CrosscheckCursor]::ClientToScreen($h, [ref]$o)
  $c = New-Object CrosscheckCursor+POINT
  [void][CrosscheckCursor]::GetCursorPos([ref]$c)
  $w = $r.R - $r.L; $hh = $r.B - $r.T
  if ($w -gt 0 -and $hh -gt 0) {
    $x = [Math]::Round(2.0 * ($c.X - $o.X) / $w - 1, 4)
    $y = [Math]::Round(1 - 2.0 * ($c.Y - $o.Y) / $hh, 4)
    $line = "C $x $y $w $hh"
    if ($line -ne $last) { [Console]::Out.WriteLine($line); $last = $line }
  }
  $down = ([CrosscheckCursor]::GetAsyncKeyState(1) -band 0x8000) -ne 0
  if ($down -and -not $was) { [Console]::Out.WriteLine("CLICK") }
  $was = $down
  Start-Sleep -Milliseconds 15
}`

const rec = new Recorder("p17-hand", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p17-hand" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }

async function readModule(names) {
  const v = await sim.read(names.map(L), { timeoutMs: 2000 })
  return Object.fromEntries(names.map((n) => [n, v.get(`L:CROSSCHECK_P12_${n}`) ?? null]))
}
const setModule = (values, quiet = false) => { for (const [k, x] of Object.entries(values)) sim.set([L(k)], [x], { label: `set CROSSCHECK_P12_${k}`, quiet }) }

async function ask(heading, instruction) {
  console.log(`\n▶ ${heading}\n  ${instruction}\n  ${START} to start, ${SKIP} to skip.`)
  const k = await keys.next()
  rec.log("key", `${k.key}${k.foreground ? `, with ${k.foreground} in front` : ""}`, k)
  return k.key === "START"
}

await sleep(1000)
const m0 = await readModule(["ALIVE", "CAM_OK"])
await sleep(500)
const m1 = await readModule(["ALIVE", "CAM_OK", "CAM_P", "CAM_B", "CAM_H", "CAM_FOV"])
const alive = m0.ALIVE !== null && m1.ALIVE > m0.ALIVE
note("module", alive ? `crosscheck-p12-follow is running; fsCameraGet ${m1.CAM_OK ? `answers: p ${fmt(m1.CAM_P)}, b ${fmt(m1.CAM_B)}, h ${fmt(m1.CAM_H)}, fov ${fmt(m1.CAM_FOV)}` : "doesn't answer"}` : "crosscheck-p12-follow isn't running, or is older than 0.5.0: rebuild it with the sim closed")
const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("setup", `aircraft TITLE ${JSON.stringify(title)}`)

let sphere = null
let finished = false
async function finish(why) {
  if (finished) return
  finished = true
  setModule({ MODE: 0, OBJECT: 0, LEAD: 0, RAY_X: 0, RAY_Y: 0 })
  if (sphere !== null) sim.remove(sphere)
  await sleep(800)
  const text = [
    "p17 · A hand sphere of our own: size and color from outside, and the cursor ray, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Ended by ${why}`,
    "",
    ...lines.map((l) => `  ${l}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
  process.exit(0)
}
process.on("SIGINT", () => finish("Ctrl+C"))
if (!alive) await finish("no module")

// The sphere, spawned at the aircraft and placed by the module from then on.
const ac = await sim.read(POS)
const init = new InitPosition()
Object.assign(init, { latitude: ac.get("PLANE LATITUDE"), longitude: ac.get("PLANE LONGITUDE"), altitude: ac.get("PLANE ALTITUDE"), pitch: 0, bank: 0, heading: wrap(ac.get("PLANE HEADING DEGREES TRUE")), onGround: false, airspeed: 0 })
const r = await sim.spawn(SPHERE, "", init)
if (r.id === undefined) {
  note("sphere", `${SPHERE}: not created: ${r.error}`)
  await finish("a failed spawn")
}
sphere = r.id
for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: r.id, quiet: true })
const cat = (await sim.readStrings(["CATEGORY"], { object: r.id })).get("CATEGORY") ?? null
note("sphere", `${SPHERE}: object ${r.id}, ${cat ?? "no category"}`)
setModule({ OBJECT: r.id, SIGN_PITCH: SIGNS[0], SIGN_BANK: SIGNS[1], LEAD, RAY_X: 0, RAY_Y: 0, RAY_DIST: DIST_M, FOV_IS_H: 0, CAM_PITCH_SIGN: 1, CAM_YAW_SIGN: 1, SCALE: 50, COLOR: 0, MODE: 4 })

// channels ----------------------------------------

if (await ask("Size and color", "Press Page Down and watch the sphere ahead of you for 12s: its color changes every 1.5s and its size sweeps up twice.")) {
  beep(1000, 100)
  const t0 = Date.now()
  const reads = []
  while (Date.now() - t0 < 12_000) {
    const s = (Date.now() - t0) / 1000
    setModule({ COLOR: Math.floor(s / 1.5) % 4, SCALE: ((s % 6) / 6) * 100 }, true)
    const z = await readModule(["Z_SCALE_READ", "ERRORS", "LAST_ERROR"])
    reads.push(z)
    await sleep(100)
  }
  beep(500, 600)
  setModule({ SCALE: 50, COLOR: 0 })
  const last = reads[reads.length - 1] ?? {}
  note("channels", `the module read the sphere's Z:CROSSCHECK_SCALE back as ${reads.map((x) => x.Z_SCALE_READ).filter((x) => x !== null).slice(-3).map(fmt).join(", ")}; module errors ${fmt(last.ERRORS)}${last.ERRORS ? ` (last ${fmt(last.LAST_ERROR)})` : ""}`)
  console.log("  Tell Claude whether the color changed, and whether the size swept up.")
}

// signs -------------------------------------------

if (await ask("Camera signs", "Press Page Down; at the first short beep look up at the roof, at the second look right, 3s each.")) {
  const base = await readModule(["CAM_P", "CAM_B"])
  const watch = async (ms) => {
    const p = [], b = []
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { const m = await readModule(["CAM_P", "CAM_B"]); p.push(m.CAM_P); b.push(m.CAM_B); await sleep(100) }
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
    return { p: med(p.slice(-10)), b: med(b.slice(-10)) }
  }
  beep(1000, 100)
  const up = await watch(3000)
  beep(1000, 100)
  const right = await watch(3000)
  beep(500, 600)
  const turn = (x) => ((x + 540) % 360) - 180
  const pitchSign = up.p - base.CAM_P >= 0 ? 1 : -1
  const yawSign = turn(right.b - base.CAM_B) >= 0 ? 1 : -1
  setModule({ CAM_PITCH_SIGN: pitchSign, CAM_YAW_SIGN: yawSign })
  note("signs", `ahead: p ${fmt(base.CAM_P)}, b ${fmt(base.CAM_B)}; looking up: p ${fmt(up.p)}; looking right: b ${fmt(right.b)}; so up is ${pitchSign > 0 ? "+" : "−"}p and right is ${yawSign > 0 ? "+" : "−"}b`)
}

// cursor ------------------------------------------

console.log(`\n▶ The sphere follows your cursor\n  Click switches and knobs: it stays on the spot for ${HOLD_MS / 1000}s. ${START} switches the field of view between vertical and horizontal. ${SKIP} ends.`)
const ps = powershell(CURSOR_PS, ["ignore", "pipe", "ignore"])
process.on("exit", () => { try { ps.kill() } catch { /* gone */ } })
let fovIsH = 0
let holdUntil = 0
let clicks = 0
let lastSend = 0
let pending = null
createInterface({ input: ps.stdout }).on("line", async (l) => {
  if (l.startsWith("C ")) {
    const [, x, y, w, h] = l.split(" ").map(Number)
    pending = { x, y, aspect: w / h }
  } else if (l === "CLICK") {
    clicks++
    holdUntil = Date.now() + HOLD_MS
    setModule({ MODE: 5 })
    await sleep(150)
    const off = await readModule(["FWD", "RIGHT", "UP"])
    rec.log("click", `held at ${fmt(off.FWD)}m forward, ${fmt(off.RIGHT)}m right, ${fmt(off.UP)}m up of the aircraft's reference point`, off)
  }
})
// The cursor goes to the module at most every 30ms; a hold ends by itself.
const tick = setInterval(() => {
  if (holdUntil && Date.now() > holdUntil) { holdUntil = 0; setModule({ MODE: 4 }, true) }
  if (pending && Date.now() - lastSend > 30) {
    setModule({ RAY_X: pending.x, RAY_Y: pending.y, RAY_ASPECT: pending.aspect }, true)
    lastSend = Date.now()
    pending = null
  }
}, 10)
const cap = setTimeout(() => finish("the 20-minute cap"), CAP_MS)
for (;;) {
  const k = await keys.next()
  if (k.key === "SKIP") break
  fovIsH = 1 - fovIsH
  setModule({ FOV_IS_H: fovIsH })
  beep(fovIsH ? 1200 : 600, 120)
  rec.log("fov", `field of view taken as ${fovIsH ? "horizontal" : "vertical"}`)
}
clearInterval(tick)
clearTimeout(cap)
note("cursor", `${clicks} click${clicks === 1 ? "" : "s"}; the field of view ended as ${fovIsH ? "horizontal" : "vertical"}`)
await finish("Page Up")
