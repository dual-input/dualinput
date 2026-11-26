// Tests the list of the sync engine's words: it holds exactly the words `serve` sends, each with a label and a
// definition, and the log says each with what it carries (record/areas/profiles/06-the-sync-log.md, "The words").
//
//   node --test src/apps/profile-extension/src/words.test.ts

import assert from "node:assert/strict"
import { test } from "node:test"

import { anchorOf, docsLink, isWord, type Word, WORDS } from "./words.ts"

/**
 * Every word `serve` sends, copied by hand from `said()` and `verdict()` in tools/profile-builder/src/serve/sync_log.rs,
 * so change the three together: a word in words.ts and not here, or here and not there, fails this test, but nothing
 * checks this list against serve's.
 */
const SENT = [
  "local-change",
  "arrived",
  "catch-up",
  "control-passed",
  "sent",
  "replaced",
  "withdrawn",
  "undone",
  "lost",
  "not-sent-during-preflight",
  "put-back",
  "put-back-carries-on",
  "matches-synced-value",
  "not-sent",
  "too-large",
  "stopped",
  "driven",
  "reported-twice",
  "ignored",
  "won",
  "compared",
  "matches",
  "differs",
  "waits-for-first-reading",
  "first-reading",
  "waits-for",
  "now-reads",
  "already-matches",
  "writes",
  "function-failed",
  "pending",
  "read-back",
  "landed",
  "never-landed",
  "warning-skipped",
  "token-used",
  "token-expired",
  "ignore-expired",
  "no-value",
  "dropped-refused",
  "shadow-restored",
  "skipped-stopped",
]

const words = Object.keys(WORDS) as Word[]

test("the list holds exactly the words serve sends", () => {
  assert.deepEqual([...words].sort(), [...SENT].sort())
})

test("every word has a label and a definition of a sentence or two, each sentence ended, short enough to read on a hover", () => {
  for (const word of words) {
    const { label, definition } = WORDS[word]
    assert.ok(label.trim() && label === label.trim(), `${word} has a label`)
    assert.match(definition, /^[A-Z].*\.$/, `${word}'s definition is sentences`)
    const sentences = definition.split(/(?<=\.) (?=[A-Z])/).length
    assert.ok(sentences >= 1 && sentences <= 2, `${word}'s definition has ${sentences} sentences`)
    const length = definition.split(/\s+/).length
    assert.ok(length <= 34, `${word}'s definition runs ${length} words`)
  }
})

test("the words read as the engine's", () => {
  assert.equal(WORDS["matches-synced-value"].label, "matches its synced value")
  assert.equal(WORDS["not-sent-during-preflight"].label, "not sent during preflight")
  assert.equal(WORDS["dropped-refused"].label, "dropped: refused")
  assert.equal(WORDS["skipped-stopped"].label, "skipped: stopped")
  assert.equal(WORDS["token-used"].label, "token used")
  assert.equal(WORDS["read-back"].label, "read back")
  assert.equal(WORDS["waits-for"].label, "waits for")
  assert.equal(WORDS["waits-for-first-reading"].label, "waits for a first reading")
})

test("each word has an anchor of its own from its label, and no docs link while the docs aren't published", () => {
  assert.equal(anchorOf("matches-synced-value"), "matches-its-synced-value")
  assert.equal(anchorOf("dropped-refused"), "dropped-refused")
  assert.equal(new Set(words.map(anchorOf)).size, words.length)
  for (const word of words) assert.equal(docsLink(word), null)
})

test("a key from a message is a word only if the list holds it", () => {
  assert.ok(isWord("landed"))
  assert.ok(!isWord("landd"))
  assert.ok(!isWord("toString"))
})
