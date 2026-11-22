// Tests the status bar's text in each of its four states for a profile, and in a module
// (record/areas/profiles/03-the-extension.md, "Building on save").
//
//   node --test src/apps/profile-extension/src/status.test.ts

import assert from "node:assert/strict"
import { test } from "node:test"

import { type Build, Builds, kindOf } from "./status.ts"

const BARON = "file:///c%3A/dualinput/profiles/aircraft/bksq-baronpro.yaml"
const BONANZA = "file:///c%3A/dualinput/profiles/aircraft/bksq-bonanzapro.yaml"
const KFC = "file:///c%3A/dualinput/profiles/modules/kfc-150.yaml"
const HASH = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809"
/** 14:32:05 on 2026-11-22 in the local time zone, which the tooltip shows. */
const BUILT = new Date(2026, 10, 22, 14, 32, 5).toISOString()

function build(fields: Partial<Build>): Build {
  return { profile: BARON, trigger: BARON, hash: null, errors: 0, builtAt: null, bundle: null, ...fields }
}

function builds(...list: Build[]): Builds {
  const all = new Builds()
  for (const one of list) all.record(one)
  return all
}

test("a profile with a bundle that built shows its short hash, with the time it was built", () => {
  assert.deepEqual(builds(build({ hash: HASH, builtAt: BUILT })).status(BARON, "profile"), {
    text: "Dual Input 1a2b3c4",
    tooltip: "Built 2026-11-22 14:32:05",
  })
})

test("a save that failed, with an older bundle in the folder, shows that bundle's hash and the errors", () => {
  const status = builds(build({ hash: HASH, builtAt: BUILT }), build({ hash: HASH, builtAt: BUILT, errors: 2 })).status(BARON, "profile")
  assert.deepEqual(status, {
    text: "Dual Input 1a2b3c4 · 2 errors",
    tooltip: "The last build had 2 errors, so the local folder keeps the bundle built 2026-11-22 14:32:05",
  })
})

test("a save that failed, with no bundle in the folder, shows not built and the errors", () => {
  assert.equal(builds(build({ errors: 1 })).status(BARON, "profile")?.text, "Dual Input: not built · 1 error")
})

test("a profile with no bundle and no build yet shows nothing", () => {
  assert.equal(new Builds().status(BARON, "profile"), null)
  assert.equal(builds(build({})).status(BARON, "profile"), null)
})

test("a module shows each profile its saves built, with its short hash", () => {
  const all = builds(
    build({ profile: BONANZA, trigger: KFC, errors: 3 }),
    build({ trigger: KFC, hash: HASH, builtAt: BUILT }),
    // A profile its saves built clean, which the local folder doesn't hold, has nothing to show.
    build({ profile: "file:///c%3A/dualinput/profiles/aircraft/bksq-staging.yaml", trigger: KFC }),
  )
  assert.deepEqual(all.status(KFC, "module"), {
    text: "Dual Input bksq-baronpro 1a2b3c4, bksq-bonanzapro not built · 3 errors",
    tooltip:
      "bksq-baronpro: Built 2026-11-22 14:32:05\nbksq-bonanzapro: The last build had 3 errors, and the local folder holds no bundle of this profile",
  })
})

test("of a module's importers, only those with a bundle in the local folder are offered for removal", () => {
  const all = builds(build({ profile: BONANZA, trigger: KFC, errors: 3 }), build({ hash: HASH, builtAt: BUILT }))
  assert.deepEqual(
    all.bundled([BARON, BONANZA, "file:///c%3A/dualinput/profiles/aircraft/bksq-staging.yaml"]).map((one) => one.profile),
    [BARON],
  )
})

test("a module shows each profile's latest build, its own saves' included", () => {
  const all = builds(build({ trigger: KFC, hash: HASH }), build({ hash: `ffffffff${HASH.slice(8)}` }))
  assert.equal(all.status(KFC, "module")?.text, "Dual Input bksq-baronpro fffffff")
})

test("a module no save has built yet shows nothing", () => {
  const all = builds(build({ hash: HASH }))
  assert.equal(all.status(KFC, "module"), null)
})

test("a file is a profile or a module by its folder, as the language's patterns take it", () => {
  assert.equal(kindOf("/c:/dualinput/profiles/aircraft/bksq-baronpro.yaml"), "profile")
  assert.equal(kindOf("/c:/dualinput/Profiles/Modules/kfc-150.YAML"), "module")
  assert.equal(kindOf("C:\\dualinput\\profiles\\aircraft\\bksq-baronpro.yaml"), "profile")
  assert.equal(kindOf("/c:/dualinput/profiles/aircraft/nested/bksq-baronpro.yaml"), null)
  assert.equal(kindOf("/c:/dualinput/.github/workflows/ci.yaml"), null)
})
