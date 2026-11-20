// State sync's cases in the sim, for one session with someone at the sim
// (record/areas/build/plan.md, "14 State sync"; record/areas/sync/05-units.md, "Cases for the
// bench"): the real core flies, and a bench core on a stand-in plays the second pilot. It runs
// the five aircraft the cases need, one flight each, reading what it can through the sim's
// inspector, and writes report.txt in the run's folder.
//
//   node tools/build.ts install                       with the sim closed
//   node tools/bench.ts state-sync                    once, so target/bench holds this tree
//   node tools/sim/state-sync.ts --core <program>     the release core, built from this tree
//
// The case of a group on one connection runs two of p08's clients, which
// `cargo build --release -p p08-client`, in experiments/areas/architecture/flight, writes. The
// loop under load beside the A350 needs no one, so it runs on its own after the session, with
// `node tools/bench.ts load 1` while the A350 stays loaded and in focus.
//
// Then start the sim and wait at the main menu; the script says each step aloud. Keys:
//   Page Up   answers yes to a question the script asks aloud, or skips a step
//   q         stops the core, replays its recording, and ends

import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import { setTimeout as sleep } from "node:timers/promises"

import type { CockpitSlice } from "../../src/engines/messages/ts/cockpit/CockpitSlice.ts"
import type { SessionSlice } from "../../src/engines/messages/ts/session/SessionSlice.ts"
import type { SimSlice } from "../../src/engines/messages/ts/sim/SimSlice.ts"
import { BenchRun, type Core } from "../bench/cores.ts"
import { load, toMenu } from "../bench/flights.ts"
import { app, BenchNetwork, host, join } from "../bench/network.ts"
import { FakeApp } from "../bench/pages.ts"
import { FakeCockpitPanel } from "../bench/panel.ts"
import { builtHashes, runBuilder } from "../bench/profiles.ts"
import { ROOT } from "../lib/repo.ts"
import { Failed, main } from "../lib/run.ts"
import { desktop, type Desktop } from "./desktop.ts"
import { Guide } from "./guide.ts"
import { evaluate, listPages, type Page } from "./inspector.ts"

const OUT = path.join(ROOT, "target", "bench", "release-with-checks")
const PROFILES = path.join(ROOT, "tools", "sim", "profiles")
const P08_CLIENT = path.join(ROOT, "experiments", "areas", "architecture", "flight", "target", "release", "p08-client.exe")

type Plane = {
  name: string
  folder: RegExp
  /** Where the flight starts, when it's more than a stand. */
  at?: string
  /** Whether the cases need the aircraft's power on, rather than cold and dark. */
  powered?: boolean
  /** The display the second pilot's panel holds, the Baron's tablet unless named. */
  display?: string
  flown: (c: Flight) => Promise<void>
  /** The second pilot's input events, each with its value. */
  second: Record<string, number>
  gauges?: Record<string, object>
  /** Variables copied from the sim onto the second pilot's aircraft before it joins, as `[name, unit]`, so a stepping write has nothing to walk in the catch-up. */
  seed?: [string, string][]
}

/** One flight's crew: the real core, reached through `real`, and the bench core playing the second pilot. */
type Flight = { real: Desktop; second: Core; panel: FakeCockpitPanel; say: (line: string, aloud?: boolean) => void; result: (ok: boolean, line: string) => void; guide: Guide }

/** Each aircraft of the session, in the order it's flown. Above `main`, which reads it as the module loads. */
const PLANES: Plane[] = [
  { name: "Black Square Baron 58P", folder: /baronpropress/i, flown: baron, second: { ELECTRICAL_Battery_1: 0, LIGHTING_BEACON_1: 0 }, gauges: { KR87A: { bfoMode: false, antMode: false, multiMode: 0 } } },
  { name: "iniBuilds A350", folder: /^a350/i, at: "at a busy airport, such as EGLL, with traffic on,", powered: true, flown: a350, second: {}, seed: [["A:KOHLSMAN SETTING MB:1", "Millibars"]] },
  { name: "iniBuilds L-1011", folder: /^inibuilds-l1011/i, powered: true, flown: l1011, second: {} },
  { name: "Fenix A320", folder: /^fnx_32x/i, flown: fenix, second: {} },
  { name: "Synaptic A220", folder: /^synaptic_a220/i, powered: true, display: "DisplayUnits", flown: a220, second: { AIRLINER_OVH_LTS_TAXI: 0 } },
]

