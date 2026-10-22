// The clients' and the panel bridge's cases in the sim, for a session with someone at the sim
// (record/areas/build/plan.md, "5 Clients and the panel bridge"). It starts the release core
// from the tree on a data folder of its own, and a bench core beside it on another, then waits
// for a flight. In each cockpit panel, through the sim's inspector, it reads whether our
// VCockpit.js loaded the bridge and every instrument loaded, and what the bridge heard of the
// core's announcement; then it plays a session's announcement into each panel, as the CommBus
// would deliver one, and reads which core each panel joined. It writes the report to
// report.txt in the run's folder.
//
//   node tools/sim/clients.ts --core <program> --bench <program>
//       a flight with our package as `node tools/build.ts install` installed it
//   node tools/sim/clients.ts --core <program> --bench <program> --bridge missing
//   node tools/sim/clients.ts --core <program> --bench <program> --bridge throws
//       first installs our package with bridge.js missing, or throwing as it loads; the sim
//       must be closed
//   node tools/sim/clients.ts --restore
//       installs our package as built again; the sim must be closed
//
// Then start the sim and load a flight. Keys:
//   q   stops both cores, replays their recordings, and ends

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { install, userCfgs } from "../lib/install.ts"
import { layOutPackage, PACKAGE } from "../lib/package.ts"
import { PAGES } from "../lib/pages.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { evaluate, listPages, type Page } from "./inspector.ts"

/** What one cockpit panel's page holds, read through the inspector. Runs in Coherent GT, so it's ES2017. */
const READ_PANEL = `(function () {
  var panel = document.getElementById("panel");
  var api = window.DUALINPUT_BRIDGE_API;
  return {
    expected: panel && panel.data && panel.data.daInstruments ? panel.data.daInstruments.length : null,
    created: panel ? panel.children.length : null,
    panel: window.globalPanelData ? globalPanelData.sName : null,
    bridge: typeof api,
    fsCopilot: typeof window.fscUnlock,
    status: api ? api.status() : null,
    pending: window.DUALINPUT_BRIDGE_PENDING ? window.DUALINPUT_BRIDGE_PENDING.length : null
  };
})()`

type PanelRead = {
  panel: string | null
  expected: number | null
  created: number | null
  bridge: string
  /** FS Copilot's VCockpit.js leaves `window.fscUnlock` in each panel, so its copy winning over ours shows here (FS Copilot fork, record/pointer-forwarding/docs/13-pr-prep.md). */
  fsCopilot: string
  status: { connection: string; announced: { last: { port: number; session: boolean } | null; count: number }; core: number | null; instruments: string[]; modules: string[] } | null
  pending: number | null
}

main(() => {
  const args = parse(process.argv.slice(2))
  if (args.restore) {
    for (const copy of install(PACKAGE, userCfgs())) console.log(`installed our package as built in ${copy}`)
    return
  }
  if (args.bridge) installVariant(args.bridge)
  session(args.core!, args.bench!, args.bridge).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

function parse(args: string[]): { core?: string; bench?: string; bridge?: "missing" | "throws"; restore: boolean } {
  const usage = "usage: node tools/sim/clients.ts --core <program> --bench <program> [--bridge missing|throws] | --restore"
  if (args.length === 1 && args[0] === "--restore") return { restore: true }
  const out: { core?: string; bench?: string; bridge?: "missing" | "throws"; restore: boolean } = { restore: false }
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1]
    if (value === undefined) throw new Failed(usage)
    if (args[i] === "--core") out.core = path.resolve(value)
    else if (args[i] === "--bench") out.bench = path.resolve(value)
    else if (args[i] === "--bridge" && (value === "missing" || value === "throws")) out.bridge = value
    else throw new Failed(usage)
  }
  if (!out.core || !out.bench) throw new Failed(usage)
  for (const program of [out.core, out.bench]) if (!fs.existsSync(program)) throw new Failed(`there's no program at ${program}`)
  return out
}

