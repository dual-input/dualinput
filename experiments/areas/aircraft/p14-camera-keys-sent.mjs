/*
 * p14: whether key presses a program sends move the pilot's cockpit eye in
 * MSFS 2024, so Crosscheck could slide a pilot to a seat by pressing the
 * pilot's own camera keys for them.
 *
 * SimConnect doesn't know the sim's cockpit camera slide actions by name (p13,
 * record/areas/aircraft/log.md). The pilot's keyboard profile binds
 * KEY_COCKPIT_CAMERA_SLIDE_RIGHT to D and _LEFT to A in the context
 * COCKPIT_GLOBAL_CAMERA_TRANSLATE, and the pilot moves the eye with Shift and
 * those keys (read in <Steam>\userdata\<Steam account id>\2537590\remote\inputprofile_*,
 * 2026-10-04; the default 2024 profile binds LShift+D,
 * Packages\fs-input-profiles\InputProfiles\Categories\Transversal\Keyboard_2024_Transversal.xml).
 *
 * Three ways, each pressing for 500ms and then reading SimConnect_CameraGet's
 * SIMOBJECT position, x turned to point right:
 *
 *   1  SendInput, Shift+D, by scan code, with the sim window in front
 *   2  PostMessage WM_KEYDOWN and WM_KEYUP, Shift+D, to the sim's window
 *   3  SendInput, Shift+A, to slide back
 *
 * Fails open: a key goes down only while the sim's window is in the foreground,
 * checked before every press, and every press is released in a finally block;
 * Ctrl+C releases Shift, D, and A before exiting. ChasePlane is turned off
 * through its API for the run and back on. Bring the sim to the front first.
 *
 *   node experiments/areas/aircraft/p14-camera-keys-sent.mjs
 *
 * Output: the steps on the console, and in
 * experiments/areas/aircraft/results/p14-camera-keys-sent-<time>.txt with the
 * .ndjson beside it.
 */

import { createInterface } from "node:readline"
import { powershell, startBeeper } from "../../tools/guide.mjs"
import { connectChasePlane } from "./lib/chaseplane.mjs"
import { Recorder, sleep } from "./lib/out.mjs"
import { NODE_SIMCONNECT, Sim } from "./lib/sim.mjs"
import { PositionReferential } from "node-simconnect"

const CLIENT = "CROSSCHECK p14-camera-keys-sent"
const VK = { SHIFT: 0xa0, D: 0x44, A: 0x41 }
const HOLD_MS = 500

