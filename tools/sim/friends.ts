// The servers for a flight with friends, run on this PC in place of Dual Input's deployed ones:
// the bench's backend, one relay, and profiles' site, each behind a Cloudflare quick tunnel, so a
// friend's installed Dual Input on another home network reaches them. It prints the settings
// both pilots put into %APPDATA%\DualInput\settings.json before they start Dual Input, and runs
// until q.
//
//   node tools/bench.ts flight-model                  once, so target/bench holds this tree's
//                                                      relay and its published profiles
//   node tools/sim/friends.ts [--cloudflared <program>] [--feed <folder>]
//
// A quick tunnel needs no account, and gets a new address at each start, so the settings it
// prints hold only until the script ends. cloudflared is Cloudflare's tunnel client; without
// `--cloudflared`, the script runs the one on the PATH.
//
// With `--feed`, it also serves that folder of packed releases, as `node tools/release.ts pack`
// writes them into target/releases, and prints `desktop.update-feed`, the setting that points
// an installed desktop app's update check at it. A release copied into the folder mid-session
// is one the app's next check finds (record/areas/install/01-installing-and-updating.md,
// "Cases for the bench").
//
// The tunnels carry HTTP alone, so the relay's QUIC address discovery doesn't cross them, and
// the two cores may find no direct path: the session then stays on the relay.

import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { createInterface } from "node:readline"

import { BenchNetwork } from "../bench/network.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")

main(() => {
  const args = process.argv.slice(2)
  const usage = "usage: node tools/sim/friends.ts [--cloudflared <program>] [--feed <folder>]"
  const given = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    if (!["--cloudflared", "--feed"].includes(args[i]!) || args[i + 1] === undefined) throw new Failed(usage)
    given.set(args[i]!, args[i + 1]!)
  }
  const feed = given.get("--feed")
  if (feed !== undefined && !fs.existsSync(feed)) throw new Failed(`there's no folder at ${feed}`)
  run(given.get("--cloudflared") ?? "cloudflared", feed && path.resolve(feed)).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

async function run(cloudflared: string, feed: string | undefined): Promise<void> {
  process.env.DUALINPUT_BENCH_RELAY = path.join(OUT, "bench-relay.exe")
  process.env.DUALINPUT_BENCH_BUILDER = path.join(OUT, "dualinput-profile-builder.exe")
  process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")
  for (const file of [process.env.DUALINPUT_BENCH_RELAY, process.env.DUALINPUT_BENCH_PROFILES]) {
    if (!fs.existsSync(file)) throw new Failed(`${path.relative(ROOT, file)} isn't there; run node tools/bench.ts flight-model first`)
  }

  const net = await BenchNetwork.start(1)
  const tunnels: ChildProcess[] = []
  const end = () => {
    for (const tunnel of tunnels) tunnel.kill()
    net.stop().catch(() => {})
  }
  process.on("exit", end)
  try {
    const open = (what: string, local: string) => tunnel(cloudflared, what, local, tunnels)
    const [backend, relay, profiles] = await Promise.all([open("the backend", net.backend.url), open("the relay", net.relays[0]!.url), open("the profiles' site", net.profiles.url)])
    // The bench's settings, with each address on this PC swapped for its tunnel's, and without the
    // bench's rule that everything goes through the relay, so the cores look for a direct path as a
    // release's do.
    const local = net.core().settings as Record<string, unknown>
    const relays = (local["network.relays"] as { url: string; token: string; cap: number }[]).map((r) => ({ ...r, url: relay }))
    const settings: Record<string, unknown> = { "network.backend": backend, "network.relays": relays, "profiles.site": profiles }
    if (feed !== undefined) settings["desktop.update-feed"] = await open("the update feed", await serve(feed))
    console.log("\nBoth pilots put these settings into %APPDATA%\\DualInput\\settings.json, with Dual Input closed, beside what the file holds:\n")
    console.log(JSON.stringify(settings, null, 2))
    console.log("\nThey hold until this script ends. Press q to end it.")
  } catch (error) {
    end()
    throw error
  }
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.on("data", (key: Buffer) => {
    if (key.toString("utf8") !== "q" && key.toString("utf8") !== "\u0003") return
    end()
    process.exit(0)
  })
}

/** Serves the files of `folder`, and none below it, on a port of this PC, and returns the address. */
function serve(folder: string): Promise<string> {
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname.slice(1))
    const file = path.join(folder, name)
    if (name === "" || name !== path.basename(name) || !fs.existsSync(file)) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { "content-length": fs.statSync(file).size })
    fs.createReadStream(file).pipe(response)
  })
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))
}

/** Starts a quick tunnel to `local`, and returns its public address once cloudflared prints it. */
function tunnel(cloudflared: string, what: string, local: string, tunnels: ChildProcess[]): Promise<string> {
  const child = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", local], { stdio: ["ignore", "ignore", "pipe"] })
  tunnels.push(child)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Failed(`cloudflared gave ${what} no address within 60s`)), 60_000)
    child.on("error", (error) => reject(new Failed(`cloudflared didn't start: ${error.message}`)))
    child.on("exit", (code) => reject(new Failed(`cloudflared for ${what} ended with ${code}`)))
    createInterface({ input: child.stderr! }).on("line", (line) => {
      const address = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line)?.[0]
      if (!address) return
      clearTimeout(timer)
      console.log(`${what}: ${local} is at ${address}`)
      resolve(address)
    })
  })
}