main(() => {
  const args = process.argv.slice(2)
  const usage = "usage: node tools/sim/state-sync.ts --core <program> [--only <aircraft>,...], where --only l-1011,a350 runs those two, in that order"
  if ((args.length !== 2 && args.length !== 4) || args[0] !== "--core" || (args.length === 4 && args[2] !== "--only")) throw new Failed(usage)
  const core = path.resolve(args[1]!)
  if (!fs.existsSync(core)) throw new Failed(`there's no core at ${core}`)
  const named = args[3]?.toLowerCase().split(",")
  const planes = named === undefined ? PLANES : named.map((n) => PLANES.find((p) => p.name.toLowerCase().includes(n)))
  const missing = named?.filter((_, i) => planes[i] === undefined) ?? []
  if (missing.length > 0) throw new Failed(`no aircraft's name holds ${missing.join(", ")}`)
  run(core, planes as Plane[]).catch((error: Error) => {
    console.error(`\n${error.message}`)
    process.exit(1)
  })
})

async function run(program: string, planes: Plane[]): Promise<void> {
  process.env.DUALINPUT_BENCH_CORE = path.join(OUT, "dualinput-core.exe")
  process.env.DUALINPUT_BENCH_STAND_IN_HELPER = path.join(OUT, "stand-in-core-helper.exe")
  process.env.DUALINPUT_BENCH_RELAY = path.join(OUT, "bench-relay.exe")
  process.env.DUALINPUT_BENCH_BUILDER = path.join(OUT, "dualinput-profile-builder.exe")
  process.env.DUALINPUT_BENCH_PROFILES = path.join(ROOT, "target", "bench", "profiles")

  const started = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const folder = path.join(ROOT, "target", "sim", "runs", `${started}-state-sync`)
  fs.mkdirSync(folder, { recursive: true })
  const report = path.join(folder, "report.txt")
  const guide = await Guide.start()
  const say = (line: string, aloud = false) => {
    console.log(line)
    fs.appendFileSync(report, `${line}\n`)
    if (aloud) guide.say(line)
  }
  const result = (ok: boolean, line: string) => {
    say(`${ok ? "PASSED" : "FAILED"}: ${line}`)
    if (ok) guide.pass()
    else guide.fail()
  }

  // Both cores load the session's small profiles as local bundles, and the Baron from the bench's published copy of the tree's.
  const local = path.join(folder, "local-bundles")
  for (const file of fs.readdirSync(path.join(PROFILES, "aircraft"))) {
    const built = builtHashes(runBuilder(["build", path.join(PROFILES, "aircraft", file), "--out", local]))
    if (built.size === 0) throw new Failed(`${file} didn't build`)
  }

  const net = await BenchNetwork.start(1)
  const { settings } = net.core()
  const benchRun = new BenchRun("sim-state-sync")
  const stub = spawn("ping", ["-n", "86400", "127.0.0.1"], { stdio: "ignore" })
  const second = await benchRun.core("second-pilot", { settings: { ...settings, "profiles.local": local } })
  second.act({ act: "watch", process: stub.pid! })
  await second.hear("stage Starting aircraft none")
  second.cockpit({ act: "ready", on: true })

  const data = path.join(folder, "core")
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ ...settings, "profiles.local": local, "session.name": "Pilot" }, null, 2))
  const out = fs.openSync(`${data}-output.txt`, "w")
  const child = spawn(program, ["--data", data], { stdio: ["ignore", out, out] })
  await until(() => (fs.existsSync(path.join(data, "port.json")) ? true : undefined), 30_000)
  watchKeys(say, child, program, data, () => {
    second.kill().catch(() => {})
    stub.kill()
    net.stop().catch(() => {})
    guide.close()
  })
  const real = await desktop(data, ["session", "sim", "notifications"])

  // The session starts from the main menu, or from a flight already loaded, as after a fix.
  const menuOrFlying = () => ["menu", "flying"].includes(real.slice<SimSlice>("sim")?.stage ?? "")
  if (!(await reached(menuOrFlying, 5_000))) say("Start the sim, and wait at the main menu.", true)
  await until(() => (menuOrFlying() ? true : undefined), 60 * 60_000)

  for (const [i, plane] of planes.entries()) await fly(plane, { real, second, say, result, guide, net, data, last: i === planes.length - 1 })

  say("That's every aircraft. Leave this flight loaded. Whoever runs the script stops it with q in its terminal, which replays the core's recording.", true)
}

