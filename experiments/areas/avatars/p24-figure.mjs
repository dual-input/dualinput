/*
 * p24: our own figure in the Baron 58P's copilot seat, on MSFS 2024: whether
 * its joints, animations that read variables, pose it in the sim as the dev
 * page poses it; whether a value between two animation frames plays smoothly;
 * and whether ASOBO_property_animation recolors it.
 *
 * The figure is CROSSCHECK_Figure, from figure/build.mjs, in the
 * crosscheck-figure package. Its 27 joints and its color read global
 * L:CROSSCHECK_* variables, which this probe sets through SimConnect, as p11
 * set GSX's. p17 measured that a model of ours reads its own object's
 * variables, which is what the product would use. The pose comes from
 * figure/solve.mjs, as in the dev page; the seat, the eye, the pedals, and
 * the hands' targets from the Baron's own files (figure/cockpit.mjs). p21 found
 * PILOT_1 to be the Baron's copilot seat, within 3mm of SimConnect's.
 *
 * In the Black Square Baron 58P, parked, from the left seat; about 1.5 minutes:
 *
 *   look     Turn your view to the copilot seat, as the dev page's pilot-seat
 *            view does, keep the sim window uncovered, and press Page Down.
 *            Then take your hand off the mouse and keep your head still.
 *   phases   The figure runs through rest, head, a smoothness test, lean,
 *            hands, legs, and colors on its own in about a minute, a beep at
 *            each phase, and the probe takes a screenshot of the sim window at
 *            each pose. A long beep ends it.
 *
 * The smoothness test moves the head right by a sixth of one animation frame
 * at a time, from a whole frame to the next: if the sim plays only whole
 * frames, the head holds still and then jumps, and the reddish pixels'
 * center in the screenshots shows it.
 *
 * Screenshots go to results/p24-figure-<time>/, which .gitignore keeps out of
 * the tree until someone checks them by eye (CLAUDE.md, Nothing personal in
 * the tree). Nothing touches the pilot's input. The figure goes with
 * AIRemoveObject at the end and on Ctrl+C.
 *
 *   node experiments/areas/avatars/figure/build.mjs     (with the sim closed)
 *   node experiments/areas/avatars/p24-figure.mjs
 *   node experiments/areas/avatars/p24-figure.mjs --phases legs --no-wait
 *
 * --phases runs only the named phases after rest, which always runs:
 * head, smoothness, lean, hands, legs, and color. --no-wait starts at once,
 * for a check while the pilot's view is already on the copilot seat.
 */

import fs from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"

import { InitPosition } from "node-simconnect"

import { SKIP, START, powershell, startBeeper, startKeys } from "../../tools/guide.mjs"
import { Recorder, fmt, sleep } from "../aircraft/lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "../aircraft/lib/sim.mjs"
import { eyes, nodePositions } from "./figure/cockpit.mjs"
import { CHANNELS, FRAMES, colorChannel, frameOf, variable } from "./figure/model.mjs"
import { solve } from "./figure/solve.mjs"
import { cockpitFiles } from "./lib/cockpit-files.mjs"
import { wrap } from "./lib/pose.mjs"

const FIGURE = "CROSSCHECK_Figure"
const SEAT = "PILOT_1"
const HAND_R = "JpiButton_R"
const HAND_L = "FUEL_Lever_Mixture_2"
// The copilot's pedals: _2_1 is the inboard one, under the left foot. The
// pad sits above and behind the node, by the dev page's defaults.
const PEDAL_L = "HANDLING_RudderPedals_2_1"
const PEDAL_R = "HANDLING_RudderPedals_2_2"
const PEDAL_UP = 0.1
const PEDAL_BACK = 0.04
const LOOK = { yaw: -55, pitch: -5, roll: 0 }
const TICK_MS = 33
// SimConnect.h, SIMCONNECT_POSITION_REFERENTIAL.
const SIMOBJECT = 1
const RAD = Math.PI / 180

const POSE = [["PLANE LATITUDE", "degrees"], ["PLANE LONGITUDE", "degrees"], ["PLANE ALTITUDE", "feet"], ["PLANE HEADING DEGREES TRUE", "degrees"], ["PLANE PITCH DEGREES", "degrees"], ["PLANE BANK DEGREES", "degrees"]]

