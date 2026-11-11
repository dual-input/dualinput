// Builds every program and package the tree holds: the programs `cargo build` builds, then
// our WASM module, which only cargo-msfs builds, our code in the sim, which esbuild builds
// and the Coherent GT check checks, and our package for the sim's Community folder, in
// target/sim-package/dualinput. It first checks that the installed MSFS SDK is the version
// msfs-sdk.txt names, so no build uses another, and that the sim's stock files our copies
// start from are the ones in src/sim-package/stock/. When you add a program or package that
// `cargo build` doesn't build, add its build here
// (record/areas/architecture/02-code-map.md, "Building every target").
//
//   node tools/build.ts
//   node tools/build.ts install
//   node tools/build.ts release
//
// `install` then copies the package into each of the sim's Community folders, and refuses
// while the sim runs. Only an installed desktop app writes our package there otherwise, and
// it doesn't copy a rebuild in, since a rebuild keeps the version
// (record/areas/build/01-the-build.md, "Our package").
//
// `release` then builds the programs a release ships with Cargo's release profile, and lays out
// the folder Setup.exe installs as `current\` in target/release-folder, which
// `node tools/release.ts pack` packs (record/areas/build/01-the-build.md, "What a release
// holds").

import path from "node:path"

import { buildPrograms } from "./lib/cargo.ts"
import { buildDesktopPages, DESKTOP } from "./lib/desktop-pages.ts"
import { install, refuseWhileSimRuns, userCfgs } from "./lib/install.ts"
import { writeMessageTypes } from "./lib/messages.ts"
import { buildModule } from "./lib/module.ts"
import { layOutPackage, PACKAGE } from "./lib/package.ts"
import { buildPages, checkPages } from "./lib/pages.ts"
import { panelCompileProblem } from "./lib/panel.ts"
import { layOutRelease, RELEASE_FOLDER } from "./lib/release.ts"
import { Failed, main, run } from "./lib/run.ts"
import { requireSdk } from "./lib/sdk.ts"
import { checkStock } from "./lib/stock.ts"

main(async () => {
  const args = process.argv.slice(2)
  const step = args.length === 1 && ["install", "release"].includes(args[0]!) ? args[0] : undefined
  if (args.length && !step) throw new Failed(`unknown arguments: ${args.join(" ")}; run node tools/build.ts [install|release]`)

  requireSdk()
  checkStock()
  // A definition edited with no compile after it would fly the old panel with no word.
  const panel = panelCompileProblem()
  if (panel) throw new Failed(panel)
  // An install refuses before it builds, so a developer with the sim open doesn't wait out a
  // build for nothing, and again before it copies, since the sim may start during the build.
  if (step === "install") refuseWhileSimRuns()
  writeMessageTypes()
  await buildDesktopPages()
  run("cargo", ["build"])
  run("cargo", ["build"], { cwd: DESKTOP })
  const pages = await buildPages()
  checkPages(pages)
  layOutPackage(buildModule(), pages)
  console.log(`laid out our package in ${PACKAGE}`)

  if (step === "install") {
    for (const copy of install(PACKAGE, userCfgs())) console.log(`installed our package in ${copy}`)
  }
  if (step === "release") {
    const { "dualinput-core": core, "dualinput-core-helper": helper } = buildPrograms(
      ["--release", "-p", "dualinput-core", "-p", "dualinput-core-helper"],
      ["dualinput-core", "dualinput-core-helper"],
    )
    const { "dualinput-desktop": desktop } = buildPrograms(["--release"], ["dualinput-desktop"], DESKTOP)
    // The sim edge's build script copies the SDK's SimConnect.dll beside the core it builds.
    layOutRelease({ desktop, core, helper, simConnect: path.join(path.dirname(core), "SimConnect.dll") }, PACKAGE)
    console.log(`laid out the release in ${RELEASE_FOLDER}; pack it with node tools/release.ts pack`)
  }
})