async function fly(plane: Plane, c: { real: Desktop; second: Core; say: Flight["say"]; result: Flight["result"]; guide: Guide; net: BenchNetwork; data: string; last: boolean }): Promise<void> {
  const { real, second, say, result, guide } = c
  say(`\n=== ${plane.name}`)
  const simSlice = () => real.slice<SimSlice>("sim")
  const flying = () => simSlice()?.stage === "flying" && plane.folder.test(simSlice()?.aircraft?.path ?? "")
  const power = plane.powered ? "with its power on, not cold and dark" : "cold and dark if the aircraft offers it"
  if (!flying()) say(`Load a flight in the ${plane.name}, ${plane.at ? `${plane.at} ` : ""}on the ground at a stand, ${power}, and press Ready to fly.`, true)
  await until(() => (flying() ? true : undefined), 60 * 60_000)
  // The A220 went back to Loading 7s after it first flew, a second load of its own, so the
  // flight counts as loaded once it has flown for 15s straight (measured on MSFS 2024,
  // 2026-11-09, record/areas/sync/log.md, "Stage 14's session in the sim passed in four
  // aircraft, and no aircraft took an H: event our module fired").
  for (let since = Date.now(); Date.now() - since < 15_000; await sleep(250)) {
    if (!flying()) {
      await until(() => (flying() ? true : undefined), 10 * 60_000)
      since = Date.now()
    }
  }
  const aircraftPath = simSlice()!.aircraft!.path
  say(`the sim is flying ${aircraftPath}; hosting the session`)
  await real.command("session.host", null)
  const session = () => real.slice<SessionSlice>("session")
  const code = await until(() => session()?.code ?? undefined, 30_000)

  second.act({ act: "inputs", events: Object.entries(plane.second) })
  for (const [name, unit] of plane.seed ?? []) setSecond(second, name, await readSim(name, unit))
  const desktopApp = await app(second)
  await join(second, code, "Second pilot")
  await until(() => (session()?.members.length === 2 ? true : undefined), 30_000)
  const cfg = `SimObjects\\Airplanes\\${aircraftPath.replaceAll("/", "\\")}\\aircraft.cfg`
  await load(second, { cfg, path: aircraftPath }, { title: plane.name, livery: "bench" })
  const panel = new FakeCockpitPanel(second, "VCockpit60", plane.gauges ?? {}, plane.display && (await displayKey(plane.display)))
  const stream = await FakeApp.open(second, ["cockpit-stream"])
  try {
    const stop = second.onHEvent((name) => panel.hEvent(name))
    await until(() => (desktopApp.slice<SessionSlice>("session")?.ready?.length === 0 ? true : undefined), 30_000)
    await desktopApp.ok("session.ready", { on: true })
    say("waiting up to 75s for your aircraft to settle")
    await until(() => (session()?.ready?.length === 0 ? true : undefined), 75_000)
    await real.command("session.ready", { on: true })
    await until(() => (session()?.preflight.phase === "ended" ? true : undefined), 15_000)
    say("preflight ended; waiting up to 20s for the second pilot's catch-up to end")
    // While a catch-up runs, the stream holds everything the second pilot sends, so no case
    // in this aircraft could pass.
    await sleep(1_000)
    if (await reached(() => stream.slice<CockpitSlice>("cockpit-stream")?.catching_up === false, 20_000)) {
      await ask({ say, guide }, `The ${plane.name}'s cases are ready. Press Page Up when you are.`, 10 * 60_000)
      // A panel that reloads mid-case refuses the inspector, which fails that aircraft's
      // remaining cases and leaves the next aircraft's to run.
      await plane.flown({ real, second, panel, say, result, guide }).catch((error: Error) => result(false, `${plane.name}'s cases stopped: ${error.message}`))
    } else {
      result(false, `the second pilot's catch-up never ended, so this aircraft's cases didn't run`)
    }
    stop()
  } finally {
    panel.close()
    stream.close()
  }
  await real.command("session.leave", null).catch(() => {})
  await desktopApp.ok("session.leave").catch(() => {})
  await toMenu(second)
  // The last aircraft stays loaded, since the loop under load runs beside the A350 after.
  if (c.last) return
  say("Done with this aircraft. End the flight, back to the main menu.", true)
  await until(() => (simSlice()?.stage === "menu" ? true : undefined), 10 * 60_000)
}

async function cockpits(): Promise<Page[]> {
  return (await listPages()).filter((p) => /^VCockpit/i.test(p.title))
}

/**
 * Runs `expression` in the first cockpit panel whose title matches `title`, found again on each
 * try, since a panel that reloads comes back as another page, and the inspector refuses the old.
 */
