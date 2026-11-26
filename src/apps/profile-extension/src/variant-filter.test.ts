// Tests filtering a profile's entries by variant: the picker's items, and the folds to make and undo
// (record/areas/build/plan.md, "22k Filtering a profile by variant").
//
//   node --test src/apps/profile-extension/src/variant-filter.test.ts

import assert from "node:assert/strict"
import { test } from "node:test"

import { foldChanges, pickItems, shifted } from "./variant-filter.ts"

test("the picker lists the variants in the profile's order, those shown ticked, and the current aircraft's marked", () => {
  assert.deepEqual(pickItems(["classic", "g1000", "skis"], ["g1000"], "skis"), [
    { label: "classic", picked: false },
    { label: "g1000", picked: true },
    { label: "skis", description: "current aircraft", picked: false },
  ])
  assert.deepEqual(pickItems(["a", "b"], [], null), [
    { label: "a", picked: false },
    { label: "b", picked: false },
  ])
})

test("folded lines follow an edit: below it they move, inside what it replaced they go, and above it they stay", () => {
  // A line typed above line 20, as Enter at the end of line 10.
  assert.deepEqual(shifted([4, 20], { start: 10, end: 10, breaks: 1 }), [4, 21])
  // Lines 11 to 13 deleted, from the end of line 10.
  assert.deepEqual(shifted([4, 12, 20], { start: 10, end: 13, breaks: 0 }), [4, 17])
  // A change within one line moves nothing.
  assert.deepEqual(shifted([4, 20], { start: 4, end: 4, breaks: 0 }), [4, 20])
})

test("only the folds that changed are made or undone", () => {
  assert.deepEqual(foldChanges([], [4, 12]), { fold: [4, 12], unfold: [] })
  assert.deepEqual(foldChanges([4, 12], [12, 20]), { fold: [20], unfold: [4] })
  assert.deepEqual(foldChanges([4, 12], []), { fold: [], unfold: [4, 12] })
})
