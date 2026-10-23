// What a session in the sim needs to guide someone who can't see the terminal behind the sim:
// Windows' own voice for each step, a high beep for a pass and a low one for a fail, and Page Up,
// read globally, to skip a step, as experiments/tools/guide.mjs did for our probes in the sim.
// It also tells each left click, wherever it lands, since a click that should cross nothing
// leaves no trace of its own to wait for.
//
// The keys and the button are read with GetAsyncKeyState, which leaves them to the sim too, and
// End stays out, since it toggles the outside camera on our development machine.

import { spawn, type ChildProcess, type StdioOptions } from "node:child_process"
import { createInterface } from "node:readline"

function powershell(script: string, stdio: StdioOptions): ChildProcess {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { stdio })
}

// VK_PRIOR (0x21) is Page Up, and VK_LBUTTON (0x01) the left mouse button.
const INPUT_PS = `
Add-Type @"
using System.Runtime.InteropServices;
public static class DualInputGuide {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
}
"@
[Console]::Out.WriteLine("ready")
$names = @{ 0x21 = "skip"; 0x01 = "click" }
$was = @{ 0x21 = $false; 0x01 = $false }
while ($true) {
  foreach ($k in @(0x21, 0x01)) {
    $now = ([DualInputGuide]::GetAsyncKeyState($k) -band 0x8000) -ne 0
    if ($now -and -not $was[$k]) { [Console]::Out.WriteLine($names[$k]) }
    $was[$k] = $now
  }
  Start-Sleep -Milliseconds 15
}`

// The user found a rate of 4 a little fast and settled on 3 (2026-10-05).
const SPEAK_PS = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = 3
while (($line = [Console]::In.ReadLine()) -ne $null) { $s.Speak($line) }`

const BEEP_PS = `
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(" ")
  [Console]::Beep([int]$p[0], [int]$p[1])
}`

export class Guide {
  private skips = 0
  private clickCount = 0
  private readonly children: ChildProcess[]

  private constructor(children: ChildProcess[]) {
    this.children = children
  }

  static async start(): Promise<Guide> {
    const input = powershell(INPUT_PS, ["ignore", "pipe", "ignore"])
    const guide = new Guide([input, powershell(SPEAK_PS, ["pipe", "ignore", "ignore"]), powershell(BEEP_PS, ["pipe", "ignore", "ignore"])])
    process.on("exit", () => guide.close())
    await new Promise<void>((ready, fail) => {
      input.on("error", fail)
      createInterface({ input: input.stdout! }).on("line", (line) => {
        if (line === "ready") ready()
        else if (line === "skip") guide.skips++
        else if (line === "click") guide.clickCount++
      })
    })
    return guide
  }

  /** Speaks one line, after any still being spoken. */
  say(text: string): void {
    this.write(1, text.replace(/[\r\n]+/g, " "))
  }

  pass(): void {
    this.write(2, "1200 150")
  }

  fail(): void {
    this.write(2, "300 600")
  }

  /** A short beep, for a step's part done. */
  tick(): void {
    this.write(2, "900 80")
  }

  /** Whether Page Up was pressed since the last call. */
  skipped(): boolean {
    const skipped = this.skips > 0
    this.skips = 0
    return skipped
  }

  /** Left clicks since the guide started. */
  clicks(): number {
    return this.clickCount
  }

  close(): void {
    for (const child of this.children) {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }
  }

  private write(child: number, line: string): void {
    try {
      this.children[child]?.stdin?.write(`${line}\n`)
    } catch {
      // No voice or beep is no failure of the session's.
    }
  }
}