async function inPanel<T>(title: RegExp, expression: string): Promise<T> {
  let last: Error = new Failed(`no cockpit panel matching ${title} answers on the inspector`)
  for (let tries = 0; tries < 3; tries++) {
    const page = (await cockpits()).find((p) => title.test(p.title))
    if (page) {
      try {
        return await evaluate<T>(page, expression)
      } catch (error) {
        last = error as Error
      }
    }
    await sleep(1_000)
  }
  throw last
}

async function readSim(name: string, unit = "number"): Promise<number> {
  return Number(await inPanel<number | boolean>(/./, `SimVar.GetSimVarValue(${JSON.stringify(name)}, ${JSON.stringify(unit)})`))
}

async function setSim(name: string, value: number, unit = "number"): Promise<void> {
  await inPanel(/./, `SimVar.SetSimVarValue(${JSON.stringify(name)}, ${JSON.stringify(unit)}, ${value}); 0`)
}

/**
 * The whole key of the sim's display whose identifier is `identifier`, as its panel's bridge
 * reports it. Pointer sync plays a gesture only on a display of the same whole key, and the
 * A220's carries its livery, as `DisplayUnits|config=C-GUAC`, so the second pilot's display
 * takes the sim's (measured on MSFS 2024, 2026-11-09, record/areas/pointer-sync/log.md,
 * "Pointer sync's cases in the sim pass on the A220's ND and the Baron's tablet, once the second
 * pilot's display carries the A220's livery").
 */
async function displayKey(identifier: string): Promise<string> {
  for (const page of await cockpits()) {
    const keys = await evaluate<string[]>(page, "window.DUALINPUT_BRIDGE_API ? window.DUALINPUT_BRIDGE_API.status().instruments : []").catch(() => [] as string[])
    const key = keys.find((k) => k === identifier || k.startsWith(`${identifier}|`))
    if (key) return key
  }
  return identifier
}

/** Reads `expression` of the Baron's KR87A, as `g`, or null where its panel has no such gauge. */
async function kr87a<T>(expression: string): Promise<T | null> {
  return inPanel<T | null>(
    /KR87A/,
    `(function () {
      var all = document.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        var g = all[i];
        if (g.instrumentIdentifier === "KR87A") return ${expression};
      }
      return null;
    })()`,
  )
}

async function secondVariable(second: Core, name: string): Promise<number> {
  const found = (await second.report()).variables.find(([n]) => n === name)
  return found ? Number(found[1]) : 0
}

async function secondInput(second: Core, name: string): Promise<number> {
  const found = (await second.report()).inputs.find(([n]) => n === name)
  return found ? found[1] : 0
}

function setSecond(second: Core, name: string, value: number): void {
  second.act({ act: "set", numbers: [[name, value]], texts: [] })
}

/** Polls `get` until `ok` holds, and says how long it took. */
async function settles(c: Flight, what: string, get: () => Promise<number>, ok: (v: number) => boolean, ms = 8_000): Promise<number | null> {
  const started = Date.now()
  let last = NaN
  while (Date.now() - started < ms) {
    try {
      last = await get()
      if (ok(last)) {
        c.result(true, `${what}: ${last}, after ${Date.now() - started}ms`)
        return Date.now() - started
      }
    } catch {
      // A page that's reloading answers nothing for a moment.
    }
    await sleep(25)
  }
  c.result(false, `${what}: never held within ${ms}ms, read ${last}`)
  return null
}

/** Asks the pilot aloud and waits for Page Up, or `ms`. */
async function ask(c: Pick<Flight, "say" | "guide">, question: string, ms = 20_000): Promise<boolean> {
  c.say(`${question} Press Page Up for yes.`, true)
  c.guide.skipped()
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (c.guide.skipped()) return true
    await sleep(100)
  }
  return false
}

/**
 * Installs a handler beside the stock one in every cockpit panel, since which panels hear an
 * `H:` event our module fires is what the case finds out, and `heardH` reads them. The handler
 * stays until the panel reloads, at the next flight's load, so it keeps at most 1,000 names
 * (`DUALINPUT_CHECK_HEARD` in record/areas/architecture/02-code-map.md, "Names the sim shares").
 */
