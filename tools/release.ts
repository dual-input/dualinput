// A release's steps after the build: packing the folder `node tools/build.ts release` laid out
// into Velopack's Setup.exe, full package, and delta. Fetching the release before for the
// delta, uploading, and publishing are the release workflow's
// (record/areas/build/01-the-build.md, "A release").
//
//   node tools/release.ts pack
//
// `pack` packs target/release-folder as the root Cargo.toml's version into target/releases,
// where `vpk` makes a delta from the release before when that one is there. It installs `vpk`
// into target/vpk the first time, which needs the .NET 8 SDK or later.

import fs from "node:fs"

import { workspaceVersion } from "./lib/package.ts"
import { pack, RELEASE_FOLDER, RELEASES } from "./lib/release.ts"
import { Failed, main } from "./lib/run.ts"

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 1 || args[0] !== "pack") throw new Failed("usage: node tools/release.ts pack")
  if (!fs.existsSync(RELEASE_FOLDER)) throw new Failed(`${RELEASE_FOLDER} holds no release; run node tools/build.ts release first`)
  const version = workspaceVersion()
  pack(version)
  console.log(`packed version ${version} into ${RELEASES}`)
})
