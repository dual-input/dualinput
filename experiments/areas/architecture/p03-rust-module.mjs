/*
 * p03: does a standalone module built from Rust with Navigraph's cargo-msfs,
 * and packaged by our own script, load on MSFS 2024, leave its version in a data
 * slot, tick every frame, and read a slot the core writes (architecture plan,
 * node 1.3.2)?
 *
 *   node experiments/areas/architecture/module/build.mjs --install   (sim closed)
 *   node experiments/areas/architecture/p03-rust-module.mjs          (sim at the main menu)
 *
 * Three packages hold one variant each (module/build.mjs): A as cargo-msfs
 * builds it, with SimConnect IDs from 0; B with IDs from 0xC300; and C, B linked
 * with the SDK's MSFS_WasmVersions.a, as the SDK's MSBuild toolset links every
 * module. Each writes CROSSCHECK_P03<A|B|C>_OUT, 20 bytes: a magic number, its
 * version, how many times module_init ran, a frame count, and the last value it
 * read from CROSSCHECK_P03<A|B|C>_IN, which this probe writes. Each also reports
 * how far it got through `L:` variables, set with the Vars API rather than
 * SimConnect, which module/src/lib.rs lists.
 *
 * For each variant, the probe reads the `L:` variables, reads OUT, again 5s
 * later, writes a random value to IN and reads OUT once more; then it lists the
 * folder the sim compiled the package into, MSFS2024 or MSFS2020 (05-03).
 */

import fs from "node:fs"
import path from "node:path"

import { Recorder, sleep } from "../aircraft/lib/out.mjs"
import { Sim } from "../aircraft/lib/sim.mjs"
import { repoRelative } from "../../tools/results.mjs"

const MAGIC = 0x5033_5253
const PACKAGES = ["crosscheck-p03-rust", "crosscheck-p03b-rust", "crosscheck-p03c-rust"]
const rec = new Recorder("p03-rust-module", { area: "architecture" })
const lines = [`p03-rust-module, ${new Date().toISOString()}`, ""]
const note = (s) => { lines.push(s); rec.log("find", s) }

const parse = (b) => (b.length >= 20 ? { magic: b.readUInt32LE(0), version: b.readUInt32LE(4), inits: b.readUInt32LE(8), frames: b.readUInt32LE(12), echo: b.readUInt32LE(16) } : null)
const show = (o) => (o ? `magic ${o.magic === MAGIC ? "ours" : `0x${o.magic.toString(16)}`}, version ${o.version}, module_init ran ${o.inits} time(s), frame ${o.frames}, echo ${o.echo}` : "nothing")

const sim = await Sim.connect(rec, { name: "CROSSCHECK p03 reader" })
const o = sim.recvOpen ?? {}
note(`Sim: ${o.applicationName ?? "?"} ${o.applicationVersionMajor ?? "?"}.${o.applicationVersionMinor ?? "?"}, build ${o.applicationBuildMajor ?? "?"}.${o.applicationBuildMinor ?? "?"}`)

for (const [v, what] of [["A", "as cargo-msfs builds it"], ["B", "with MSFS_WasmVersions.a, its StackSizesSection removed"], ["C", "with MSFS_WasmVersions.a and its StackSizesSection"]]) {
  note("")
  note(`Variant ${v}, ${what}:`)
  const vars = ["STAGE", "OPEN", "HANDLE", "FAIL_STEP", "FAIL_HR", "SEND_FIRST", "EXC_COUNT", "EXC", "EXC_SEND", "EXC_INDEX", "FRAMES"].map((n) => `L:CROSSCHECK_P03${v}_${n}`)
  const got = await sim.read(vars.map((n) => [n, "number"]))
  note(`  ${vars.map((n) => `${n.slice(2)} ${got.has(n) ? got.get(n) : "unread"}`).join(", ")}`)

  const read = async () => {
    const b = await sim.readClientData(`CROSSCHECK_P03${v}_OUT`, 20)
    return { at: Date.now(), out: b.missing ? null : parse(b), error: b.error }
  }
  const first = await read()
  note(`  OUT at connect: ${first.out ? show(first.out) : `missing (${first.error})`}`)
  if (!first.out) continue
  await sleep(5000)
  const second = await read()
  note(`  OUT 5s later: ${show(second.out)}`)
  if (second.out) note(`  Frames counted: ${second.out.frames - first.out.frames} in ${((second.at - first.at) / 1000).toFixed(2)}s, ${((second.out.frames - first.out.frames) / ((second.at - first.at) / 1000)).toFixed(1)} a second`)

  const tag = Math.floor(Math.random() * 0xffff_fffe) + 1
  const slot = sim.watchClientData(`CROSSCHECK_P03${v}_IN`, 4, () => {})
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(tag)
  slot.write(bytes)
  await sleep(500)
  const third = await read()
  note(`  Wrote ${tag} to IN; OUT 0.5s later: ${show(third.out)}; ${third.out?.echo === tag ? "the module read it" : "the module didn't echo it"}`)
  slot.stop()
}

note("")
const wasmRoot = path.join(process.env.APPDATA, "Microsoft Flight Simulator 2024", "WASM")
for (const pkg of PACKAGES) {
  for (const folder of ["MSFS2024", "MSFS2020"]) {
    const dir = path.join(wasmRoot, folder, pkg)
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".dll")).map((f) => `${f} at ${fs.statSync(path.join(dir, f)).mtime.toISOString()}`) : null
    note(`${pkg} compiled into WASM\\${folder}: ${files ? files.join(", ") || "no DLL" : "no"}`)
  }
}

sim.close()
rec.writeReport(lines.join("\n"))
await rec.close()
console.log(`saved ${repoRelative(rec.files.txt)}`)
