// The core helper's cases on a desk and in the sim, with the real helper
// (record/areas/build/plan.md, "6 The core helper"). Each run starts a bench build of the core
// from the tree, whose development setting names the real helper, built beside it, and drives
// the core helper's test unit through the bench's socket, as a feature would want things of
// the helper. tools/sim/desk stands in for the sim's windows and a pilot's keys and clicks.
// Each mode writes its report to report.txt in its run's folder.
//
//   node tools/sim/core-helper.ts desk
//       the cases that need nobody, in about a minute and a half, in which windows of its
//       own take the focus, and quiet tones play on Windows' default output device
//   node tools/sim/core-helper.ts audio
//       the desk's audio cases alone, which take no focus
//   node tools/sim/core-helper.ts person [step...]
//       the cases that need someone at the PC: Windows' default output device changed while
//       a sound plays, a headset unplugged, a throttle quadrant's switch held on while
//       binding, an Xbox controller, and clicks at 150%; or only the steps named, by number
//   node tools/sim/core-helper.ts sim
//       the cases with the sim in a flight, and BeyondATC's speech through Opus
//
// A person run asks for each step in the terminal, and Enter goes on. A sim run asks one
// question there, starts the sim through Steam if it isn't running, and then guides you by
// voice and beeps from inside the sim (tools/sim/guide.ts), back to the terminal only to
// listen to the ATC it captured.

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import { setTimeout as sleep } from "node:timers/promises"

import type { Bound } from "../../src/engines/messages/ts/core_helper/Bound.ts"
import { BenchRun, type Core } from "../bench/cores.ts"
import { FakePage } from "../bench/pages.ts"
import { buildPrograms } from "../lib/cargo.ts"
import { simRunning } from "../lib/install.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { Guide } from "./guide.ts"

/** Scan codes, which the helper binds a key by. F22 to F24 sit on no keyboard, so nothing takes them. */
const F22 = 0x6d
const F23 = 0x6e
const F24 = 0x76
const LEFT_SHIFT = 0x2a
const BOUND: Bound = { input: { key: { scan: F24, extended: false } }, name: "F24" }

/** The sim's main window's title starts this (record/areas/core/04-core-helper.md, "Raw Input"). */
const MAIN_TITLE = "Microsoft Flight Simulator 2024"

type Tools = { core: string; helper: string; desk: string; tone: string }

type Session = { run: BenchRun; core: Core; tools: Tools; say: (line: string) => void; check: (ok: boolean, what: string, detail?: string) => void }

