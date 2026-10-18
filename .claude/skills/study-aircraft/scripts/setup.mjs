/*
 * Fetches the tools decode.mjs needs, WABT and prettier, into the skill's bin/ folder,
 * if they're missing.
 *
 *   node .claude/skills/study-aircraft/scripts/setup.mjs
 *
 * Each tool is pinned in tools.json, with its download's SHA-256, so a changed or
 * tampered download is refused. When you bump a version there, bump its hash in the same
 * edit. bin/ is gitignored, so the downloaded binaries never enter the repository, which
 * goes public.
 */

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"

const skillDir = dirname(dirname(fileURLToPath(import.meta.url)))
const binDir = join(skillDir, "bin")
const tools = JSON.parse(readFileSync(join(skillDir, "tools.json"), "utf8"))
mkdirSync(binDir, { recursive: true })

await setUpWabt(tools.wabt)
setUpPrettier(tools.prettier)

async function setUpWabt({ version, url, sha256, files }) {
  const wanted = files.map((f) => join(binDir, basename(f)))
  if (!wanted.every(existsSync)) {
    const response = await fetch(url)
    if (!response.ok) fail(`wabt ${version}: download failed, HTTP ${response.status} from ${url}`)
    const archive = Buffer.from(await response.arrayBuffer())
    const actual = createHash("sha256").update(archive).digest("hex")
    if (actual !== sha256) fail(`wabt ${version}: SHA-256 is ${actual}, and tools.json expects ${sha256}`)
    const entries = readTar(gunzipSync(archive))
    for (const file of files) {
      const data = entries.get(file)
      if (!data) fail(`wabt ${version}: ${file} isn't in the archive`)
      writeFileSync(join(binDir, basename(file)), data)
    }
  }
  const reported = execFileSync(join(binDir, "wasm-decompile.exe"), ["--version"]).toString().trim()
  console.log(`wabt ${version}: ready, wasm-decompile reports ${reported}`)
}

function setUpPrettier({ version }) {
  const manifest = join(binDir, "node_modules", "prettier", "package.json")
  const installed = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : null
  if (installed !== version) {
    // On Windows, npm is npm.cmd, and Node runs a .cmd file only through a shell
    // (CVE-2024-27980, fixed in Node's April 2024 security releases).
    execFileSync("npm", ["install", "--prefix", binDir, "--no-save", "--no-package-lock", "--no-audit", "--no-fund", `prettier@${version}`], {
      stdio: "inherit",
      shell: true,
    })
  }
  console.log(`prettier ${version}: ready`)
}

// WABT ships as a .tar.gz, and Node has gzip built in but not tar, so this reads the
// tar itself: regular files, with GNU and PAX long names, which is enough for a release.
function readTar(buffer) {
  const entries = new Map()
  let offset = 0
  let longName = null
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const field = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "")
    const size = parseInt(field(124, 12).trim() || "0", 8)
    const type = field(156, 1)
    const prefix = field(345, 155)
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    const data = buffer.subarray(offset + 512, offset + 512 + size)
    longName = null
    if (type === "L") longName = data.toString("utf8").replace(/\0.*$/s, "")
    else if (type === "x") longName = data.toString("utf8").match(/\d+ path=(.*)\n/)?.[1] ?? null
    else if (type === "0" || type === "") entries.set(name, Buffer.from(data))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
