// Replays a pilot's recording on the core the recording's release shipped, so a replay runs
// the math that run ran: the core's math follows the C runtime of the Windows SDK it was built
// with, which CI's runner image doesn't pin, so a build of the same commit here could part from
// the run where the release's own core wouldn't (record/areas/core/01-loop-and-edge.md,
// "Running a replay").
//
//   node tools/replay.ts <recording> [--log <level>]
//
// It reads the commit from the recording's header, finds the release whose tag is on that
// commit, fetches the release's full package from GitHub into target/replay/<version>/ unless
// it's there, and runs its `dualinput-core replay`, which writes beside the recording. A
// recording of a development build names a commit no release was built from: replay that one
// with `dualinput-core replay <recording>` from a build of its commit.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

import { ROOT } from "./lib/repo.ts"
import { Failed, main, output, run } from "./lib/run.ts"

/** `REPOSITORY` in src/apps/desktop/src/jobs/updates.rs names the same repository, so change both together. */
const REPOSITORY = "https://github.com/dual-input/dualinput"

/** `MAGIC` in src/engines/recording-format/src/lib.rs, which every recording starts with once decompressed. */
const MAGIC = "DualInput recording\n"

main(async () => {
  const [file, ...rest] = process.argv.slice(2)
  if (!file || !(rest.length === 0 || (rest.length === 2 && rest[0] === "--log"))) {
    throw new Failed("usage: node tools/replay.ts <recording> [--log <level>]")
  }
  const commit = await recordedCommit(file)
  const version = releaseAt(commit)
  const core = await releasedCore(version)
  console.log(`replaying on the core of release ${version}, built from ${commit}`)
  const result = spawnSync(core, ["replay", path.resolve(file), ...rest], { stdio: "inherit" })
  process.exit(result.status ?? 1)
})

/**
 * The commit the recording's header names. The header follows the magic: its length, then its
 * fields in postcard, which writes the first, the commit, as its length and its 40 hex digits,
 * each length a varint (src/engines/recording-format/src/lib.rs).
 */
async function recordedCommit(file: string): Promise<string> {
  if (!fs.existsSync(file)) throw new Failed(`${file} doesn't exist`)
  const start = await decompressedStart(file, MAGIC.length + 64)
  if (start.subarray(0, MAGIC.length).toString("latin1") !== MAGIC) throw new Failed(`${file} isn't a recording of Dual Input's core`)
  let at = MAGIC.length
  const varint = () => {
    let value = 0
    for (let shift = 0; ; shift += 7) {
      const byte = start[at++]!
      value += (byte & 0x7f) * 2 ** shift
      if (byte < 0x80) return value
    }
  }
  varint()
  const length = varint()
  return start.subarray(at, at + length).toString("latin1")
}

/** The first `bytes` of the file once decompressed, reading no further than they need. */
async function decompressedStart(file: string, bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let held = 0
  const input = fs.createReadStream(file)
  const zstd = zlib.createZstdDecompress()
  try {
    for await (const chunk of input.pipe(zstd) as AsyncIterable<Buffer>) {
      chunks.push(chunk)
      held += chunk.length
      if (held >= bytes) break
    }
  } catch (error) {
    // A recording the core was killed while writing ends mid-frame, past what's needed here.
    if (held < bytes) throw new Failed(`${file} doesn't decompress: ${(error as Error).message}`)
  } finally {
    input.destroy()
    zstd.destroy()
  }
  return Buffer.concat(chunks)
}

/** The version of the release whose tag is on `commit`; every tag on the repository is a release's bare version. */
function releaseAt(commit: string): string {
  // `git ls-remote --tags` prints "<commit>\trefs/tags/<tag>", and for an annotated tag also
  // "<commit>\trefs/tags/<tag>^{}", the commit it points at.
  const tags = output("git", ["ls-remote", "--tags", REPOSITORY]).split("\n").filter(Boolean)
  const found = tags.map((line) => line.split("\t")).find(([at, ref]) => at === commit && ref?.startsWith("refs/tags/"))
  if (!found) throw new Failed(`no release of Dual Input was built from ${commit}: replay the recording with dualinput-core replay from a build of that commit`)
  return found[1]!.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "")
}

/** The release's core, from its full package in target/replay/<version>/, fetched the first time. */
async function releasedCore(version: string): Promise<string> {
  const folder = path.join(ROOT, "target", "replay", version)
  // Velopack's full package is a zip that holds the release's `current\` folder as lib/app/,
  // whose SimConnect.dll and C runtime DLLs the core loads from beside it.
  const core = path.join(folder, "lib", "app", "dualinput-core.exe")
  if (fs.existsSync(core)) return core
  const name = `DualInput-${version}-full.nupkg`
  const url = `${REPOSITORY}/releases/download/${version}/${name}`
  console.log(`fetching ${url}`)
  const answer = await fetch(url)
  if (!answer.ok) throw new Failed(`${url} answered ${answer.status}`)
  fs.rmSync(folder, { recursive: true, force: true })
  fs.mkdirSync(folder, { recursive: true })
  const nupkg = path.join(folder, name)
  fs.writeFileSync(nupkg, Buffer.from(await answer.arrayBuffer()))
  // Windows' own tar, bsdtar, reads a zip, where Git's GNU tar, which can come first on the
  // PATH, doesn't.
  run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", nupkg, "-C", folder])
  if (!fs.existsSync(core)) throw new Failed(`${name} holds no lib/app/dualinput-core.exe`)
  return core
}
