/*
 * p01: whether a Cloudflare Realtime TURN allocation stops relaying once it
 * has exchanged data with 10 distinct peer transport addresses (IP and port),
 * as cloudflare/cloudflare-docs issue 33972 reports (opened 2026-10-04, no
 * reply from Cloudflare). Cloudflare's TURN page states per-allocation rates,
 * ">5 new IP/sec" among them, and no total
 * (https://developers.cloudflare.com/realtime/turn/). Architecture node 2.1
 * (record/areas/architecture/plan.md) weighs one relayed peer per allocation
 * against ICE, which sends to several.
 *
 *   node experiments/areas/network/p01-turn-peer-cap.mjs
 *   node experiments/areas/network/p01-turn-peer-cap.mjs --idle
 *   node experiments/areas/network/p01-turn-peer-cap.mjs --phases=7
 *
 * It runs phases 1-5, 7, and 8, then 6 with --idle, or the ones --phases names;
 * phases 2 and 6 run 1 first, because they use its allocation.
 *
 * It needs a Cloudflare TURN key: TURN_KEY_ID and TURN_KEY_API_TOKEN in the
 * environment, or those two lines in %USERPROFILE%\.crosscheck\cloudflare-turn.env,
 * outside the tree. It mints credentials that outlive the run by a few
 * minutes, and revokes them at the end.
 *
 * The TURN client is written here, on UDP, rather than taken from
 * turn-client-proto, so every request goes out as written and every error
 * comes back verbatim, with no library deciding which peers it may address.
 *
 * Peers are UDP sockets on this PC. Cloudflare refuses permissions for private
 * addresses (https://developers.cloudflare.com/realtime/turn/faq/), so each
 * peer sends to the relayed address through the router, which gives it its own
 * public port on our public IP, and a STUN query per socket shows that port.
 * Phases:
 *   1. A1: P01 sends once a second throughout, and P02-P15 join 2s apart with
 *      4 datagrams each (the issue's test 1).
 *   2. A1 sends to each peer by Send indication, binds a channel to each,
 *      sends on the channels, and hears from each peer again; then it
 *      refreshes and hears from P16.
 *   3. A2, a fresh allocation, hears from P15-P01, in that order.
 *   4. A3 hears from 20 new peers at once (the issue's test 3); then A3 is
 *      deleted and allocated again on the same socket, and hears from 12.
 *   5. A4 hears from other Cloudflare allocations' relayed addresses, our only
 *      second source IP without a second internet connection, mixed with peers
 *      on our IP.
 *   6. With --idle, about 9 more minutes: A1 hears from an old peer and a new
 *      one 5.5 and 10.5 minutes after P02-P16 went quiet, while it refreshes
 *      its allocation and its permission for our IP; A5 lets its permission
 *      lapse, hears from an old peer, grants it again, and hears from an old
 *      peer and a new one.
 *   7. A6 sends to 12 peers before hearing from any, and A7 binds channels to
 *      12 before any data, which is what ICE's checks from a relayed
 *      candidate do; each peer first opens its NAT toward the relay with a
 *      datagram that expires on the way (OPEN_TTL).
 *   8. A8 asks for the LIFETIMEs turn-client-proto asks for, and others, and
 *      records what Cloudflare grants; then it exchanges ChannelData, padded
 *      and not, with a peer, and with H8's relayed address.
 *
 * The report names every address by its role, never its number, so it can be
 * committed.
 */

import dgram from "node:dgram"
import { createHash, createHmac, randomBytes } from "node:crypto"
import { lookup } from "node:dns/promises"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { crc32 } from "node:zlib"

import { repoRelative, resultFile, stamp } from "../../tools/results.mjs"

const IDLE = process.argv.includes("--idle")
const PHASES = (process.argv.find((a) => a.startsWith("--phases="))?.slice(9).split(",") ?? [1, 2, 3, 4, 5, 7, 8, ...(IDLE ? [6] : [])]).map(Number)
const TTL_S = PHASES.includes(6) ? 1500 : 600
const API = "https://rtc.live.cloudflare.com/v1/turn/keys"
const KEY_FILE = join(homedir(), ".crosscheck", "cloudflare-turn.env")
const BURST = 4 // datagrams per peer per round, as in the issue
const GAP_MS = 250 // between one peer's datagrams
const SETTLE_MS = 2000 // after the last datagram, before counting
const KEEP_MS = 120_000 // Refresh and CreatePermission, inside the 300s permission lifetime
// This PC's connection forgets an idle UDP mapping after between 120s and
// 150s (measured 2026-10-10 by asking STUN again after each idle interval),
// and Cloudflare never answered an allocation's Refresh sent after about 130s
// of silence. A peer quiet that long comes back on a new public port, which
// the relay counts as a new address. So every socket sends a Binding request
// this often, an allocation's to the TURN server and a peer's to the STUN
// server; the router maps a socket to one public port whatever the
// destination, and neither request touches a permission.
const NAT_KEEP_MS = 15_000

const started = Date.now()
const when = stamp()
const lines = []
const data = { probe: "p01-turn-peer-cap", idle: IDLE, phases: {} }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const out = (text = "") => { lines.push(text); console.log(redact(text)) }
const note = (text) => out(`t+${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s  ${text}`)

// ---------------------------------------------------------------- addresses by role