async function listenForH(): Promise<void> {
  for (const page of await cockpits()) {
    await evaluate(
      page,
      `(function () {
        var fresh = !window.DUALINPUT_CHECK_HEARD;
        window.DUALINPUT_CHECK_HEARD = [];
        if (fresh) {
          Coherent.on("OnInteractionEvent", function (t, a) {
            if (window.DUALINPUT_CHECK_HEARD.length < 1000) window.DUALINPUT_CHECK_HEARD.push(a && a[0]);
          });
        }
        return 0;
      })()`,
    ).catch(() => {})
  }
}

/** How many times the panel that heard `name` most heard it. */
async function heardH(name: string): Promise<number> {
  let most = 0
  for (const page of await cockpits()) {
    const n = await evaluate<number>(page, `(window.DUALINPUT_CHECK_HEARD || []).filter(function (n) { return n === ${JSON.stringify(name)}; }).length`).catch(() => 0)
    most = Math.max(most, n)
  }
  return most
}

/**
 * The Baron's cases. Each starts from the state it reads or sets up, and checks a change it
 * caused, so none can pass by standing still; the cases that need the radios' power come after
 * the pilot turns the avionics on, since the KR87A ignores every event without it (read in
 * bksq-aircraft-baronpro 0.1.1, KR87A.js, `onInteractionEvent`).
 */
async function baron(c: Flight): Promise<void> {
  const { second } = c
  const notWindshield = (await readSim("L:var_windshieldHeatSwitch")) === 1 ? 0 : 1
  setSecond(second, "L:var_windshieldHeatSwitch", notWindshield)
  await settles(c, "an L: variable the second pilot sets moves in the sim", () => readSim("L:var_windshieldHeatSwitch"), (v) => v === notWindshield)
  const back = 1 - notWindshield
  await setSim("L:var_windshieldHeatSwitch", back)
  await settles(c, "an L: variable set in the sim moves on the second pilot's", () => secondVariable(second, "L:var_windshieldHeatSwitch"), (v) => v === back)

  const notBattery = (await readSim("A:ELECTRICAL MASTER BATTERY", "bool")) === 1 ? 0 : 1
  second.act({ act: "set-input", name: "ELECTRICAL_Battery_1", value: notBattery })
  await settles(c, "our module's call of an input event's preset moves the sim's battery switch", () => readSim("A:ELECTRICAL MASTER BATTERY", "bool"), (v) => v === notBattery)

  // The pilot pitot heat switch moves without power, and its K: event carries one value, which
  // goes by the legacy call.
  const notPitot = (await readSim("A:CIRCUIT SWITCH ON:29", "bool")) === 1 ? 0 : 1
  setSecond(second, "CIRCUIT SWITCH ON:29", notPitot)
  await settles(c, "a K: event with one value, sent by the legacy call, moves the sim's pitot heat switch", () => readSim("A:CIRCUIT SWITCH ON:29", "bool"), (v) => v === notPitot)

  const beacon = await secondInput(second, "LIGHTING_BEACON_1")
  c.say(`Flip the beacon switch ${beacon === 1 ? "off" : "on"}, with the mouse.`, true)
  await settles(c, "a switch flipped in the sim reaches the second pilot's input event", () => secondInput(second, "LIGHTING_BEACON_1"), (v) => v !== beacon, 30_000)

  c.say("Turn the battery and the avionics master on, and the ADF radio's power if it stays dark.", true)
  if (!(await poweredKr87a(90_000))) {
    c.result(false, "the KR87A never had power, so its cases didn't run")
  } else {
    c.result(true, "the KR87A has power")
    await listenForH()
    c.panel.hEvent("adf_SetRst")
    c.panel.hEvent("adf_SetRst")
    await settles(c, "our module fires an H: event a JavaScript instrument hears, both of two in a burst", () => heardH("adf_SetRst"), (n) => n >= 2)

    const heardBySecond: string[] = []
    const stop = second.onHEvent((name) => heardBySecond.push(name))
    c.say("Press the ADF timer's SET RST button, with the mouse.", true)
    await settles(c, "the h-events handler hears an H: event beside the stock one", async () => heardBySecond.filter((n) => n === "adf_SetRst").length, (n) => n >= 1, 30_000)
    const bfo = await kr87a<boolean>("g.bfoMode")
    c.say("Press the ADF's BFO button, with the mouse.", true)
    await settles(c, "the KR87A takes the press, its bfoMode changing", async () => Number(await kr87a<boolean>("g.bfoMode")), (v) => v !== Number(bfo), 30_000)
    await settles(c, "instrument-reads sees the BFO change and the second pilot toggles it", async () => heardBySecond.filter((n) => n === "adf_bfo").length, (n) => n >= 1, 5_000)
    stop()
  }

  await groupCleared(c)
  await ask(c, "Open the tablet, and press Page Up once it shows.", 60_000)
  await pointerCases(c, /BlackSquareTablet/i, "the tablet")
}

