/*
 * p10: how big is a recording of every input a flying machine's core takes
 * in, and does one loop carry that load (architecture plan, node 5.1.2)?
 *
 * This is the part in the sim, about 12 minutes with a pilot at the controls.
 * The capture (recording/capture) subscribes as the core of a flying machine
 * that also hosts traffic would, to the flight model and the camera every sim
 * frame, the names FS Copilot's 58P profile watches as they change, AI traffic
 * every 500ms, the flow and system events, and p08's module's slots, and
 * records every SimConnect record with its time. FS Copilot's profile stands in
 * for the load of v1's 58P profile, which isn't written yet.
 *
 *   cargo build --release --manifest-path experiments/areas/architecture/recording/Cargo.toml
 *   node experiments/areas/architecture/p10-recording.mjs [minutes]
 *
 * Load the Black Square Baron 58P with AI traffic on, and press Page Down when
 * ready to fly; a beep starts the recording and two end it, after 10 minutes or
 * at Page Up. It needs p08's module in the Community folder, and takes no
 * masking group, so it never holds back the pilot's controls.
 *
 * Then, with no sim, the loop runs the capture's load and replays its own
 * recording; this probe prints that command at the end.
 *
 * Output: results/p10-recording-<time>.txt, the capture itself as
 * p10-capture-<time>.bin, and the names it watched as p10-names-<time>.tsv.
 */

import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"

import { SKIP, START, startBeeper, startKeys, startSpeaker } from "../../tools/guide.mjs"
import { REPO, repoRelative, resultFile, stamp } from "../../tools/results.mjs"

const MINUTES = Number(process.argv[2] ?? 10)
const KEEPALIVE_MS = 5_000
const HERE = path.join(REPO, "experiments", "areas", "architecture")
const RELEASE = path.join(HERE, "recording", "target", "release")
const CAPTURE = path.join(RELEASE, "p10-capture.exe")
const LOOP = path.join(RELEASE, "p10-loop.exe")
const WRITERS = path.join(HERE, "engine", "dist", "writers.js")
// FS Copilot's 58P profile, merged but for its five modules, in our sibling
// checkout (CLAUDE.md, "Prior work").
const PROFILE = path.join(REPO, "..", "fsc", "profiles", "profiles", "bksq-aircraft-baronpropress.yaml")

