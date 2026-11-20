// The backend: a Cloudflare Worker on D1 that hands out invite codes and keeps each session's
// relay list and crew, which a joiner looks up by the code. It holds no connection, since the
// cores link to each other through iroh, so it needs no Durable Object
// (record/areas/network/02-units.md, "The backend").
//
// The bodies are the message crate's types, through the TypeScript ts-rs writes from it. The
// backend running is always the newest release's and answers older releases' cores too, so
// a released path's bodies never change: a change takes a new path beside the old one, and
// each path's literal-JSON tests in src/backend/test/ are never edited after its release
// (record/areas/build/01-the-build.md, "The backend").

import type { Created } from "../../engines/messages/ts/backend/Created.ts"
import type { Entry } from "../../engines/messages/ts/backend/Entry.ts"
import type { Leave } from "../../engines/messages/ts/backend/Leave.ts"
import type { LookedUp } from "../../engines/messages/ts/backend/LookedUp.ts"
import type { Lookup } from "../../engines/messages/ts/backend/Lookup.ts"
import type { NewSession } from "../../engines/messages/ts/backend/NewSession.ts"
import type { Older } from "../../engines/messages/ts/backend/Older.ts"
import type { Refused } from "../../engines/messages/ts/backend/Refused.ts"
import type { Renew } from "../../engines/messages/ts/backend/Renew.ts"
import type { Taken } from "../../engines/messages/ts/backend/Taken.ts"
import type { Relay } from "../../engines/messages/ts/net/Relay.ts"
import { counted } from "./address.ts"
import { claim, wellFormed } from "./codes.ts"

// src/engines/messages/src/backend.rs names the same paths and headers, so change both together.
const SESSIONS = "/v1/sessions"
const LOOKUP = "/v1/lookup"
const MEMBERS = "/v1/members"
const LEAVE = "/v1/members/leave"
const ENDPOINT_HEADER = "DualInput-Endpoint"
const SIGNATURE_HEADER = "DualInput-Signature"

/** A lookup lists only members renewed within this, and every member renews each 10 minutes, at `RENEW_EVERY` in src/platform/network/src/backend.rs, so change both together. */
const LAPSE_MS = 30 * 60 * 1000
/** An address that got this many codes wrong this hour is refused until the next. */
const WRONG_CODES = 20
/** Every body the cores send fits well under this. */
const MOST_BYTES = 16 * 1024

export interface Env {
  DB: D1Database
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // `BACKEND_ANSWERS` in src/platform/network/src/reach.rs takes this 405 as our Worker
    // answering, so change both together.
    if (request.method !== "POST") return refuse(405, "only POST is answered")
    if (Number(request.headers.get("content-length") ?? 0) > MOST_BYTES) return refuse(413, "the body is too large")
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.length > MOST_BYTES) return refuse(413, "the body is too large")
    const now = Date.now()
    switch (new URL(request.url).pathname) {
      case SESSIONS:
        return sessions(request, bytes, env.DB, now)
      case LOOKUP:
        return lookup(request, bytes, env.DB, now)
      case MEMBERS:
        return members(request, bytes, env.DB, now)
      case LEAVE:
        return leave(request, bytes, env.DB)
      default:
        return refuse(404, "no such request")
    }
  },

  /** The hourly Cron Trigger. */
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await sweep(env.DB, controller.scheduledTime)
  },
}

