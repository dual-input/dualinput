// The bench's profiles' site: a local server that serves `index.json` and
// `bundles/<hash>.yaml` as the Pages site does, from the folder the profile builder's
// `publish` laid out, answering a repeat fetch of an unchanged file with a 304. A scenario can
// hold its answers back, cut it, or publish more profiles into it
// (record/areas/build/02-testing.md, "What it touches").

import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import type net from "node:net"
import path from "node:path"

import { ROOT } from "../lib/repo.ts"

/** The profile builder tools/bench.ts built, by the path Cargo reported. */
export function builder(): string {
  const program = process.env.DUALINPUT_BENCH_BUILDER
  if (!program) throw new Error("DUALINPUT_BENCH_BUILDER isn't set; run the bench with node tools/bench.ts")
  return program
}

/**
 * The highest level of the profile format this tree has, which the bench publishes at as a
 * release of this tree would: each level's files sit in a folder of its own, levels/<n>/.
 */
export function level(): number {
  const levels = path.join(ROOT, "src", "engines", "profile-engine", "levels")
  return Math.max(...fs.readdirSync(levels).map(Number).filter(Number.isInteger))
}

/** Runs the profile builder, and fails with its output unless it succeeded. */
export function runBuilder(args: string[]): string {
  const result = spawnSync(builder(), args, { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`dualinput-profile-builder ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout
}

/** The bundle each profile built to, by its path in the profiles' folder, from the builder's lines. */
export function builtHashes(output: string): Map<string, string> {
  return new Map([...output.matchAll(/^(\S+): level \d+, ([0-9a-f]{64})$/gm)].map((m) => [m[1]!, m[2]!]))
}

export class ProfilesSite {
  readonly url: string
  readonly folder: string
  /** Each request the site answered, in order, with its status, or 0 for one it cut. */
  readonly requests: { path: string; status: number }[] = []
  private readonly server: http.Server
  private readonly sockets = new Set<net.Socket>()
  private holding = false
  private held: (() => void)[] = []
  private cut = false
  private refusing = false

  private constructor(server: http.Server, port: number, folder: string) {
    this.server = server
    this.url = `http://127.0.0.1:${port}`
    this.folder = folder
  }

  /**
   * Starts a site in a folder of its own that holds the profiles tools/bench.ts published
   * from the tree, or none when `empty`.
   */
  static async start({ empty = false } = {}): Promise<ProfilesSite> {
    const sites = path.join(ROOT, "target", "bench", "sites")
    fs.mkdirSync(sites, { recursive: true })
    const folder = fs.mkdtempSync(path.join(sites, "site-"))
    if (!empty) {
      const published = process.env.DUALINPUT_BENCH_PROFILES
      if (!published) throw new Error("DUALINPUT_BENCH_PROFILES isn't set; run the bench with node tools/bench.ts")
      fs.cpSync(published, folder, { recursive: true })
    }
    let site: ProfilesSite | undefined
    const server = http.createServer((request, response) => site!.answer(request, response))
    server.on("connection", (socket) => {
      site?.sockets.add(socket)
      socket.on("close", () => site?.sockets.delete(socket))
    })
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port))
    })
    site = new ProfilesSite(server, port, folder)
    return site
  }

  private async answer(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = request.url ?? "/"
    if (this.holding) await new Promise<void>((resolve) => this.held.push(resolve))
    if (this.cut) {
      this.requests.push({ path: url, status: 0 })
      request.socket.destroy()
      return
    }
    if (this.refusing && url.startsWith("/bundles/")) {
      this.requests.push({ path: url, status: 503 })
      response.writeHead(503).end()
      return
    }
    const file = path.join(this.folder, ...url.split("/").filter((p) => p && p !== ".."))
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      this.requests.push({ path: url, status: 404 })
      response.writeHead(404).end()
      return
    }
    const body = fs.readFileSync(file)
    const etag = `"${crypto.createHash("sha1").update(body).digest("hex")}"`
    if (request.headers["if-none-match"] === etag) {
      this.requests.push({ path: url, status: 304 })
      response.writeHead(304, { etag }).end()
      return
    }
    this.requests.push({ path: url, status: 200 })
    response.writeHead(200, { etag, "content-length": body.length }).end(body)
  }

  /** Holds every answer back until called with false, as a slow site would. */
  hold(on: boolean): void {
    this.holding = on
    if (!on) for (const release of this.held.splice(0)) release()
  }

  /** Answers each bundle's fetch with a 503 until called with false, while the index answers as ever. */
  refuseBundles(on: boolean): void {
    this.refusing = on
  }

  /** Cuts every connection and refuses each request until called with false, as a site offline would. */
  setCut(on: boolean): void {
    this.cut = on
    if (on) for (const socket of this.sockets) socket.destroy()
  }

  /**
   * Publishes the profiles in `profiles`, a folder laid out as the tree's `profiles/` is, into
   * the site, as CI does on a merge, and returns each profile's bundle by its path.
   */
  publish(profiles: string): Map<string, string> {
    return builtHashes(runBuilder(["publish", "--released", String(level()), "--profiles", profiles, "--pages", this.folder]))
  }

  async stop(): Promise<void> {
    this.hold(false)
    for (const socket of this.sockets) socket.destroy()
    await new Promise((resolve) => this.server.close(resolve))
  }
}

/** A copy of the tree's `profiles/` in `folder`, for a scenario to change before it publishes. */
export function copyProfiles(folder: string): string {
  const copy = path.join(folder, "profiles")
  fs.cpSync(path.join(ROOT, "profiles"), copy, { recursive: true })
  return copy
}
