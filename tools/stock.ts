// Copies the sim's own files that our package ships changed copies of, VCockpit.js and
// BlurPage's two files, into sim-package/stock/, and writes stock.json with the sim's release
// and each file's SHA-256. Run it when a build stops because a sim update changed one, then
// commit what it changed, which shows what the update changed
// (record/areas/build/01-the-build.md, "The sim's stock files").
//
//   node tools/stock.ts

import fs from "node:fs"
import path from "node:path"

import { Failed, main } from "./lib/run.ts"
import { sha256, STOCK, STOCK_FILES, STOCK_JSON, steamSim, type StockJson } from "./lib/stock.ts"

main(() => {
  const sim = steamSim()
  if (!sim) throw new Failed("found no Steam edition of MSFS 2024, whose files are the only ones this reads")
  // A beta's files would reach pilots on the public sim through the next release.
  if (sim.branch !== "public") throw new Failed(`the sim is on Steam's ${sim.branch} branch; copy its files only from the public branch`)

  const json: StockJson = { sim: sim.version, branch: sim.branch, files: {} }
  fs.mkdirSync(STOCK, { recursive: true })
  for (const { name, from } of STOCK_FILES) {
    const file = path.join(sim.folder, "Packages", from)
    if (!fs.existsSync(file)) throw new Failed(`the sim has no ${from}`)
    fs.copyFileSync(file, path.join(STOCK, name))
    json.files[name] = { from, sha256: sha256(file) }
    console.log(`copied ${from}`)
  }
  fs.writeFileSync(STOCK_JSON, `${JSON.stringify(json, null, 2)}\n`)
  console.log(`wrote sim-package/stock/stock.json for the sim's ${sim.version}`)
})
