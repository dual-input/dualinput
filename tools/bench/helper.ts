// The bench's end of the stand-in core helper's line. The core owns both ends of its pipe to
// the helper, so the bench listens on a port of its own, which a core's environment carries to
// the stand-in the core starts. Each start of the stand-in connects, says what the core sent
// it, and does what a scenario tells it (record/areas/build/02-testing.md's note of 2026-10-22).

import net from "node:net"
import { setTimeout as sleep } from "node:timers/promises"

import type { StandInHelperAct } from "../../src/engines/messages/ts/bench/StandInHelperAct.ts"
import type { StandInHelperLine } from "../../src/engines/messages/ts/bench/StandInHelperLine.ts"
import type { CoreOptions } from "./cores.ts"

/** The stand-in core helper that tools/bench.ts built, by the path Cargo reported. */
export function standInHelperProgram(): string {
  const program = process.env.DUALINPUT_BENCH_STAND_IN_HELPER
  if (!program) throw new Error("DUALINPUT_BENCH_STAND_IN_HELPER isn't set; run the bench with node tools/bench.ts")
  return program
}

/** One start of the stand-in, from its connecting to its line closing. */
export class HelperRun {
  /** When it connected, on `performance.now()`. */
  readonly connected = performance.now()
  process: number | undefined
  readonly lines: StandInHelperLine[] = []
  /** When its line closed, on `performance.now()`, once it has. */
  closed: number | undefined
  private readonly socket: net.Socket

  constructor(socket: net.Socket) {
    this.socket = socket
  }

  act(act: StandInHelperAct): void {
    this.socket.write(`${JSON.stringify(act)}\n`)
  }

  /** The wants the core sent this run, newest last. */
  wants(): Extract<StandInHelperLine, { line: "wants" }>[] {
    return this.lines.flatMap((l) => (l.line === "wants" ? [l] : []))
  }
}

export class StandInHelper {
  readonly runs: HelperRun[] = []
  /** What each new run says hello as, the build's own by default, or nothing with `null`. */
  helloAs: { version?: string; hash?: string } | null = {}
  private readonly server: net.Server

  private constructor(server: net.Server) {
    this.server = server
    server.on("connection", (socket) => this.connected(socket))
  }

  static async start(): Promise<StandInHelper> {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    return new StandInHelper(server)
  }

  get port(): number {
    return (this.server.address() as net.AddressInfo).port
  }

  get latest(): HelperRun | undefined {
    return this.runs.at(-1)
  }

  /** What `BenchRun.core` needs to start a core whose helper is this stand-in, with `settings` in its settings.json. */
  coreOptions(settings: Record<string, unknown> = {}): CoreOptions {
    return {
      settings: { "core-helper.program": standInHelperProgram(), ...settings },
      env: { DUALINPUT_BENCH_HELPER: String(this.port) },
    }
  }

  /** Waits until `holds`, or fails naming `what`. */
  async until(holds: () => boolean, what: string, ms = 10_000): Promise<void> {
    const started = performance.now()
    while (!holds()) {
      if (performance.now() - started > ms) throw new Error(`the stand-in core helper never reached ${what} within ${ms}ms`)
      await sleep(5)
    }
  }

  close(): void {
    this.server.close()
  }

  private connected(socket: net.Socket): void {
    const run = new HelperRun(socket)
    this.runs.push(run)
    socket.on("error", () => {})
    let text = ""
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8")
      for (let end = text.indexOf("\n"); end >= 0; end = text.indexOf("\n")) {
        const line = JSON.parse(text.slice(0, end)) as StandInHelperLine
        text = text.slice(end + 1)
        run.lines.push(line)
        if (line.line === "started") {
          run.process = line.process
          if (this.helloAs) run.act({ act: "hello", version: this.helloAs.version ?? null, hash: this.helloAs.hash ?? null })
        }
      }
    })
    socket.once("close", () => (run.closed = performance.now()))
  }
}