const PHASES = ["head", "smoothness", "lean", "hands", "legs", "color"]
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1] ?? "" }
const only = arg("--phases")?.split(",").map((s) => s.trim()).filter(Boolean) ?? PHASES
const unknown = only.filter((p) => !PHASES.includes(p))
if (unknown.length) { console.error(`unknown phase ${unknown.join(", ")}: the phases are ${PHASES.join(", ")}`); process.exit(1) }
const wait = !process.argv.includes("--no-wait")

const spec = JSON.parse(fs.readFileSync(new URL("./figure/figure.json", import.meta.url), "utf8"))
const ALL = [...CHANNELS, colorChannel(spec)]
const VARS = ALL.map((ch) => [`L:${variable(ch)}`, "number"])

// The sim window's client area as a PNG, and the share of strongly red pixels
// with their center, read in the same pass: "OK width height brightness
// redCount redX redY". DPI-aware, so the area is in the screen's own pixels.
const SHOT_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class CrosscheckShot {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static string Take(IntPtr h, string file) {
    RECT r; GetClientRect(h, out r); POINT o = new POINT(); ClientToScreen(h, ref o);
    int w = r.R - r.L, hh = r.B - r.T;
    if (w <= 0 || hh <= 0) return "ERR no client area";
    using (Bitmap bmp = new Bitmap(w, hh, PixelFormat.Format24bppRgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) g.CopyFromScreen(o.X, o.Y, 0, 0, new Size(w, hh));
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, hh), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      byte[] px = new byte[d.Stride * hh];
      Marshal.Copy(d.Scan0, px, 0, px.Length);
      bmp.UnlockBits(d);
      double sum = 0, rx = 0, ry = 0; long n = 0, red = 0;
      for (int y = 0; y < hh; y += 2) for (int x = 0; x < w; x += 2) {
        int i = y * d.Stride + x * 3; int b = px[i], gg = px[i + 1], rr = px[i + 2];
        sum += (rr + gg + b) / 3.0; n++;
        if (rr > 120 && rr > gg * 1.6 && rr > b * 1.6) { red++; rx += x; ry += y; }
      }
      bmp.Save(file, ImageFormat.Png);
      return String.Format(System.Globalization.CultureInfo.InvariantCulture, "OK {0} {1} {2:F1} {3} {4:F1} {5:F1}", w, hh, sum / n, red, red > 0 ? rx / red : -1, red > 0 ? ry / red : -1);
    }
  }
}
"@
[void][CrosscheckShot]::SetProcessDPIAware()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = Get-Process -Name FlightSimulator2024 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { [Console]::Out.WriteLine("ERR no sim window"); continue }
  try { [Console]::Out.WriteLine([CrosscheckShot]::Take($p.MainWindowHandle, $line)) } catch { [Console]::Out.WriteLine("ERR " + $_.Exception.Message) }
}`

const rec = new Recorder("p24-figure", { area: "avatars" })
const sim = await Sim.connect(rec, { name: "CROSSCHECK p24-figure" })
rec.open()
const keys = await startKeys()
const beep = startBeeper()
const lines = []
const note = (kind, text, fields = {}) => { lines.push(text); rec.log(kind, text, fields) }

const shotsDir = path.join(path.dirname(rec.files.txt), `p24-figure-${rec.when}`)
const shooter = powershell(SHOT_PS, ["pipe", "pipe", "ignore"])
process.on("exit", () => { try { shooter.kill() } catch { /* gone */ } })
const replies = []
createInterface({ input: shooter.stdout }).on("line", (l) => replies.shift()?.(l))
const shots = []
async function shot(name) {
  fs.mkdirSync(shotsDir, { recursive: true })
  const file = path.join(shotsDir, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`)
  const line = await Promise.race([
    new Promise((resolve) => { replies.push(resolve); shooter.stdin.write(file + "\n") }),
    sleep(5000).then(() => "ERR no reply in 5s"),
  ])
  const [ok, w, h, bright, red, rx, ry] = line.split(" ")
  const s = ok === "OK"
    ? { name, file: path.basename(file), width: +w, height: +h, brightness: +bright, red: +red, redX: +rx, redY: +ry }
    : { name, error: line }
  shots.push(s)
  rec.data("shot", s.error ? `${name}: ${s.error}` : `${name}: ${s.width}×${s.height}, brightness ${s.brightness}, ${s.red} red samples centered at ${s.redX}, ${s.redY}`, s)
  return s
}

