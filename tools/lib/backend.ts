// The backend run on this PC: the Worker under `wrangler dev --local`, on a local D1 in a
// folder of its own with backend/migrations applied, for the backend's tests and the bench
// (record/areas/network/02-units.md, "Cases for the bench").

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"

import { ROOT } from "./repo.ts"
import { Failed } from "./run.ts"

const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js")
const CONFIG = path.join(ROOT, "backend", "wrangler.jsonc")

/** wrangler asks no question with CI set, and sends Cloudflare no usage data with the other. */
const QUIET = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }

/** How long `wrangler dev` may take to bundle the Worker and start workerd. */
const READY_WITHIN_MS = 60_000

export type LocalBackend = {
  url: string
  /** What wrangler printed, the Worker's own errors among it. */
  printed(): string
  /** Runs SQL on the local D1, as the tests do to age a row. */
  execute(sql: string): void
  /** Runs the hourly Cron Trigger now. wrangler's `/__scheduled` runs it at the real time, so a
   * test ages rows with `execute` first. */
  scheduled(): Promise<void>
  stop(): Promise<void>
}

export async function startBackend(): Promise<LocalBackend> {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-backend-"))
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", persist, "--config", CONFIG])
  const port = await freePort()
  const child = spawn(
    process.execPath,
    [WRANGLER, "dev", "--local", "--persist-to", persist, "--config", CONFIG, "--ip", "127.0.0.1", "--port", String(port), "--test-scheduled"],
    { cwd: ROOT, env: QUIET, stdio: ["ignore", "pipe", "pipe"] },
  )
  let printed = ""
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Failed(`wrangler dev didn't start within ${READY_WITHIN_MS / 1000}s:\n${printed}`)), READY_WITHIN_MS)
    const read = (chunk: Buffer) => {
      printed += chunk.toString()
      if (printed.includes("Ready on")) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout.on("data", read)
    child.stderr.on("data", read)
    child.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Failed(`wrangler dev exited with ${code}:\n${printed}`))
    })
  })
  const url = `http://127.0.0.1:${port}`
  return {
    url,
    printed: () => printed,
    execute: (sql) => wrangler(["d1", "execute", "DB", "--local", "--persist-to", persist, "--config", CONFIG, "--command", sql]),
    async scheduled() {
      const answer = await fetch(`${url}/__scheduled?cron=${encodeURIComponent("0 * * * *")}`)
      if (!answer.ok) throw new Failed(`the Cron Trigger answered ${answer.status}`)
    },
    async stop() {
      child.removeAllListeners("exit")
      const exited = new Promise((resolve) => child.on("exit", resolve))
      // wrangler runs the Worker in workerd, a process of its own, which outlives a wrangler
      // that Windows ends at once, so the whole tree goes.
      if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"])
      else child.kill()
      await exited
      // workerd lets go of the database's file a moment after it exits.
      try {
        fs.rmSync(persist, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
      } catch (error) {
        console.warn(`the local backend's folder ${persist} stays behind: ${error}`)
      }
    },
  }
}

function wrangler(args: string[]): void {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, env: QUIET, encoding: "utf8" })
  if (result.status !== 0) throw new Failed(`wrangler ${args.slice(0, 3).join(" ")} exited with ${result.status}:\n${result.stdout}${result.stderr}`)
}

/** A TCP port nothing listens on, which the OS picks. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Failed("no port"))))
    })
  })
}
