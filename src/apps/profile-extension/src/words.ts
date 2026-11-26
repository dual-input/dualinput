// The sync engine's words, each as the Sync log shows it, with a definition for authors, written once here: the view
// shows a word's definition on hover or click, and the authors' docs take their glossary from this list (record/areas/profiles/06-the-sync-log.md, "The words").
// `serve` sends each word by its key, from `said()` and `verdict()` in tools/profile-builder/src/serve/sync_log.rs, so
// change both together. It imports nothing of VS Code's, so Node's test runner tests it alone, and the Sync log's
// webview bundles it.

/**
 * A word's label, as the log shows it, and what it means, read on a hover: one sentence of what happened, to you, in
 * the words the profile format and the log give an author, and a second only for why or what to do, at most 34 words in
 * all, which words.test.ts checks. A step's own act is in the past tense, waits included, since the log is a record;
 * a rule and what still holds are in the present, as "the pilot flying owns the entry".
 */
export type Definition = { label: string; definition: string }

export const WORDS = {
  "local-change": {
    label: "local change",
    definition: "A change on this PC, by your hand or the aircraft itself, that the engine didn't write.",
  },
  arrived: {
    label: "arrived",
    definition: "A change or firing reached this PC.",
  },
  "catch-up": {
    label: "catch-up",
    definition: "The engine restored this value, as you joined or as a playback started.",
  },
  "control-passed": {
    label: "control passed",
    definition: "You took control, so the engine set each entry the pilot flying owns to the last pilot flying's value, once, where yours differed.",
  },
  sent: {
    label: "sent",
    definition: "Your change went to your crew.",
  },
  replaced: {
    label: "replaced",
    definition: "A newer change of this entry took over before this one finished, so this row ends here and the newer row carries on.",
  },
  withdrawn: {
    label: "withdrawn",
    definition: "The engine dropped your change before sending it.",
  },
  undone: {
    label: "undone",
    definition: "The entry went back to the value it last sent before this went out, so there was nothing new to send.",
  },
  lost: {
    label: "lost",
    definition: "This change and another conflicted, and the other won, as the newer, or as the pilot flying's when neither saw the other, so the engine dropped this one.",
  },
  "not-sent-during-preflight": {
    label: "not sent during preflight",
    definition: "The engine didn't send this change, since it skips cockpit changes during preflight.",
  },
  "put-back": {
    label: "put back",
    definition: "The pilot flying owns this entry, or you were still catching up, so the engine didn't send your change and wrote back the value your crew agreed on.",
  },
  "put-back-carries-on": {
    label: "put back carries on",
    definition: "This change came while a put back was still stepping the entry, so the engine let the put back finish.",
  },
  "matches-synced-value": {
    label: "matches its synced value",
    definition: "The pilot flying owns this entry, or you were catching up, so the engine didn't send your change. It already matched the value your crew agreed on, so nothing went back.",
  },
  "not-sent": {
    label: "not sent",
    definition: "The pilot flying owns this entry, or you were catching up, so the engine didn't send your change. It had nothing to put back: a watch-only entry, an event, or no agreed value.",
  },
  "too-large": {
    label: "too large",
    definition: "The value was over 4 KiB, the most an entry can carry, so the engine didn't send it.",
  },
  stopped: {
    label: "stopped",
    definition: "The entry stopped syncing on this PC until the profile loads again.",
  },
  driven: {
    label: "driven",
    definition: "The aircraft changes this entry on its own: it changed in each 3s window for 30s, and your crew changed it too, so each aircraft keeps its own.",
  },
  "reported-twice": {
    label: "reported twice",
    definition: "The sim reported this press a second time, as it does for some presses, so the engine dropped the repeat.",
  },
  ignored: {
    label: "ignored",
    definition: "The entry's ignore list names this event, a side effect of the entry's own change, so the engine didn't send it.",
  },
  won: {
    label: "won",
    definition: "This change and another conflicted, and this one won, as the newer, or as the pilot flying's when neither saw the other, so the engine dropped the other.",
  },
  compared: {
    label: "compared",
    definition: "The engine compared a crew member's value for this watch-only entry with your reading 1.5s later.",
  },
  matches: {
    label: "matches",
    definition: "Your reading matched the crew member's value 1.5s after it arrived.",
  },
  differs: {
    label: "differs",
    definition: "Your reading differed from the crew member's value 1.5s after it arrived.",
  },
  "waits-for-first-reading": {
    label: "waits for a first reading",
    definition: "The sim hadn't read this entry since the profile loaded, so the write waited for a first reading. A toggle never flips blind.",
  },
  "first-reading": {
    label: "first reading",
    definition: "The sim read the entry for the first time since the profile loaded.",
  },
  "waits-for": {
    label: "waits for",
    definition: "This write waited for the named entry's earlier write to land first, since writes go in the order they came.",
  },
  "now-reads": {
    label: "now reads",
    definition: "While this write waited, another write caused this entry to change to the value it was going to write.",
  },
  "already-matches": {
    label: "already matches",
    definition: "The value to be written was already the value in the sim.",
  },
  writes: {
    label: "writes",
    definition: "The engine set these values or fired these events in the sim.",
  },
  "function-failed": {
    label: "function failed",
    definition: "The entry's write function threw an error. The engine still checks whether the value reads back, as it does for any write.",
  },
  pending: {
    label: "pending",
    definition: "The engine waited up to 1.5s for the sim to read back the written value.",
  },
  "read-back": {
    label: "read back",
    definition: "The sim read back a value the engine wrote, which confirmed the write.",
  },
  landed: {
    label: "landed",
    definition: "The sim read back the last written value.",
  },
  "never-landed": {
    label: "never landed",
    definition: "The sim didn't read back the written value within 1.5s of the write.",
  },
  "warning-skipped": {
    label: "warning skipped",
    definition: "The value didn't read back within 1.5s, but the pilot flying owns this entry, so the engine didn't warn.",
  },
  "token-used": {
    label: "token used",
    definition: "The engine leaves a token for each event it fires. The aircraft's report of that firing used the token up, so the engine didn't send the report back.",
  },
  "token-expired": {
    label: "token expired",
    definition: "The engine leaves a token for each event it fires. No report used it up within 1s, so the engine dropped it, and your next press goes out.",
  },
  "ignore-expired": {
    label: "ignore expired",
    definition: "The event the ignore list expected didn't come within 1s, so the next one goes out.",
  },
  "no-value": {
    label: "no value",
    definition: "This event entry's write sets a variable, but the firing carried no value, so the engine had nothing to write.",
  },
  "dropped-refused": {
    label: "dropped: refused",
    definition: "The sim refused to read this entry, so the engine dropped the write waiting for its first reading, and drops later writes to it at once.",
  },
  "shadow-restored": {
    label: "shadow restored",
    definition: "Back from a restart, your core restored this entry's shadow value from the pilot flying's, and wrote nothing.",
  },
  "skipped-stopped": {
    label: "skipped: stopped",
    definition: "The entry stopped syncing earlier in this load, so the engine skipped the change.",
  },
} satisfies Record<string, Definition>

