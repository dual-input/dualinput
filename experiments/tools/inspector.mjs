/*
 * A driver for the WebKit inspector that MSFS 2024 hosts on 127.0.0.1:19999.
 * It runs any JavaScript in any panel document, with DevMode off (measured on
 * MSFS 2024, 2026-09-01, FS Copilot fork, record/pointer-forwarding/docs/
 * 06-open-questions.md, Q00).
 *
 *   GET /pagelist.json                     the inspectable documents
 *   ws://127.0.0.1:19999/devtools/page/N   the inspector protocol for one of them
 *
 * The sim assigns page ids, and they change between sessions and aircraft, so
 * select by title. A panel's title is `VCockpitNN - <instrumentIdentifier>`.
 * Some aircraft reuse an identifier across panels: the A220's two CTPs are both
 * `CTP`, so select those by id (FS Copilot fork, record/pointer-forwarding/docs/
 * build/log.md, "2026-08-30 - A220 panel identifiers collide, and MKP is not
 * interactive").
 *
 * Node 22 has a global WebSocket, so this needs no dependencies.
 */

import { createConnection } from "node:net"

const HOST = "127.0.0.1"
const PORT = 19999

function httpGet(path, ms = 5000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const sock = createConnection({ host: HOST, port: PORT })
    sock.setTimeout(ms)
    sock.on("connect", () =>
      sock.write(`GET ${path} HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nConnection: close\r\n\r\n`))
    sock.on("data", (d) => chunks.push(d))
    sock.on("timeout", () => { sock.destroy(); finish() })
    sock.on("error", reject)
    sock.on("close", finish)
    function finish() {
      const raw = Buffer.concat(chunks).toString("utf8")
      const at = raw.indexOf("\r\n\r\n")
      if (at === -1) return reject(new Error(`no response body from ${path}`))
      resolve({ head: raw.slice(0, at), body: raw.slice(at + 4) })
    }
  })
}

// An addon's process that outlives the sim can inherit port 19999. It accepts the
// connection and answers nothing, which looks like a server refusing the protocol
// (FS Copilot fork, record/pointer-forwarding/docs/build/log.md, "2026-08-30 — The
// port was squatted by a dead process's inherited socket").
export const NOT_LISTENING_HINT =
  "Nothing answered on 127.0.0.1:19999. Either the sim isn't running or hasn't finished\n" +
  "loading, or a dead process holds the port: check which process owns it before\n" +
  "reading anything into the silence."

export async function listPages() {
  let body
  try {
    ({ body } = await httpGet("/pagelist.json"))
  } catch (e) {
    throw new Error(`${e.message}\n\n${NOT_LISTENING_HINT}`)
  }
  return JSON.parse(body)
}

// Refuses an ambiguous match, because the wrong panel gives a meaningless result
// rather than a weaker one.
export function selectPage(pages, sel) {
  if (typeof sel === "number" || /^\d+$/.test(sel)) {
    const id = Number(sel)
    const hit = pages.find((p) => p.id === id)
    if (!hit) throw new Error(`no page with id ${id}`)
    return hit
  }
  const needle = String(sel).toLowerCase()
  const hits = pages.filter((p) => String(p.title || "").toLowerCase().includes(needle))
  if (!hits.length) throw new Error(`no page whose title contains ${JSON.stringify(sel)}`)
  if (hits.length > 1) {
    throw new Error(
      `${JSON.stringify(sel)} matches ${hits.length} pages, so give an id:\n` +
      hits.map((p) => `  ${String(p.id).padStart(3)}  ${p.title}`).join("\n"))
  }
  return hits[0]
}

export class Inspector {
  constructor(pageId) {
    this.pageId = pageId
    this.ws = null
    this.seq = 0
    this.pending = new Map()
    this.handlers = new Map()
  }

