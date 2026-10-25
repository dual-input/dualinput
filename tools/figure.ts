// The figure's SimObject, avatars' DUALINPUT_FIGURE_PILOT (record/areas/build/01-the-build.md,
// "Files compiled with the sim").
//
//   node tools/figure.ts generate    writes src/features/avatars/figure/source/ from figure.json
//                                    and model.ts, and prints what each level of detail costs
//   node tools/figure.ts check       fails when the sources aren't what the generator writes, or
//                                    changed since compiled/ was compiled, as tools/check.ts does
//   node tools/figure.ts recompile   compiles the sources with fspackagetool into compiled/, and
//                                    writes their hashes into source.json
//
// To change the figure, on a PC with the sim and its SDK installed:
//
//  1. Change figure.json, or model.ts, and look at it in tools/figure-viewer.
//  2. Run `node tools/figure.ts generate`. It prints each level's triangles and draw calls
//     against the budget.
//  3. Close the sim in full, since fspackagetool hangs while it runs (measured, fsc-editor,
//     docs/sim-vars/build/v1-log.md, "2026-08-23 — The module becomes a sub-project, and
//     fspackagetool cannot run with the sim open").
//  4. Run `node tools/figure.ts recompile`. It prints "compiled/ written" with the files it
//     wrote, and `node tools/figure.ts check` passes.
//  5. Commit figure.json, source/, compiled/, and source.json together.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { BUDGET, COMPILED, HASHES, OBJECT, PACKAGE, SOURCE, mismatches, sha256, sources, walk } from "./lib/figure.ts"
import { simRunning } from "./lib/install.ts"
import { Failed, main } from "./lib/run.ts"

/** fspackagetool, from the SDK the installer put where `MSFS2024_SDK` names. */
function packageTool(): string {
  const sdk = process.env.MSFS2024_SDK ?? "C:/MSFS 2024 SDK"
  const tool = path.join(sdk, "Tools", "bin", "fspackagetool.exe")
  if (!fs.existsSync(tool)) throw new Failed(`no fspackagetool at ${tool}: install the MSFS 2024 SDK, which sets MSFS2024_SDK`)
  return tool
}

function generate(): void {
  const { files, costs } = sources()
  fs.rmSync(SOURCE, { recursive: true, force: true })
  for (const [rel, content] of files) {
    const file = path.join(SOURCE, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  console.log(`source/ written: ${files.size} files`)
  for (const { name, cost } of costs) {
    const budget = BUDGET[name]
    const over = budget && (cost.triangles > budget.triangles || cost.draws > budget.draws)
    console.log(
      `${name}: ${cost.triangles} triangles and ${cost.draws} draw calls as a pose shows it` +
        (budget ? `, against ${budget.triangles} and ${budget.draws}${over ? ": over the budget" : ""}` : "") +
        `; ${cost.nodes} nodes, ${cost.materials} materials`,
    )
  }
}

function check(): void {
  const found = mismatches()
  if (found.length) throw new Failed(`the figure's sources don't match:\n  ${found.join("\n  ")}`)
  console.log("the figure's sources match what compiled/ was compiled from")
}

function recompile(): void {
  if (simRunning()) throw new Failed("the sim is running, and fspackagetool hangs while it runs; close it in full and run this again")
  const tool = packageTool()
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "dualinput-figure-"))
  fs.cpSync(SOURCE, out, { recursive: true })
  const run = spawnSync(tool, [path.join(out, "project.xml"), "-nopause"], { stdio: "inherit", cwd: out })
  const built = path.join(out, "Packages", PACKAGE, OBJECT)
  if (run.status !== 0 || !fs.existsSync(built)) throw new Failed(`fspackagetool built no ${OBJECT} in ${path.join(out, "Packages", PACKAGE)}`)
  // Only the SimObject's own files: the package's manifest.json is tools/build.ts's, and
  // _PackageInt\ holds the home folder's path (record/areas/build/01-the-build.md, "Files
  // compiled with the sim").
  fs.rmSync(COMPILED, { recursive: true, force: true })
  fs.cpSync(built, COMPILED, { recursive: true })
  const hashes = Object.fromEntries(walk(SOURCE).map((rel) => [rel, sha256(fs.readFileSync(path.join(SOURCE, rel)))]))
  fs.writeFileSync(HASHES, JSON.stringify(hashes, null, 2) + "\n")
  fs.rmSync(out, { recursive: true, force: true })
  console.log(`compiled/ written: ${walk(COMPILED).join(", ")}`)
}

main(() => {
  const command = process.argv[2]
  if (command === "generate") generate()
  else if (command === "check") check()
  else if (command === "recompile") recompile()
  else throw new Failed("say generate, check, or recompile")
})
