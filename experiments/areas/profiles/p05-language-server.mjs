/*
 * p05: how fast the profile extension's language server, `dualinput-profile-builder serve`,
 * answers the 58P's profile, against the budgets in record/areas/profiles/03-the-extension.md.
 *
 * It drives the server over stdio as VS Code does, and times: the start, until the server answers
 * `initialize` and a first completion inside a script; a request inside a script right after an
 * edit, 30 runs each of completion after `state.`, signature help in `write(`, and a hover on a key
 * of `state`; and the engine's checks on one keystroke, from `didChange` to the diagnostics they
 * publish. The edits go to the server alone, so no file changes. Needs no sim.
 *
 *   node experiments/areas/profiles/p05-language-server.mjs
 *
 * It runs target/release/dualinput-profile-builder.exe, which `node tools/build.ts extension`
 * builds.
 *
 * Output: the report on the console and in
 * experiments/areas/profiles/results/p05-language-server-<time>.txt.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { REPO, repoRelative, saveResult } from "../../tools/results.mjs"

const exe = path.join(REPO, "target", "release", "dualinput-profile-builder.exe")
const local = fs.mkdtempSync(path.join(os.tmpdir(), "p05-"))
const file = path.join(REPO, "profiles", "aircraft", "bksq-baronpro.yaml")
const uri = pathToFileURL(file).href
const base = fs.readFileSync(file, "utf8")
// One warning, so each keystroke's engine checks publish diagnostics that can be timed.
const warned = base.replace(
  "    watch: L('BKSQ_MixtureLeverPosition_2')\n    write: L('BKSQ_MixtureLeverPosition_2')\n",
  "    watch: L('BKSQ_MixtureLeverPosition_2')\n    write: L('BKSQ_MixtureLeverPosition_2')\n    ignore: L('BKSQ_MixtureLeverPosition_1')\n",
)
if (warned === base) throw new Error("the warning line did not go in")

const started = performance.now()
const server = spawn(exe, ["serve"], { stdio: ["pipe", "pipe", "pipe"] })
let stderr = ""
server.stderr.on("data", (d) => (stderr += d))
let buffer = Buffer.alloc(0)
const waiting = new Map()
const listeners = []
server.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n")
    if (end < 0) return
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + length) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    const at = performance.now()
    if (message.id !== undefined && message.method === "workspace/configuration") {
      send({ jsonrpc: "2.0", id: message.id, result: [{ buildOnSave: false, localFolder: local }] })
    } else if (message.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)({ message, at })
      waiting.delete(message.id)
    } else if (message.method) {
      for (const l of [...listeners]) l(message, at)
    }
  }
})
function send(message) {
  const body = Buffer.from(JSON.stringify(message))
  server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
  server.stdin.write(body)
}
let next = 0
function request(method, params) {
  const id = ++next
  const sent = performance.now()
  const answered = new Promise((resolve) => waiting.set(id, resolve))
  send({ jsonrpc: "2.0", id, method, params })
  return answered.then(({ message, at }) => ({ result: message.result, error: message.error, ms: at - sent }))
}
function notify(method, params) {
  send({ jsonrpc: "2.0", method, params })
}
function once(method, test) {
  return new Promise((resolve) => {
    const l = (message, at) => {
      if (message.method === method && test(message.params)) {
        listeners.splice(listeners.indexOf(l), 1)
        resolve(at)
      }
    }
    listeners.push(l)
  })
}

await request("initialize", {
  processId: process.pid,
  capabilities: { workspace: { configuration: true } },
  workspaceFolders: [{ uri: pathToFileURL(REPO).href, name: "repo" }],
})
const initialized = performance.now() - started
notify("initialized", {})

let version = 1
notify("textDocument/didOpen", { textDocument: { uri, languageId: "dualinput-profile", version, text: warned } })

// Places in the 58P's scripts: after `state.`, inside `write(`, and on a key of `state`.
const lines = warned.split("\n")
const line = lines.findIndex((l) => l.includes("if (value == state.breaker_starter) return"))
const dot = lines[line].indexOf("state.") + 6
const callLine = line + 1
const call = lines[callLine].indexOf("write(") + 6
const hoverAt = lines[line].indexOf("breaker_starter") + 3
const same = (u) => decodeURIComponent(u).toLowerCase() === decodeURIComponent(uri).toLowerCase()
const position = (l, c) => ({ textDocument: { uri }, position: { line: l, character: c } })

const firstCompletion = await request("textDocument/completion", position(line, dot))
const firstAnswered = performance.now() - started

// The edit alternates one script line between two texts, so each request follows a change.
const edited = (n) => {
  const copy = [...lines]
  copy[line] = n % 2 ? `${lines[line]} ` : lines[line]
  return copy.join("\n")
}
const stats = (ms) => {
  const sorted = [...ms].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
  return `p50 ${at(0.5).toFixed(1)}ms, p95 ${at(0.95).toFixed(1)}ms, max ${sorted.at(-1).toFixed(1)}ms`
}

async function timed(name, method, params, check) {
  const ms = []
  for (let n = 0; n < 30; n++) {
    version++
    notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text: edited(version) }] })
    const answer = await request(method, params)
    if (n === 0 && !check(answer.result)) throw new Error(`${name} answered ${JSON.stringify(answer.result).slice(0, 300)}`)
    ms.push(answer.ms)
  }
  return `${name}: ${stats(ms)}`
}

const out = [
  `p05 on ${repoRelative(file)}, ${os.cpus()[0].model.trim()}, Node ${process.version}, 30 runs of each request, each after an edit`,
  `start: initialize answered ${initialized.toFixed(0)}ms after the process started; the first completion in a script ${firstAnswered.toFixed(0)}ms after, itself ${firstCompletion.ms.toFixed(1)}ms`,
]
out.push(await timed("completion after state.", "textDocument/completion", position(line, dot), (r) => r.items?.some((i) => i.label === "breaker_starter")))
out.push(await timed("signature help in write(", "textDocument/signatureHelp", position(callLine, call), (r) => r?.signatures?.length > 0))
out.push(await timed("hover on state.breaker_starter", "textDocument/hover", position(line, hoverAt), (r) => r?.contents?.value?.includes("breaker_starter")))

// The engine's checks on one keystroke: didChange until the diagnostics they publish, which
// counts the trip over stdio too, so it's an upper bound.
const checks = []
for (let n = 0; n < 30; n++) {
  version++
  const published = once("textDocument/publishDiagnostics", (p) => same(p.uri) && p.diagnostics.some((d) => d.code === "ignore-watched"))
  const sent = performance.now()
  notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text: edited(version) }] })
  checks.push((await published) - sent)
}
out.push(`the engine's checks, didChange to publishDiagnostics: ${stats(checks)}`)

await request("shutdown", null)
notify("exit", null)
server.stdin.end()
await new Promise((resolve) => setTimeout(resolve, 500))
fs.rmSync(local, { recursive: true, force: true })
console.log(out.join("\n"))
console.log(`saved ${repoRelative(saveResult("profiles", "p05-language-server", out.join("\n")))}`)
