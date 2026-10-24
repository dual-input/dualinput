// The bench's network: local relays, each behind a proxy that holds back or cuts one core's
// connection on its own, the backend on a local D1, and the profiles' site, which the cores'
// settings name in place of Dual Input's own (record/areas/network/02-units.md, "Cases for the
// bench").
//
// The relays take a test token, not a production one, so the bench needs no access to the
// private repository of the relays' tokens.

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import readline from "node:readline"

import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import { type LocalBackend, startBackend } from "../lib/backend.ts"
import type { Core, CoreOptions } from "./cores.ts"
import { FakeApp } from "./pages.ts"
import { ProfilesSite } from "./profiles.ts"

export const TOKEN = "bench-token"
/** The production cap, 256 KiB/s, which src/relays/relays.toml gives each relay. */
export const CAP = 262144

/** The bench relay that tools/bench.ts built, by the path Cargo reported. */
function relayProgram(): string {
  const program = process.env.DUALINPUT_BENCH_RELAY
  if (!program) throw new Error("DUALINPUT_BENCH_RELAY isn't set; run the bench with node tools/bench.ts")
  return program
}

/** One of tools/bench/relay's relays and its proxy, which the cores reach at `url`. */
export class BenchRelay {
  readonly url: string
  private readonly child: ChildProcess
  private readonly answers: string[] = []
  private readonly waiting: ((line: string) => void)[] = []

  private constructor(child: ChildProcess, port: number, lines: readline.Interface) {
    this.child = child
    this.url = `http://127.0.0.1:${port}`
    lines.on("line", (line) => {
      const wake = this.waiting.shift()
      if (wake) wake(line)
      else this.answers.push(line)
    })
  }

  static async start(): Promise<BenchRelay> {
    const child = spawn(relayProgram(), [TOKEN, String(CAP)], { stdio: ["pipe", "pipe", "inherit"] })
    const lines = readline.createInterface({ input: child.stdout! })
    const port = await new Promise<number>((resolve, reject) => {
      lines.once("line", (line) => {
        const ready = /^ready (\d+)$/.exec(line)
        if (ready) resolve(Number(ready[1]))
        else reject(new Error(`the bench relay said ${line}`))
      })
      child.once("exit", (code) => reject(new Error(`the bench relay exited with ${code}`)))
    })
    return new BenchRelay(child, port, lines)
  }

  private async command(command: unknown): Promise<string> {
    const answered = new Promise<string>((resolve) => {
      const early = this.answers.shift()
      if (early !== undefined) resolve(early)
      else this.waiting.push(resolve)
    })
    this.child.stdin!.write(`${JSON.stringify(command)}\n`)
    const answer = await answered
    if (answer.startsWith("error")) throw new Error(`the bench relay refused ${JSON.stringify(command)}: ${answer}`)
    return answer
  }

  /** Closes a core's connections through the proxy, and refuses new ones, for `ms`; `pid` 0 is every core. */
  cut(pid: number, ms: number): Promise<string> {
    return this.command({ cut: { pid, ms } })
  }

  /** Holds a read back, and every byte behind it, for `holdMs`, at `rate`, each way. */
  loss(pid: number, rate: number, holdMs: number): Promise<string> {
    return this.command({ loss: { pid, rate, hold_ms: holdMs } })
  }

  delay(pid: number, ms: number): Promise<string> {
    return this.command({ delay: { pid, ms } })
  }

  /** Stops the relay, closing every connection, or starts it again. */
  down(down: boolean): Promise<string> {
    return this.command({ down })
  }

  /** Each core's bytes sent through the relay, and its busiest second's, by its process ID. */
  async rates(): Promise<Record<string, [number, number]>> {
    const answer = await this.command({ rates: {} })
    return JSON.parse(answer.replace(/^rates /, "")) as Record<string, [number, number]>
  }

  async stop(): Promise<void> {
    const exited = new Promise((resolve) => this.child.once("exit", resolve))
    this.child.kill()
    await exited
  }
}

/** The relays, the backend, and the profiles' site one scenario's cores share. */
export class BenchNetwork {
  readonly relays: BenchRelay[]
  readonly backend: LocalBackend
  readonly profiles: ProfilesSite

