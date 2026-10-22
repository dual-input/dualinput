// The backend's requests against the Worker on a local D1 (record/areas/network/02-units.md,
// "Cases for the bench"). Each body is written out as the JSON a core sends, not built from
// the message crate's types, so a change to those types can't change what a released path is
// held to. Once a path is released, its tests here are never edited: a change to its bodies
// takes a new path, with tests of its own (record/areas/build/01-the-build.md, "The backend").

import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { after, before, test } from "node:test"

import { type LocalBackend, startBackend } from "../../tools/lib/backend.ts"

let backend: LocalBackend

before(async () => {
  backend = await startBackend()
})

after(async () => {
  await backend?.stop()
})

const VERSION = "0.1.0"
const HASH = "9f2c".repeat(16)
const HOST_PILOT = "11".repeat(16)
const JOINER_PILOT = "22".repeat(16)

/** A fresh endpoint key, and the headers that sign a body with it. */
function key() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const endpoint = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url").toString("hex")
  return {
    endpoint,
    headers: (body: string) => ({
      "DualInput-Endpoint": endpoint,
      "DualInput-Signature": sign(null, Buffer.from(body), privateKey).toString("hex"),
    }),
  }
}

async function post(path: string, body: string, headers: Record<string, string> = {}) {
  const answer = await fetch(backend.url + path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } })
  return { status: answer.status, body: (await answer.json()) as Record<string, unknown> }
}

/** Hosts a session and returns its code and the host's key. */
async function host(version = VERSION) {
  const host = key()
  const body = `{"session":"0b9f2a4e-6c1d-4e8a-b7f3-2d5c9e1a4b6f","relays":[{"url":"https://nyc.relay.dualinput.app","token":"t1","cap":262144}],"host":{"pilot":"${HOST_PILOT}","name":"Host","kind":"crew","endpoint":"${host.endpoint}"},"version":"${version}","hash":"${HASH}"}`
  const answer = await post("/v1/sessions", body, host.headers(body))
  assert.equal(answer.status, 200, JSON.stringify(answer.body))
  const code = answer.body.code
  assert.match(String(code), /^[ABCDEFGHJKMNPQRSTVWXYZ2-9]{6}$/)
  return { code: String(code), host }
}

function lookup(code: string, address: string, version = VERSION, hash = HASH) {
  return post("/v1/lookup", `{"code":"${code}","version":"${version}","hash":"${hash}"}`, { "CF-Connecting-IP": address })
}

test("a session's code finds its relays and crew, which a member's entry joins and its leave leaves", async () => {
  const { code, host: h } = await host()
  let found = await lookup(code, "198.51.100.1")
  assert.equal(found.status, 200)
  assert.deepEqual(found.body, {
    answer: "found",
    session: "0b9f2a4e-6c1d-4e8a-b7f3-2d5c9e1a4b6f",
    relays: [{ url: "https://nyc.relay.dualinput.app", token: "t1", cap: 262144 }],
    crew: [{ pilot: HOST_PILOT, name: "Host", kind: "crew", endpoint: h.endpoint }],
  })

  const joiner = key()
  const entry = `{"code":"${code}","member":{"pilot":"${JOINER_PILOT}","name":"Joiner","kind":"crew","endpoint":"${joiner.endpoint}"}}`
  assert.deepEqual(await post("/v1/members", entry, joiner.headers(entry)), { status: 200, body: {} })
  found = await lookup(code.toLowerCase(), "198.51.100.1")
  assert.equal((found.body.crew as unknown[]).length, 2)

  const leave = `{"code":"${code}","endpoint":"${joiner.endpoint}"}`
  assert.deepEqual(await post("/v1/members/leave", leave, joiner.headers(leave)), { status: 200, body: {} })
  found = await lookup(code, "198.51.100.1")
  assert.deepEqual(found.body.crew, [{ pilot: HOST_PILOT, name: "Host", kind: "crew", endpoint: h.endpoint }])
})

test("a request signed by another key, or naming another endpoint, is refused", async () => {
  const { code } = await host()
  const joiner = key()
  const other = key()
  const entry = `{"code":"${code}","member":{"pilot":"${JOINER_PILOT}","name":"Joiner","kind":"crew","endpoint":"${joiner.endpoint}"}}`
  const forged = { ...joiner.headers(entry), "DualInput-Signature": other.headers(entry)["DualInput-Signature"] }
  assert.deepEqual(await post("/v1/members", entry, forged), { status: 403, body: { error: "the signature didn't match" } })
  assert.deepEqual(await post("/v1/members", entry, other.headers(entry)), {
    status: 403,
    body: { error: "the entry names another endpoint" },
  })
  assert.deepEqual(await post("/v1/members", entry), { status: 403, body: { error: "the request isn't signed" } })
})

test("a member for a code no session holds is refused", async () => {
  const joiner = key()
  const entry = `{"code":"ZZZZZZ","member":{"pilot":"${JOINER_PILOT}","name":"Joiner","kind":"crew","endpoint":"${joiner.endpoint}"}}`
  assert.deepEqual(await post("/v1/members", entry, joiner.headers(entry)), { status: 404, body: { error: "no session has the code" } })
})

test("a joiner on another version is told whose is older, and on another build of it, that", async () => {
  const { code } = await host("0.2.0")
  assert.deepEqual((await lookup(code, "198.51.100.2", "0.1.9")).body, { answer: "other-version", older: "mine" })
  assert.deepEqual((await lookup(code, "198.51.100.2", "0.10.0")).body, { answer: "other-version", older: "theirs" })
  assert.deepEqual((await lookup(code, "198.51.100.2", "0.2.0", "0".repeat(64))).body, { answer: "other-hash" })
})

test("a member unrenewed for 30 minutes is missing from a lookup, and a session with none has no such code", async () => {
  const { code, host: h } = await host()
  backend.execute(`UPDATE members SET renewed = renewed - ${31 * 60 * 1000} WHERE endpoint = '${h.endpoint}'`)
  assert.deepEqual((await lookup(code, "198.51.100.3")).body, { answer: "no-such-code" })
})

test("the hourly sweep deletes lapsed members and the sessions they leave empty", async () => {
  const { code, host: h } = await host()
  backend.execute(`UPDATE members SET renewed = renewed - ${31 * 60 * 1000} WHERE code = '${code}'`)
  await backend.scheduled()
  // A renewal finds no session to list itself in once the sweep deleted it.
  const entry = `{"code":"${code}","member":{"pilot":"${HOST_PILOT}","name":"Host","kind":"crew","endpoint":"${h.endpoint}"}}`
  assert.deepEqual(await post("/v1/members", entry, h.headers(entry)), { status: 404, body: { error: "no session has the code" } })
})
test("an address's 21st wrong code in an hour is refused, and a right code from it too", async () => {
  const { code } = await host()
  for (let i = 0; i < 20; i++) assert.deepEqual((await lookup("ZZZZZZ", "198.51.100.5")).body, { answer: "no-such-code" })
  assert.deepEqual((await lookup("ZZZZZZ", "198.51.100.5")).body, { answer: "too-many-wrong-codes" })
  assert.deepEqual((await lookup(code, "198.51.100.5")).body, { answer: "too-many-wrong-codes" })
  assert.equal((await lookup(code, "198.51.100.6")).body.answer, "found")
})

test("a body that doesn't read is refused", async () => {
  assert.deepEqual(await post("/v1/lookup", `{"code":"ABCDEF"}`), { status: 400, body: { error: "the request didn't read" } })
  assert.deepEqual(await post("/v1/nothing", "{}"), { status: 404, body: { error: "no such request" } })
})
