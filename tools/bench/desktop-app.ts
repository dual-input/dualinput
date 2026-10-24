// The bench's end of the stand-in desktop app, which tools/bench.ts copies beside the bench
// core as dualinput-desktop.exe, so a core starts it where it would start the desktop app's
// program. Each start appends its arguments to a file in the run's folder, which the
// environment of the core that starts it names (tools/bench/desktop-app/src/main.rs).

import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import type { BenchRun, CoreOptions } from "./cores.ts"

export class StandInDesktopApp {
  readonly file: string

  /** The stand-in for the core named `core` in `run`. */
  constructor(run: BenchRun, core: string) {
    this.file = path.join(run.folder, `${core}-desktop-app-starts.txt`)
  }

  /** What `BenchRun.core` needs to start a core whose starts of the desktop app's program this hears. */
  coreOptions(): CoreOptions {
    return { env: { DUALINPUT_BENCH_DESKTOP_APP: this.file } }
  }

  /** Each start's arguments, oldest first. */
  starts(): string[][] {
    if (!fs.existsSync(this.file)) return []
    return fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as string[])
  }

  /** Waits until the program has started `count` times, or fails. */
  async until(count: number, ms = 5_000): Promise<void> {
    const started = performance.now()
    while (this.starts().length < count) {
      if (performance.now() - started > ms) throw new Error(`the desktop app's program started ${this.starts().length} times, not ${count}, within ${ms}ms`)
      await sleep(20)
    }
  }
}
