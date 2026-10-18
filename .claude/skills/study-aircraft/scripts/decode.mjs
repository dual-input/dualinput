/*
 * The study-aircraft skill reads every file of an aircraft to learn how it's built, and
 * much of an aircraft ships as WASM, minified JavaScript, and Windows binaries, which
 * nobody can search. This turns those files into searchable text, and leaves deciding
 * what matters in them to the study.
 *
 * Each source is a folder: a package, a WASM work folder, or a vendor install.
 * It lands in <out>/<source folder name>/, with each file at its path relative
 * to the source:
 *
 *   .wasm                  <file>.objdump.txt (sections, imports, exports, names),
 *                          <file>.dcmp (wasm-decompile), <file>.strings.txt
 *   minified .js           reformatted by prettier, under its own name
 *   other text             copied as is
 *   .exe, .dll             <file>.strings.txt
 *   anything else          left alone, and listed in the report
 *
 * <out>/decode-report.tsv lists every file with what was done to it.
 * An output that already exists is kept, so a rerun only does what's missing.
 *
 *   node .claude/skills/study-aircraft/scripts/decode.mjs <out> <source> [<source> ...]
 *
 * Before the first run, run scripts/setup.mjs, which fetches the tools this uses.
 */

import { spawnSync } from "node:child_process"
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const binDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "bin")
const [out, ...sources] = process.argv.slice(2)
if (!out || sources.length === 0) {
  console.error("usage: node decode.mjs <out> <source> [<source> ...]")
  process.exit(1)
}
if (!existsSync(join(binDir, "wasm-decompile.exe"))) {
  console.error("The tools are missing: run scripts/setup.mjs first.")
  process.exit(1)
}
const prettier = await import(pathToFileURL(join(binDir, "node_modules", "prettier", "index.mjs")))

const textExtensions = new Set([".xml", ".cfg", ".html", ".htm", ".css", ".json", ".ini", ".txt", ".flt", ".md", ".yaml", ".yml", ".csv", ".lua", ".ts", ".loc", ".sav"])
const binaryExtensions = new Set([".exe", ".dll"])

const report = ["source\tpath\tbytes\taction"]
const counts = new Map()
const failures = []

for (const source of sources) {
  const name = basename(source)
  for (const file of walk(source)) {
    const rel = relative(source, file)
    const target = join(out, name, rel)
    const bytes = statSync(file).size
    let action
    try {
      action = await decode(file, target)
    } catch (error) {
      action = "failed"
      failures.push(`${name}/${rel}: ${String(error.message).split("\n")[0]}`)
    }
    report.push(`${name}\t${rel.replaceAll("\\", "/")}\t${bytes}\t${action}`)
    const key = `${action} ${extname(file).toLowerCase() || "(none)"}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
}

mkdirSync(out, { recursive: true })
writeFileSync(join(out, "decode-report.tsv"), report.join("\n") + "\n")
for (const [key, count] of [...counts].sort()) console.log(`${String(count).padStart(6)}  ${key}`)
for (const failure of failures) console.log(`failed: ${failure}`)
console.log(`report: ${join(out, "decode-report.tsv")}`)

async function decode(file, target) {
  const extension = extname(file).toLowerCase()
  if (extension === ".wasm") {
    ensureDir(target)
    run("wasm-objdump.exe", ["-x", file], `${target}.objdump.txt`)
    run("wasm-decompile.exe", [file], `${target}.dcmp`)
    writeStrings(file, `${target}.strings.txt`)
    return "decompiled"
  }
  if (extension === ".js" || extension === ".mjs") {
    if (existsSync(target)) return "kept"
    ensureDir(target)
    const source = readFileSync(file, "utf8")
    if (!isMinified(source)) {
      copyFileSync(file, target)
      return "copied"
    }
    writeFileSync(target, await prettier.format(source, { parser: "babel" }))
    return "reformatted"
  }
  if (textExtensions.has(extension)) {
    if (!existsSync(target)) {
      ensureDir(target)
      copyFileSync(file, target)
    }
    return "copied"
  }
  if (binaryExtensions.has(extension)) {
    ensureDir(target)
    writeStrings(file, `${target}.strings.txt`)
    return "strings"
  }
  return "untouched"
}

// Minified code packs a whole module onto a few lines, so a line over 1,000 characters
// marks a file as minified.
function isMinified(source) {
  return source.split("\n").some((line) => line.length > 1000)
}

// Paths under an aircraft's SimObjects folder can pass Windows' 260-character limit,
// and WABT's tools can't open a path that long. We saw `wasm-decompile -o` exit 0 on one
// and write nothing. So the tools write to stdout and Node writes the file, and an empty
// output counts as a failure.
function run(tool, args, outputPath) {
  if (existsSync(outputPath) && statSync(outputPath).size > 0) return
  const fd = openSync(outputPath, "w")
  const result = spawnSync(join(binDir, tool), args, { stdio: ["ignore", fd, "pipe"] })
  closeSync(fd)
  if (result.status !== 0) throw new Error(`${tool} exited ${result.status}: ${result.stderr}`)
  if (statSync(outputPath).size === 0) throw new Error(`${tool} wrote nothing`)
}

// Like Unix's `strings`: printable runs of 6 or more characters, in ASCII and in
// UTF-16LE, which is how Windows binaries usually store their strings.
function writeStrings(file, target) {
  if (existsSync(target)) return
  const buffer = readFileSync(file)
  const found = []
  let run = ""
  for (const byte of buffer) {
    if (byte >= 0x20 && byte < 0x7f) run += String.fromCharCode(byte)
    else {
      if (run.length >= 6) found.push(run)
      run = ""
    }
  }
  if (run.length >= 6) found.push(run)
  run = ""
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const code = buffer[i] | (buffer[i + 1] << 8)
    if (code >= 0x20 && code < 0x7f) run += String.fromCharCode(code)
    else {
      if (run.length >= 6) found.push(run)
      run = ""
    }
  }
  if (run.length >= 6) found.push(run)
  writeFileSync(target, found.join("\n") + "\n")
}

function ensureDir(target) {
  mkdirSync(dirname(target), { recursive: true })
}

function* walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}
