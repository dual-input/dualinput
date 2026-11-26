// Tests the boxes' look for each kind in each palette, the split of a file's boxes by kind
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The box"), and the hint after an entry's first box
// (06-the-sync-log.md, "The hint at the end of a line").
//
//   node --test src/apps/profile-extension/src/boxes.test.ts

import assert from "node:assert/strict"
import { test } from "node:test"

import { type Box, boxStyle, byKind, type Hint, hintStyles, hintText } from "./boxes.ts"
import { type Word, WORDS } from "./words.ts"

/** The corners and padding, which ride in `textDecoration`, since VS Code's API passes on no other field for them. */
const SHAPE = { margin: "0 0 0 0.75ch", textDecoration: "none; border-radius: 3px; padding: 0 0.4ch" }

test("a value and a firing take the kit's live lime on a 10% tint of it, in each palette", () => {
  for (const kind of ["value", "firing"] as const) {
    assert.deepEqual(boxStyle(kind, "dark"), { after: { color: "#c5ee85", backgroundColor: "rgba(197, 238, 133, 0.1)", ...SHAPE } })
    assert.deepEqual(boxStyle(kind, "light"), { after: { color: "#4d7c0f", backgroundColor: "rgba(77, 124, 15, 0.1)", ...SHAPE } })
  }
})

test("an error takes the kit's warning color on a 10% tint of it, in each palette", () => {
  assert.deepEqual(boxStyle("error", "dark"), { after: { color: "#f1be4d", backgroundColor: "rgba(241, 190, 77, 0.1)", ...SHAPE } })
  assert.deepEqual(boxStyle("error", "light"), { after: { color: "#b45309", backgroundColor: "rgba(180, 83, 9, 0.1)", ...SHAPE } })
})

test("a file's boxes split by kind, each kind's in the order the server sent them", () => {
  const boxes: Box[] = [
    { line: 12, text: "0.82", kind: "value" },
    { line: 30, text: "×3", kind: "firing" },
    { line: 4, text: "1", kind: "value" },
    { line: 41, text: "no panel holds KX155B_2", kind: "error" },
  ]
  assert.deepEqual(byKind(boxes), {
    value: [boxes[0], boxes[2]],
    firing: [boxes[1]],
    error: [boxes[3]],
  })
  assert.deepEqual(byKind([]), { value: [], firing: [], error: [] })
})

test("a hint is its verdict's word, then what the verdict carries", () => {
  const cases: [Hint, string, string][] = [
    [{ word: "landed", detail: "84ms" }, "landed", " 84ms"],
    [{ word: "pending", detail: "1" }, "pending", " 1"],
    [{ word: "never-landed", detail: "0" }, "never landed", " 0"],
    [{ word: "waits-for", detail: "ap_altitude_hold" }, "waits for", " ap_altitude_hold"],
    [{ word: "matches-synced-value", detail: null }, "matches its synced value", ""],
    [{ word: "stopped", detail: null }, "stopped", ""],
    [{ word: "stopped", detail: "the write function ran past 100ms" }, "stopped", ": the write function ran past 100ms"],
  ]
  for (const [hint, word, rest] of cases) assert.deepEqual(hintText(hint), { word, rest }, hint.word)
})

test("each word as a verdict shows its label, and its detail after a space, or an error after a colon as the log does", () => {
  for (const word of Object.keys(WORDS) as Word[]) {
    const { label } = WORDS[word]
    assert.deepEqual(hintText({ word, detail: null }), { word: label, rest: "" })
    assert.deepEqual(hintText({ word, detail: "1" }), { word: label, rest: word === "stopped" || word === "function-failed" ? ": 1" : " 1" })
  }
})

test("a hint is muted, a space after its box, with the dotted underline on its word alone, in each palette", () => {
  assert.deepEqual(hintStyles("dark"), { word: { after: { color: "#a1a1a1", margin: "0 0 0 1ch", textDecoration: "underline dotted" } }, rest: { after: { color: "#a1a1a1" } } })
  assert.deepEqual(hintStyles("light"), { word: { after: { color: "#737373", margin: "0 0 0 1ch", textDecoration: "underline dotted" } }, rest: { after: { color: "#737373" } } })
})
