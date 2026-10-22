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
//   node tools/sim/core-helper.ts person
//       the cases that need someone at the PC: Windows' default output device changed while
//       a sound plays, a headset unplugged, a throttle quadrant's switch held on while
//       binding, an Xbox controller, and clicks at 150%
//   node tools/sim/core-helper.ts sim
//       the cases with the sim in a flight, and BeyondATC's speech through Opus
//
// A person and a sim run ask for each step in the terminal, and Enter goes on.

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import { setTimeout as sleep } from "node:timers/promises"

import type { Bound } from "../../engines/messages/ts/core_helper/Bound.ts"
import { BenchRun, type Core } from "../bench/cores.ts"
import { FakePage } from "../bench/pages.ts"
import { buildPrograms } from "../lib/cargo.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"

/** Scan codes, which the helper binds a key by. F22 to F24 sit on no keyboard, so nothing takes them. */
const F22 = 0x6d
const F23 = 0x6e
const F24 = 0x76
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
  private readonly process: ChildProcess
  private readonly lines: AsyncIterator<string>

  private constructor(process: ChildProcess, lines: AsyncIterator<string>, dpi: number) {
    this.process = process
    this.lines = lines
    this.dpi = dpi
  }

  static async open(desk: string, cls: string, title: string): Promise<DeskWindow> {
    const child = spawn(desk, ["window", cls, title], { stdio: ["pipe", "pipe", "inherit"] })
    const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]()
    const ready = (await lines.next()).value as string
    const dpi = Number(/^ready (\d+)/.exec(ready)?.[1])
    if (!dpi) throw new Failed(`the desk's window didn't open: ${ready}`)
    return new DeskWindow(child, lines, dpi)
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
    await main.do("click 0 0")
    await main.do("click 1279 719")
    await popOut.do("click 640 360")
    await other.do("click 640 360")
    await sleep(300)
    const clicks = since(core, from, "mouse LeftDown")
    say(`clicks: ${clicks.join("; ")}`)
    check(clicks.length === 2, "only the clicks in the sim's main window cross, not one in a popped-out display or another program")
    check(clicks[0] === "mouse LeftDown -1.000 1.000" && clicks[1] === "mouse LeftDown 0.998 -0.997", `at ${main.dpi} DPI, the top-left pixel of the client area crosses as -1, 1, and the bottom-right as nearly 1, -1`)

    core.helper({ act: "next-press", on: true })
    await sleep(300)
    from = core.heard().length
    await other.do(`key ${F22} 100`)
    await sleep(300)
    const next = since(core, from, "next press")
    check(next.length === 1, "the next press crosses whatever is in front, once", next.join("; "))

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
  core.act({ act: "watch", process: run.stub().id })
  await core.hear("stage Starting aircraft none")
  const desktop = new FakePage(core, { component: "desktop" })
  try {
    await desktop.until(() => desktop.client.connected, "the desktop app's page connecting")
    core.helper({ act: "sounds", on: true })
    await helperProcess(core)

    await ask(say, "1. Open Windows' sound settings. Press Enter, and a 2s two-tone sound plays on Windows' default output device, again and again for 15s; while it plays, change the default output device.")
    let before = logLines(core, "plays on this output device").length
    for (let played = 0; played < 15_000; played += 1_500) {
      core.helper({ act: "play" })
      await sleep(1_500)
    }
    const moved = logLines(core, "plays on this output device").slice(before)
    say(`the helper played on: ${moved.map((l) => /output=("[^"]*"|\S+)/.exec(l)?.[1]).join(", ")}`)
    const heard = await ask(say, "Did the sound carry on in the new device? Type y or n, then Enter.")
    check(moved.length >= 1 && heard === "y", "Windows' default output device changed while a sound played, and the sound carried on in the new device")

    const devices = runDesk(tools, "devices").split("\n").map((l) => l.split("\t") as [string, string])
    devices.forEach(([, name], i) => say(`  ${i + 1}. ${name}`))
    const pick = Number(await ask(say, "2. Type the number of a headset you can unplug, then Enter, or s to skip."))
    const headset = devices[pick - 1]
    if (headset) {
      await desktop.client.command("clients.set-setting", { key: "core-helper.output", value: { id: headset[0], name: headset[1] } })
      await ask(say, `Dual Input now plays on ${headset[1]}. Press Enter, then, as the sound plays every 2s, unplug the headset, wait for the sound on Windows' default device, and plug it into another USB port.`)
      before = logLines(core, "plays on this output device").length
      const plays = setInterval(() => core.helper({ act: "play" }), 2_000)
      await ask(say, "Press Enter once the sound is back in the headset.")
      clearInterval(plays)
      const used = logLines(core, "plays on this output device").slice(before).map((l) => /output=("[^"]*"|\S+)/.exec(l)?.[1])
      say(`the helper played on: ${used.join(", ")}`)
      const warned = logLines(core, "core-helper.missing-output").length > 0
      check(warned, "with the picked headset unplugged, Dual Input warned", logLines(core, "missing-output").at(0) ?? "")
      check(used.length >= 2 && used.at(-1)!.includes(headset[1]), "Dual Input played on Windows' default, and went back to the headset in another port")
      await desktop.client.command("clients.set-setting", { key: "core-helper.output", value: null })
    }

    if ((await ask(say, "3. Turn a switch on your throttle quadrant on, and leave it on. Then press Enter, or type s to skip.")) !== "s") {
      core.helper({ act: "next-press", on: true })
      const from = core.heard().length
      await ask(say, "Now press a button on the yoke or throttle, not that switch, then press Enter.")
      const next = since(core, from, "next press")
      say(`the next press: ${next.join("; ")}`)
      check(next.length === 1 && /button \d+$/.test(next[0]!), "while binding, with a switch held on, only the button pressed crosses, and then nothing")
    }

    if ((await ask(say, "4. If an Xbox controller is connected, press Enter, then press its A button within 10s; otherwise type s.")) !== "s") {
      core.helper({ act: "next-press", on: true })
      const from = core.heard().length
      await sleep(10_000)
      const next = since(core, from, "next press")
      say(next.length ? `Raw Input saw the Xbox controller's button: ${next[0]}` : "Raw Input saw no button of the Xbox controller in 10s")
    }

    const dpi = await DeskWindow.open(tools.desk, "AceApp", `${MAIN_TITLE} - Dual Input's scaling test`)
    dpi.close()
    if (dpi.dpi !== 144 && (await ask(say, `5. The main display is at ${Math.round((dpi.dpi * 100) / 96)}%. Set it to 150% in Windows' display settings, then press Enter, or type s to skip.`)) !== "s") {
      const main = await DeskWindow.open(tools.desk, "AceApp", `${MAIN_TITLE} - Dual Input's scaling test`)
      try {
        core.helper({ act: "mouse", on: true })
        await sleep(500)
        const from = core.heard().length
        await main.do("click 0 0")
        await main.do("click 1279 719")
        await sleep(300)
        const clicks = since(core, from, "mouse LeftDown")
        say(`at ${main.dpi} DPI, clicks: ${clicks.join("; ")}`)
        check(clicks[0] === "mouse LeftDown -1.000 1.000" && clicks[1] === "mouse LeftDown 0.998 -0.997", "on a monitor scaled to 150%, the client area's corners cross as -1, 1 and nearly 1, -1")
      } finally {
        main.close()
      }
    }
  } finally {
    desktop.close()
  }
}

