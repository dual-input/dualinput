/*
 * Calculator code in the sim, through fsc-editor's Link WASM module, which is
 * installed in Community as fsc-editor-link and loads with the sim.
 *
 *   const link = new Link(sim)
 *   await link.exec("(A:PLANE ALTITUDE, feet)")   → { ok: true, value: 177.9 }
 *   await link.exec("1 (>L:Battery1Switch)")      → { ok: true, value: 0 }
 *   await link.fire("H:A2A_BATTERY_1_SWITCH")     → (>H:A2A_BATTERY_1_SWITCH)
 *   await link.setL("CROSSCHECK_PROBE", 1)
 *
 * The wire, copied from fsc-editor, src/shared/link.ts, which that repository
 * keeps in step with link/src/module.cpp: the harness writes the line
 * `exec <token> <code>` into the client data area FSCEDITOR_LINK_CMD, 8,192
 * bytes, NUL-padded; the module runs the code and writes a message into
 * FSCEDITOR_LINK_OUT whose first line is `exec <seq> <remaining>` and whose
 * next is `<token> ok|err <value>`. `ok` is the calculator's verdict that the
 * code parsed and ran, not that a write landed anywhere, and the value is what
 * the code left on the stack, 0 for a write. A first exec answered `ok -> 0`
 * on the PA-24 (fsc-editor, docs/sim-vars/build/v1-log.md, "2026-08-25 — The
 * wire runs calculator code, and `gauges.h` came back clean").
 *
 * The command area holds one command, so exec() sends one at a time and waits
 * for its reply before the next. The output area is a broadcast every client
 * reads, so a reply is ours only when its token is: tokens start at a number
 * fsc-editor's own tools don't use.
 */

import { sleep } from "./out.mjs"

export const LINK_OUT = "FSCEDITOR_LINK_OUT"
export const LINK_CMD = "FSCEDITOR_LINK_CMD"
export const LINK_AREA_BYTES = 8192

// From fsc-editor, src/shared/link.ts, parseLinkMessage and parseExecLine.
function parseMessage(raw) {
  const text = raw.replace(/\0[\s\S]*$/, "")
  const newline = text.indexOf("\n")
  if (newline < 0) return null
  const [kind, seq, remaining] = text.slice(0, newline).split(" ")
  if (!kind || !Number.isFinite(Number(seq)) || !Number.isFinite(Number(remaining))) return null
  return { kind, lines: text.slice(newline + 1).split("\n").filter((l) => l.length > 0) }
}

function parseExec(line) {
  const [token, status, value] = line.split(" ")
  const t = Number(token)
  if (!Number.isInteger(t) || t < 0 || (status !== "ok" && status !== "err")) return null
  const v = Number(value)
  return { token: t, ok: status === "ok", value: Number.isFinite(v) ? v : 0 }
}

export class Link {
  constructor(sim) {
    this.sim = sim
    this.rec = sim.rec
    this.token = 7_000_000 + (Date.now() % 100_000) * 10
    this.waiting = new Map()
    this.queue = Promise.resolve()
    this.attached = false
    this.answered = 0
  }

  attach() {
    if (this.attached) return
    this.attached = true
    this.out = this.sim.watchClientData(LINK_OUT, LINK_AREA_BYTES, (bytes) => this.onOut(bytes))
    this.cmd = { id: this.sim.clientDataId(LINK_CMD), def: this.sim.clientDataDef(LINK_CMD, 0, LINK_AREA_BYTES) }
  }

  onOut(bytes) {
    const msg = parseMessage(bytes.toString("utf8"))
    if (!msg) return
    if (msg.kind === "names" || msg.kind === "values" || msg.kind === "hello") return this.onStream(msg)
    if (msg.kind !== "exec") return
    for (const line of msg.lines) {
      const r = parseExec(line)
      const fn = r && this.waiting.get(r.token)
      if (fn) { this.waiting.delete(r.token); fn(r) }
    }
  }

  // { ok, value } from the module, or { ok: false, error } when it can't be
  // sent or nothing answers in time, which is how a missing module looks.
  exec(code, { timeoutMs = 3000, quiet = false } = {}) {
    const run = this.queue.then(() => this.execNow(code, timeoutMs, quiet))
    this.queue = run.catch(() => {})
    return run
  }

