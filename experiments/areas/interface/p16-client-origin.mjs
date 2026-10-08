/*
 * p16: whether the WebSocket client in Node, and in Electron's main process,
 * sends an Origin header, which decides whether the core's Origin check lets
 * the desktop app in: the core accepts `coui://html_ui` or no Origin
 * (record/areas/architecture/decisions.md, "The core accepts a WebSocket only
 * from the sim's pages and our own apps"). Needs no sim.
 *
 *   node experiments/areas/interface/p16-client-origin.mjs
 *
 * It serves a WebSocket upgrade on 127.0.0.1 and logs each connection's
 * Origin, from three clients: this Node's built-in WebSocket; Electron run as
 * Node, with ELECTRON_RUN_AS_NODE; and Electron's main process, with no
 * window. The desktop app is Electron if step 7's lean holds
 * (record/areas/product/plan.md), and fsc-editor ships Electron 43, whose
 * executable we use (../fsc-editor/node_modules/electron).
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"

import { REPO, saveResult } from "../../tools/results.mjs"

const ELECTRON = path.join(REPO, "..", "fsc-editor", "node_modules", "electron", "dist", "electron.exe")
const seen = []

const server = createServer((req, res) => { res.writeHead(404); res.end() })
server.on("upgrade", (req, socket) => {
  const from = new URL(req.url, "http://127.0.0.1").searchParams.get("from") ?? "?"
  seen.push({ from, origin: req.headers.origin ?? null })
  socket.destroy()
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const url = `ws://127.0.0.1:${server.address().port}/`

// The client each runtime runs: open a socket, report the runtime's versions,
// and leave once the server has hung up or 3s have passed.
const CLIENT = `
const v = process.versions;
const label = (v.electron ? "Electron " + v.electron + " (Node " + v.node + ")" : "Node " + v.node) + " " + (process.type || "as Node");
const ws = new WebSocket(${JSON.stringify(url)} + "?from=" + encodeURIComponent(label));
const done = () => process.exit(0);
ws.onclose = done; ws.onerror = done; setTimeout(done, 3000);
`
const MAIN = `
const { app } = require("electron");
app.whenReady().then(() => {${CLIENT.replace(/process\.exit\(0\)/g, "app.quit()")}});
`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p16-"))
fs.writeFileSync(path.join(dir, "client.cjs"), CLIENT)
fs.writeFileSync(path.join(dir, "main.cjs"), MAIN)

const lines = [`p16-client-origin, ${new Date().toISOString()}`, ""]
const runs = [
  ["this Node", process.execPath, [path.join(dir, "client.cjs")], {}],
  ["Electron as Node", ELECTRON, [path.join(dir, "client.cjs")], { ELECTRON_RUN_AS_NODE: "1" }],
  ["Electron's main process", ELECTRON, [path.join(dir, "main.cjs")], {}],
]
for (const [what, exe, args, env] of runs) {
  if (!fs.existsSync(exe)) { lines.push(`- ${what}: no executable`); continue }
  const before = seen.length
  // Asynchronous, so the server above keeps answering while the client runs.
  await new Promise((resolve) => {
    const child = spawn(exe, args, { env: { ...process.env, ...env }, stdio: "ignore" })
    child.on("exit", resolve)
    child.on("error", resolve)
  })
  const got = seen.slice(before)
  lines.push(`- ${what}: ${got.length ? got.map((g) => `${g.from} sent ${g.origin === null ? "no Origin" : `the Origin ${g.origin}`}`).join("; ") : "no connection reached the server"}`)
}
server.close()
fs.rmSync(dir, { recursive: true, force: true })

const text = lines.join("\n")
console.log(text)
console.log(`saved ${path.relative(REPO, saveResult("interface", "p16-client-origin", text))}`)