  private constructor(relays: BenchRelay[], backend: LocalBackend, profiles: ProfilesSite) {
    this.relays = relays
    this.backend = backend
    this.profiles = profiles
  }

  /** Starts the network, with a profiles' site that serves the tree's profiles, or none when emptySite. */
  static async start(relays = 1, { emptySite = false } = {}): Promise<BenchNetwork> {
    const started = await Promise.all(Array.from({ length: relays }, () => BenchRelay.start()))
    return new BenchNetwork(started, await startBackend(), await ProfilesSite.start({ empty: emptySite }))
  }

  /**
   * A core's settings: the bench's backend, relays, and profiles' site in place of Dual Input's,
   * and everything through the relays, since two cores on one PC would otherwise link directly
   * and never cross a relay (record/areas/network/01-between-machines.md, "Two cores on one
   * PC").
   */
  core(relays: BenchRelay[] = this.relays): CoreOptions {
    return {
      settings: {
        "network.backend": this.backend.url,
        "network.relays": relays.map((r) => ({ url: r.url, token: TOKEN, cap: CAP })),
        "network.relays-only": true,
        "profiles.site": this.profiles.url,
      },
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.relays.map((r) => r.stop()))
    await this.backend.stop()
    await this.profiles.stop()
  }
}

/** Each core's fake desktop app, which the session crate's commands go through. */
const apps = new WeakMap<Core, FakeApp>()

/** `core`'s fake desktop app, watching the session's slice, opened at its first use. */
export async function app(core: Core): Promise<FakeApp> {
  let app = apps.get(core)
  if (!app) {
    app = await FakeApp.open(core, ["session", "notices"])
    apps.set(core, app)
  }
  return app
}

/** Hosts a session on `core`, as the pilot `name`, and returns its code once the backend gave one. */
export async function host(core: Core, name: string): Promise<string> {
  const desktop = await app(core)
  await desktop.ok("clients.set-setting", { key: "session.name", value: name })
  await desktop.ok("session.host")
  await desktop.until(() => typeof desktop.slice<SessionSlice>("session")?.code === "string", "the session's code", 15_000)
  return desktop.slice<SessionSlice>("session")!.code!
}

/** Joins the session `code` names on `core`, as the pilot `name`. */
export async function join(core: Core, code: string, name: string): Promise<void> {
  const desktop = await app(core)
  await desktop.ok("clients.set-setting", { key: "session.name", value: name })
  await desktop.ok("session.join", { code })
}

/** Hosts on `host` and joins on each of `joiners`, and returns the code once every joiner's link is up. */
export async function session(hostCore: Core, joiners: Core[]): Promise<{ code: string; joinMs: number }> {
  const code = await host(hostCore, "Host")
  const started = performance.now()
  for (const [i, joiner] of joiners.entries()) await join(joiner, code, `Joiner ${i + 1}`)
  for (const joiner of joiners) await joiner.hear(/^net up \S+ again=false restart=0$/, { ms: 15_000 })
  return { code, joinMs: performance.now() - started }
}

export type Summary = { count: number; p50_us: number; p99_us: number; max_us: number; behind: number }
export type Report = { probes: Record<string, Summary>; offsets: Record<string, number | null> }

/** What came on each of a core's probe channels, and its clock offset from each member. */
export async function report(core: Core): Promise<Report> {
  const after = core.heard().length
  core.net({ act: "report" })
  const line = await core.hear(/^net report /, { after })
  return JSON.parse(line.replace(/^net report /, "")) as Report
}

/** The CPU time a process has used, in ms, as Windows counts it. */
export function cpuMs(pid: number): number {
  const result = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).TotalProcessorTime.TotalMilliseconds`], { encoding: "utf8" })
  return Number(result.stdout.trim())
}

/** Waits until `core` says `wanted` after its first `after` lines, and returns how long that took. */
export async function took(core: Core, wanted: RegExp, after: number, ms: number): Promise<number> {
  const started = performance.now()
  await core.hear(wanted, { after, ms })
  return performance.now() - started
}