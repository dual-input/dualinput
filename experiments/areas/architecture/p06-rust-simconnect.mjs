/*
 * p06: does a Rust program on the SDK's own SimConnect.dll do what the core
 * would at the main menu (architecture plan, node 1.3.4)? Every SimConnect
 * finding before it came through node-simconnect.
 *
 *   cargo build --release            (in simconnect/)
 *   node experiments/areas/architecture/p06-rust-simconnect.mjs
 *
 * With the sim at the main menu and crosscheck-p03-rust, p03's Rust module, in
 * the Community folder since the sim started; about 20s, through the
 * inspector, with nothing for the pilot to do. It checks, from the Rust client
 * (simconnect/src/main.rs):
 *   1. the open reply, and each subscribing call's result;
 *   2. the "1sec" system event, counted over the run;
 *   3. the CommBus both ways with mainUi: a listener put into mainUi through the
 *      inspector, the way mainUi's own view listeners take events (p14), answers
 *      each CROSSCHECK_P06_HELLO the client calls with a CROSSCHECK_P06_ASK, which
 *      the client subscribes to;
 *   4. data slots with p03's module: the client reads CROSSCHECK_P03A_OUT once a
 *      second, writes a random value to CROSSCHECK_P03A_IN, and looks for it in
 *      the module's echo.
 * Flow events are subscribed to as well, though the main menu sends none.
 * Nothing it adds is in the pilot's input path.
 */

import { spawn } from "node:child_process"
import path from "node:path"
import { createInterface } from "node:readline"

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const EXE = path.join(REPO, "experiments", "areas", "architecture", "simconnect", "target", "release", "p06-simconnect.exe")
const HELLOS = 10
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Runs in mainUi, which has engine and no Coherent: no arrow functions,
// optional chaining, or ?? (CLAUDE.md, "Before writing code that runs in a panel").
const SETUP = `(function () {
  var r = window.CROSSCHECK_P06 = { heard: 0, answered: 0, errors: [], handles: [] };
  r.handles.push(engine.on("EVENT_FROM_VIEW_LISTENER", function (listener, name, data) {
    if (String(listener).toUpperCase() !== "JS_LISTENER_COMM_BUS" || name !== "CROSSCHECK_P06_HELLO") return;
    r.heard++;
    try { engine.call("COMM_BUS_SIMCONNECT_CALLBACK", "CROSSCHECK_P06_ASK", JSON.stringify({ echo: String(data) })); r.answered++; } catch (e) { r.errors.push(e.message); }
  }));
  engine.trigger("ADD_VIEW_LISTENER", "JS_LISTENER_COMM_BUS", window.location.pathname);
  return "started";
})()`
const READ = `(function () {
  var r = window.CROSSCHECK_P06;
  if (!r) return null;
  for (var i = 0; i < r.handles.length; i++) { try { if (r.handles[i] && r.handles[i].clear) r.handles[i].clear(); } catch (e) {} }
  window.CROSSCHECK_P06 = undefined;
  return { heard: r.heard, answered: r.answered, errors: r.errors };
})()`

async function inPage(page, expression) {
  const insp = new Inspector(page.id)
  try {
    await insp.open()
    return { ok: true, value: await insp.evaluate(expression) }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    insp.close()
  }
}

const lines = []
const client = spawn(EXE, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
const got = []
let ready
const isReady = new Promise((r) => { ready = r })
createInterface({ input: client.stdout }).on("line", (l) => {
  got.push({ t: Date.now(), l })
  if (l === "READY") ready()
})
client.on("exit", (code) => got.push({ t: Date.now(), l: `EXITED ${code}` }))
const send = (cmd) => client.stdin.write(cmd + "\n")

await Promise.race([isReady, sleep(10_000)])
const started = Date.now()

const mainUi = (await listPages()).find((p) => String(p.title) === "mainUi" || /mainUi/i.test(String(p.url)))
const setup = mainUi ? await inPage(mainUi, SETUP) : { ok: false, error: "no mainUi page" }
await sleep(1000)
for (let i = 1; i <= HELLOS; i++) {
  send(`bus ${JSON.stringify({ n: i, at: Date.now() })}`)
  await sleep(500)
}
await sleep(1000)
const page = mainUi ? await inPage(mainUi, READ) : { ok: false, error: "no mainUi page" }

const tag = Math.floor(Math.random() * 0xffff_fffe) + 1
send(`in ${tag}`)
await sleep(2500)
send("quit")
await Promise.race([new Promise((r) => client.on("exit", r)), sleep(5000)])
const seconds = (Date.now() - started) / 1000

const of = (prefix) => got.filter((g) => g.l.startsWith(prefix)).map((g) => g.l)
const asks = of("COMMBUS 2 ")
const outs = of("OUT ").map((l) => l.split(" ").slice(1).map(Number))
const echoed = outs.find((o) => o[4] === tag)
lines.push(
  `p06-rust-simconnect, ${new Date(started).toISOString()}`,
  ...of("OPEN "),
  "",
  ...of("CALL ").map((l) => `- ${l.slice(5)}`),
  "",
  `"1sec" events: ${of("EVENT 1 ").length} over ${seconds.toFixed(1)}s`,
  `Flow events: ${of("FLOW ").length}`,
  `Exceptions: ${of("EXCEPTION ").length ? of("EXCEPTION ").join("; ") : "none"}`,
  "",
  `CommBus: mainUi setup ${setup.ok ? setup.value : `failed: ${setup.error}`}; the client called CROSSCHECK_P06_HELLO ${of("CALLED bus").length} times (${[...new Set(of("CALLED bus").map((l) => l.split(" ").pop()))].join(", ")} returned)`,
  `  mainUi heard ${page.ok && page.value ? page.value.heard : "?"} and answered ${page.ok && page.value ? page.value.answered : "?"}${page.ok && page.value && page.value.errors.length ? `; errors: ${page.value.errors.join("; ")}` : ""}${page.ok ? "" : `; couldn't read: ${page.error}`}`,
  `  the client got ${asks.length} CROSSCHECK_P06_ASK${asks.length ? `, the first: ${asks[0].slice(10)}` : ""}`,
  "",
  `Data slots: ${outs.length} reads of CROSSCHECK_P03A_OUT; the first ${outs.length ? `[magic ${outs[0][0] === 0x5033_5253 ? "ours" : outs[0][0]}, version ${outs[0][1]}, inits ${outs[0][2]}, frame ${outs[0][3]}, echo ${outs[0][4]}]` : "none"}`,
  `  wrote ${tag} to CROSSCHECK_P03A_IN (${of("WROTE in").join("; ")}); ${echoed ? "the module echoed it" : "no echo of it"}`,
  ...(outs.length > 1 ? [`  frames between the first and last reads: ${outs[outs.length - 1][3] - outs[0][3]}`] : []),
  "",
  "Everything the client printed:",
  ...got.map((g) => `  +${((g.t - started) / 1000).toFixed(2)}s ${g.l}`),
)
const text = lines.join("\n")
console.log(text)
console.log(`saved ${repoRelative(saveResult("architecture", "p06-rust-simconnect", text))}`)
process.exit(0)