const roles = new Map()
function nameIp(ip, role) {
  if (!roles.has(ip)) roles.set(ip, role)
  return roles.get(ip)
}
function nextRole(prefix) {
  return `${prefix}-${[...roles.values()].filter((r) => r.startsWith(prefix)).length + 1}`
}
const ipRole = (ip) => roles.get(ip) ?? nameIp(ip, nextRole("other-ip"))
const show = (a) => (a ? `${ipRole(a.ip)}:${a.port}` : "-")
// Every line goes through this before it's printed or saved, so an address
// that reaches text some other way, such as in an error's reason phrase, still
// leaves as a role.
const redact = (text) => text.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, (ip) => ipRole(ip))

// ---------------------------------------------------------------- STUN and TURN messages (RFC 8489, RFC 8656)

const MAGIC = 0x2112a442
const T = { BINDING: 0x0001, ALLOCATE: 0x0003, REFRESH: 0x0004, CREATE_PERMISSION: 0x0008, CHANNEL_BIND: 0x0009, SEND: 0x0016, DATA: 0x0017 }
const A = {
  USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, CHANNEL_NUMBER: 0x000c, LIFETIME: 0x000d,
  XOR_PEER_ADDRESS: 0x0012, DATA: 0x0013, REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019, XOR_MAPPED_ADDRESS: 0x0020, FINGERPRINT: 0x8028,
}
const NAMES = { [T.ALLOCATE]: "Allocate", [T.REFRESH]: "Refresh", [T.CREATE_PERMISSION]: "CreatePermission", [T.CHANNEL_BIND]: "ChannelBind" }

function attr(type, value) {
  const b = Buffer.alloc(4 + value.length + ((4 - (value.length % 4)) % 4))
  b.writeUInt16BE(type, 0)
  b.writeUInt16BE(value.length, 2)
  value.copy(b, 4)
  return b
}
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }

