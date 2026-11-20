import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { relays, render } from "./deploy.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))

test("each relay in relays.toml takes its tokens, newest first, from tokens.toml", () => {
  const list = fs.readFileSync(path.join(HERE, "relays.toml"), "utf8")
  const all = relays(list, `fra = ["new", "old"] # newest first\nsgp = ["unlisted"]\n`)
  assert.deepEqual(
    all.map((r) => [r.region, r.tokens]),
    [["fra", ["new", "old"]]],
  )
  assert.throws(() => relays(list, `sgp = ["new"]\n`), /no token for the relay fra/)
})

test("a relay's configuration lists all its tokens, what Let's Encrypt needs, and its cap", () => {
  const config = render({ region: "fra", url: "https://fra.relay.dualinput.app", cap: 262144, tokens: ["new", "old"] }, "relays@example.com")
  assert.match(config, /^access\.shared_token = \["new", "old"\]$/m)
  // iroh-relay 1.3.0 refuses to start in Let's Encrypt mode without a hostname and a contact
  // (read in its src/main.rs, `load_cert_config`).
  assert.match(config, /^hostname = "fra\.relay\.dualinput\.app"$/m)
  assert.match(config, /^contact = "relays@example\.com"$/m)
  assert.match(config, /^\[limits\.client\.rx\]\nbytes_per_second = 262144$/m)
})
