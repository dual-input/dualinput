/*
 * p06: whether code in the EFB's document and in an in-game panel's document
 * can reach a program on the same PC, by a WebSocket, by an HTTP request, and
 * by showing a page that program serves. The plan's step 6 probe on clients
 * (record/areas/product/plan.md; record/areas/product/04-room-for-later.md,
 * "One protocol for every client").
 *
 *   node experiments/areas/interface/p06-websocket.mjs
 *
 * An EFB app's code runs in the EFB's document, titled "Electronic Flight
 * Bag", which stays loaded while the EFB is closed (record/areas/interface/
 * log.md, 2026-10-04, "Code in the EFB's document switches the EFB to another
 * app, but no call we found puts the EFB on screen"), so code the inspector
 * runs there stands in for an app's. The inspector runs code with DevMode off
 * (experiments/tools/inspector.mjs). A cockpit panel's document is the control:
 * our FS Copilot fork measured a WebSocket from one (FS Copilot fork,
 * record/pointer-forwarding/docs/build/log.md, "2026-08-30 - Q08 yes: a
 * cockpit document can hold a WebSocket to loopback").
 *
 * The probe serves, on 127.0.0.1, a page and a WebSocket endpoint with no
 * dependencies, and in each document it tries:
 *   1. a WebSocket that sends a line and waits for the echo;
 *   2. an XMLHttpRequest for a small text file;
 *   3. a hidden 1x1 iframe of the served page, whose own script opens a
 *      WebSocket back and sends a line, which is the Fenix tablet app's route:
 *      it shows its web app from http://localhost:8083 (read in
 *      fnx-aircraft-320 2.4.0.4720, record/areas/aircraft/fenix-a320-family/
 *      study.md).
 * It reads back what each document saw, puts the server's log beside it, and
 * removes the iframe and closes the sockets. Nothing it adds sits in the
 * pilot's input path.
 *
 * Needs a flight loaded, so the EFB's and the cockpit's documents exist.
 */

import { createHash } from "node:crypto"
import { createServer } from "node:http"

import { Inspector, listPages } from "../../tools/inspector.mjs"
import { repoRelative, saveResult } from "../../tools/results.mjs"

const PORT = 47_806
const WAIT_MS = 6000
const log = []
const note = (text) => { const line = `${new Date().toISOString().slice(11, 23)} ${text}`; log.push(line); console.log(line) }

// ---------------------------------------------------------------- the server

const PAGE = (from) => `<!doctype html><html><body><script>
var s = new WebSocket("ws://127.0.0.1:${PORT}/?from=" + encodeURIComponent(${JSON.stringify(`${from} (iframe)`)}));
s.onopen = function () { s.send("hello from the iframe"); };
</script></body></html>`

// A WebSocket server's minimum, from RFC 6455: the accept key, and text frames
// in both directions, the client's masked and ours not.
function accept(key) {
  return createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
}

function frame(text) {
  const body = Buffer.from(text)
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
  return Buffer.concat([head, body])
}

