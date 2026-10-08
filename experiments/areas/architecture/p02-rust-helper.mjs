/*
 * p02: can a Rust program do the native work the core's helper would do, and
 * does it build without Visual Studio (architecture plan, node 1.3.3)? Needs no
 * sim.
 *
 *   node experiments/areas/architecture/p02-rust-helper.mjs
 *
 * Build helper/ first, once for each target:
 *   cargo build --release                                     (MSVC's linker)
 *   cargo build --release --target x86_64-pc-windows-gnu      (Rust's own MinGW linker)
 * The probe runs whichever builds it finds, each through the same steps:
 *
 *   1. devices: list the output and input devices.
 *   2. play and loopback: one copy plays a quiet 440Hz tone for 6s on the
 *      default output device, looked up by its name; a second copy captures that
 *      first copy's audio through WASAPI's process loopback for 4s and reports
 *      the level each second. The tone plays at -26dBFS, so the capture should
 *      read about -29dBFS RMS (a sine's RMS is 3dB under its peak).
 *   3. mic: the default input device for 3s, levels only; nothing is kept.
 *   4. keys: Raw Input in sink mode for 4s, while a third copy presses and
 *      releases F24, which no application binds, with this terminal in front.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const HELPER = path.join(REPO, "experiments", "areas", "architecture", "helper", "target")
const builds = [
  ["MSVC target (x86_64-pc-windows-msvc)", path.join(HELPER, "release", "p02-helper.exe")],
  ["GNU target (x86_64-pc-windows-gnu)", path.join(HELPER, "x86_64-pc-windows-gnu", "release", "p02-helper.exe")],
]

// Runs one copy of the helper and collects its lines; onLine sees each as it comes.
function run(exe, args, onLine = () => {}) {
  const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  const lines = []
  createInterface({ input: child.stdout }).on("line", (l) => { lines.push(l); onLine(l, child) })
  const done = new Promise((resolve) => child.on("exit", (code) => resolve({ code, lines })))
  return { child, done }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = [`p02-rust-helper, ${new Date().toISOString()}`, ""]
const note = (s) => { console.log(s); out.push(s) }

for (const [what, exe] of builds) {
  if (!fs.existsSync(exe)) { note(`${what}: not built`); note(""); continue }
  note(`${what}, ${fs.statSync(exe).size} bytes`)

  const devices = await run(exe, ["devices"]).done
  for (const l of devices.lines) note(`  ${l}`)

  let pid = null
  const player = run(exe, ["play", "default", "6", "440"], (l) => { const m = /^PLAYING (\d+)/.exec(l); if (m) pid = Number(m[1]) })
  for (let i = 0; i < 50 && pid === null; i++) await sleep(100)
  if (pid === null) {
    note(`  play: no PLAYING line`)
  } else {
    await sleep(500)
    const loop = await run(exe, ["loopback", String(pid), "4"]).done
    for (const l of loop.lines) note(`  loopback: ${l}`)
  }
  const played = await player.done
  for (const l of played.lines) note(`  play: ${l}`)

  const mic = await run(exe, ["mic", "3"]).done
  for (const l of mic.lines) note(`  mic: ${l}`)

  let ready = false
  const keys = run(exe, ["keys", "4"], (l) => { if (l === "READY") ready = true })
  for (let i = 0; i < 50 && !ready; i++) await sleep(100)
  for (let i = 0; i < 3; i++) { await sleep(500); const s = await run(exe, ["send"]).done; note(`  send: ${s.lines.join(" ")}`) }
  const k = await keys.done
  for (const l of k.lines) note(`  keys: ${l}`)
  note("")
}

const text = out.join("\n")
console.log(`saved ${repoRelative(saveResult("architecture", "p02-rust-helper", text))}`)
