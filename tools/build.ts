// Builds every program and package the tree holds: the programs `cargo build` builds, then
// our WASM module, which only cargo-msfs builds, our code in the sim, which esbuild builds
// and the Coherent GT check checks, and our package for the sim's Community folder, in
// target/sim-package/dualinput. It first checks that the installed MSFS SDK is the version
// msfs-sdk.txt names, so no build uses another, and that the sim's stock files our copies
// start from are the ones in sim-package/stock/. When you add a program or package that
// `cargo build` doesn't build, add its build here
// (record/areas/architecture/02-code-map.md, "Building every target").
//
//   node tools/build.ts
//   node tools/build.ts install
//
// `install` then copies the package into each of the sim's Community folders, and refuses
// while the sim runs. Only an installed desktop app writes our package there otherwise, and
// it doesn't copy a rebuild in, since a rebuild keeps the version
// (record/areas/build/01-the-build.md, "Our package").

import { install, refuseWhileSimRuns, userCfgs } from "./lib/install.ts"
import { writeMessageTypes } from "./lib/messages.ts"
import { buildModule } from "./lib/module.ts"
import { layOutPackage, PACKAGE } from "./lib/package.ts"
import { buildPages, checkPages } from "./lib/pages.ts"
import { Failed, main, run } from "./lib/run.ts"
import { requireSdk } from "./lib/sdk.ts"
import { checkStock } from "./lib/stock.ts"

main(() => {
  const args = process.argv.slice(2)
  const installing = args.length === 1 && args[0] === "install"
  if (args.length && !installing) throw new Failed(`unknown arguments: ${args.join(" ")}; run node tools/build.ts [install]`)

  requireSdk()
  checkStock()
  // An install refuses before it builds, so a developer with the sim open doesn't wait out a
  // build for nothing, and again before it copies, since the sim may start during the build.
  if (installing) refuseWhileSimRuns()
  writeMessageTypes()
  run("cargo", ["build"])
  const pages = buildPages()
  checkPages(pages)
  layOutPackage(buildModule(), pages)
  console.log(`laid out our package in ${PACKAGE}`)

  if (installing) {
    for (const copy of install(PACKAGE, userCfgs())) console.log(`installed our package in ${copy}`)
  }
})
