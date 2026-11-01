import { spawnSync, type SpawnSyncOptions } from "node:child_process"
import path from "node:path"

import { fromRoot, ROOT } from "./repo.ts"

/** A command as a person would type it, with `node` for Node and paths from the root, such as `node tools/map-check.ts`. */
function shown(program: string, args: string[]): string {
  const short = (a: string) => (path.isAbsolute(a) && !fromRoot(a).startsWith("..") ? fromRoot(a) : a)
  return [program === process.execPath ? "node" : program, ...args.map(short)].join(" ")
}

/**
 * A failure that stops a script, such as a command that exited with an error or a missing
 * SDK. `main` prints its message and exits with 1, without a stack trace.
 */
export class Failed extends Error {}

/**
 * Runs a program in the repository's root, with its output shown, and throws `Failed`
 * unless it exits with 0. Each of our scripts stops at its first failing command, so a
 * failure can't scroll past while the script goes on and exits with 0.
 */
export function run(program: string, args: string[], options: SpawnSyncOptions = {}): void {
  console.log(`> ${shown(program, args)}`)
  const result = spawnSync(program, args, { cwd: ROOT, stdio: "inherit", ...options })
  if (result.error) throw new Failed(`${program} didn't start: ${result.error.message}`)
  if (result.status !== 0) throw new Failed(`${shown(program, args)} exited with ${result.status}`)
}

/** Runs a program and returns what it printed, throwing `Failed` unless it exits with 0. */
export function output(program: string, args: string[], options: SpawnSyncOptions = {}): string {
  const result = spawnSync(program, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, ...options })
  if (result.error) throw new Failed(`${program} didn't start: ${result.error.message}`)
  if (result.status !== 0) throw new Failed(`${shown(program, args)} exited with ${result.status}\n${String(result.stderr)}`)
  return String(result.stdout)
}

/**
 * Runs a script's body. On `Failed`, it prints the message and exits with 1. Any other
 * error is a bug in the script, so it goes up with its stack trace.
 */
export function main(body: () => void | Promise<void>): void {
  const stop = (error: unknown) => {
    if (!(error instanceof Failed)) throw error
    console.error(`\n${error.message}`)
    process.exit(1)
  }
  try {
    body()?.catch(stop)
  } catch (error) {
    stop(error)
  }
}