const KEYS_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Threading;
public static class CrosscheckKeys {
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  const uint KEYEVENTF_KEYUP = 2, KEYEVENTF_SCANCODE = 8;
  static void Key(ushort vk, bool down) {
    INPUT[] i = new INPUT[1]; i[0].type = 1;
    i[0].ki.wScan = (ushort)MapVirtualKey(vk, 0); i[0].ki.dwFlags = KEYEVENTF_SCANCODE | (down ? 0 : KEYEVENTF_KEYUP);
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string Send(IntPtr sim, ushort[] vks, int ms) {
    if (GetForegroundWindow() != sim) return "SKIPPED the sim isn't in front";
    int pressed = 0;
    try { foreach (ushort vk in vks) { Key(vk, true); pressed++; } Thread.Sleep(ms); }
    finally { for (int k = pressed - 1; k >= 0; k--) Key(vks[k], false); }
    return "OK sent";
  }
  public static string Post(IntPtr sim, ushort[] vks, int ms) {
    int pressed = 0;
    try {
      foreach (ushort vk in vks) { uint sc = MapVirtualKey(vk, 0); PostMessage(sim, 0x0100, (IntPtr)vk, (IntPtr)(1 | (sc << 16))); pressed++; }
      Thread.Sleep(ms);
    } finally {
      for (int k = pressed - 1; k >= 0; k--) { uint sc = MapVirtualKey(vks[k], 0); PostMessage(sim, 0x0101, (IntPtr)vks[k], (IntPtr)(1 | (sc << 16) | (1u << 30) | (1u << 31))); }
    }
    return "OK posted";
  }
  public static void ReleaseAll(ushort[] vks) { foreach (ushort vk in vks) Key(vk, false); }
}
"@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = Get-Process -Name FlightSimulator2024 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { [Console]::Out.WriteLine("ERR no sim window"); continue }
  $f = $line.Split(" ")
  try {
    if ($f[0] -eq "front") { [Console]::Out.WriteLine($(if ([CrosscheckKeys]::GetForegroundWindow() -eq $p.MainWindowHandle) { "OK in front" } else { "NO not in front" })) }
    elseif ($f[0] -eq "focus") { [void][CrosscheckKeys]::SetForegroundWindow($p.MainWindowHandle); Start-Sleep -Milliseconds 300; [Console]::Out.WriteLine($(if ([CrosscheckKeys]::GetForegroundWindow() -eq $p.MainWindowHandle) { "OK in front" } else { "NO not in front" })) }
    elseif ($f[0] -eq "release") { [CrosscheckKeys]::ReleaseAll([uint16[]]($f[1].Split(","))); [Console]::Out.WriteLine("OK released") }
    else { $vks = [uint16[]]($f[1].Split(",")); $ms = [int]$f[2]; if ($f[0] -eq "send") { [Console]::Out.WriteLine([CrosscheckKeys]::Send($p.MainWindowHandle, $vks, $ms)) } else { [Console]::Out.WriteLine([CrosscheckKeys]::Post($p.MainWindowHandle, $vks, $ms)) } }
  } catch { [Console]::Out.WriteLine("ERR " + $_.Exception.Message) }
}`

const rec = new Recorder("p14-camera-keys-sent", { area: "aircraft" })
const sim = await Sim.connect(rec, { name: CLIENT })
rec.open()
const h = sim.handle
const beep = startBeeper()
const lines = []
const note = (kind, text, data) => { rec.log(kind, text, data); lines.push(text) }

const keys = powershell(KEYS_PS, ["pipe", "pipe", "ignore"])
const replies = []
createInterface({ input: keys.stdout }).on("line", (l) => replies.shift()?.(l))
const ask = (cmd) => Promise.race([
  new Promise((resolve) => { replies.push(resolve); keys.stdin.write(cmd + "\n") }),
  sleep(5000).then(() => "ERR no reply in 5s"),
])
const ALL = [VK.SHIFT, VK.D, VK.A].join(",")

let waiting = null
h.on("cameraData", (r) => { if (waiting) { const w = waiting; waiting = null; w(r.cameraData) } })
async function eye() {
  const got = new Promise((resolve) => { waiting = resolve; setTimeout(() => { if (waiting === resolve) { waiting = null; resolve(null) } }, 1500) })
  sim.send("camera get SIMOBJECT", () => h.cameraGet(PositionReferential.SIMOBJECT))
  const c = await got
  return c ? { x: -c.position.x, y: c.position.y, z: c.position.z } : null
}
const delta = (a, b) => (a && b ? `${((b.x - a.x) * 1000).toFixed(0)}mm right, ${((b.y - a.y) * 1000).toFixed(0)}mm up, ${((b.z - a.z) * 1000).toFixed(0)}mm forward` : "no reply")

let cp = null
let cpTurnedOff = false
let cleaned = false
async function cleanUp(why) {
  if (cleaned) return
  cleaned = true
  rec.log("stop", why)
  try { rec.log("stop", await ask(`release ${ALL}`)) } catch { /* the helper is gone */ }
  if (cpTurnedOff) { try { await cp.setMasterEnabled(true); note("chaseplane", "Turned ChasePlane back on") } catch (e) { note("chaseplane", `Turning ChasePlane back on failed: ${e.message}`) } }
  cp?.close()
  try { keys.stdin.end(); keys.kill() } catch { /* gone */ }
}
process.on("SIGINT", async () => { await cleanUp("Ctrl+C: releasing Shift, D, and A"); sim.close(); await rec.close(); process.exit(1) })

const title = (await sim.readStrings(["TITLE"])).get("TITLE") ?? null
note("aircraft", `TITLE ${JSON.stringify(title)}`)
try {
  cp = await connectChasePlane(CLIENT, { rec })
  await sleep(500)
  if (cp.state.masterEnabled) { await cp.setMasterEnabled(false); cpTurnedOff = true; await sleep(1500); note("chaseplane", "Turned ChasePlane off through its API") }
} catch (e) { note("chaseplane", `ChasePlane: ${e.message}`) }

let front = await ask("front")
if (!front.startsWith("OK")) front = await ask("focus")
// Windows often refuses SetForegroundWindow to a background program, so wait
// for the pilot to click into the sim.
if (!front.startsWith("OK")) {
  console.log("Click into the sim window; the keys go out once it's in front (up to 20s).")
  for (let i = 0; i < 40 && !front.startsWith("OK"); i++) { await sleep(500); front = await ask("front") }
}
note("focus", `The sim window: ${front}`)
if (!front.startsWith("OK")) { await cleanUp("the sim never came to the front"); sim.close(); await rec.close(); process.exit(2) }
beep(1000, 150)
await sleep(500)

async function trial(label, cmd) {
  const a = await eye()
  const r = await ask(cmd)
  await sleep(800)
  const b = await eye()
  note("move", `${label}: ${r}; the eye moved ${delta(a, b)}`, { label, reply: r, before: a, after: b })
}
await trial("1, SendInput Shift+D", `send ${VK.SHIFT},${VK.D} ${HOLD_MS}`)
await trial("2, PostMessage Shift+D to the sim window", `post ${VK.SHIFT},${VK.D} ${HOLD_MS}`)
await trial("3, SendInput Shift+A", `send ${VK.SHIFT},${VK.A} ${HOLD_MS}`)

await cleanUp("done: releasing Shift, D, and A, ChasePlane back on")
const text = [
  "p14 · Key presses a program sends, and the cockpit eye, on MSFS 2024",
  `${new Date(rec.started).toISOString()}, ${sim.version}, node-simconnect ${NODE_SIMCONNECT}`,
  "",
  ...lines,
  "",
  `Exceptions: ${rec.timeline.filter((e) => e.kind === "exception").map((e) => e.text).join("; ") || "none"}`,
].join("\n")
console.log("\n" + text)
rec.writeReport(text)
sim.close()
await rec.close()
process.exit(0)
