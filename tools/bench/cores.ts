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

import type { Hello } from "../../engines/messages/ts/bench/Hello.ts"
import type { ToCore } from "../../engines/messages/ts/bench/ToCore.ts"
import { HASH, VERSION } from "../../engines/messages/ts/stamp.ts"
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
  async core(name: string): Promise<Core> {
    const core = await Core.start(path.join(this.folder, name))
    this.cores.push(core)
    return core
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

  private constructor(data: string, process: ChildProcess, exited: Promise<number | null>, socket: net.Socket) {
    this.data = data
    this.process = process
    this.exited = exited
    this.socket = socket
  }

  /** Starts a core on the data folder `data`, and ends it again if it doesn't answer as a bench core of this tree. */
  static async start(data: string): Promise<Core> {
    fs.mkdirSync(data, { recursive: true })
    // A core started on this folder before, and killed, left its port behind.
    const portFile = path.join(data, "bench-port")
    fs.rmSync(portFile, { force: true })
    const out = fs.openSync(`${data}-output.txt`, "w")
    const child = spawn(benchCore(), ["--data", data], { stdio: ["ignore", out, out] })
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
      const hello = JSON.parse(await firstLine(socket)) as Hello
      assert.deepEqual(hello, { version: VERSION, hash: HASH }, "the core was built from another tree than the bench's types")
      return new Core(data, child, exited, socket)
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

function firstLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ""
    const onData = (chunk: Buffer) => {
      text += chunk.toString("utf8")
      const end = text.indexOf("\n")
      if (end < 0) return
      socket.off("data", onData)
      resolve(text.slice(0, end))
    }
    socket.on("data", onData)
    socket.once("close", () => reject(new Error("the core closed its socket before its first line")))
  })
}

export type Replayed = {
  file: string
  inputs: number
  checkpoints: number
  /** The recording stopped inside a frame, as a killed core's can. */
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
  // As dualinput-core's replay prints it, in apps/core/src/lib.rs, such as "replayed 76
  // inputs, and all 3 checkpoints matched", so change both together.
  const said =
    /^replayed (\d+) inputs?, and (?:it held no checkpoint to compare|its (1) checkpoint matched|all (\d+) checkpoints matched)(, up to the last whole frame of a cut recording)?$/m.exec(
      result.stdout,
    )
  assert.ok(said, `the replay of ${file} said something else:\n${result.stdout}`)
  // apps/core/src/recording/replay.rs writes the log into a `replay` folder beside the
  // recording, so change both together.
  const log = path.join(path.dirname(file), "replay", "log.txt")
  return { file, inputs: Number(said[1]), checkpoints: Number(said[2] ?? said[3] ?? 0), cut: said[4] !== undefined, ms, log }
}
