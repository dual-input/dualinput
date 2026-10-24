// What the bench's scenarios run: bench builds of the core, each with a data folder of its
// own in the run's folder, which a scenario reaches only from outside, through the bench's
// socket, the process, and the files the core writes (record/areas/build/02-testing.md,
// "The bench").

import assert from "node:assert/strict"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { ClientsAct } from "../../src/engines/messages/ts/bench/ClientsAct.ts"
import type { FromCore } from "../../src/engines/messages/ts/bench/FromCore.ts"
import type { HelperAct } from "../../src/engines/messages/ts/bench/HelperAct.ts"
import type { NetAct } from "../../src/engines/messages/ts/bench/NetAct.ts"
import type { PortFile } from "../../src/engines/messages/ts/clients/PortFile.ts"
import type { Hello } from "../../src/engines/messages/ts/bench/Hello.ts"
import type { SimCall } from "../../src/engines/messages/ts/bench/SimCall.ts"
import type { StandInAct } from "../../src/engines/messages/ts/bench/StandInAct.ts"
import type { ToCore } from "../../src/engines/messages/ts/bench/ToCore.ts"
import { HASH, VERSION } from "../../src/engines/messages/ts/stamp.ts"
import { ROOT } from "../lib/repo.ts"

/**
 * The bench build of the core that tools/bench.ts built, by the path Cargo reported, so a
 * scenario never runs a core from another commit.
 */
export function benchCore(): string {
  const core = process.env.DUALINPUT_BENCH_CORE
  if (!core) throw new Error("DUALINPUT_BENCH_CORE isn't set; run the bench with node tools/bench.ts")
  return core
}

/**
 * A scenario's run, in a folder of its own in target/bench/runs/, named for when it started
 * and the scenario.
 */
export class BenchRun {
  readonly folder: string
  private readonly cores: Core[] = []
  private readonly stubs: Stub[] = []
  private readonly replayed = new Set<string>()

  /**
   * `test`, a scenario's test context, gets the run's end as its last step, so a scenario
   * that fails before its cores exit still ends them and replays their recordings, rather
   * than leaving a core waiting on its socket and the bench waiting on the core.
   */
  constructor(scenario: string, test?: { after(end: () => Promise<void>): void }) {
    const runs = path.join(ROOT, "target", "bench", "runs")
    const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
    let folder = path.join(runs, `${started}-${scenario}`)
    for (let n = 2; fs.existsSync(folder); n++) folder = path.join(runs, `${started}-${scenario}-${n}`)
    fs.mkdirSync(folder, { recursive: true })
    this.folder = folder
    test?.after(() => this.end())
  }

  /** Starts a bench core with a data folder named `name`, and connects to its socket. */
  async core(name: string, options: CoreOptions = {}): Promise<Core> {
    const core = await Core.start(path.join(this.folder, name), options)
    this.cores.push(core)
    return core
  }

  /** Starts a stub for a sim's process, which the run kills at its end if a step hasn't. */
  stub(): Stub {
    const stub = new Stub()
    this.stubs.push(stub)
    return stub
  }

  /**
   * Replays `file` with the bench build, at the log level given, and fails unless the
   * replay matched every checkpoint.
   */
  replay(file: string, level = "info"): Replayed {
    this.replayed.add(file)
    return replay(file, level)
  }

  /**
   * Ends every core still running, then replays each recording no step of the scenario
   * replayed, as every scenario ends, and fails on any whose replay parts from its run.
   */
  async end(): Promise<void> {
    for (const core of this.cores) await core.kill()
    for (const stub of this.stubs) await stub.kill()
    for (const core of this.cores) {
      for (const file of core.recordings()) if (!this.replayed.has(file)) this.replay(file)
    }
  }
}

export class Core {
  readonly data: string
  readonly process: ChildProcess
  /** The core's exit code once it has exited, or null once `kill` ended it, since Node gives no code for a process it ended. */
  readonly exited: Promise<number | null>
  private readonly socket: net.Socket
  private readonly lines: Lines

  private constructor(data: string, process: ChildProcess, exited: Promise<number | null>, socket: net.Socket, lines: Lines) {
    this.data = data
    this.process = process
    this.exited = exited
    this.socket = socket
    this.lines = lines
  }