function xorAddress({ ip, port }) {
  const b = Buffer.alloc(8)
  b[1] = 0x01
  b.writeUInt16BE(port ^ (MAGIC >>> 16), 2)
  b.writeUInt32BE((ip.split(".").reduce((n, o) => n * 256 + Number(o), 0) ^ MAGIC) >>> 0, 4)
  return b
}
function readXorAddress(v) {
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16)
  if (v[1] !== 0x01) return { ip: "ipv6", port }
  const n = (v.readUInt32BE(4) ^ MAGIC) >>> 0
  return { ip: [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."), port }
}

// The methods here are all below 0x10, so only the two class bits sit apart.
function encode(type, tid, attrs, key) {
  const header = (length) => {
    const h = Buffer.alloc(20)
    h.writeUInt16BE(type, 0)
    h.writeUInt16BE(length, 2)
    h.writeUInt32BE(MAGIC, 4)
    tid.copy(h, 8)
    return h
  }
  let body = Buffer.concat(attrs)
  if (key) body = Buffer.concat([body, attr(A.MESSAGE_INTEGRITY, createHmac("sha1", key).update(Buffer.concat([header(body.length + 24), body])).digest())])
  body = Buffer.concat([body, attr(A.FINGERPRINT, u32(crc32(Buffer.concat([header(body.length + 8), body])) ^ 0x5354554e))])
  return Buffer.concat([header(body.length), body])
}

function decode(buf) {
  if (buf.length < 20 || (buf[0] & 0xc0) !== 0 || buf.readUInt32BE(4) !== MAGIC) return null
  const type = buf.readUInt16BE(0)
  const end = Math.min(buf.length, 20 + buf.readUInt16BE(2))
  const msg = { type, klass: ((type & 0x0010) >> 4) | ((type & 0x0100) >> 7), tid: buf.subarray(8, 20), attrs: new Map() }
  for (let o = 20; o + 4 <= end; ) {
    const t = buf.readUInt16BE(o)
    const l = buf.readUInt16BE(o + 2)
    if (!msg.attrs.has(t)) msg.attrs.set(t, buf.subarray(o + 4, o + 4 + l))
    o += 4 + l + ((4 - (l % 4)) % 4)
  }
  return msg
}

function outcome(r) {
  if (!r) return "no response"
  if (r.klass === 2) return "ok"
  const v = r.attrs.get(A.ERROR_CODE)
  return v ? `${(v[2] & 7) * 100 + v[3]} "${v.subarray(4).toString("utf8")}"` : "error with no ERROR-CODE"
}
const errorCode = (r) => { const v = r?.klass === 3 && r.attrs.get(A.ERROR_CODE); return v ? (v[2] & 7) * 100 + v[3] : 0 }
const granted = (r) => (r?.klass === 2 ? r.attrs.get(A.LIFETIME)?.readUInt32BE(0) : undefined)
const refreshed = (r) => `${outcome(r)}${granted(r) === undefined ? "" : `, LIFETIME ${granted(r)}s`}`

// ---------------------------------------------------------------- sockets

class Endpoint {
  constructor(name) {
    this.name = name
    this.pending = new Map()
    this.socket = dgram.createSocket("udp4")
    this.socket.on("message", (buf, rinfo) => this.receive(buf, { ip: rinfo.address, port: rinfo.port }))
    this.socket.on("error", (e) => note(`${this.name}: socket error ${e.code ?? e.message}`))
  }
  bind() { return new Promise((resolve) => this.socket.bind(0, resolve)) }
  close() { try { this.socket.close() } catch {} }
  get localPort() { return this.socket.address().port }
  receive(buf, from) {
    const msg = decode(buf)
    if (msg && msg.klass >= 2) {
      const key = msg.tid.toString("hex")
      const p = this.pending.get(key)
      if (p) { this.pending.delete(key); clearTimeout(p.timer); p.resolve(msg) }
      return
    }
    this.other(buf, from, msg)
  }
  other() {}
  // UDP loses requests too, so a request goes again after 0.5, 1.5, 3.5, and
  // 5.5s, RFC 8489's schedule cut short, and a silent server reads as null.
  transact(to, build) {
    const tid = randomBytes(12)
    const key = tid.toString("hex")
    const buf = build(tid)
    const waits = [500, 1000, 2000, 2000, 2000]
    return new Promise((resolve) => {
      const p = { resolve, timer: null }
      const fire = (i) => {
        this.socket.send(buf, to.port, to.ip)
        p.timer = setTimeout(() => {
          if (i + 1 < waits.length) fire(i + 1)
          else { this.pending.delete(key); resolve(null) }
        }, waits[i])
      }
      this.pending.set(key, p)
      fire(0)
    })
  }
}

class Peer extends Endpoint {
  constructor(name) { super(name); this.got = []; this.mapped = null }
  async map(stun) {
    const v = (await this.transact(stun, (tid) => encode(T.BINDING, tid, [])))?.attrs.get(A.XOR_MAPPED_ADDRESS)
    this.mapped = v ? readXorAddress(v) : null
  }
  other(buf, from) { this.got.push({ text: buf.toString("utf8"), from }) }
  send(to, text) { this.socket.send(Buffer.from(text), to.port, to.ip) }
  count(alloc, round) { return this.got.filter((g) => g.text.startsWith(`p01|${alloc}|${round}|${this.name}|`)).length }
}

class Turn extends Endpoint {
  constructor(name, server, creds) {
    super(name)
    this.server = server
    this.creds = creds
    this.alloc = name
    this.received = []
    this.channels = new Map()
  }
  other(buf, from, msg) {
    if (msg?.type === T.DATA) {
      const v = msg.attrs.get(A.XOR_PEER_ADDRESS)
      const d = msg.attrs.get(A.DATA)
      if (v && d) this.received.push({ text: d.toString("utf8"), from: readXorAddress(v), via: "Data indication" })
      return
    }
    if (buf.length >= 4 && buf[0] >= 0x40 && buf[0] <= 0x7f) {
      const len = buf.readUInt16BE(2)
      this.received.push({ text: buf.subarray(4, 4 + len).toString("utf8"), from: this.channels.get(buf.readUInt16BE(0)), via: "ChannelData", len, pad: buf.length - 4 - len })
      return
    }
    note(`${this.name}: unexpected ${buf.length}-byte datagram from ${show(from)}`)
  }
  // Long-term credentials: the first Allocate draws a 401 with the realm and
  // nonce, and the key is MD5 of "username:realm:password".
  async allocate(label, lifetime) {
    this.alloc = label
    this.relayed = null
    const attrs = [attr(A.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]))]
    if (lifetime) attrs.push(attr(A.LIFETIME, u32(lifetime)))
    if (!this.key) {
      const r = await this.transact(this.server, (tid) => encode(T.ALLOCATE, tid, attrs))
      if (errorCode(r) !== 401) return r
      this.learn(r)
    }
    const r = await this.request(T.ALLOCATE, attrs)
    if (r?.klass === 2) {
      this.relayed = readXorAddress(r.attrs.get(A.XOR_RELAYED_ADDRESS))
      this.mapped = readXorAddress(r.attrs.get(A.XOR_MAPPED_ADDRESS))
      this.lifetime = r.attrs.get(A.LIFETIME)?.readUInt32BE(0)
    }
    return r
  }
  learn(r) {
    const realm = r.attrs.get(A.REALM)
    const nonce = r.attrs.get(A.NONCE)
    if (realm) this.realm = Buffer.from(realm)
    if (nonce) this.nonce = Buffer.from(nonce)
    this.key = createHash("md5").update(`${this.creds.username}:${this.realm.toString("utf8")}:${this.creds.password}`).digest()
  }
  // A 438 Stale Nonce, or a 401 that carries a new nonce, gets one retry.
  async request(type, attrs) {
    let r = null
    for (let attempt = 0; attempt < 2; attempt++) {
      const auth = [attr(A.USERNAME, Buffer.from(this.creds.username)), attr(A.REALM, this.realm), attr(A.NONCE, this.nonce)]
      r = await this.transact(this.server, (tid) => encode(type, tid, [...attrs, ...auth], this.key))
      if ((errorCode(r) === 438 || errorCode(r) === 401) && r.attrs.get(A.NONCE)) { this.learn(r); continue }
      return r
    }
    return r
  }
  permit(addr) { return this.request(T.CREATE_PERMISSION, [attr(A.XOR_PEER_ADDRESS, xorAddress(addr))]) }
  refresh(seconds) { return this.request(T.REFRESH, [attr(A.LIFETIME, u32(seconds))]) }
  bindChannel(ch, addr) { return this.request(T.CHANNEL_BIND, [attr(A.CHANNEL_NUMBER, u32(ch << 16)), attr(A.XOR_PEER_ADDRESS, xorAddress(addr))]) }
  sendIndication(to, text) {
    this.socket.send(encode(T.SEND, randomBytes(12), [attr(A.XOR_PEER_ADDRESS, xorAddress(to)), attr(A.DATA, Buffer.from(text))]), this.server.port, this.server.ip)
  }
  // Over UDP, RFC 8656 makes the padding to a multiple of 4 optional.
  channelData(ch, text, padded = true) {
    const d = Buffer.from(text)
    const b = Buffer.alloc(4 + d.length + (padded ? (4 - (d.length % 4)) % 4 : 0))
    b.writeUInt16BE(ch, 0)
    b.writeUInt16BE(d.length, 2)
    d.copy(b, 4)
    this.socket.send(b, this.server.port, this.server.ip)
  }
  hits(round, name, alloc = this.alloc) { return this.received.filter((r) => r.text.startsWith(`p01|${alloc}|${round}|${name}|`)) }
}