for (const f of [CAPTURE, LOOP]) {
  if (!existsSync(f)) {
    console.error(`${repoRelative(f)} isn't built; run cargo build --release in experiments/areas/architecture/recording first.`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------- the names

// FS Copilot writes one name a line, as `- get: L:var_RadarGain` or
// `- get: A:GENERAL ENG THROTTLE LEVER POSITION:1, Position 16k`. An H: event
// can't be read as a variable, so it's left out, and a B: name is an input
// event the capture subscribes to.
const when = stamp()
const names = []
for (const line of readFileSync(PROFILE, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*-?\s*get:\s*"?([LAB]):([^,"]+?)\s*(?:,\s*([^"#]+?))?\s*"?\s*(?:#.*)?$/)
  if (!m) continue
  const [, prefix, name, unit] = m
  names.push(prefix === "B" ? `B\t${name}` : `${prefix}\t${name}\t${unit ?? "number"}`)
}
const namesFile = resultFile("architecture", "p10-names", "tsv", when)
writeFileSync(namesFile, names.join("\n") + "\n")
const captureFile = resultFile("architecture", "p10-capture", "bin", when)
const count = (p) => names.filter((n) => n.startsWith(`${p}\t`)).length
console.log(`Watching ${names.length} names from FS Copilot's 58P profile: ${count("L")} L:, ${count("A")} A:, ${count("B")} B:.`)

// ---------------------------------------------------------------- the capture

const lines = []
const kinds = []
let total = null
const capture = spawn(CAPTURE, [namesFile, captureFile], { cwd: RELEASE, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
createInterface({ input: capture.stderr }).on("line", (l) => console.log(`capture: ${l}`))
const waiters = new Set()
createInterface({ input: capture.stdout }).on("line", (raw) => {
  const [, kind, ...f] = raw.split("\t")
  lines.push(raw)
  if (kind === "STATUS") {
    const [secs, fps, air, ground, records, bytes] = f
    const where = Number(secs) > 0 ? `recording ${secs}s` : "not recording yet"
    console.log(`  ${where}: ${fps} fps, ${air} aircraft and ${ground} ground vehicles around, ${Number(records).toLocaleString("en-US")} records, ${(Number(bytes) / 1e6).toFixed(2)} MB`)
  } else if (kind === "KIND") {
    kinds.push(f)
  } else if (kind === "TOTAL") {
    total = f
  } else {
    console.log(`capture: ${kind} ${f.join(" ")}`)
  }
  for (const w of waiters) if (w.kind === kind) { waiters.delete(w); w.resolve(f) }
})
const send = (cmd) => { try { capture.stdin.write(cmd + "\n") } catch { /* exited */ } }
const next = (kind) => new Promise((resolve) => waiters.add({ kind, resolve }))
const alive = setInterval(() => send("alive"), KEEPALIVE_MS)
capture.on("exit", (code) => { clearInterval(alive); if (code) console.log(`capture exited with code ${code}`) })

const keys = await startKeys()
const beep = startBeeper()
const speak = startSpeaker()

await next("CONNECTED")
console.log(`\nLoad the Black Square Baron 58P with AI traffic on, and get ready to fly.`)
console.log(`Press ${START} to start ${MINUTES} minutes of recording; ${SKIP} stops it early.`)
speak(`Load the Baron 58P with traffic on. Press Page Down to start recording.`)
while ((await keys.next()).key !== "START") { /* only Page Down starts it */ }

send("start")
await next("STARTED")
beep(880, 200)
speak(`Recording for ${MINUTES} minutes. Fly as you usually would: taxi, take off, work the switches and the radios, and look around.`)
console.log(`Recording. Fly as you usually would: taxi, take off, work the switches and the radios, and look around.`)
await new Promise((resolve) => {
  const timer = setTimeout(resolve, MINUTES * 60_000)
  const off = keys.listen((k) => { if (k.key === "SKIP") { clearTimeout(timer); off(); resolve() } })
})
send("stop")
await next("TOTAL")
beep(660, 200)
setTimeout(() => beep(440, 300), 300)
speak("Recording done.")
send("quit")
await new Promise((r) => capture.on("exit", r))

// ---------------------------------------------------------------- the report

const size = spawnSync(LOOP, ["size", captureFile], { encoding: "utf8" })
const offline = `${repoRelative(LOOP)} run ${repoRelative(captureFile)} ${repoRelative(WRITERS)} experiments/areas/architecture/results/p10-loop-${when} ${MINUTES}`
const report = [
  `p10: the size of a recording of every input a flying machine's core takes in, ${when} UTC`,
  "",
  `Watched: ${names.length} names from FS Copilot's 58P profile (${count("L")} L:, ${count("A")} A:, ${count("B")} B:), listed in ${repoRelative(namesFile)}.`,
  `Capture: ${repoRelative(captureFile)}`,
  "",
  "== The capture, by kind: count, bytes ==",
  ...kinds.map(([, name, n, bytes]) => `${name}\t${n}\t${bytes}`),
  total ? `total\t${total[0]} s\t${total[1]} records\t${total[2]} bytes\t${total[3]} traffic objects seen` : "no total",
  "",
  "== The capture's size ==",
  size.stdout.trim(),
  size.stderr.trim(),
  "",
  "== The capture program's other lines ==",
  ...lines.filter((l) => !/\t(STATUS|KIND)\t/.test(l)),
  "",
  "== Next, offline ==",
  offline,
].join("\n")
const out = resultFile("architecture", "p10-recording", "txt", when)
writeFileSync(out, report + "\n")
console.log(`\n${size.stdout.trim()}\n\nSaved ${repoRelative(out)}. The loop runs offline next:\n  ${offline}`)
process.exit(0)