/** One of the engine's words, by its key, as `serve` sends it. */
export type Word = keyof typeof WORDS

/**
 * The authors' docs' page that defines the words, which each word's link points into at its anchor, or null until those
 * docs are published, when no link shows.
 */
export const DOCS: string | null = null

/** A word's anchor in the authors' docs, from its label, as `matches-its-synced-value`: the docs give each word a heading of its label. */
export function anchorOf(word: Word): string {
  return WORDS[word].label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** The word's link into the authors' docs, or null while `DOCS` names none. */
export function docsLink(word: Word): string | null {
  return DOCS === null ? null : `${DOCS}#${anchorOf(word)}`
}

/** Whether `key` is one of the words, for a key read from a message rather than checked by the compiler. */
export function isWord(key: string): key is Word {
  return Object.prototype.hasOwnProperty.call(WORDS, key)
}

/** A piece of a step as the log says it: one of the engine's words, which the view underlines and defines, or plain text. */
export type Part = { word: Word } | { text: string }

/** Parts as plain text, each word by its label. */
export function textOf(parts: Part[]): string {
  return parts.map((part) => ("word" in part ? WORDS[part.word].label : part.text)).join("")
}

/**
 * What comes between a word and its detail: a colon before an error, as `stopped: Unexpected token` and `function
 * failed: ReferenceError`, and a space before a value, as `read back 1`.
 */
export function apart(word: Word): string {
  return word === "stopped" || word === "function-failed" ? ": " : " "
}

/** The words whose second word says why, as `stopped: driven` and `withdrawn: lost`. */
const REASONED = new Set<Word>(["stopped", "withdrawn"])

/**
 * Whether a word's second word is its reason, which follows a colon, as `withdrawn: lost`, where any other second word
 * is a further fact after a comma, as `read back 1, landed`.
 */
export function reasoned(word: Word): boolean {
  return REASONED.has(word)
}
