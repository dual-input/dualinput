// Builds every program and package the tree holds. It first checks that the installed
// MSFS SDK is the version msfs-sdk.txt names, so no build uses another. When you add a
// program or package that `cargo build` doesn't build, add its build here
// (record/areas/architecture/02-code-map.md, "Building every target").
//
//   node tools/build.ts

import { main, run } from "./lib/run.ts"
import { requireSdk } from "./lib/sdk.ts"
import { writeMessageTypes } from "./lib/messages.ts"

main(() => {
  requireSdk()
  writeMessageTypes()
  run("cargo", ["build"])
})