  /** Starts a core on the data folder `data`, and ends it again if it doesn't answer as a bench core of this tree. */
  static async start(data: string, options: CoreOptions = {}): Promise<Core> {
    fs.mkdirSync(data, { recursive: true })
    // A core no scenario gave a profiles' site fetches from a closed port on this PC, so no
    // bench core reaches the real site on the internet. A settings file the scenario wrote
    // itself, or a core before this one, keeps its keys.
    const file = path.join(data, "settings.json")
    const written = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {}
    const settings = { "profiles.site": OFFLINE_SITE, ...written, ...options.settings }
    fs.writeFileSync(file, JSON.stringify(settings, null, 2))
    // A core started on this folder before, and killed, left its port behind.
    const portFile = path.join(data, "bench-port")
    fs.rmSync(portFile, { force: true })
    const out = fs.openSync(`${data}-output.txt`, "w")
    const env = { ...process.env, ...options.env }
    const child = spawn(benchCore(), ["--data", data], { stdio: ["ignore", out, out], env })
    fs.closeSync(out)
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve))
    let gone = false
    void exited.then(() => (gone = true))
    let socket: net.Socket | undefined
    try {
      for (let waited = 0; !fs.existsSync(portFile); waited += 25) {
        if (gone) throw new Error(`the core for ${data} exited before it opened its socket; see ${data}-output.txt`)
        if (waited > 15_000) throw new Error(`the core for ${data} wrote no bench-port within 15s`)
        await sleep(25)
      }
      socket = net.connect({ host: "127.0.0.1", port: Number(fs.readFileSync(portFile, "utf8")) })
      // A killed core resets the connection, which ends the socket and nothing else.
      socket.on("error", () => {})
      const lines = new Lines(socket)
      const hello = JSON.parse(await lines.next()) as Hello
      assert.deepEqual(hello, { version: VERSION, hash: HASH }, "the core was built from another tree than the bench's types")
      return new Core(data, child, exited, socket, lines)
    } catch (error) {
      socket?.destroy()
      child.kill()
      await exited
      throw error
    }
  }

  send(line: ToCore): void {
    this.socket.write(`${JSON.stringify(line)}\n`)
  }

  /** Acts on the core's stand-in sim. */
  act(act: StandInAct): void {
    this.send({ kind: "stand-in", act })
  }

  /** Has the sim's test unit, which stands in for a feature, make a call of the sim. */
  call(call: SimCall): void {
    this.send({ kind: "sim", call })
  }

  /** Has the clients' test unit, which stands in for a feature with a panel module, act. */
  clients(act: ClientsAct): void {
    this.send({ kind: "clients", act })
  }

  /** Has the core helper's test unit, which stands in for the features that want things of the helper, act. */
  helper(act: HelperAct): void {
    this.send({ kind: "helper", act })
  }

  /** Has the network's test unit, which stands in for a feature with a channel of each delivery, act. */
  net(act: NetAct): void {
    this.send({ kind: "net", act })
  }

  /** Calls `f` with each CommBus call the core makes for JavaScript, as the sim's pages hear it, from now on. */
  onCommBus(f: (name: string, data: string) => void): () => void {
    return this.lines.listen((l) => {
      const line = JSON.parse(l) as FromCore
      if (line.kind === "comm-bus") f(line.name, line.data)
    })
  }

  /** The port the core's WebSocket server listens on, from its port file. */
  port(): number {
    return (JSON.parse(fs.readFileSync(path.join(this.data, "port.json"), "utf8")) as PortFile).port
  }

  /** The core's log of its newest run. */
  log(): string {
    const recordings = path.join(this.data, "recordings")
    const newest = fs.readdirSync(recordings).sort().at(-1)
    return newest ? fs.readFileSync(path.join(recordings, newest, "log.txt"), "utf8") : ""
  }

  /**
   * Checks the loop's stats for the whole run, which the core logs as it exits, against the
   * code map's 1ms for a handler. Windows now and then pauses the loop's thread mid-input,
   * and the stats time inputs by the wall clock, which can't tell a pause from work, so a run
   * may hold one input over 1ms if it's under 2ms, and a handler slow each time it runs still
   * fails (record/areas/build/02-testing.md, "Building what it runs").
   */
  checkHandlers(run: string): void {
    const stats = this.log().split("\n").filter((l) => l.includes("the loop's stats")).at(-1) ?? ""
    const slowest = Number(/slowest_us=(\d+)/.exec(stats)?.[1])
    const over = Number(/over_1ms=(\d+)/.exec(stats)?.[1])
    console.log(`budget: ${run}: the slowest input took ${slowest}µs, ${over} over 1ms, against 1,000µs for a handler with one pause under 2ms allowed`)
    assert.ok(over <= 1 && slowest < 2_000, `inputs took over 1ms: ${stats}`)
  }

  /** Every line the sim's test unit has told the bench so far, oldest first. */
  heard(): string[] {
    return this.lines.read.flatMap((l) => {
      const line = JSON.parse(l) as FromCore
      return line.kind === "heard" ? [line.what] : []
    })
  }

  /**
   * Waits until the sim's test unit has told the bench a line that `wanted` matches, among
   * the lines after the first `after` it told, and returns it.
   */
  async hear(wanted: string | RegExp, { after = 0, ms = 10_000 } = {}): Promise<string> {
    const match = (what: string) => (typeof wanted === "string" ? what === wanted : wanted.test(what))
    const started = Date.now()
    while (true) {
      const found = this.heard().slice(after).find(match)
      if (found !== undefined) return found
      const left = ms - (Date.now() - started)
      if (left <= 0) throw new Error(`the core's test unit never said ${wanted}; it said:\n${this.heard().join("\n")}`)
      await this.lines.more(left)
    }
  }

  /** What the stand-in was called for, and what its aircraft holds. */
  async report(): Promise<StandInReport> {
    const before = this.lines.read.length
    this.act({ act: "report" })
    const started = Date.now()
    while (Date.now() - started < 5_000) {
      for (const l of this.lines.read.slice(before)) {
        const line = JSON.parse(l) as FromCore
        if (line.kind === "stand-in") return line
      }
      await this.lines.more(5_000)
    }
    throw new Error("the stand-in didn't report within 5s")
  }

  /** Ends the core at once, as a crash would, if it's still running, and waits until it has. */
  async kill(): Promise<void> {
    this.socket.destroy()
    if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill()
    await this.exited
  }

  /** Each run's recording in the core's data folder, oldest first. */
  recordings(): string[] {
    const recordings = path.join(this.data, "recordings")
    if (!fs.existsSync(recordings)) return []
    return fs
      .readdirSync(recordings)
      .sort()
      .map((run) => path.join(recordings, run, "inputs.zst"))
      .filter((file) => fs.existsSync(file))
  }
}