main(() => {
  const mode = process.argv[2]
  const modes: Record<string, (s: Session) => Promise<void>> = { desk, audio, person, sim }
  const run = mode && modes[mode]
  if (!run) throw new Failed("usage: node tools/sim/core-helper.ts desk|audio|person|sim")
  session(mode, run).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

async function session(mode: string, run: (s: Session) => Promise<void>): Promise<void> {
  const tools = build()
  process.env.DUALINPUT_BENCH_CORE = tools.core
  const bench = new BenchRun(`core-helper-${mode}`)
  const report = path.join(bench.folder, "report.txt")
  const say = (line: string) => {
    console.log(line)
    fs.appendFileSync(report, `${line}\n`)
  }
  let failed = 0
  const check = (ok: boolean, what: string, detail = "") => {
    if (!ok) failed++
    say(`${ok ? "ok" : "FAILED"}: ${what}${detail ? `: ${detail}` : ""}`)
  }
  const core = await bench.core("core", { settings: { "core-helper.program": tools.helper, "bench.input": BOUND } })
  say(`a bench core started in ${path.relative(ROOT, bench.folder)}, with the real helper`)
  try {
    await run({ run: bench, core, tools, say, check })
  } catch (error) {
    check(false, "the run went on to its end", (error as Error).message)
  }
  core.send({ kind: "exit" })
  await Promise.race([core.exited, sleep(5_000)])
  await bench.end()
  say(`the core's recordings replayed to every checkpoint; ${failed ? `${failed} FAILED` : "every case passed"}`)
  process.exit(failed ? 1 : 0)
}

/** Builds the bench core, the real helper, and the desk's tools, release, into target/bench, as Cargo reports their paths. */
function build(): Tools {
  const args = ["--release", "-p", "dualinput-core", "-p", "dualinput-core-helper", "-p", "desk"]
  args.push("--features", "dualinput-core/stand-in", "--target-dir", path.join("target", "bench"))
  const built = buildPrograms(args, ["dualinput-core", "dualinput-core-helper", "desk", "desk-tone"])
  return { core: built["dualinput-core"], helper: built["dualinput-core-helper"], desk: built.desk, tone: built["desk-tone"] }
}

/** A window of tools/sim/desk's, which brings itself to the front before each key or click. */
class DeskWindow {
  readonly dpi: number
  /** The client area's size in pixels, as Windows made it. */
  readonly width: number
  readonly height: number
  private readonly process: ChildProcess
  private readonly lines: AsyncIterator<string>

  private constructor(process: ChildProcess, lines: AsyncIterator<string>, [dpi, width, height]: number[]) {
    this.process = process
    this.lines = lines
    this.dpi = dpi ?? 0
    this.width = width ?? 0
    this.height = height ?? 0
  }

  static async open(desk: string, cls: string, title: string): Promise<DeskWindow> {
    const child = spawn(desk, ["window", cls, title], { stdio: ["pipe", "pipe", "inherit"] })
    const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]()
    const ready = (await lines.next()).value as string
    const sizes = /^ready (\d+) (\d+) (\d+)/.exec(ready)?.slice(1).map(Number)
    if (!sizes) throw new Failed(`the desk's window didn't open: ${ready}`)
    return new DeskWindow(child, lines, sizes)
  }

  /** Clicks the client area's top-left pixel, then its bottom-right one. */
  async clickCorners(): Promise<void> {
    await this.do("click 0 0")
    await this.do(`click ${this.width - 1} ${this.height - 1}`)
  }

  /**
   * Whether two clicks crossed as the client area's corners: the top-left pixel as -1, 1, and
   * the bottom-right one, at its far edge less a pixel, as 2(w-1)/w - 1 and 1 - 2(h-1)/h.
   */
  cornersCrossed(clicks: string[]): boolean {
    const place = (line: string | undefined) => (line ?? "").split(" ").slice(2).map(Number)
    const near = (got: number[], want: number[]) => got.length === 2 && got.every((v, i) => Math.abs(v - want[i]!) < 0.0015)
    const [w, h] = [this.width, this.height]
    return clicks.length === 2 && near(place(clicks[0]), [-1, 1]) && near(place(clicks[1]), [(2 * (w - 1)) / w - 1, 1 - (2 * (h - 1)) / h])
  }

  /** Runs one command, and returns whether the window was in front for it. */
  async do(command: string): Promise<boolean> {
    this.process.stdin!.write(`${command}\n`)
    return ((await this.lines.next()).value as string) === "done"
  }

  close(): void {
    this.process.stdin!.end()
    this.process.kill()
  }
}

function runDesk(tools: Tools, ...args: string[]): string {
  const result = spawnSync(tools.desk, args, { encoding: "utf8" })
  if (result.status !== 0) throw new Failed(`desk ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

/** The heard lines after the first `from`. */
function since(core: Core, from: number, prefix: string): string[] {
  return core.heard().slice(from).filter((h) => h.startsWith(prefix))
}

/** The running helper's process ID, from the core's log. */
async function helperProcess(core: Core): Promise<number> {
  for (let waited = 0; waited < 10_000; waited += 100) {
    const line = core.log().split("\n").filter((l) => l.includes("the core helper said hello")).at(-1)
    const process = line && /process=(\d+)/.exec(line)?.[1]
    if (process) return Number(process)
    await sleep(100)
  }
  throw new Failed("the core helper never said hello")
}

async function desk(s: Session): Promise<void> {
  const { core, tools, say, check } = s
  const main = await DeskWindow.open(tools.desk, "AceApp", `${MAIN_TITLE} - Dual Input's desk test`)
  const popOut = await DeskWindow.open(tools.desk, "AceApp", "Dual Input's pop-out test")
  const other = await DeskWindow.open(tools.desk, "DualInputDesk", "Another program")
  try {
    say(`the desk's windows are at ${main.dpi} DPI, ${Math.round((main.dpi * 100) / 96)}% scaling`)
    core.helper({ act: "binding", on: true })
    const helper = await helperProcess(core)
    say(`the core started the real helper, process ${helper}`)

    let from = core.heard().length
    check(await main.do(`key ${F24} 2000`), "the sim's main window came to the front")
    await sleep(300)
    let presses = since(core, from, "press")
    check(presses.length === 2 && presses[0]!.startsWith("press down") && presses[1]!.startsWith("press up"), "a bound key held for 2s crosses as one press and one release", presses.join("; "))

    from = core.heard().length
    await other.do(`key ${F24} 200`)
    await main.do(`key ${F23} 200`)
    await sleep(300)
    presses = since(core, from, "press")
    check(presses.length === 0, "the bound key with another program in front, and a key nobody bound with the sim in front, never cross", presses.join("; "))

    from = core.heard().length
    await popOut.do(`key ${F24} 200`)
    await sleep(300)
    check(since(core, from, "press").length === 2, "the bound key crosses with a popped-out display in front")

    from = core.heard().length
    for (let i = 0; i < 100; i++) await main.do(`key ${F24} 20`)
    await sleep(300)
    const after = since(core, from, "press").map((h) => Number(/(\d+)us after/.exec(h)?.[1])).sort((a, b) => a - b)
    const p99 = after[Math.ceil(after.length * 0.99) - 1] ?? Infinity
    say(`budget: of ${after.length} presses and releases, the 99th percentile reached the loop ${p99}µs after the helper's stamp, against 5,000µs`)
    check(after.length === 200 && p99 < 5_000, "a press on the queue within 5ms of the helper's stamp at p99")

    core.helper({ act: "mouse", on: true })
    await sleep(500)
    from = core.heard().length
    await main.clickCorners()
    await popOut.do("click 640 360")
    await other.do("click 640 360")
    await sleep(300)
    const clicks = since(core, from, "mouse LeftDown")
    say(`clicks, in a client area of ${main.width} by ${main.height}: ${clicks.join("; ")}`)
    check(clicks.length === 2, "only the clicks in the sim's main window cross, not one in a popped-out display or another program")
    check(main.cornersCrossed(clicks), `at ${main.dpi} DPI, the top-left pixel of the client area crosses as -1, 1, and the bottom-right as nearly 1, -1`)

    core.helper({ act: "next-press", on: true })
    await sleep(300)
    from = core.heard().length
    await other.do(`key ${F22} 100`)
    await sleep(300)
    const next = since(core, from, "next press")
    check(next.length === 1, "the next press crosses whatever is in front, once", next.join("; "))

    core.helper({ act: "next-press", on: true })
    await sleep(300)
    from = core.heard().length
    await main.do(`key ${LEFT_SHIFT} 100`)
    await sleep(300)
    check(since(core, from, "next press").length === 0, "while binding, a modifier alone doesn't bind")
    await main.do(`key ${F24} 200`)
    await sleep(300)
    const kept = since(core, from, "next press")
    const crossed = since(core, from, "press")
    check(kept.length === 1 && crossed.length === 0, "while binding, the key already bound crosses as the next press alone, so it takes nothing", [...kept, ...crossed].join("; "))

  } finally {
    for (const w of [main, popOut, other]) w.close()
  }
  await audio(s)
}

/** The audio's cases on a desk, which take no focus: the capture, playback, and sounds. */
async function audio(s: Session): Promise<void> {
  const { core, tools, say, check } = s
  core.helper({ act: "capture", programs: ["desk-tone"] })
  const helper = await helperProcess(core)
  await core.hear("capturing None")

  // desk-tone's level as captured, while it runs at `mixer` in the Windows mixer.
  const captured = async (mixer: string): Promise<number> => {
    const from = core.heard().length
    const tone = spawn(tools.tone, ["10", mixer], { stdio: "ignore" })
    await core.hear('capturing Some("desk-tone")', { after: from })
    // The helper reads the program's mixer level again every 1s.
    await sleep(1_500)
    const start = core.heard().length
    await sleep(5_000)
    tone.kill()
    await core.hear("capturing None", { after: start })
    const hex = since(core, start, "captured").map((h) => h.split(" ")[3] ?? "")
    const frames = path.join(s.run.folder, `desk-tone-${mixer}.hex`)
    fs.writeFileSync(frames, `${hex.join("\n")}\n`)
    const decoded = runDesk(tools, "frames", frames, path.join(s.run.folder, `desk-tone-${mixer}.wav`), "0")
    say(`desk-tone at ${mixer} in the mixer, as captured: ${decoded}`)
    return Number(/level (-?[\d.]+)/.exec(decoded)?.[1])
  }
  const full = await captured("1")
  const low = await captured("0.3")
  check(true, "the captured program exited, the capture stopped, and attached again once it started again")
  check(Math.abs(full - low) < 1.5, "frames from a program at 30% in the Windows mixer arrive at the level it has at 100%", `${low} dBFS against ${full} dBFS`)

  const read = (usage: string) => [Number(/cpu ([\d.]+)/.exec(usage)?.[1]), Number(/private ([\d.]+)/.exec(usage)?.[1])] as const
  core.helper({ act: "sounds", on: true })
  await sleep(2_000)
  const [idle] = read(runDesk(tools, "usage", String(helper), "10000"))
  say(`the helper took ${idle}% of one CPU core over 10s with the output device open and nothing playing`)
  core.helper({ act: "sounds", on: false })
  // A program muted in the mixer plays silence, which the gate holds back unencoded, as it
  // holds back ATC between transmissions.
  let from = core.heard().length
  const muted = spawn(tools.tone, ["20", "0"], { stdio: "ignore" })
  await core.hear('capturing Some("desk-tone")', { after: from })
  await sleep(2_000)
  const [silent] = read(runDesk(tools, "usage", String(helper), "10000"))
  say(`the helper took ${silent}% of one CPU core over 10s capturing a program that plays silence`)
  muted.kill()
  await core.hear("capturing None", { after: from })
  from = core.heard().length
  const tone = spawn(tools.tone, ["40", "1"], { stdio: "ignore" })
  await core.hear('capturing Some("desk-tone")', { after: from })
  await sleep(2_000)
  const [capturing, memory] = read(runDesk(tools, "usage", String(helper), "10000"))
  core.helper({ act: "stream", on: true })
  core.helper({ act: "loop", on: true })
  await sleep(2_000)
  const [both, most] = read(runDesk(tools, "usage", String(helper), "10000"))
  tone.kill()
  // A tone never falls below the gate, so every frame is encoded, sent, and played, as in
  // the longest ATC transmission; the ATC host captures, and each other machine plays.
  say(`budget: the helper took ${capturing}% of one CPU core over 10s capturing a tone, and ${both}% capturing it and playing it back, so about ${(both - capturing).toFixed(2)}% playing, each against 1%`)
  say(`budget: the helper held ${Math.max(memory, most)} MB of private working set, against 20 MB`)
  check(capturing < 1, "the helper under 1% of one CPU core while it captures")
  check(both - capturing < 1, "the helper under 1% of one CPU core while it plays")
  check(Math.max(memory, most) < 20, "the helper under 20 MB of private working set")
  core.helper({ act: "loop", on: false })
  core.helper({ act: "capture", programs: null })
  core.helper({ act: "stream", on: false })

  core.helper({ act: "sounds", on: true })
  await sleep(500)
  core.helper({ act: "play" })
  await sleep(1_000)
  const inUse = core.log().split("\n").filter((l) => l.includes("the core helper plays on this output device")).at(-1)
  say(`the helper plays on: ${/output=("[^"]*"|\S+)/.exec(inUse ?? "")?.[1] ?? "nothing it said"}`)
  check(inUse !== undefined && !core.log().includes("a sound wasn't played"), "the bench's tone plays on the output device")
}

/** Waits for Enter, or a line the person typed, in the terminal. */
async function ask(say: (line: string) => void, question: string): Promise<string> {
  say(question)
  const rl = createInterface({ input: process.stdin })
  const answer = await new Promise<string>((resolve) => rl.once("line", resolve))
  rl.close()
  return answer.trim()
}

/** Lines of the core's log after `from` that hold `text`. */
function logLines(core: Core, text: string): string[] {
  return core.log().split("\n").filter((l) => l.includes(text))
}

async function person(s: Session): Promise<void> {
  const { core, run, tools, say, check } = s
  // `person 5` runs step 5 alone, and `person 2 3` steps 2 and 3, as after a fix to one case.
  const steps = process.argv.slice(3).map(Number).filter(Boolean)
  const runs = (step: number) => steps.length === 0 || steps.includes(step)
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  const desktop = new FakePage(core, { component: "desktop" })
  try {
    await desktop.until(() => desktop.client.connected, "the desktop app's page connecting")
    core.helper({ act: "sounds", on: true })
    await helperProcess(core)

    // Switching away and back lets the ear judge the second switch on a device it can hear,
    // when the only other device plays nothing, as NVIDIA Broadcast with no speaker effect.
    let before = logLines(core, "plays on this output device").length
    if (runs(1) && (await ask(say, "1. Open Windows' sound settings. Press Enter, and a 2s two-tone sound plays on the default device, again and again for 40s, or type s to skip. While it plays, switch the default output device to another one, wait for two sounds, and switch it back.")) !== "s") {
      for (let played = 0; played < 40_000; played += 1_500) {
        core.helper({ act: "play" })
        await sleep(1_500)
      }
      const moved = logLines(core, "plays on this output device").slice(before)
      say(`the helper played on: ${moved.map((l) => /output=("[^"]*"|\S+)/.exec(l)?.[1]).join(", ")}`)
      const heard = await ask(say, "Did the sound come back in the device you switched back to? Type y or n, then Enter.")
      check(moved.length >= 2 && heard === "y", "Windows' default output device changed while a sound played, and the sound carried on in the new device")
    }

    const devices = runs(2) ? runDesk(tools, "devices").split("\n").map((l) => l.split("\t") as [string, string]) : []
    devices.forEach(([, name], i) => say(`  ${i + 1}. ${name}`))
    const pick = !runs(2) ? 0 : Number(await ask(say, "2. Type the number of a device you can unplug, a USB headset or the audio interface yours is plugged into, then Enter, or s to skip. It may be Windows' default device: while it's missing, Windows makes another one the default."))
    const headset = devices[pick - 1]
    if (headset) {
      await desktop.client.command("clients.set-setting", { key: "core-helper.output", value: { id: headset[0], name: headset[1] } })
      // The log, not the ear, tells whether the helper went to Windows' default, since a
      // default that plays through the unplugged device, as NVIDIA Broadcast does, goes silent.
      await ask(say, `Dual Input now plays on ${headset[1]}. Press Enter, then, as the sound plays every 2s, take your time to unplug it, wait about 5s, and plug it into another USB port; or disable it in Windows' Sound control panel (mmsys.cpl), wait about 5s, and enable it again.`)
      before = logLines(core, "plays on this output device").length
      const plays = setInterval(() => core.helper({ act: "play" }), 2_000)
      await ask(say, "Press Enter once the sound is back in the headset.")
      clearInterval(plays)
      const how = await ask(say, "Did you unplug it into another port (u) or disable and enable it (d)? Type u or d, then Enter.")
      say(`the device went missing by ${how === "u" ? "being unplugged and plugged into another port" : "being disabled and enabled again in Windows' Sound control panel"}`)
      const used = logLines(core, "plays on this output device").slice(before).map((l) => /output=("[^"]*"|\S+)/.exec(l)?.[1])
      say(`the helper played on: ${used.join(", ")}`)

      check(used.length >= 2 && used.at(-1)!.includes(headset[1]), "Dual Input played on Windows' default, and went back to the headset in another port")
      await desktop.client.command("clients.set-setting", { key: "core-helper.output", value: null })
    }

    if (runs(3) && (await ask(say, "3. Turn a switch on your throttle quadrant on, and leave it on. Then press Enter, or type s to skip.")) !== "s") {
      core.helper({ act: "next-press", on: true })
      const from = core.heard().length
      await ask(say, "Now press a button on the yoke or throttle, not that switch, then press Enter.")
      const next = since(core, from, "next press")
      say(`the next press: ${next.join("; ")}`)
      check(next.length === 1 && /button \d+$/.test(next[0]!), "while binding, with a switch held on, only the button pressed crosses, and then nothing")
      const pressedButton = since(core, from, "next input").at(-1)?.replace("next input ", "")
      if (pressedButton) {
        await desktop.client.command("clients.set-setting", { key: "bench.input", value: JSON.parse(pressedButton) })
        core.helper({ act: "binding", on: true })
        await sleep(300)
        const before = core.heard().length
        await ask(say, "This terminal is in front, so no window of the sim is. Press that same button once more, then press Enter.")
        const presses = since(core, before, "press")
        check(presses.length === 2, "a bound button crosses with another program in front", presses.join("; "))
        core.helper({ act: "binding", on: false })
      }
    }

    if (runs(4) && (await ask(say, "4. If an Xbox controller is connected, press Enter, then press its A button within 10s; otherwise type s.")) !== "s") {
      core.helper({ act: "next-press", on: true })
      const from = core.heard().length
      await sleep(10_000)
      const next = since(core, from, "next press")
      say(next.length ? `Raw Input saw the Xbox controller's button: ${next[0]}` : "Raw Input saw no button of the Xbox controller in 10s")
    }

    const scaling = (dpi: number) => Math.round((dpi * 100) / 96)
    const probe = runs(5) ? await DeskWindow.open(tools.desk, "AceApp", `${MAIN_TITLE} - Dual Input's scaling test`) : undefined
    probe?.close()
    const at150 = probe !== undefined && (probe.dpi === 144 || (await ask(say, `5. The main display is at ${scaling(probe.dpi)}%. Set it to 150% in Windows' display settings, then press Enter, or type s to skip.`)) !== "s")
    if (at150) {
      const main = await DeskWindow.open(tools.desk, "AceApp", `${MAIN_TITLE} - Dual Input's scaling test`)
      try {
        core.helper({ act: "mouse", on: true })
        await sleep(500)
        const from = core.heard().length
        await main.clickCorners()
        await sleep(300)
        const clicks = since(core, from, "mouse LeftDown")
        say(`at ${main.dpi} DPI, ${scaling(main.dpi)}%, in a client area of ${main.width} by ${main.height}, clicks: ${clicks.join("; ")}`)
        if (main.dpi === 144) {
          check(main.cornersCrossed(clicks), "on a monitor scaled to 150%, the client area's corners cross as -1, 1 and nearly 1, -1")
        } else check(false, "the display was at 150% for the clicks", `it was at ${scaling(main.dpi)}%`)
      } finally {
        main.close()
      }
    }
    say(`Done. Set Windows' default output device${at150 && probe?.dpi !== 144 ? " and the display's scaling" : ""} back as you had them.`)
  } finally {
    desktop.close()
  }
}

/** The class and title of the window in front. */
function front(tools: Tools): { cls: string; title: string } {
  const [cls = "", title = ""] = runDesk(tools, "front").split("\t")
  return { cls, title }
}

const mainInFront = (tools: Tools) => {
  const { cls, title } = front(tools)
  return cls === "AceApp" && title.startsWith(MAIN_TITLE)
}

const popOutInFront = (tools: Tools) => {
  const { cls, title } = front(tools)
  return cls === "AceApp" && !title.startsWith(MAIN_TITLE)
}

/** Waits until `holds`, Page Up, or `ms`, whichever comes first, and says which. */
async function step(guide: Guide, holds: () => boolean, ms: number): Promise<"done" | "skipped" | "timeout"> {
  guide.skipped()
  for (let waited = 0; waited < ms; waited += 200) {
    if (holds()) return "done"
    if (guide.skipped()) return "skipped"
    await sleep(200)
  }
  return holds() ? "done" : "timeout"
}

/** The helper's share of one CPU core over `ms`, as tools/sim/desk's `usage` reads it, without holding up the session. */
function cpuOver(tools: Tools, pid: number, ms: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(tools.desk, ["usage", String(pid), String(ms)], { stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    child.stdout!.on("data", (d: Buffer) => (out += d.toString()))
    child.on("close", () => resolve(Number(/cpu ([\d.]+)/.exec(out)?.[1])))
  })
}

/**
 * The cases in the sim. Past the first question, nothing needs the terminal until the
 * listening at the end: a voice says each step, the session moves on once it sees the step
 * done, and Page Up skips one, since the sim covers the terminal.
 */
async function sim(s: Session): Promise<void> {
  const { core, tools, say, check } = s
  const choice = (await ask(say, "Which ATC app will you use? Type b for BeyondATC, i for SayIntentionsAI, both, or n for neither, then Enter.")).toLowerCase()
  const apps = ({ b: ["BeyondATC"], i: ["SayIntentionsAI"], both: ["BeyondATC", "SayIntentionsAI"] } as Record<string, string[]>)[choice] ?? []
  say(
    [
      "",
      "In the sim, a voice says each step, a high beep is a pass and a low one a fail, and Page Up skips a step:",
      "  1. Load into a flight, and click into the sim's window.",
      "  2. Pop out a display, by holding right Alt and clicking a screen, and click inside the pop-out; then click it once more when the voice asks.",
      "  3. Click once in the sim's main window, on the sky or anything that does nothing.",
      "  4. Switch to another program, such as this terminal.",
      ...apps.map((app, i) => `  ${5 + i}. Get ${app} talking${i === 0 ? " for about a minute, such as by asking for the ATIS" : " for a few seconds"}.`),
      `Then come back here${apps.length ? " to listen to the ATC recordings" : ""}.`,
      "",
    ].join("\n"),
  )
  if (!simRunning()) {
    spawn("cmd", ["/c", "start", "", "steam://rungameid/2537590"], { stdio: "ignore", detached: true }).unref()
    say("The sim wasn't running, so Steam is starting it.")
  }
  await ask(say, "Press Enter, then go to the sim.")
  const guide = await Guide.start()
  const verdict = (ok: boolean, what: string, detail = "") => {
    check(ok, what, detail)
    if (ok) guide.pass()
    else guide.fail()
  }
  const missed = (outcome: "skipped" | "timeout", what: string) => {
    if (outcome === "skipped") {
      say(`skipped: ${what}`)
      guide.tick()
    } else verdict(false, what, "it didn't happen in time")
  }
  const keyCrosses = async () => {
    const from = core.heard().length
    runDesk(tools, "key", String(F24), "200")
    await sleep(300)
    return since(core, from, "press").length
  }

  try {
    core.helper({ act: "binding", on: true })
    core.helper({ act: "mouse", on: true })
    const helper = await helperProcess(core)

    guide.say("Step 1. Load into a flight, and click into the sim's window.")
    let outcome = await step(guide, () => mainInFront(tools), 20 * 60_000)
    if (outcome === "done") {
      await sleep(1_000)
      const presses = await keyCrosses()
      verdict(presses === 2, "a bound key crosses with the sim's main window in front", `${presses} presses and releases`)
    } else missed(outcome, "a bound key with the sim's main window in front")

    guide.say("Step 2. Pop out a display: hold right Alt and click a screen, then click once inside the pop-out.")
    outcome = await step(guide, () => popOutInFront(tools), 5 * 60_000)
    if (outcome === "done") {
      guide.tick()
      guide.say("Now click inside the pop-out once more.")
      // Counted from here, since the click that pops a display out lands in the main window,
      // and the one that brings the pop-out to the front may land before it's in front.
      const [from, clicked] = [core.heard().length, guide.clicks()]
      outcome = await step(guide, () => guide.clicks() > clicked, 2 * 60_000)
      if (outcome === "done") {
        await sleep(400)
        // A left release crosses whatever is in front, so the hand a press brought out never stays out
        // (record/areas/core/04-core-helper.md, its note of 2026-11-05).
        const crossed = since(core, from, "mouse").filter((line) => !line.startsWith("mouse LeftUp"))
        verdict(popOutInFront(tools) && crossed.length === 0, "a click in a popped-out display crosses nothing but its release", crossed.join("; "))
        const presses = await keyCrosses()
        verdict(presses === 2, "a bound key crosses with a popped-out display in front", `${presses} presses and releases`)
      } else missed(outcome, "a click in a popped-out display")
    } else missed(outcome, "a popped-out display in front")

    guide.say("Step 3. Click once in the sim's main window, on the sky or anything that does nothing. If you hear no beep, click again.")
    let from = core.heard().length
    outcome = await step(guide, () => since(core, from, "mouse LeftDown").length > 0, 3 * 60_000)
    if (outcome === "done") {
      const click = since(core, from, "mouse LeftDown")[0] ?? ""
      const [x, y] = click.split(" ").slice(2).map(Number)
      const inside = (v: number | undefined) => v !== undefined && Math.abs(v) <= 1
      verdict(inside(x) && inside(y), "a click in the sim's main window crosses with its place", click)
    } else missed(outcome, "a click in the sim's main window")

    guide.say("Step 4. Switch to another program, such as the terminal.")
    outcome = await step(guide, () => front(tools).cls !== "AceApp", 3 * 60_000)
    if (outcome === "done") {
      await sleep(500)
      const presses = await keyCrosses()
      verdict(presses === 0, "a bound key with another program in front crosses nothing", `${presses} presses and releases`)
    } else missed(outcome, "a bound key with another program in front")

    for (const [i, app] of apps.entries()) {
      // The first app's speech goes through the Opus check: a minute of it, 50 frames a second
      // that cross the gate; any other app's only shows it's captured.
      const wanted = i === 0 ? 3_000 : 250
      core.helper({ act: "capture", programs: [app] })
      from = core.heard().length
      guide.say(i === 0 ? `Step ${5 + i}. Get ${app} talking for about a minute, for example by asking for the ATIS.` : `Step ${5 + i}. Get ${app} talking for a few seconds.`)
      outcome = await step(guide, () => since(core, from, "capturing Some").length > 0, 5 * 60_000)
      if (outcome !== "done") {
        missed(outcome, `the helper captures ${app}'s speech`)
        core.helper({ act: "capture", programs: null })
        continue
      }
      guide.tick()
      const readings: number[] = []
      let capturing = true
      const sampling = (async () => {
        while (capturing) {
          const cpu = await cpuOver(tools, helper, 10_000)
          if (capturing) readings.push(cpu)
        }
      })()
      outcome = await step(guide, () => since(core, from, "captured").length >= wanted, 10 * 60_000)
      capturing = false
      await sampling
      core.helper({ act: "capture", programs: null })
      const hex = since(core, from, "captured").map((h) => h.split(" ")[3] ?? "")
      verdict(hex.length > 0, `the helper captures ${app}'s speech`, `${hex.length} frames crossed the gate`)
      if (readings.length) {
        const mean = readings.reduce((a, b) => a + b, 0) / readings.length
        say(`budget: capturing ${app}, the helper took ${mean.toFixed(2)}% of one CPU core on average over ${readings.length} readings of 10s, ${Math.max(...readings).toFixed(2)}% at most, against 1%`)
      }
      if (i > 0) continue
      // These are the helper's encoded frames, for listening, so they stay in target/; the
      // Opus check's fixture is a lossless recording, src/apps/core-helper/fixtures/beyondatc.wav,
      // which experiments/areas/core/opus-quality's `record` made.
      const frames = path.join(s.run.folder, "atc.hex")
      fs.writeFileSync(frames, `${hex.join("\n")}\n`)
      for (const loss of ["0", "5"]) {
        const wav = path.join(s.run.folder, `atc-${loss}-loss.wav`)
        say(`ATC through opus-rs, as the helper encoded it, with ${loss}% of frames lost: ${runDesk(tools, "frames", frames, wav, loss)}`)
      }
    }
    guide.say("That's every step in the sim. Come back to the terminal.")
    guide.pass()
  } finally {
    await sleep(3_000)
    guide.close()
  }

  if (!fs.existsSync(path.join(s.run.folder, "atc-0-loss.wav"))) return
  for (const loss of ["0", "5"]) {
    const wav = path.join(s.run.folder, `atc-${loss}-loss.wav`)
    spawn("cmd", ["/c", "start", "", wav], { stdio: "ignore", detached: true }).unref()
    await ask(say, `Listening to ATC with ${loss}% of frames lost, ${path.relative(ROOT, wav)}, which opens now. Press Enter when you've heard enough.`)
  }
  // A fault a pilot would hear passes, as long as they can understand every call (user, 2026-11-16,
  // record/areas/core/log.md).
  const lost = await ask(say, "Is any of the 5% one impossible to understand, as a pilot listening for their call? Type y or n, then Enter.")
  check(lost === "n", "ATC speech through opus-rs with 5% of frames lost stays understandable", lost === "y" ? "it doesn't, so libopus goes in its place" : "")
}