// ---------------------------------------------------------------- credentials

function loadKey() {
  let id = process.env.TURN_KEY_ID
  let token = process.env.TURN_KEY_API_TOKEN
  if ((!id || !token) && existsSync(KEY_FILE)) {
    for (const line of readFileSync(KEY_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(TURN_KEY_ID|TURN_KEY_API_TOKEN)\s*=\s*["']?(.*?)["']?\s*$/)
      if (m?.[1] === "TURN_KEY_ID") id ||= m[2]
      if (m?.[1] === "TURN_KEY_API_TOKEN") token ||= m[2]
    }
  }
  if (!id || !token) {
    console.error(`No TURN key: set TURN_KEY_ID and TURN_KEY_API_TOKEN, or write them to ${KEY_FILE.replace(homedir(), "%USERPROFILE%")}.`)
    process.exit(2)
  }
  return { id, token }
}

async function mint(key) {
  const res = await fetch(`${API}/${key.id}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: TTL_S }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`generate-ice-servers: HTTP ${res.status} ${body.slice(0, 300)}`)
  const ice = [].concat(JSON.parse(body).iceServers).find((s) => s.username)
  const urls = [].concat(ice.urls)
  const url = urls.find((u) => /^turn:[^?]+:3478\?transport=udp$/.test(u)) ?? urls.find((u) => /^turn:.*transport=udp/.test(u))
  const [, host, port] = url.match(/^turn:([^:?]+):(\d+)/)
  note(`credentials: HTTP ${res.status}, ${urls.length} URLs, using ${url}, ttl ${TTL_S}s`)
  return { username: ice.username, password: ice.credential, host, port: Number(port) }
}

async function revoke(key, creds) {
  try {
    const res = await fetch(`${API}/${key.id}/credentials/${encodeURIComponent(creds.username)}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key.token}` },
    })
    note(`credentials revoked: HTTP ${res.status}`)
  } catch (e) {
    note(`credentials not revoked: ${e.message}`)
  }
}

// ---------------------------------------------------------------- probe steps

let server, stun, creds, ourIp
const allocations = []
const sockets = []
const timers = []

function table(headers, rows) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
  const line = (r) => "    " + r.map((c, i) => String(c).padEnd(w[i])).join("  ").trimEnd()
  out(line(headers))
  out(line(w.map((n) => "-".repeat(n))))
  for (const r of rows) out(line(r))
}

async function makePeers(prefix, from, to) {
  const peers = []
  for (let i = from; i <= to; i++) peers.push(new Peer(`${prefix}${String(i).padStart(2, "0")}`))
  sockets.push(...peers)
  await Promise.all(peers.map((p) => p.bind()))
  await Promise.all(peers.map((p) => p.map(stun)))
  if (!ourIp && peers[0].mapped) { ourIp = peers[0].mapped.ip; nameIp(ourIp, "our-ip") }
  const ips = new Set(peers.map((p) => (p.mapped ? ipRole(p.mapped.ip) : "no answer")))
  const ports = new Set(peers.map((p) => p.mapped?.port))
  note(`${peers[0].name}-${peers.at(-1).name}: STUN mapped them to ${[...ips].join(", ")}, ${ports.size} distinct public ports for ${peers.length} sockets`)
  data.mappings = (data.mappings ?? []).concat(peers.map((p) => ({ peer: p.name, local: p.localPort, mapped: show(p.mapped) })))
  return peers
}

async function newAllocation(label) {
  const t = new Turn(label, server, creds)
  sockets.push(t)
  await t.bind()
  return allocateOn(t, label)
}

async function allocateOn(t, label, lifetime) {
  const r = await t.allocate(label, lifetime)
  if (t.relayed) nameIp(t.relayed.ip, nextRole("relay-ip"))
  if (!ourIp && t.mapped) { ourIp = t.mapped.ip; nameIp(ourIp, "our-ip") }
  note(`${label}: Allocate${lifetime ? ` asking LIFETIME ${lifetime}s` : ""} ${outcome(r)}${t.relayed ? `, relayed ${show(t.relayed)}, mapped ${show(t.mapped)}, LIFETIME ${t.lifetime}s` : ""}`)
  if (!t.relayed) throw new Error(`${label}: no allocation`)
  allocations.push(t)
  return t
}

async function permit(t, addr) {
  const o = outcome(await t.permit(addr))
  note(`${t.alloc}: CreatePermission for ${ipRole(addr.ip)}: ${o}`)
  return o
}

async function drop(t) {
  const o = outcome(await t.refresh(0))
  note(`${t.alloc}: Refresh with LIFETIME 0 (delete): ${o}`)
  const i = allocations.indexOf(t)
  if (i >= 0) allocations.splice(i, 1)
  return o
}

async function burst(peer, t, round, n = BURST) {
  for (let i = 1; i <= n; i++) {
    const text = `p01|${t.alloc}|${round}|${peer.name}|${i}`
    if (peer instanceof Turn) peer.sendIndication(t.relayed, text)
    else peer.send(t.relayed, text)
    if (i < n) await sleep(GAP_MS)
  }
}

// Sends, waits half a second, and prints how many arrived, so the console
// shows the cap, if there is one, as it happens.
async function hear(peer, t, round, n = BURST) {
  await burst(peer, t, round, n)
  await sleep(500)
  const hits = t.hits(round, peer.name)
  note(`${peer.name} -> ${t.alloc}: ${hits.length}/${n}${hits[0] ? ` via ${hits[0].via}, relay saw ${show(hits[0].from)}` : ""}`)
}

function tally(t, round, peers, n = BURST, alloc = t.alloc) {
  const rows = peers.map((p) => {
    const hits = t.hits(round, p.name, alloc)
    const source = p instanceof Turn ? p.relayed : p.mapped
    return {
      peer: p.name, from: show(source), sent: n, got: hits.length,
      via: [...new Set(hits.map((h) => h.via))].join(" + ") || "-",
      relaySaw: show(hits[0]?.from), stunPortMatches: hits[0] && !(p instanceof Turn) ? hits[0].from?.port === source?.port : null,
    }
  })
  table(["peer", "source", "sent", "got", "arrived as", "relay saw"], rows.map((r) => [r.peer, r.from, r.sent, r.got, r.via, r.relaySaw]))
  const through = rows.filter((r) => r.got > 0).map((r) => r.peer)
  const refused = rows.filter((r) => r.got === 0).map((r) => r.peer)
  out(`    ${through.length} of ${rows.length} got data through${refused.length ? `; nothing arrived from ${refused.join(", ")}` : ""}`)
  return { rows, through, refused }
}

// The address A1 has seen a peer at, or the one STUN reported if A1 never
// heard from it; phase 1 checks the two agree for the peers it heard.
const addrAt = (t, p) => t.received.find((r) => r.text.split("|")[3] === p.name)?.from ?? p.mapped

// ---------------------------------------------------------------- phases

let P, anchorSent = 0

async function phase1() {
  out()
  out("Phase 1: A1; P01 sends once a second throughout, and P02-P15 join 2s apart with 4 datagrams each")
  const a1 = await newAllocation("A1")
  await permit(a1, P[0].mapped)
  timers.push(setInterval(() => P[0].send(a1.relayed, `p01|A1|anchor|P01|${++anchorSent}`), 1000))
  for (const p of P.slice(1, 15)) {
    await hear(p, a1, "join")
    await sleep(2000 - GAP_MS * (BURST - 1) - 500)
  }
  await sleep(SETTLE_MS)
  const t = tally(a1, "join", P.slice(1, 15))
  const heard = t.rows.filter((r) => r.stunPortMatches !== null)
  out(`    the relay saw the STUN-mapped port for ${heard.filter((r) => r.stunPortMatches).length} of the ${heard.length} peers it heard from`)
  out(`    P01 anchor so far: ${a1.hits("anchor", "P01").length} of ${anchorSent} arrived`)
  data.phases.p1 = t
  return a1
}

async function phase2(a1) {
  out()
  out("Phase 2: A1 sends to P01-P15 by Send indication, binds a channel to each, sends on it, and hears from P02-P15 again")
  const peers = P.slice(0, 15)
  const addressed = new Map(peers.map((p) => [p.name, addrAt(a1, p)]))
  for (const p of peers) {
    for (let i = 1; i <= BURST; i++) a1.sendIndication(addressed.get(p.name), `p01|A1|send|${p.name}|${i}`)
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const binds = []
  for (const [i, p] of peers.entries()) {
    const ch = 0x4001 + i
    const o = outcome(await a1.bindChannel(ch, addressed.get(p.name)))
    if (o === "ok") a1.channels.set(ch, addressed.get(p.name))
    binds.push({ p, ch, o })
    note(`A1: ChannelBind 0x${ch.toString(16)} to ${p.name} at ${show(addressed.get(p.name))}: ${o}`)
  }
  for (const b of binds.filter((b) => b.o === "ok")) for (let i = 1; i <= BURST; i++) a1.channelData(b.ch, `p01|A1|chan|${b.p.name}|${i}`)
  await sleep(SETTLE_MS)
  for (const p of P.slice(1, 15)) await burst(p, a1, "again", 2)
  await sleep(SETTLE_MS)
  const rows = peers.map((p) => {
    const again = p === P[0] ? null : a1.hits("again", p.name)
    return {
      peer: p.name,
      addressedAs: (a1.hits("join", p.name).length || p === P[0]) ? "address relay saw" : "STUN-mapped",
      sendIndication: `${p.count("A1", "send")}/${BURST}`,
      channelBind: binds.find((b) => b.p === p).o,
      channelData: binds.find((b) => b.p === p).o === "ok" ? `${p.count("A1", "chan")}/${BURST}` : "-",
      again: again ? `${again.length}/2${again[0] ? ` ${again[0].via}` : ""}` : "(anchor)",
    }
  })
  table(["peer", "addressed as", "Send ind. arrived", "ChannelBind", "ChannelData arrived", "peer again -> A1"],
    rows.map((r) => [r.peer, r.addressedAs, r.sendIndication, r.channelBind, r.channelData, r.again]))
  out()
  note(`A1: Refresh with LIFETIME 600: ${refreshed(await a1.refresh(600))}`)
  await hear(P[15], a1, "after-refresh")
  data.phases.p2 = { rows, afterRefresh: { peer: "P16", got: a1.hits("after-refresh", "P16").length, sent: BURST } }
  // A1 stays for phase 6, so its allocation and its permission for our IP
  // are refreshed from here on; channels are left to expire.
  timers.push(setInterval(async () => {
    note(`A1 keepalive: Refresh ${refreshed(await a1.refresh(600))}, CreatePermission for our-ip ${outcome(await a1.permit(P[0].mapped))}`)
  }, KEEP_MS))
}

async function phase3() {
  out()
  out("Phase 3: A2, a fresh allocation; P15 down to P01 join 1.5s apart")
  const a2 = await newAllocation("A2")
  await permit(a2, P[0].mapped)
  const order = P.slice(0, 15).reverse()
  for (const p of order) { await hear(p, a2, "join"); await sleep(1500 - GAP_MS * (BURST - 1) - 500) }
  await sleep(SETTLE_MS)
  data.phases.p3 = tally(a2, "join", order)
  await drop(a2)
}

async function phase4() {
  out()
  out("Phase 4: A3 hears from 20 new peers at once, then is deleted and allocated again on the same socket")
  const Q = await makePeers("Q", 1, 20)
  const a3 = await newAllocation("A3")
  await permit(a3, Q[0].mapped)
  for (let i = 1; i <= BURST; i++) {
    for (const q of Q) q.send(a3.relayed, `p01|A3|burst|${q.name}|${i}`)
    await sleep(GAP_MS)
  }
  await sleep(SETTLE_MS)
  data.phases.p4 = tally(a3, "burst", Q)
  await drop(a3)
  try {
    await allocateOn(a3, "A3b")
  } catch (e) {
    note(e.message)
    return
  }
  await permit(a3, Q[0].mapped)
  const again = Q.slice(0, 12)
  for (const q of again) { await hear(q, a3, "join"); await sleep(1000 - GAP_MS * (BURST - 1) - 500) }
  await sleep(SETTLE_MS)
  data.phases.p4b = tally(a3, "join", again)
  await drop(a3)
}

async function phase5() {
  out()
  out("Phase 5: A4 hears from H1-H3, other allocations' relayed addresses, mixed with R01-R09 on our IP")
  const H = []
  for (let i = 1; i <= 3; i++) H.push(await newAllocation(`H${i}`))
  const R = await makePeers("R", 1, 9)
  const a4 = await newAllocation("A4")
  const perms = { ours: await permit(a4, R[0].mapped) }
  for (const h of H) perms[`A4 for ${h.name}`] = await permit(a4, h.relayed)
  for (const h of H) perms[`${h.name} for A4`] = await permit(h, a4.relayed)
  // H1 first shows whether relay-to-relay works at all; H2 is the 10th
  // source, and H3 and R09 the 11th and 12th.
  const order = [H[0], ...R.slice(0, 8), H[1], H[2], R[8]]
  for (const s of order) { await hear(s, a4, "join"); await sleep(700) }
  await sleep(SETTLE_MS)
  const t = tally(a4, "join", order)
  for (const s of order) {
    const to = s instanceof Turn ? s.relayed : addrAt(a4, s)
    for (let i = 1; i <= BURST; i++) a4.sendIndication(to, `p01|A4|back|${s.name}|${i}`)
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const back = order.map((s) => [s.name, `${s instanceof Turn ? s.hits("back", s.name, "A4").length : s.count("A4", "back")}/${BURST}`])
  out("    A4 -> each source by Send indication:")
  table(["source", "arrived"], back)
  data.phases.p5 = { perms, ...t, back: Object.fromEntries(back) }
  for (const x of [a4, ...H]) await drop(x)
}

async function phase6(a1, quietSince) {
  out()
  out("Phase 6: idle slots. A1 keeps its permission; A5 lets its permission lapse")
  const S = await makePeers("S", 1, 12)
  const a5 = await newAllocation("A5")
  await permit(a5, S[0].mapped)
  for (const s of S.slice(0, 11)) { await hear(s, a5, "join"); await sleep(700) }
  await sleep(SETTLE_MS)
  const fill = tally(a5, "join", S.slice(0, 11))
  const a5Quiet = Date.now()
  timers.push(setInterval(async () => note(`A5 keepalive: Refresh ${refreshed(await a5.refresh(600))}, permission left to lapse`), KEEP_MS))
  const result = { fill }
  // At each check a peer that holds a slot sends first, the control that the
  // allocation and that peer's public port still work, then a new peer.
  const events = [
    { at: quietSince + 330_000, run: async () => {
      out(); note("A1, 5.5 minutes after P02-P16 went quiet:")
      await hear(P[1], a1, "idle-5")
      await hear(P[16], a1, "idle-5")
      result.a1After330s = { oldP02: a1.hits("idle-5", "P02").length, newP17: a1.hits("idle-5", "P17").length }
    } },
    { at: a5Quiet + 330_000, run: async () => {
      out(); note("A5, 5.5 minutes after its peers went quiet, with its permission lapsed:")
      await hear(S[1], a5, "lapsed")
      await permit(a5, S[0].mapped)
      await hear(S[0], a5, "re-permitted")
      await hear(S[11], a5, "re-permitted")
      result.a5 = { oldS02Lapsed: a5.hits("lapsed", "S02").length, oldS01Repermitted: a5.hits("re-permitted", "S01").length, newS12Repermitted: a5.hits("re-permitted", "S12").length }
    } },
    { at: quietSince + 630_000, run: async () => {
      out(); note("A1, 10.5 minutes after P02-P16 went quiet, past the 600s channel lifetime:")
      await hear(P[2], a1, "idle-10")
      await hear(P[17], a1, "idle-10")
      result.a1After630s = { oldP03: a1.hits("idle-10", "P03").length, newP18: a1.hits("idle-10", "P18").length }
    } },
  ].sort((x, y) => x.at - y.at)
  for (const e of events) {
    const wait = e.at - Date.now()
    if (wait > 0) note(`waiting ${Math.round(wait / 1000)}s`)
    await sleep(Math.max(0, wait))
    await e.run()
  }
  data.phases.p6 = result
}

// A datagram sent with this TTL opens the peer's mapping in the router, hop 1,
// and in hop 2, whose address is in the carrier-grade NAT range, then expires
// before Cloudflare, 9 hops away by tracert from this PC on 2026-10-10. The
// phase checks that the relay heard none of them.
const OPEN_TTL = 4

function open(p, t) {
  p.socket.setTTL(OPEN_TTL)
  return new Promise((resolve) => p.socket.send(Buffer.from(`p01|${t.alloc}|open|${p.name}|1`), t.relayed.port, t.relayed.ip, () => {
    p.socket.setTTL(128)
    resolve()
  }))
}

async function phase7() {
  out()
  out("Phase 7: A6 sends to 12 peers it has never heard from, and A7 binds channels to 12 before any data")
  const T = await makePeers("T", 1, 12)
  const a6 = await newAllocation("A6")
  await permit(a6, T[0].mapped)
  for (const p of T) await open(p, a6)
  await sleep(SETTLE_MS)
  for (const p of T) {
    for (let i = 1; i <= BURST; i++) a6.sendIndication(p.mapped, `p01|A6|send|${p.name}|${i}`)
    await sleep(700)
    note(`A6 -> ${p.name} by Send indication: ${p.count("A6", "send")}/${BURST}`)
  }
  await sleep(SETTLE_MS)
  for (const p of T) { await hear(p, a6, "after"); await sleep(200) }
  await sleep(SETTLE_MS)
  const sendFirst = T.map((p) => ({ peer: p.name, openHeard: a6.hits("open", p.name).length, toPeer: p.count("A6", "send"), fromPeer: a6.hits("after", p.name).length }))
  table(["peer", "TTL-4 datagram heard by A6", "A6 -> peer", "peer -> A6 after"], sendFirst.map((r) => [r.peer, r.openHeard, `${r.toPeer}/${BURST}`, `${r.fromPeer}/${BURST}`]))
  await drop(a6)

  const U = await makePeers("U", 1, 12)
  const a7 = await newAllocation("A7")
  await permit(a7, U[0].mapped)
  for (const p of U) await open(p, a7)
  await sleep(SETTLE_MS)
  const binds = []
  for (const [i, p] of U.entries()) {
    const ch = 0x4001 + i
    const o = outcome(await a7.bindChannel(ch, p.mapped))
    if (o === "ok") a7.channels.set(ch, p.mapped)
    binds.push({ p, ch, o })
    note(`A7: ChannelBind 0x${ch.toString(16)} to ${p.name}, never heard from: ${o}`)
  }
  for (const b of binds.filter((b) => b.o === "ok")) for (let i = 1; i <= BURST; i++) a7.channelData(b.ch, `p01|A7|chan|${b.p.name}|${i}`)
  await sleep(SETTLE_MS)
  for (const p of U) { await hear(p, a7, "after"); await sleep(200) }
  await sleep(SETTLE_MS)
  const bindFirst = binds.map((b) => ({
    peer: b.p.name, openHeard: a7.hits("open", b.p.name).length, channelBind: b.o,
    toPeer: b.o === "ok" ? b.p.count("A7", "chan") : null, fromPeer: a7.hits("after", b.p.name).length,
  }))
  table(["peer", "TTL-4 datagram heard by A7", "ChannelBind", "ChannelData -> peer", "peer -> A7 after"],
    bindFirst.map((r) => [r.peer, r.openHeard, r.channelBind, r.toPeer === null ? "-" : `${r.toPeer}/${BURST}`, `${r.fromPeer}/${BURST}`]))
  await drop(a7)
  data.phases.p7 = { sendFirst, bindFirst }
}

// turn-client-proto 0.7.3 asks for a LIFETIME of 1800 in its Allocate and in
// every Refresh, and ignores a Refresh response that grants under 600s, so its
// allocation would lapse (read on docs.rs, turn-client-proto 0.7.3,
// src/protocol.rs, send_initial_request, poll_transmit, and MIN_LIFETIME).
async function phase8() {
  out()
  out("Phase 8: the LIFETIME Cloudflare grants, and ChannelData framing, to a peer and relay to relay")
  const a8 = new Turn("A8", server, creds)
  sockets.push(a8)
  await a8.bind()
  await allocateOn(a8, "A8", 1800)
  const grants = [{ request: "Allocate asking 1800", granted: a8.lifetime }]
  for (const ask of [1800, 600, 300, null, 3600, 1800]) {
    const r = ask === null ? await a8.request(T.REFRESH, []) : await a8.refresh(ask)
    grants.push({ request: `Refresh asking ${ask ?? "nothing"}`, outcome: outcome(r), granted: granted(r) })
    note(`A8: Refresh asking ${ask === null ? "with no LIFETIME" : `LIFETIME ${ask}s`}: ${refreshed(r)}`)
  }

  const [v] = await makePeers("V", 1, 1)
  await permit(a8, v.mapped)
  await hear(v, a8, "first", 1)
  const bindPeer = outcome(await a8.bindChannel(0x4001, v.mapped))
  if (bindPeer === "ok") a8.channels.set(0x4001, v.mapped)
  note(`A8: ChannelBind 0x4001 to V01: ${bindPeer}`)
  await hear(v, a8, "chan")
  for (let i = 1; i <= BURST; i++) a8.channelData(0x4001, `p01|A8|padded|V01|${i}`, true)
  for (let i = 1; i <= BURST; i++) a8.channelData(0x4001, `p01|A8|unpadded|V01|${i}`, false)
  await sleep(SETTLE_MS)
  const frames = a8.hits("chan", "V01").map((h) => `${h.via}, ${h.len} bytes of data, ${h.pad ?? "-"} of padding`)
  note(`V01 -> A8 frames: ${[...new Set(frames)].join("; ") || "none"}`)
  note(`A8 -> V01 ChannelData: padded ${v.count("A8", "padded")}/${BURST}, unpadded ${v.count("A8", "unpadded")}/${BURST}`)

  const h8 = await newAllocation("H8")
  const perms = { a8ForH8: await permit(a8, h8.relayed), h8ForA8: await permit(h8, a8.relayed) }
  const bindA8 = outcome(await a8.bindChannel(0x4002, h8.relayed))
  const bindH8 = outcome(await h8.bindChannel(0x4001, a8.relayed))
  if (bindA8 === "ok") a8.channels.set(0x4002, h8.relayed)
  if (bindH8 === "ok") h8.channels.set(0x4001, a8.relayed)
  note(`A8: ChannelBind 0x4002 to H8's relayed address: ${bindA8}; H8: ChannelBind 0x4001 to A8's: ${bindH8}`)
  for (let i = 1; i <= BURST; i++) {
    a8.channelData(0x4002, `p01|H8|relay|A8|${i}`)
    h8.channelData(0x4001, `p01|A8|relay|H8|${i}`)
  }
  await sleep(SETTLE_MS)
  const a8ToH8 = h8.hits("relay", "A8", "H8")
  const h8ToA8 = a8.hits("relay", "H8", "A8")
  note(`relay to relay by ChannelData: A8 -> H8 ${a8ToH8.length}/${BURST}${a8ToH8[0] ? ` as ${a8ToH8[0].via}` : ""}, H8 -> A8 ${h8ToA8.length}/${BURST}${h8ToA8[0] ? ` as ${h8ToA8[0].via}` : ""}`)

  data.phases.p8 = {
    grants, bindPeer, frames: [...new Set(frames)],
    toPeer: { padded: v.count("A8", "padded"), unpadded: v.count("A8", "unpadded"), sent: BURST },
    relayToRelay: { perms, bindA8, bindH8, a8ToH8: a8ToH8.length, h8ToA8: h8ToA8.length, sent: BURST },
  }
  await drop(h8)
  await drop(a8)
}

// ---------------------------------------------------------------- run

async function main() {
  out(`p01-turn-peer-cap, ${when} UTC, phases ${PHASES.join(", ")}`)
  const key = loadKey()
  creds = await mint(key)
  server = { ip: (await lookup(creds.host, { family: 4 })).address, port: creds.port }
  nameIp(server.ip, "turn-server")
  stun = { ip: (await lookup("stun.cloudflare.com", { family: 4 })).address, port: 3478 }
  nameIp(stun.ip, "stun-server")
  note(`TURN server ${creds.host} is ${show(server)}; STUN server stun.cloudflare.com is ${show(stun)}`)

  const finish = async () => {
    for (const t of timers) clearInterval(t)
    if (P && allocations.find((a) => a.alloc === "A1")) {
      const a1 = allocations.find((a) => a.alloc === "A1")
      out()
      note(`P01 anchor to A1: ${a1.hits("anchor", "P01").length} of ${anchorSent} arrived`)
      data.anchor = { sent: anchorSent, got: a1.hits("anchor", "P01").length }
    }
    for (const t of [...allocations]) await drop(t)
    await revoke(key, creds)
    for (const s of sockets) s.close()
    const txt = resultFile("network", "p01-turn-peer-cap", "txt", when)
    writeFileSync(txt, redact(lines.join("\n")) + "\n")
    writeFileSync(resultFile("network", "p01-turn-peer-cap", "json", when), redact(JSON.stringify(data, null, 2)) + "\n")
    console.log(`\nSaved ${repoRelative(txt)} and its .json`)
  }
  process.once("SIGINT", async () => { note("interrupted"); await finish(); process.exit(130) })
  timers.push(setInterval(() => {
    for (const t of allocations) t.transact(server, (tid) => encode(T.BINDING, tid, []))
    for (const s of sockets) if (s instanceof Peer) s.transact(stun, (tid) => encode(T.BINDING, tid, []))
  }, NAT_KEEP_MS))

  try {
    const run = (n) => PHASES.includes(n)
    let a1, quietSince
    if (run(1) || run(2) || run(6)) {
      P = await makePeers("P", 1, 18)
      a1 = await phase1()
      await phase2(a1)
      quietSince = Date.now()
    }
    if (run(3)) await phase3()
    if (run(4)) await phase4()
    if (run(5)) await phase5()
    if (run(7)) await phase7()
    if (run(8)) await phase8()
    if (run(6)) await phase6(a1, quietSince)
  } catch (e) {
    note(`stopped: ${e.stack ?? e.message}`)
  }
  await finish()
}

await main()