export type StandInReport = Extract<FromCore, { kind: "stand-in" }>

/** A port nothing listens on, where a core finds no profiles' site. */
export const OFFLINE_SITE = "http://127.0.0.1:1"

export type CoreOptions = {
  /** The core's `settings.json`, written into its data folder before it starts. */
  settings?: Record<string, unknown>
  /** Environment variables for the core, which the programs it starts inherit. */
  env?: Record<string, string>
}

/** The lines a core sends over the bench's socket, as they arrive. */
class Lines {
  readonly read: string[] = []
  private text = ""
  private closed = false
  private wake: (() => void)[] = []
  private taken = 0
  private readonly listeners = new Set<(line: string) => void>()

  constructor(socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.text += chunk.toString("utf8")
      for (let end = this.text.indexOf("\n"); end >= 0; end = this.text.indexOf("\n")) {
        const line = this.text.slice(0, end)
        this.read.push(line)
        this.text = this.text.slice(end + 1)
        for (const f of this.listeners) f(line)
      }
      this.notify()
    })
    socket.once("close", () => {
      this.closed = true
      this.notify()
    })
  }

  /** The next line no caller of `next` has taken, once it arrives. */
  async next(): Promise<string> {
    while (this.taken >= this.read.length) {
      if (this.closed) throw new Error("the core closed its socket before its next line")
      await this.more(15_000)
    }
    return this.read[this.taken++]!
  }

  /** Calls `f` with each line as it arrives from now on, until the returned function is called. */
  listen(f: (line: string) => void): () => void {
    this.listeners.add(f)
    return () => this.listeners.delete(f)
  }

  /** Resolves once another line arrives, the socket closes, or `ms` passes. */
  more(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      this.wake.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private notify(): void {
    for (const wake of this.wake.splice(0)) wake()
  }
}

/**
 * The process that stands for the sim's: a ping that runs for 10 minutes, which the bench
 * kills to crash the sim. Each stand-in watches its own stub by its ID, so the stub's name
 * matters only to the desktop app (record/areas/build/02-testing.md, "The sim's process").
 */
export class Stub {
  readonly process: ChildProcess
  private readonly ended: Promise<void>

  constructor() {
    this.process = spawn("ping", ["-n", "600", "127.0.0.1"], { stdio: "ignore" })
    this.ended = new Promise((resolve) => this.process.once("exit", () => resolve()))
  }

  get id(): number {
    return this.process.pid!
  }

  /** Ends the stub at once, as a crash ends the sim, and waits until it has. */
  async kill(): Promise<void> {
    if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill()
    await this.ended
  }
}

export type Replayed = {
  file: string
  inputs: number
  checkpoints: number
  /** The recording stops partway, after its last flush, as a killed core's can. */
  cut: boolean
  /** How long the replay took. */
  ms: number
  /** The replay's own log, which `dualinput-core replay` writes beside the recording. */
  log: string
}

/** Replays `file` with the bench build, and fails unless the replay matched every checkpoint. */
export function replay(file: string, level = "info"): Replayed {
  const started = performance.now()
  const result = spawnSync(benchCore(), ["replay", file, "--log", level], { encoding: "utf8" })
  const ms = performance.now() - started
  assert.equal(result.status, 0, `the replay of ${file} didn't match its run:\n${result.stdout}${result.stderr}`)
  // As dualinput-core's replay prints it, in src/apps/core/src/lib.rs, such as "replayed 76
  // inputs, and all 3 checkpoints matched", so change both together.
  const said =
    /^replayed (\d+) inputs?, and (?:it held no checkpoint to compare|its (1) checkpoint matched|all (\d+) checkpoints matched)(, up to the last flush of a cut recording)?$/m.exec(
      result.stdout,
    )
  assert.ok(said, `the replay of ${file} said something else:\n${result.stdout}`)
  // src/apps/core/src/recording/replay.rs writes the log into a `replay` folder beside the
  // recording, so change both together.
  const log = path.join(path.dirname(file), "replay", "log.txt")
  return { file, inputs: Number(said[1]), checkpoints: Number(said[2] ?? said[3] ?? 0), cut: said[4] !== undefined, ms, log }
}