/** The class and title of the window in front. */
function front(tools: Tools): { cls: string; title: string } {
  const [cls = "", title = ""] = runDesk(tools, "front").split("\t")
  return { cls, title }
}

async function until(holds: () => boolean, ms: number): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 200) {
    if (holds()) return true
    await sleep(200)
  }
  return holds()
}

async function sim(s: Session): Promise<void> {
  const { core, tools, say, check } = s
  core.helper({ act: "binding", on: true })
  core.helper({ act: "mouse", on: true })
  const helper = await helperProcess(core)

  await ask(say, "1. Start the sim, load a flight, and click into the sim's window. Then come back here and press Enter; the next 30s wait for the sim to be in front again.")
  let from = core.heard().length
  if (await until(() => front(tools).cls === "AceApp" && front(tools).title.startsWith(MAIN_TITLE), 30_000)) {
    runDesk(tools, "key", String(F24), "200")
    await sleep(300)
    check(since(core, from, "press").length === 2, "a bound key crosses with the sim's main window in front")
  } else check(false, "the sim's main window came to the front within 30s")

  await ask(say, "2. Pop out a display (hold right Alt and click it), then click on the popped-out window once. Come back here and press Enter; the next 30s wait for the pop-out to be in front.")
  from = core.heard().length
  if (await until(() => front(tools).cls === "AceApp" && !front(tools).title.startsWith(MAIN_TITLE), 30_000)) {
    runDesk(tools, "key", String(F24), "200")
    await sleep(300)
    check(since(core, from, "press").length === 2, "a bound key crosses with a popped-out display in front")
  } else check(false, "a popped-out display came to the front within 30s")
  check(since(core, from, "mouse").length === 0, "the click in the popped-out display crossed nothing")

  await ask(say, "3. Press Enter, then within 15s click once in the sim's main window, on something that does nothing, such as the sky.")
  from = core.heard().length
  await until(() => since(core, from, "mouse LeftDown").length > 0, 15_000)
  const click = since(core, from, "mouse LeftDown")
  check(click.length >= 1, "a click in the sim's main window crosses with its place", click.join("; "))

  await ask(say, "4. Switch to another program, such as this terminal, then press Enter.")
  from = core.heard().length
  runDesk(tools, "key", String(F24), "200")
  await sleep(300)
  check(since(core, from, "press").length === 0, "a bound key with another program in front crosses nothing")

  const app = await ask(say, "5. Type the ATC app you have, BeyondATC or SayIntentionsAI, then Enter; it's captured once it runs.")
  core.helper({ act: "capture", programs: [app || "BeyondATC"] })
  from = core.heard().length
  await ask(say, `Start ${app || "BeyondATC"} if it isn't running, and have it talk for about a minute, such as by asking for the ATIS. Press Enter once it's talking.`)
  const program = await until(() => since(core, from, "capturing Some").length > 0, 30_000)
  check(program, `the helper captures ${app || "BeyondATC"}'s speech`, since(core, from, "capturing").join("; "))
  const usage = runDesk(tools, "usage", String(helper), "10000")
  say(`the helper while capturing ATC: ${usage}`)
  await ask(say, "Press Enter once it has talked for a minute.")
  const hex = since(core, from, "captured").map((h) => h.split(" ")[3] ?? "")
  // ATC speech is another program's, so it stays in target/, which the repository leaves out
  // (record/areas/core/04-core-helper.md's note of 2026-10-22).
  const frames = path.join(s.run.folder, "atc.hex")
  fs.writeFileSync(frames, `${hex.join("\n")}\n`)
  for (const loss of ["0", "5"]) {
    const wav = path.join(s.run.folder, `atc-${loss}-loss.wav`)
    say(`ATC through opus-rs at 24 kbps with ${loss}% of frames lost: ${runDesk(tools, "frames", frames, wav, loss)}; listen to ${path.relative(ROOT, wav)}`)
  }
  core.helper({ act: "capture", programs: null })
}
