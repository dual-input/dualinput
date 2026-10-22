import assert from "node:assert/strict"
import { test } from "node:test"

import { counted } from "../src/address.ts"

test("an IPv6 address counts by its /64, however it's written, and an IPv4 address whole", () => {
  assert.equal(counted("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64")
  assert.equal(counted("2001:0db8:0001:0002::1"), "2001:db8:1:2::/64")
  assert.equal(counted("2001:db8::1"), "2001:db8:0:0::/64")
  assert.equal(counted("::1"), "0:0:0:0::/64")
  assert.equal(counted("198.51.100.7"), "198.51.100.7")
  assert.equal(counted("::ffff:198.51.100.7"), "::ffff:198.51.100.7")
})