async function sessions(request: Request, bytes: Uint8Array<ArrayBuffer>, db: D1Database, now: number): Promise<Response> {
  const endpoint = await signer(request, bytes)
  if (endpoint instanceof Response) return endpoint
  const body = read(bytes)
  if (!isNewSession(body)) return refuse(400, "the request didn't read")
  if (body.host.endpoint !== endpoint) return refuse(403, "the host's entry names another endpoint")
  const code = await claim(
    (b) => crypto.getRandomValues(b),
    async (code) => {
      const [taken] = await db.batch([
        db
          .prepare("INSERT INTO sessions (code, session, relays, version, hash, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(code, body.session, JSON.stringify(body.relays), body.version, body.hash, now),
        db
          // Only beside this request's own session, so a code some other session holds gets
          // no member of this one.
          .prepare("INSERT INTO members (code, endpoint, entry, renewed) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sessions WHERE code = ? AND session = ?)")
          .bind(code, endpoint, JSON.stringify(body.host), now, code, body.session),
      ])
      return taken?.meta.changes === 1
    },
  )
  if (code === null) return refuse(503, "every code drawn was taken")
  return answer<Created>({ code })
}

async function lookup(request: Request, bytes: Uint8Array<ArrayBuffer>, db: D1Database, now: number): Promise<Response> {
  const body = read(bytes)
  if (!isLookup(body)) return refuse(400, "the request didn't read")
  const address = counted(request.headers.get("CF-Connecting-IP") ?? "unknown")
  // Each lookup takes one of the address's 20 guesses this hour in the same statement that
  // checks it, so lookups made at once can't all read a count under 20, and a right code gives
  // its guess back. An address at the limit is refused even with a right code, so the limit
  // can't be told from a wrong code by guessing on.
  const guess = await db
    .prepare("INSERT INTO wrong_codes (address, hour, count) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count")
    .bind(address, hour(now), WRONG_CODES)
    .first<{ count: number }>()
  if (!guess) return answer<LookedUp>({ answer: "too-many-wrong-codes", until: new Date((hour(now) + 1) * 3_600_000).toISOString() })

  const code = body.code.toUpperCase()
  const session = wellFormed(code)
    ? await db.prepare("SELECT session, relays, version, hash FROM sessions WHERE code = ?").bind(code).first<{
        session: string
        relays: string
        version: string
        hash: string
      }>()
    : null
  const crew = session
    ? (await db.prepare("SELECT entry FROM members WHERE code = ? AND renewed >= ?").bind(code, now - LAPSE_MS).all<{ entry: string }>()).results
    : []
  if (!session || crew.length === 0) return answer<LookedUp>({ answer: "no-such-code" })
  await db.prepare("UPDATE wrong_codes SET count = count - 1 WHERE address = ? AND hour = ?").bind(address, hour(now)).run()
  if (session.version !== body.version) {
    return answer<LookedUp>({ answer: "other-version", older: older(body.version, session.version), theirs: session.version })
  }
  if (session.hash !== body.hash) return answer<LookedUp>({ answer: "other-hash" })
  return answer<LookedUp>({
    answer: "found",
    session: session.session,
    relays: JSON.parse(session.relays) as Relay[],
    crew: crew.map((m) => JSON.parse(m.entry) as Entry),
  })
}

async function members(request: Request, bytes: Uint8Array<ArrayBuffer>, db: D1Database, now: number): Promise<Response> {
  const endpoint = await signer(request, bytes)
  if (endpoint instanceof Response) return endpoint
  const body = read(bytes)
  if (!isRenew(body)) return refuse(400, "the request didn't read")
  if (body.member.endpoint !== endpoint) return refuse(403, "the entry names another endpoint")
  const listed = await db
    .prepare(
      "INSERT INTO members (code, endpoint, entry, renewed) SELECT code, ?, ?, ? FROM sessions WHERE code = ? ON CONFLICT DO UPDATE SET entry = excluded.entry, renewed = excluded.renewed",
    )
    .bind(endpoint, JSON.stringify(body.member), now, body.code.toUpperCase())
    .run()
  if (listed.meta.changes === 0) return refuse(404, "no session has the code")
  return answer<Taken>({})
}

async function leave(request: Request, bytes: Uint8Array<ArrayBuffer>, db: D1Database): Promise<Response> {
  const endpoint = await signer(request, bytes)
  if (endpoint instanceof Response) return endpoint
  const body = read(bytes)
  if (!isLeave(body)) return refuse(400, "the request didn't read")
  if (body.endpoint !== endpoint) return refuse(403, "the request names another endpoint")
  await db.prepare("DELETE FROM members WHERE code = ? AND endpoint = ?").bind(body.code.toUpperCase(), endpoint).run()
  return answer<Taken>({})
}

/** Deletes lapsed members, sessions with none left, and past hours' counts of wrong codes. */
export async function sweep(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM members WHERE renewed < ?").bind(now - LAPSE_MS),
    db.prepare("DELETE FROM sessions WHERE code NOT IN (SELECT code FROM members)"),
    db.prepare("DELETE FROM wrong_codes WHERE hour < ?").bind(hour(now)),
  ])
}

/**
 * The request's endpoint ID, once its signature over the body checks out against it: the
 * endpoint ID is the public half of the key that signs, so it checks itself. A captured
 * request could be sent again, but only by someone who also holds the code it carries, which
 * admits them to the session outright.
 */
async function signer(request: Request, bytes: Uint8Array<ArrayBuffer>): Promise<string | Response> {
  const endpoint = request.headers.get(ENDPOINT_HEADER) ?? ""
  const key = unhex(endpoint, 32)
  const signature = unhex(request.headers.get(SIGNATURE_HEADER) ?? "", 64)
  if (!key || !signature) return refuse(403, "the request isn't signed")
  try {
    const verifier = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"])
    if (await crypto.subtle.verify({ name: "Ed25519" }, verifier, signature, bytes)) return endpoint
  } catch {
    // A key that isn't a point on the curve fails the import, which is a signature that
    // didn't match.
  }
  return refuse(403, "the signature didn't match")
}

/** Whose version is older, as the core that looked the code up sees it. `older` in src/platform/session/src/joining.rs reads x.y.z versions the same way, so change both together. */
export function older(mine: string, theirs: string): Older {
  const a = mine.split(".").map(Number)
  const b = theirs.split(".").map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d < 0 ? "mine" : "theirs"
  }
  return "theirs"
}

function hour(ms: number): number {
  return Math.floor(ms / 3_600_000)
}

function answer<T>(body: T): Response {
  return Response.json(body)
}

function refuse(status: number, error: string): Response {
  return Response.json({ error } satisfies Refused, { status })
}

function read(bytes: Uint8Array<ArrayBuffer>): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

function unhex(text: string, length: number): Uint8Array<ArrayBuffer> | null {
  if (text.length !== length * 2 || !/^[0-9a-f]*$/.test(text)) return null
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function text(v: unknown): v is string {
  return typeof v === "string"
}

function hex(v: unknown, length: number): v is string {
  return text(v) && unhex(v, length) !== null
}

function isEntry(v: unknown): v is Entry {
  return record(v) && hex(v.pilot, 16) && text(v.name) && (v.kind === "crew" || v.kind === "passenger") && hex(v.endpoint, 32)
}

function isRelay(v: unknown): v is Relay {
  return record(v) && text(v.url) && text(v.token) && Number.isInteger(v.cap) && (v.cap as number) >= 0
}

function isNewSession(v: unknown): v is NewSession {
  return (
    record(v) &&
    text(v.session) &&
    Array.isArray(v.relays) &&
    v.relays.every(isRelay) &&
    isEntry(v.host) &&
    text(v.version) &&
    text(v.hash)
  )
}

function isLookup(v: unknown): v is Lookup {
  return record(v) && text(v.code) && text(v.version) && text(v.hash)
}

function isRenew(v: unknown): v is Renew {
  return record(v) && text(v.code) && isEntry(v.member)
}

function isLeave(v: unknown): v is Leave {
  return record(v) && text(v.code) && hex(v.endpoint, 32)
}
