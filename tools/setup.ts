// Installs the two things our builds need besides the compilers: cargo-msfs, the tool that
// builds our WASM module, at the tag our builds use, and the MSFS SDK version msfs-sdk.txt
// names, in the folder cargo-msfs reads it from. A new PC's setup runs it after `npm ci`
// (record/areas/architecture/02-code-map.md, "Building every target").
//
//   node tools/setup.ts
//
// It skips what's already installed, so it's safe to run after every pull.

import { installedSdk, sdkFolder, wantedSdk } from "./lib/sdk.ts"
import { main, output, run } from "./lib/run.ts"

const CARGO_MSFS = { git: "https://github.com/navigraph/cargo-msfs", tag: "v1.1.0" }

main(() => {
  // `cargo install --list` names a git install by its URL and tag, such as
  // "cargo-msfs v0.1.0 (https://github.com/navigraph/cargo-msfs?tag=v1.1.0#5d3718d1):".
  const installs = output("cargo", ["install", "--list"])
  const line = installs.split(/\r?\n/).find((l) => l.startsWith("cargo-msfs "))
  if (line?.includes(`${CARGO_MSFS.git}?tag=${CARGO_MSFS.tag}#`)) {
    console.log(`cargo-msfs ${CARGO_MSFS.tag} is installed`)
  } else {
    run("cargo", ["install", "--git", CARGO_MSFS.git, "--tag", CARGO_MSFS.tag, "--locked", "cargo-msfs"])
  }

  const wanted = wantedSdk()
  const installed = installedSdk()
  if (installed === wanted) {
    console.log(`SDK ${wanted} is installed in ${sdkFolder()}`)
  } else {
    console.log(installed ? `SDK ${installed} is installed; installing ${wanted}` : `installing SDK ${wanted}`)
    run("cargo", ["run", "--release", "--locked", "-p", "dualinput-msfs-sdk", "--", wanted])
  }
})