  // The sim sends a domain's events only after its enable call, such as
  // Console.enable, so a handler without one hears nothing.
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(fn)
    return this
  }

  open(ms = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${HOST}:${PORT}/devtools/page/${this.pageId}`)
      this.ws = ws
      const timer = setTimeout(() => reject(new Error("inspector connect timed out")), ms)
      ws.onopen = () => { clearTimeout(timer); resolve(this) }
      ws.onerror = () => { clearTimeout(timer); reject(new Error("inspector connection failed")) }
      ws.onclose = () => {
        for (const [, p] of this.pending) p.reject(new Error("inspector connection closed"))
        this.pending.clear()
      }
      ws.onmessage = (e) => {
        let msg
        try { msg = JSON.parse(String(e.data)) } catch { return }
        if (msg.id == null) {
          const fns = this.handlers.get(msg.method)
          if (fns) for (const fn of fns) {
            try { fn(msg.params || {}) } catch { /* one bad handler mustn't close the socket */ }
          }
          return
        }
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        p.resolve(msg)
      }
    })
  }

  send(method, params, ms = 20000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${ms}ms`))
      }, ms)
      this.pending.set(id, {
        resolve: (m) => { clearTimeout(timer); resolve(m) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })
      this.ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
  }

  // Throws when the page throws, so a probe that failed can't pass for one that
  // returned undefined.
  async evaluate(expression, { returnByValue = true } = {}) {
    const msg = await this.send("Runtime.evaluate", {
      expression,
      returnByValue,
      includeCommandLineAPI: true,
      doNotPauseOnExceptionsAndMuteConsoleAPI: false
    })
    if (msg.error) throw new Error(`inspector error: ${JSON.stringify(msg.error)}`)
    const r = msg.result || {}
    if (r.wasThrown) {
      const d = (r.result && (r.result.description || r.result.value)) || "unknown"
      throw new Error(`page threw: ${d}`)
    }
    return r.result ? r.result.value : undefined
  }

  close() { try { this.ws && this.ws.close() } catch { /* already closed */ } }
}

// A panel's console.* goes to the sim's log, not to us, so this buffers it where
// drain() can read it back. Don't use the inspector's Console domain to carry data:
// it drops a message identical to the one before it (FS Copilot fork,
// record/pointer-forwarding/docs/build/log.md, "2026-08-30 - The console channel
// silently drops repeated messages").
// This runs in the panel, so it's written for Chrome 49.
export const CAPTURE_SHIM = `
(function () {
  if (window.CROSSCHECK_LOG) { window.CROSSCHECK_LOG.length = 0; return "reused" }
  var buf = window.CROSSCHECK_LOG = []
  var native = { log: console.log, warn: console.warn, error: console.error }
  window.CROSSCHECK_LOG_NATIVE = native
  function cap(kind, fn) {
    return function () {
      try {
        var parts = []
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i]
          if (typeof a === "string") parts.push(a)
          else if (a instanceof Error) parts.push(String(a))
          else { try { parts.push(JSON.stringify(a)) } catch (e) { parts.push(String(a)) } }
        }
        buf.push((kind === "log" ? "" : "[" + kind + "] ") + parts.join(" "))
      } catch (e) { /* never break the page */ }
      try { fn.apply(console, arguments) } catch (e) {}
    }
  }
  console.log = cap("log", native.log)
  console.warn = cap("warn", native.warn)
  console.error = cap("error", native.error)
  return "installed"
})()`

// A probe can keep working after evaluate() returns, on timers or listeners, so
// this waits `settle` ms before reading what it printed.
export async function runProbe(insp, source, { settle = 2500 } = {}) {
  await insp.evaluate(CAPTURE_SHIM)
  await insp.evaluate(`(function(){ try { eval(${JSON.stringify(source)}); return "ok" } catch (e) { console.error("probe threw: " + e); return "threw" } })()`)
  await new Promise((r) => setTimeout(r, settle))
  return drain(insp)
}

export async function drain(insp) {
  const out = await insp.evaluate(`(function(){ var b = window.CROSSCHECK_LOG || []; var s = b.join("\\n"); b.length = 0; return s })()`)
  return out || ""
}

// Flattens a Page.getResourceTree result. Child frames carry their own resources.
export function flattenResources(node, out = [], depth = 0) {
  const frameId = node.frame.id
  out.push({ frameId, depth, url: node.frame.url, type: "Frame", mimeType: "", isFrame: true })
  for (const r of node.resources || []) out.push({ ...r, frameId, depth })
  for (const c of node.childFrames || []) flattenResources(c, out, depth + 1)
  return out
}

export async function loadedScripts(insp) {
  await insp.send("Page.enable", {})
  const tree = await insp.send("Page.getResourceTree", {})
  const items = flattenResources(tree.result.frameTree)
  return items.filter((r) => /script/i.test(r.type) || /javascript/i.test(r.mimeType))
}

export async function resourceContent(insp, resource) {
  const c = await insp.send("Page.getResourceContent", { frameId: resource.frameId, url: resource.url })
  if (c.error) throw new Error(JSON.stringify(c.error))
  return (c.result && c.result.content) || ""
}