/** Whether the KR87A has power within `ms`, by its own check. */
async function poweredKr87a(ms: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if ((await kr87a<boolean>("g.isElectricityAvailable()").catch(() => null)) === true) return true
    await sleep(500)
  }
  return false
}

/**
 * Whether a group on one SimConnect connection keeps hearing a sim event while a group on
 * another is cleared, which decides whether the rule against clearing a group while another
 * of the core's groups hears that event covers one connection or all of them
 * (record/areas/architecture/02-code-map.md, "A connection for each feature, for each load").
 * Two of p08's clients are the two connections, each asked for by a stdin command.
 */
async function groupCleared(c: Flight): Promise<void> {
  if (!fs.existsSync(P08_CLIENT)) {
    c.result(false, `a group on one connection keeps hearing: there's no client at ${P08_CLIENT}`)
    return
  }
  const client = () => {
    const child = spawn(P08_CLIENT, [], { stdio: ["pipe", "pipe", "ignore"] })
    const lines: string[] = []
    createInterface({ input: child.stdout! }).on("line", (line) => lines.push(line))
    const send = (line: string) => child.stdin!.write(`${line}\n`)
    // Without a keepalive for 15s the client lets go and exits.
    const alive = setInterval(() => send("alive"), 5_000)
    return {
      lines,
      send,
      ready: () => lines.some((l) => l.endsWith("\tREADY")),
      heard: (group: number) => lines.filter((l) => l.split("\t").slice(1, 3).join(" ") === `EVENT ${group}`).length,
      end: () => {
        clearInterval(alive)
        send("quit")
      },
    }
  }
  // The clients' groups: H, 2, listens without masking, and A, 1, holds the axis maskable.
  const listening = client()
  const cleared = client()
  try {
    if (!(await reached(() => listening.ready() && cleared.ready(), 15_000))) {
      c.result(false, "a group on one connection keeps hearing: the clients never came up")
      return
    }
    listening.send("listen")
    cleared.send("mask")
    await sleep(500)
    c.say("Move the yoke forward and back, and keep moving it until the next beep.", true)
    if (!(await reached(() => listening.heard(2) >= 20 && cleared.heard(1) >= 20, 30_000))) {
      c.result(false, `a group on one connection keeps hearing: before the clear, the listener heard ${listening.heard(2)} and the other ${cleared.heard(1)}`)
      return
    }
    cleared.send("clear")
    await sleep(250)
    c.guide.tick()
    const [heardBefore, clearedBefore] = [listening.heard(2), cleared.heard(1)]
    const kept = await reached(() => listening.heard(2) >= heardBefore + 20, 15_000)
    c.result(kept && cleared.heard(1) === clearedBefore, `a group on one connection keeps hearing while a group on another is cleared: ${listening.heard(2) - heardBefore} heard after the clear, and ${cleared.heard(1) - clearedBefore} by the cleared group`)
  } finally {
    listening.end()
    cleared.end()
  }
}


async function a350(c: Flight): Promise<void> {
  const { second } = c
  const before = await readSim("A:KOHLSMAN SETTING MB:1", "Millibars")
  c.say(`the captain's baro reads ${before}`)
  await second.report()
  setSecond(second, "KOHLSMAN SETTING MB:1", before + 10)
  await settles(c, "ten baro commands at 2 frames move it 10 hPa", () => readSim("A:KOHLSMAN SETTING MB:1", "Millibars"), (v) => Math.abs(v - (before + 10)) < 0.2, 12_000)
}

/**
 * The flight engineer's script acts only on `H:FUEL`, so the switch's variable moving says our
 * `L:` write landed, and the pump's own switch moving says our module's `H:FUEL` reached the
 * aircraft (read in inibuilds-aircraft-l1011 1.0.8, record/areas/aircraft/inibuilds-l1011/study.md).
 */
async function l1011(c: Flight): Promise<void> {
  const want = (await readSim("L:SWITCH_FUEL_PUMP_1_1")) === 1 ? 0 : 1
  setSecond(c.second, "L:SWITCH_FUEL_PUMP_1_1", want)
  await settles(c, "the fuel pump switch's L: variable takes the second pilot's write", () => readSim("L:SWITCH_FUEL_PUMP_1_1"), (v) => v === want, 5_000)
  await settles(c, "the flight engineer acts on our module's H:FUEL, after the switch", () => readSim("A:FUELSYSTEM PUMP SWITCH:1", "bool"), (v) => v === want, 10_000)
}