function readFrames(buf, onText) {
  let o = 0
  while (buf.length - o >= 2) {
    const op = buf[o] & 0x0f
    let len = buf[o + 1] & 0x7f
    let p = o + 2
    if (len === 126) { len = buf.readUInt16BE(p); p += 2 }
    else if (len === 127) return buf.length
    const masked = (buf[o + 1] & 0x80) !== 0
    const mask = masked ? buf.subarray(p, p + 4) : null
    if (masked) p += 4
    if (buf.length < p + len) break
    const data = Buffer.from(buf.subarray(p, p + len))
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4]
    if (op === 1) onText(data.toString("utf8"))
    o = p + len
  }
  return o
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const from = url.searchParams.get("from") ?? "?"
  note(`HTTP ${req.method} ${url.pathname} from ${from} (origin ${req.headers.origin ?? "none"})`)
  if (url.pathname === "/page") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE(from)); return }
  res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" })
  res.end("crosscheck p06")
})

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const from = url.searchParams.get("from") ?? "?"
  note(`WebSocket from ${from} (origin ${req.headers.origin ?? "none"})`)
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept(req.headers["sec-websocket-key"])}\r\n\r\n`)
  let pending = Buffer.alloc(0)
  socket.on("data", (d) => {
    pending = Buffer.concat([pending, d])
    const used = readFrames(pending, (text) => { note(`WebSocket ${from} said: ${text}`); socket.write(frame(`echo: ${text}`)) })
    pending = pending.subarray(used)
  })
  socket.on("error", () => {})
})

// ---------------------------------------------------------------- in each document

// Runs in the document: Chrome 49's syntax, no optional chaining or ??.
const TRY = (from) => `(function () {
  var r = window.CROSSCHECK_P06 = { from: ${JSON.stringify(from)}, ws: "not tried", wsEcho: null, xhr: "not tried", iframe: "not tried", errors: [] };
  try {
    var s = new WebSocket("ws://127.0.0.1:${PORT}/?from=" + encodeURIComponent(r.from));
    r.ws = "connecting";
    s.onopen = function () { r.ws = "open"; s.send("hello from " + r.from); };
    s.onmessage = function (e) { r.wsEcho = String(e.data); };
    s.onerror = function () { r.ws = "error"; };
    s.onclose = function (e) { if (r.ws !== "open") r.ws = "closed " + e.code; };
    r.socket = s;
  } catch (e) { r.ws = "threw"; r.errors.push("ws: " + e.message); }
  try {
    var x = new XMLHttpRequest();
    x.open("GET", "http://127.0.0.1:${PORT}/ping?from=" + encodeURIComponent(r.from));
    x.onload = function () { r.xhr = "status " + x.status + ": " + x.responseText; };
    x.onerror = function () { r.xhr = "error"; };
    x.send();
    r.xhr = "sent";
  } catch (e) { r.xhr = "threw"; r.errors.push("xhr: " + e.message); }
  try {
    var f = document.createElement("iframe");
    f.style.cssText = "position:absolute;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0";
    f.onload = function () { r.iframe = "loaded"; };
    f.src = "http://127.0.0.1:${PORT}/page?from=" + encodeURIComponent(r.from);
    document.body.appendChild(f);
    r.frame = f;
    r.iframe = "added";
  } catch (e) { r.iframe = "threw"; r.errors.push("iframe: " + e.message); }
  return "started";
})()`

const READ = `(function () {
  var r = window.CROSSCHECK_P06;
  if (!r) return null;
  return { ws: r.ws, wsEcho: r.wsEcho, xhr: r.xhr, iframe: r.iframe, errors: r.errors };
})()`

const CLEAN = `(function () {
  var r = window.CROSSCHECK_P06;
  if (!r) return "nothing";
  try { if (r.socket) r.socket.close(); } catch (e) {}
  try { if (r.frame && r.frame.parentNode) r.frame.parentNode.removeChild(r.frame); } catch (e) {}
  window.CROSSCHECK_P06 = undefined;
  return "cleaned";
})()`

function pick(pages) {
  const title = (p) => String(p.title || "")
  const url = (p) => String(p.url || "")
  const out = []
  const efb = pages.find((p) => title(p) === "Electronic Flight Bag")
  if (efb) out.push(["the EFB", efb])
  for (const p of pages.filter((q) => /InGamePanels/i.test(url(q)) || /toolbar/i.test(title(q))).slice(0, 4)) out.push([`in-game panel or toolbar: ${title(p) || url(p)}`, p])
  const cockpit = pages.find((p) => /^VCockpit/i.test(title(p)))
  if (cockpit) out.push([`cockpit control: ${title(cockpit)}`, cockpit])
  return out
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve))
  note(`serving on 127.0.0.1:${PORT}`)
  const pages = await listPages()
  note(`${pages.length} documents: ${pages.map((p) => p.title || p.url).join(" | ")}`)
  const targets = pick(pages)
  if (!targets.length) throw new Error("no EFB, in-game panel, or cockpit document; is a flight loaded?")

  const results = []
  for (const [label, page] of targets) {
    const insp = new Inspector(page.id)
    try {
      await insp.open()
      const started = await insp.evaluate(TRY(label))
      note(`${label}: ${JSON.stringify(started)}`)
      results.push({ label, page, insp })
    } catch (e) {
      note(`${label}: couldn't run: ${e.message}`)
      insp.close()
    }
  }
  await new Promise((r) => setTimeout(r, WAIT_MS))
  const lines = [`p06-websocket, ${new Date().toISOString()}`, ""]
  for (const r of results) {
    let seen
    try { seen = await r.insp.evaluate(READ) } catch (e) { seen = { error: e.message } }
    try { await r.insp.evaluate(CLEAN) } catch { /* the document may have gone */ }
    r.insp.close()
    lines.push(`${r.label} (page ${r.page.id}): ${JSON.stringify(seen)}`)
  }
  lines.push("", "Server log:", ...log)
  const file = saveResult("interface", "p06-websocket", lines.join("\n"))
  console.log("\n" + lines.join("\n"))
  console.log(`saved ${repoRelative(file)}`)
  server.close()
  process.exit(0)
}

main().catch((e) => {
  console.error(e.stack ?? String(e))
  server.close()
  process.exit(1)
})
