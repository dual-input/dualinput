import assert from "node:assert/strict"
import { test } from "node:test"

import type { Note } from "../src/note.ts"
import { GAP, merge, MORE_LINE, ordered, place } from "../src/placing.ts"

const held = (id: string, level: Note["level"] = "information"): Note => ({ id, level, text: id })
const once = (id: string): Note => ({ id, level: "information", text: id, once: true })
const ids = (notes: Note[]) => notes.map((note) => note.id)
const CARD = 60
const height = () => CARD

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