/** Installs our package as last built, but with bridge.js missing, or replaced by one that throws as it loads. */
function installVariant(bridge: "missing" | "throws"): void {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-variant-"))
  try {
    const pages = [
      { file: path.join(PAGES, "VCockpit.js"), to: "html_ui/Pages/VCockpit/Core/VCockpit.js" },
      ...(bridge === "throws" ? [{ file: path.join(temp, "bridge.js"), to: "html_ui/DualInput/bridge.js" }] : []),
    ]
    fs.writeFileSync(path.join(temp, "bridge.js"), 'throw new Error("Dual Input\'s test: this bridge.js throws as it loads");\n')
    const pkg = path.join(temp, "dualinput")
    layOutPackage(path.join(PACKAGE, "modules", "dualinput.wasm"), pages, pkg)
    for (const copy of install(pkg, userCfgs())) console.log(`installed our package with bridge.js ${bridge === "missing" ? "missing" : "throwing as it loads"} in ${copy}`)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

async function session(core: string, bench: string, bridge: "missing" | "throws" | undefined): Promise<void> {
  const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-clients${bridge ? `-${bridge}` : ""}`)
  const report = path.join(folder, "report.txt")
  fs.mkdirSync(folder, { recursive: true })
  const say = (line: string) => {
    console.log(line)
    fs.appendFileSync(report, `${line}\n`)
  }
  const real = start(core, path.join(folder, "core"))
  const beside = start(bench, path.join(folder, "bench"))
  say(`the core and a bench core started, in ${path.relative(ROOT, folder)}; start the sim, load a flight in a cockpit, and press Ready to fly`)
  say("keys: q stops both cores, replays their recordings, and ends")
  watchKeys(say, [real, beside], folder)

  const port = await until(() => portOf(path.join(folder, "core")), 30_000)
  say(`the core's WebSocket server listens on ${port}`)
  await until(() => (logOf(path.join(folder, "core")).includes("stage=Flying") ? true : undefined), 60 * 60_000)
  say("the sim is Flying; waiting 15s for the cockpit's panels to settle")
  await sleep(15_000)

  const panels = (await listPages()).filter((p) => /^VCockpit/i.test(p.title))
  say(`${panels.length} cockpit panels:`)
  const first = await readAll(panels)
  for (const [page, read] of first) {
    const announced = read.status?.announced.last
    say(
      `  ${page.title}: ${read.created}/${read.expected} instruments created; bridge ${read.bridge === "object" ? "loaded" : "absent"}${read.fsCopilot === "function" ? ", FS Copilot's VCockpit.js loaded" : ""}` +
        (read.status ? `, heard ${read.status.announced.count} announcements, the last for port ${announced?.port} with session ${announced?.session}` : `, ${read.pending} instruments queued for it`),
    )
  }
  const short = first.filter(([, r]) => r.created !== r.expected)
  say(short.length ? `FAILED: ${short.length} panels created fewer instruments than they hold` : "every panel created every instrument")
  if (bridge) {
    const loaded = first.filter(([, r]) => r.bridge === "object")
    say(loaded.length ? `FAILED: ${loaded.length} panels loaded a bridge` : `with bridge.js ${bridge}, no panel has a bridge, and the cockpit loaded as without Dual Input`)
    return
  }
  const deaf = first.filter(([, r]) => r.status?.announced.last?.port !== port)
  say(deaf.length ? `FAILED: ${deaf.length} panels didn't hear the core's announcement` : "every panel's bridge heard the core's announcement")

  // A session's announcement, played into each panel as the CommBus delivers one: the sim's
  // CommBus listener registers each name's handler with Coherent.on (read in fs-base-ui,
  // html_ui/JS/common.js, ViewListener.on), so Coherent.trigger reaches it the same way.
  const announce = JSON.stringify(JSON.stringify({ port, session: true }))
  for (const page of panels) await evaluate(page, `Coherent.trigger("DUALINPUT_CORE_ANNOUNCE", ${announce}), true`)
  say("played a session's announcement into each panel; waiting 5s")
  await sleep(5_000)
  // The core's own announcements say no session runs, and a panel closes its socket on the
  // next, so the core's log, not each panel's connection now, says which panels joined.
  const coreLog = logOf(path.join(folder, "core"))
  const hellos = coreLog.split("\n").filter((l) => /a client joined.*component="panel-bridge"/.test(l))
  const joined = first.filter(([, r]) => hellos.some((l) => l.includes(`panel="${r.panel}"`)))
  say(`${joined.length} of ${panels.length} panels joined the core`)
  for (const line of hellos) say(`  the core: ${/socket=\d+ component="panel-bridge"(?: panel="[^"]*")? instruments=\d+/.exec(line)?.[0] ?? line}`)
  const benchJoined = logOf(path.join(folder, "bench")).includes("a client joined")
  say(benchJoined ? "FAILED: a page joined the bench core" : "no page joined the bench core")
  say(joined.length === panels.length ? "every cockpit panel joined the real sim's core, with its instruments' keys" : "FAILED: not every panel joined the core")
}

function start(program: string, data: string): ReturnType<typeof spawn> {
  fs.mkdirSync(data, { recursive: true })
  const out = fs.openSync(`${data}-output.txt`, "w")
  return spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
}

async function readAll(pages: Page[]): Promise<[Page, PanelRead][]> {
  const reads: [Page, PanelRead][] = []
  for (const page of pages) reads.push([page, await evaluate<PanelRead>(page, READ_PANEL)])
  return reads
}

function portOf(data: string): number | undefined {
  const file = path.join(data, "port.json")
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as { port: number }).port : undefined
}

function logOf(data: string): string {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return ""
  const run = fs.readdirSync(recordings).sort().at(-1)
  const log = run && path.join(recordings, run, "log.txt")
  return log && fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""
}

async function until<T>(get: () => T | undefined, ms: number): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() - started > ms) throw new Failed(`gave up after ${ms / 1000}s`)
    await sleep(250)
  }
}

function watchKeys(say: (line: string) => void, cores: ReturnType<typeof spawn>[], folder: string): void {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", async (key: Buffer) => {
    if (key.toString("utf8") !== "q" && key.toString("utf8") !== "\u0003") return
    for (const core of cores) core.kill()
    await sleep(1_000)
    for (const [name, program] of [["core", cores[0]!.spawnfile], ["bench", cores[1]!.spawnfile]] as const) {
      const recordings = path.join(folder, name, "recordings")
      const run = fs.existsSync(recordings) ? fs.readdirSync(recordings).sort().at(-1) : undefined
      const recording = run && path.join(recordings, run, "inputs.zst")
      if (recording && fs.existsSync(recording)) {
        const replayed = spawnSync(program, ["replay", recording], { encoding: "utf8" })
        say(`the ${name}'s replay: ${(replayed.stdout + replayed.stderr).trim()}`)
      }
    }
    process.exit(0)
  })
}