async function fenix(c: Flight): Promise<void> {
  const { second, real } = c
  const off = ["L:S_OH_ELEC_BAT1", "L:S_OH_ELEC_BAT2", "L:S_OH_ELEC_APU_MASTER"]
  for (const name of off) {
    if ((await readSim(name)) !== 0) {
      c.result(false, `the Fenix's ${name} was on at the start, so its cases need a cold and dark load`)
      return
    }
  }
  setSecond(second, "L:S_OH_ELEC_BAT1", 1)
  await settles(c, "battery 1's switch takes the second pilot's write", () => readSim("L:S_OH_ELEC_BAT1"), (v) => v === 1, 3_000)
  await sleep(2_000)
  const flagged = (real.slice<{ text: string }[]>("notifications") ?? []).filter((n) => n.text.includes("Battery"))
  c.result(flagged.length === 0, `no notification followed: ${JSON.stringify(flagged)}`)
  setSecond(second, "L:S_OH_ELEC_BAT1", 0)
  await settles(c, "battery 1's switch goes off again", () => readSim("L:S_OH_ELEC_BAT1"), (v) => v === 0, 3_000)
  await sleep(1_000)

  c.say("now the APU's catch-up: the second pilot flies alone with the battery and APU on, and you join late")
  const desktopApp = await app(second)
  await real.command("session.leave", null)
  await desktopApp.ok("session.leave")
  await sleep(1_000)
  const code = await host(second, "Second pilot")
  await desktopApp.until(() => desktopApp.slice<SessionSlice>("session")?.ready?.length === 0, "Ready allowed", 30_000)
  await desktopApp.ok("session.ready", { on: true })
  await desktopApp.until(() => desktopApp.slice<SessionSlice>("session")?.preflight.phase === "ended", "preflight's end", 15_000)
  setSecond(second, "L:S_OH_ELEC_BAT1", 1)
  await sleep(200)
  setSecond(second, "L:S_OH_ELEC_BAT2", 1)
  await sleep(200)
  setSecond(second, "L:S_OH_ELEC_APU_MASTER", 1)
  await sleep(500)
  await real.command("session.join", { code })
  for (const name of off) await settles(c, `catch-up writes ${name}`, () => readSim(name), (v) => v === 1, 20_000)
  await settles(c, "the APU master's ON light comes on, with both batteries on", () => readSim("L:I_OH_ELEC_APU_MASTER_L"), (v) => v === 1, 10_000)
}

async function a220(c: Flight): Promise<void> {
  const { second } = c
  second.act({ act: "rule", when: { when: "fired", name: "AIRLINER_OVH_LTS_TAXI_Set" }, after_ms: 0, then: { then: "flip", name: "L:FIRED_ONCE" } })
  c.say("Turn the taxi lights switch one notch, with the mouse.", true)
  await settles(c, "an input event reported twice goes out once", () => secondVariable(second, "L:FIRED_ONCE"), (v) => v === 1, 30_000)
  c.say("Now leave it alone for a moment.")
  await sleep(1_000)
  c.result((await secondVariable(second, "L:FIRED_ONCE")) === 1, "the double report stayed one write")
  // Which of the A220's display units the cases land on, for the log.
  c.say(`the A220's display panels: ${(await cockpits()).filter((p) => /DisplayUnits/i.test(p.title)).map((p) => p.title).join(", ")}`)
  await pointerCases(c, /DisplayUnits/i, "the ND")
}

/**
 * The cases from pointer sync's list. A gesture the second pilot plays on the sim's real display
 * is read through listeners in its panel, a press of the pilot's is read on the second pilot's
 * display, and the pilot answers only for what shows in front of them.
 */
