// Tests filtering a profile's entries by variant: the picker's items, and the folds to make and undo
// (record/areas/build/plan.md, "22k Filtering a profile by variant").
//
//   node --test src/apps/profile-extension/src/variant-filter.test.ts

import assert from "node:assert/strict"
import { test } from "node:test"

import { foldChanges, pickItems } from "./variant-filter.ts"

test("the picker lists the variants in the profile's order, those shown ticked, and the loaded one marked", () => {
  assert.deepEqual(pickItems(["classic", "g1000", "skis"], ["g1000"], "skis"), [
    { label: "classic", picked: false },
    { label: "g1000", picked: true },
    { label: "skis", description: "loaded", picked: false },
  ])
  assert.deepEqual(pickItems(["a", "b"], [], null), [
    { label: "a", picked: false },
    { label: "b", picked: false },
  ])
})

test("only the folds that changed are made or undone", () => {
  assert.deepEqual(foldChanges([], [4, 12]), { fold: [4, 12], unfold: [] })
  assert.deepEqual(foldChanges([4, 12], [12, 20]), { fold: [20], unfold: [4] })
  assert.deepEqual(foldChanges([4, 12], []), { fold: [], unfold: [4, 12] })
})