  async execNow(code, timeoutMs, quiet) {
    this.attach()
    const token = this.token++
    const line = `exec ${token} ${code}`
    if (code.includes("\0") || Buffer.byteLength(line, "utf8") >= LINK_AREA_BYTES) {
      return { ok: false, error: "too long for the 8 KB area, or holds a NUL" }
    }
    const payload = Buffer.alloc(LINK_AREA_BYTES)
    payload.write(line, 0, "utf8")
    const t0 = Date.now()
    const reply = new Promise((resolve) => {
      this.waiting.set(token, resolve)
      setTimeout(() => {
        if (this.waiting.delete(token)) resolve({ ok: false, error: `no reply in ${timeoutMs}ms; is fsc-editor-link in Community?` })
      }, timeoutMs)
    })
    this.sim.send(`link exec ${token}`, () => this.sim.handle.setClientData(this.cmd.id, this.cmd.def, 0, 0, LINK_AREA_BYTES, payload))
    const r = await reply
    if (r.ok !== undefined && r.token !== undefined) this.answered++
    const text = `${code} → ${r.error ? r.error : `${r.ok ? "ok" : "err"} ${r.value}`} (${Date.now() - t0}ms)`
    if (quiet) this.rec.data("link", text, { code, ...r, ms: Date.now() - t0 })
    else this.rec.log("link", text, { code, ...r, ms: Date.now() - t0 })
    // The module reads its command area once per frame, so a second command
    // written within one frame of a reply could land before the module has
    // looked. 30ms is two frames at 60 fps (unmeasured margin).
    await sleep(30)
    return r
  }

  // Every L: variable in the sim, by the module's own stream: after `start` it
  // sends the names it enumerated, then, 15 times a second, every value that
  // moved by more than 1e-6 since its last read; `rescan` appends names
  // registered since, without re-reporting values (fsc-editor,
  // link/src/module.cpp, k_interval_seconds and k_deadband, and the `start` and
  // `rescan` commands). onNames gets [{ id, name }], onValues [{ id, value }]
  // with the arrival time, and onHello { version, protocol, count }.
  stream({ onNames = null, onValues = null, onHello = null } = {}) {
    this.attach()
    this.handlers = { onNames, onValues, onHello }
    this.command("start")
    return {
      rescan: () => this.command("rescan", { quiet: true }),
      stop: () => { this.handlers = null; return this.command("stop") },
    }
  }

  onStream(msg) {
    const h = this.handlers
    if (!h) return
    const t = Date.now()
    if (msg.kind === "hello") {
      const [version, protocol, count] = (msg.lines[0] ?? "").split(" ")
      h.onHello?.({ version, protocol: Number(protocol), count: Number(count) }, t)
      return
    }
    const out = []
    for (const line of msg.lines) {
      const space = line.indexOf(" ")
      if (space <= 0) continue
      const id = Number(line.slice(0, space))
      if (!Number.isInteger(id) || id < 0) continue
      if (msg.kind === "names") out.push({ id, name: line.slice(space + 1) })
      else {
        const value = Number(line.slice(space + 1))
        if (Number.isFinite(value)) out.push({ id, value })
      }
    }
    if (msg.kind === "names") h.onNames?.(out, t)
    else h.onValues?.(out, t)
  }

  // A bare command, such as `start`, through the same queue as exec, because
  // the command area holds one command at a time.
  command(line, { quiet = false } = {}) {
    const run = this.queue.then(async () => {
      this.attach()
      const payload = Buffer.alloc(LINK_AREA_BYTES)
      payload.write(line, 0, "utf8")
      this.sim.send(`link ${line}`, () => this.sim.handle.setClientData(this.cmd.id, this.cmd.def, 0, 0, LINK_AREA_BYTES, payload))
      if (!quiet) this.rec.log("link", `sent ${line}`)
      await sleep(30)
    })
    this.queue = run.catch(() => {})
    return run
  }

  fire(name, value = null) {
    const bare = name.replace(/^H:/i, "")
    return this.exec(`${value === null ? "" : `${value} `}(>H:${bare})`)
  }

  setL(name, value, units = "number") {
    const bare = name.replace(/^L:/i, "")
    return this.exec(`${value} (>L:${bare}, ${units})`)
  }

  async getL(name, units = "number") {
    const bare = name.replace(/^L:/i, "")
    const r = await this.exec(`(L:${bare}, ${units})`, { quiet: true })
    return r.ok ? r.value : null
  }

  stop() {
    this.out?.stop()
  }
}
