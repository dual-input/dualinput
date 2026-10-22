// Checks files we ship into the sim against what Coherent GT runs, printing each failure
// with its line in our source, and exits with 1 if it found any.
//
//   node tools/coherent-check/main.ts <file>...

import path from "node:path"

import { checkFile, format } from "./check.ts"

const files = process.argv.slice(2)
if (!files.length) {
  console.error("usage: node tools/coherent-check/main.ts <file>...")
  process.exit(2)
}
let found = 0
for (const file of files) {
  for (const f of checkFile(file)) {
    console.log(format(path.relative(process.cwd(), file).split(path.sep).join("/"), f))
    found++
  }
}
process.exitCode = found ? 1 : 0