let cam = null
sim.handle.on("cameraData", (r) => {
  const c = r.cameraData
  cam = { x: c.position.x, y: c.position.y, z: c.position.z, pitch: c.pbh.pitch, yaw: c.pbh.bank, roll: c.pbh.heading, fov: c.fov }
})
async function cameraNow() {
  cam = null
  sim.send("camera get", () => sim.handle.cameraGet(SIMOBJECT))
  for (let i = 0; i < 20 && !cam; i++) await sleep(50)
  return cam
}

let figure = null
let finished = false
async function finish(why) {
  if (finished) return
  finished = true
  if (figure !== null) sim.remove(figure)
  await sleep(500)
  const counted = new Map()
  for (const e of rec.timeline.filter((x) => x.kind === "exception")) counted.set(e.text, (counted.get(e.text) ?? 0) + 1)
  const text = [
    "p24 · Our own figure in the Baron 58P's copilot seat: joints, smoothness between frames, and color, on MSFS 2024",
    `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
    `Ended by ${why}`,
    "",
    ...lines.map((l) => `  ${l}`),
    "",
    `Screenshots: ${shots.length ? path.relative(path.dirname(rec.files.txt), shotsDir).replace(/\\/g, "/") + "/" : "none"}`,
    ...shots.map((s) => `  ${s.name}: ${s.error ?? `${s.width}×${s.height}, brightness ${s.brightness}, ${s.red} red samples at ${s.redX}, ${s.redY}`}`),
    "",
    `Exceptions: ${counted.size ? "" : "none"}`,
    ...[...counted].map(([e, n]) => `  ${n} × ${e}`),
  ].join("\n")
  console.log("\n" + text)
  rec.writeReport(text)
  sim.close()
  await rec.close()
  process.exit(0)
}
process.on("SIGINT", () => finish("Ctrl+C"))

// ------------------------------------------------ the cockpit

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
const files = title && cockpitFiles(title)
note("setup", `aircraft TITLE ${JSON.stringify(title)}${files ? `, interior ${path.basename(files.gltf)}` : ", no interior model found"}`)
if (!files) await finish("no interior model")
const nodes = nodePositions(files.gltf, [SEAT, HAND_R, HAND_L, PEDAL_L, PEDAL_R])
const missing = Object.entries(nodes).filter(([, p]) => !p).map(([n]) => n)
if (missing.length) {
  note("setup", `the interior model has no ${missing.join(", ")}: this probe is written for the Black Square Baron 58P`)
  await finish("missing nodes")
}
const eye = eyes(path.join(path.dirname(files.cfg), "cameras.cfg"), { copilot: "CoPilot" }).copilot
if (!eye) await finish("no CoPilot camera in cameras.cfg")
const seat = nodes[SEAT]
const fromSeat = (p) => ({ fwd: p.fwd - seat.fwd, right: p.right - seat.right, up: p.up - seat.up })
const pedal = (p) => fromSeat({ fwd: p.fwd - PEDAL_BACK, right: p.right, up: p.up + PEDAL_UP })
const where = (p) => `${p.fwd.toFixed(3)}m forward, ${p.right.toFixed(3)}m right, ${p.up.toFixed(3)}m up`
note("setup", `seat ${SEAT} at ${where(seat)} of the model's origin; the copilot's eye ${where(fromSeat(eye))} of the seat`)

// ------------------------------------------------ the figure

// A point in the aircraft's frame, forward, right, and up in meters, as a
// position: turned by bank, pitch, and heading, with nose up and right wing
// down both negative in the sim's variables (p15).
function toWorld(ac, b) {
  const th = -ac.pitch * RAD, ph = -ac.bank * RAD, ps = ac.hdg * RAD
  const r1 = b.right * Math.cos(ph) + b.up * Math.sin(ph)
  const u1 = -b.right * Math.sin(ph) + b.up * Math.cos(ph)
  const f2 = b.fwd * Math.cos(th) - u1 * Math.sin(th)
  const u2 = b.fwd * Math.sin(th) + u1 * Math.cos(th)
  const north = f2 * Math.cos(ps) - r1 * Math.sin(ps)
  const east = f2 * Math.sin(ps) + r1 * Math.cos(ps)
  return {
    lat: ac.lat + (north / 6_371_000) / RAD,
    lon: ac.lon + (east / (6_371_000 * Math.cos(ac.lat * RAD))) / RAD,
    alt: ac.alt + u2 / 0.3048,
  }
}

const v = await sim.read(POSE)
const ac = { lat: v.get("PLANE LATITUDE"), lon: v.get("PLANE LONGITUDE"), alt: v.get("PLANE ALTITUDE"), hdg: v.get("PLANE HEADING DEGREES TRUE"), pitch: v.get("PLANE PITCH DEGREES"), bank: v.get("PLANE BANK DEGREES") }
note("setup", `aircraft heading ${fmt(ac.hdg)}°, pitch ${fmt(ac.pitch)}°, bank ${fmt(ac.bank)}°`)

const base = { eye: fromSeat(eye), look: LOOK, handL: null, handR: null, footL: null, footR: null, color: 0 }
const valuesOf = (pose) => ({ ...solve(spec, pose), COLOR: pose.color })
const send = (values) => sim.set(VARS, ALL.map((ch) => values[ch.name]), { quiet: true, label: "figure variables" })
let now = valuesOf(base)
send(now)

const init = new InitPosition()
Object.assign(init, { latitude: ac.lat, longitude: ac.lon, altitude: ac.alt, pitch: 0, bank: 0, heading: wrap(ac.hdg), onGround: false, airspeed: 0 })
const r = await sim.spawn(FIGURE, "", init)
if (r.id === undefined) {
  note("figure", `${FIGURE}: not created: ${r.error}. Is crosscheck-figure in Community, and was the sim started after it was built?`)
  await finish("a failed spawn")
}
figure = r.id
sim.release(figure)
for (const e of ["FREEZE_LATITUDE_LONGITUDE_SET", "FREEZE_ALTITUDE_SET", "FREEZE_ATTITUDE_SET"]) sim.transmit(e, [1], { object: figure, quiet: true })
const at = toWorld(ac, seat)
sim.set(POSE, [at.lat, at.lon, at.alt, ac.hdg, ac.pitch, ac.bank], { object: figure, label: "figure on the seat" })
const category = (await sim.readStrings(["CATEGORY"], { object: figure })).get("CATEGORY") ?? null
note("figure", `${FIGURE}: object ${figure}, ${category ?? "no category"}, placed on ${SEAT} with the aircraft's attitude`)

// ------------------------------------------------ the phases

// Moves every channel in a straight line from where it is to a pose's values,
// sending them each tick, then holds, and takes a screenshot partway into the
// hold, once the sim has drawn a few frames of the pose.
async function go(pose, moveMs, holdMs, name = null) {
  const from = now, to = valuesOf(pose)
  const t0 = Date.now()
  for (;;) {
    const f = moveMs ? Math.min(1, (Date.now() - t0) / moveMs) : 1
    now = Object.fromEntries(ALL.map((ch) => [ch.name, from[ch.name] + (to[ch.name] - from[ch.name]) * f]))
    send(now)
    if (f >= 1) break
    await sleep(TICK_MS)
  }
  const t1 = Date.now()
  let s = null
  if (name) { await sleep(Math.min(250, holdMs)); s = await shot(name) }
  await sleep(Math.max(0, holdMs - (Date.now() - t1)))
  return s
}
const look = (l) => ({ ...base, look: { ...LOOK, ...l } })

note("setup", `phases: rest, ${only.join(", ")}`)
if (wait) {
  console.log(`\nBefore you start: in the Baron 58P, parked, in the left seat.\n\n▶ The figure\n  Turn your view to the copilot seat, keep the sim window uncovered, and press ${START}.\n  Then let go of the mouse and keep your head still until the long beep. ${SKIP} ends.`)
  const k = await keys.next()
  rec.log("key", `${k.key}${k.foreground ? `, with ${k.foreground} in front` : ""}`, k)
  if (k.key !== "START") await finish("Page Up")
} else {
  await sleep(1000)
}

const c = await cameraNow()
note("camera", c ? `CameraGet in SIMOBJECT: ${where({ fwd: c.z, right: -c.x, up: c.y })} of the reference point, pitch ${fmt(c.pitch)}°, yaw ${fmt(c.yaw)}°, roll ${fmt(c.roll)}°, fov ${fmt(c.fov)}` : "CameraGet didn't answer", { cam: c })

const phase = (name) => { beep(1000, 80); rec.log("phase", name) }

phase("rest")
const first = await go(base, 0, 1500, "rest")
note("rest", first.error ? `screenshot failed: ${first.error}` : `screenshot ${first.width}×${first.height}, brightness ${first.brightness}${first.brightness < 3 ? ": black, so the capture can't see the sim (exclusive fullscreen?)" : ""}, ${first.red} red samples`)

if (only.includes("head")) {
  phase("head")
  await go(look({ yaw: 0 }), 1000, 700, "head-ahead")
  await go(look({ yaw: 60 }), 1000, 700, "head-right")
  await go(look({ pitch: 25 }), 1000, 700, "head-up")
  await go(look({ pitch: -30 }), 1000, 700, "head-down")
  await go(look({ roll: 25 }), 1000, 700, "head-roll-right")
  await go(look({ roll: -25 }), 1000, 700, "head-roll-left")
  await go(base, 800, 400)
}

if (only.includes("smoothness")) {
  phase("smoothness")
  const ch = CHANNELS.find((x) => x.name === "HEAD_RIGHT")
  const width = (ch.max - ch.min) / FRAMES
  const whole = Math.round(frameOf(ch, base.eye.right))
  const smooth = []
  for (let i = 0; i <= 6; i++) {
    const right = ch.min + (whole + i / 6) * width
    smooth.push(await go({ ...base, eye: { ...base.eye, right } }, 0, 600, `smooth-${i}of6`))
  }
  const xs = smooth.map((s) => s.redX)
  const steps = xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(1))
  note("smoothness", `the head right by sixths of a frame (${(width * 100).toFixed(2)}cm a frame, from frame ${whole}): the red samples' center moved ${steps.join(", ")} px a step, from ${xs.map((x) => x.toFixed(1)).join(", ")}`, { steps, xs })
  await go(base, 300, 300)
}

if (only.includes("lean")) {
  phase("lean")
  await go({ ...base, eye: { fwd: base.eye.fwd + 0.15, right: base.eye.right - 0.1, up: base.eye.up + 0.05 } }, 1200, 700, "lean")
  await go(base, 1000, 300)
}

if (only.includes("hands")) {
  phase("hands")
  const handR = fromSeat(nodes[HAND_R]), handL = fromSeat(nodes[HAND_L])
  note("hands", `right hand to ${HAND_R} at ${where(handR)} of the seat, left to ${HAND_L} at ${where(handL)}`)
  await go({ ...base, handR }, 1200, 800, "hand-right")
  await go({ ...base, handR, handL }, 1200, 800, "hands-both")
  await go(base, 1000, 300)
}

if (only.includes("legs")) {
  phase("legs")
  await go({ ...base, footL: pedal(nodes[PEDAL_L]), footR: pedal(nodes[PEDAL_R]) }, 1500, 800, "feet-pedals")
  await go(base, 1500, 300, "feet-rest-again")
}

if (only.includes("color")) {
  phase("color")
  const reds = []
  for (let i = 1; i < spec.palette.length; i++) reds.push(await go({ ...base, color: i }, 0, 600, `color-${spec.palette[i].name}`))
  reds.push(await go({ ...base, color: 0.5 }, 0, 600, "color-red-blue-half"))
  await go({ ...base, color: 0 }, 0, 300)
  await go({ ...base, color: spec.palette.length - 1 }, 4000, 0)
  await go({ ...base, color: 0 }, 0, 600, "color-red-again")
  note("color", `red samples by palette entry: ${["red " + first.red, ...reds.map((s) => `${s.name.replace(/^color-/, "")} ${s.red}`)].join(", ")}; the figure's red reads only while it's red`)
}

beep(500, 600)
await finish("the end of the phases")