async function pointerCases(c: Flight, title: RegExp, label: string): Promise<void> {
  const run = <T>(expression: string) => inPanel<T>(title, expression)
  // One set of listeners for each page, however often the cases run in it, kept as
  // `listenForH`'s handler is.
  await run(`(function () {
    var fresh = !window.DUALINPUT_CHECK_MOUSE;
    window.DUALINPUT_CHECK_MOUSE = [];
    if (fresh) {
      ["mousedown", "mousemove", "mouseup", "click"].forEach(function (t) {
        document.addEventListener(t, function (e) {
          if (window.DUALINPUT_CHECK_MOUSE.length < 1000) window.DUALINPUT_CHECK_MOUSE.push(t + "@" + Math.round(e.clientX) + "," + Math.round(e.clientY));
        }, true);
      });
    }
    return 0;
  })()`)
  const heard = () => run<string[]>("window.DUALINPUT_CHECK_MOUSE")
  const clear = () => run("window.DUALINPUT_CHECK_MOUSE = []; 0")
  const count = (events: string[], type: string) => events.filter((e) => e.startsWith(`${type}@`)).length

  c.say(`The second pilot taps ${label}, then holds a press on it, then drags across it.`, true)
  await sleep(2_500)
  await clear()
  c.panel.tap(0.5, 0.5)
  await sleep(1_000)
  const tap = await heard()
  c.result(count(tap, "mousedown") === 1 && count(tap, "mouseup") === 1 && count(tap, "click") === 1, `a tap plays one down, one up, and one click: ${tap.join(" ")}`)

  await clear()
  c.panel.press(0.4, 0.4)
  await sleep(3_000)
  c.panel.release(0.4, 0.4)
  await sleep(500)
  const held = await heard()
  c.result(held[0]?.startsWith("mousedown@") === true && held.at(-1)?.startsWith("click@") === true && count(held, "mousedown") === 1, `a press held 3s plays through to its up: ${held.join(" ")}`)

  // At a hand's pace, a step every 100ms, since moves sent in one instant with their up say
  // nothing of a drag.
  await clear()
  c.panel.press(0.2, 0.2)
  for (const at of [0.25, 0.3, 0.35, 0.4]) {
    await sleep(100)
    c.panel.move(at, at)
  }
  await sleep(100)
  c.panel.release(0.4, 0.4)
  await sleep(1_000)
  const dragged = await heard()
  c.result(count(dragged, "mousedown") === 1 && count(dragged, "mousemove") >= 2 && count(dragged, "mouseup") === 1, `a drag plays its down, its moves, and its up: ${dragged.join(" ")}`)

  c.panel.press(0.5, 0.5)
  await sleep(300)
  c.result(await ask(c, `The second pilot is holding a press on ${label}. Press it yourself, with the mouse: does it flash?`, 15_000), "a press under the other pilot's lock flashes")
  c.panel.release(0.5, 0.5)
  await sleep(1_000)

  const downs = c.panel.events("mousedown").length
  const ups = c.panel.events("mouseup").length
  c.say(`Press on ${label}, drag off its edge, and let go off it.`, true)
  c.result(await reached(() => c.panel.events("mousedown").length > downs, 30_000), `your press on ${label} plays on the second pilot's display`)
  c.result(await reached(() => c.panel.events("mouseup").length > ups && c.panel.lockText() === null, 30_000), `a press let go off ${label} ends on the second pilot's display, and leaves it unlocked`)
}

function log(data: string): string {
  const recordings = path.join(data, "recordings")
  if (!fs.existsSync(recordings)) return ""
  const newest = fs.readdirSync(recordings).sort().at(-1)
  const file = newest && path.join(recordings, newest, "log.txt")
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
}

/** Whether `get` holds within `ms`. */
async function reached(get: () => boolean, ms: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (get()) return true
    await sleep(50)
  }
  return false
}

async function until<T>(get: () => T | undefined, ms: number): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = get()
    if (value !== undefined) return value
    if (Date.now() - started > ms) throw new Failed(`gave up after ${ms / 1000}s`)
    await sleep(100)
  }
}

function watchKeys(say: (line: string) => void, child: ReturnType<typeof spawn>, program: string, data: string, end: () => void): void {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", async (key: Buffer) => {
    if (key.toString("utf8") !== "q" && key.toString("utf8") !== "\u0003") return
    const stats = log(data).split(/\r?\n/).filter((l) => l.includes("the loop's stats")).at(-1)
    say(`the real core's last loop stats: ${stats ?? "none"}`)
    child.kill()
    await sleep(1_000)
    const recordings = path.join(data, "recordings")
    const run = fs.existsSync(recordings) ? fs.readdirSync(recordings).sort().at(-1) : undefined
    const recording = run && path.join(recordings, run, "inputs.zst")
    if (recording && fs.existsSync(recording)) {
      const replayed = spawnSync(program, ["replay", recording], { encoding: "utf8" })
      say(`the core's replay: ${(replayed.stdout + replayed.stderr).trim()}`)
    }
    end()
    process.exit(0)
  })
}
