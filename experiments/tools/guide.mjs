/*
 * Keys and beeps for a probe that someone runs from inside the sim.
 *
 *   const keys = await startKeys()
 *   const k = await keys.next()          { key: "START" | "SKIP", foreground, t }
 *   const stop = keys.listen((k) => …)   every press, without waiting for one
 *   const beep = startBeeper(); beep(1000, 100)
 *   const say = startSpeaker(); say("Aircraft 3 of 13")
 *
 * Page Down starts a step and Page Up skips it. End is out, because it toggles
 * the outside camera on our development machine. The keys are read globally,
 * as our FS Copilot fork's guided WASM probe did (FS Copilot fork,
 * record/wasm-pointer/probes/p01-wasm-away.mjs), so the sim stays in front.
 * GetAsyncKeyState doesn't consume the key, so the sim sees it too.
 */

import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

export const START = "Page Down"
export const SKIP = "Page Up"

export const encode = (ps) => Buffer.from(ps, "utf16le").toString("base64")
export const powershell = (ps, stdio) =>
  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encode(ps)], { stdio })

// VK_NEXT (0x22) is Page Down and VK_PRIOR (0x21) is Page Up.
const KEYS_PS = `
$ProgressPreference = "SilentlyContinue"
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CrosscheckKeys {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
[Console]::Out.WriteLine("READY")
$keys = @{ 0x22 = "START"; 0x21 = "SKIP" }
$was = @{ 0x22 = $false; 0x21 = $false }
while ($true) {
  foreach ($k in @(0x22, 0x21)) {
    $now = ([CrosscheckKeys]::GetAsyncKeyState($k) -band 0x8000) -ne 0
    if ($now -and -not $was[$k]) {
      $procId = 0
      [void][CrosscheckKeys]::GetWindowThreadProcessId([CrosscheckKeys]::GetForegroundWindow(), [ref]$procId)
      $name = "?"
      try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
      [Console]::Out.WriteLine("KEY " + $keys[$k] + " " + $name)
    }
    $was[$k] = $now
  }
  Start-Sleep -Milliseconds 20
}`

const BEEP_PS = `
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(" ")
  [Console]::Beep([int]$p[0], [int]$p[1])
}`

export function startKeys() {
  const ps = powershell(KEYS_PS, ["ignore", "pipe", "ignore"])
  process.on("exit", () => { try { ps.kill() } catch { /* gone */ } })
  let waiter = null
  const listeners = new Set()
  const out = createInterface({ input: ps.stdout })
  return new Promise((ready, fail) => {
    ps.on("error", fail)
    out.on("line", (l) => {
      if (l === "READY") {
        return ready({
          next: () => new Promise((r) => { waiter = r }),
          listen: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
        })
      }
      if (!l.startsWith("KEY ")) return
      const [, key, ...fg] = l.split(" ")
      const k = { key, foreground: fg.join(" "), t: Date.now() }
      for (const fn of listeners) fn(k)
      // A press while nobody waits is dropped, so a stray key can't start a step.
      if (waiter) { const w = waiter; waiter = null; w(k) }
    })
  })
}

// Windows' own speech synthesizer, so a pilot inside the sim hears a prompt
// they can't read; one line of text per prompt, spoken in order. rate runs from
// -10 to 10, 0 being normal speed (System.Speech, SpeechSynthesizer.Rate); the
// user found 4 a little fast and settled on 3 (2026-10-05).
const PROMPT_RATE = 3
const speakPs = (rate) => `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = ${Math.max(-10, Math.min(10, Math.round(rate)))}
while (($line = [Console]::In.ReadLine()) -ne $null) { $s.Speak($line) }`

export function startSpeaker({ rate = PROMPT_RATE } = {}) {
  const ps = powershell(speakPs(rate), ["pipe", "ignore", "ignore"])
  process.on("exit", () => { try { ps.kill() } catch { /* gone */ } })
  return (text) => { try { ps.stdin.write(`${text.replace(/[\r\n]+/g, " ")}\n`) } catch { /* no voice is no failure */ } }
}

export function startBeeper() {
  const ps = powershell(BEEP_PS, ["pipe", "ignore", "ignore"])
  process.on("exit", () => { try { ps.kill() } catch { /* gone */ } })
  return (hz, ms) => { try { ps.stdin.write(`${hz} ${ms}\n`) } catch { /* no sound is no failure */ } }
}
