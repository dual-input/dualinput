import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { relays, render } from "./deploy.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))

test("each relay in relays.toml takes its tokens, newest first, from tokens.toml", () => {
  const list = fs.readFileSync(path.join(HERE, "relays.toml"), "utf8")
  const all = relays(list, `nyc = ["new", "old"]\nfra = ["only"] # one token\n`)
  assert.deepEqual(
    all.map((r) => [r.region, r.tokens]),
    [
      ["nyc", ["new", "old"]],
      ["fra", ["only"]],
    ],
  )
  assert.throws(() => relays(list, `nyc = ["new"]\n`), /no token for the relay fra/)
})

test("a relay's configuration lists all its tokens, its host for Let's Encrypt, and its cap", () => {
  const config = render({ region: "nyc", url: "https://nyc.relay.dualinput.app", cap: 262144, tokens: ["new", "old"] })
  assert.match(config, /^access\.shared_token = \["new", "old"\]$/m)
  assert.match(config, /^hostname = "nyc\.relay\.dualinput\.app"$/m)
  assert.match(config, /^\[limits\.client\.rx\]\nbytes_per_second = 262144$/m)
})
