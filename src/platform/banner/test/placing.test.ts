import assert from "node:assert/strict"
import { test } from "node:test"

import type { Note } from "../src/note.ts"
import { cleared, GAP, merge, MORE_LINE, ordered, place, said, withKept } from "../src/placing.ts"

const held = (id: string, level: Note["level"] = "information"): Note => ({ id, level, text: id, landing: "session" })
const once = (id: string): Note => ({ id, level: "information", text: id, once: true, landing: "session" })
const ids = (notes: Note[]) => notes.map((note) => note.id)
const CARD = 60
const height = () => CARD

test("a one-time card whose time ran out shows again once the core has dropped it and raises the same words", () => {
  const card = once("adam left")
  const kept = new Map<string, Note>()
  let gone: ReadonlyMap<string, boolean> = new Map()
  assert.deepEqual(ids(withKept([card], kept, gone)), ["adam left"])

  // Its time runs out while the core still holds it, so it stays hidden and isn't kept again.
  kept.delete(card.id)
  gone = new Map([[said(card), false]])
  withKept([card], kept, gone)
  assert.equal(kept.size, 0)

  // The core drops it, which clears its mark.
  const notes = withKept([], kept, gone)
  assert.deepEqual(notes, [])
  assert.deepEqual(cleared(gone, notes), [said(card)])
  gone = new Map()

  assert.deepEqual(ids(withKept([card], kept, gone)), ["adam left"])
  assert.equal(kept.size, 1)
})

test("a one-time card outlasts the core's holding it while its own time runs", () => {
  const card = once("adam left")
  const kept = new Map<string, Note>()
  withKept([card], kept, new Map())
  assert.deepEqual(ids(withKept([], kept, new Map())), ["adam left"])
})

test("cards that fit all show, newest first", () => {
  const { shown, waiting } = place([once("c"), held("b"), once("a")], height, 3 * CARD + 2 * GAP)
  assert.deepEqual(ids(shown), ["c", "b", "a"])
  assert.deepEqual(waiting, [])
})

test("the oldest one-time cards leave early, and held ones stay", () => {
  const { shown, waiting } = place([once("d"), held("c"), once("b"), once("a")], height, 2 * CARD + GAP)
  assert.deepEqual(ids(shown), ["d", "c"])
  assert.deepEqual(waiting, [], "a one-time card that left early isn't waiting")
})

test("held cards that don't fit keep their places by trouble, then warnings, then information", () => {
  const notes = [held("new-info"), held("warning", "warning"), held("trouble", "trouble"), held("old-info")]
  const { shown, waiting } = place(notes, height, 2 * CARD + GAP + MORE_LINE + GAP)
  assert.deepEqual(ids(shown), ["warning", "trouble"], "shown in age order, picked by rank")
  assert.deepEqual(ids(waiting), ["new-info", "old-info"])
})

test("a new card arrives at the top, and a waiting one at the foot", () => {
  const placed = [held("new"), held("b"), held("a"), held("was-waiting")]
  assert.deepEqual(ids(ordered(placed, ["b", "a"], new Set(["was-waiting"]))), ["new", "b", "a", "was-waiting"])
})

test("a card that's gone stays in its row, leaving, and a new one goes in after the row it follows", () => {
  const merged = merge([{ id: "a" }, { id: "b" }], ["a", "c"], (id) => id === "b")
  assert.deepEqual(merged, [{ id: "a", fresh: undefined }, { id: "c", fresh: true }, { id: "b", leaving: true, away: true }])
})
