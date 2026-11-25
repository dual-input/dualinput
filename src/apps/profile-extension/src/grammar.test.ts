// Tests that the grammar gives each look in the highlighting table its scope, and that the
// manifest's palettes color every token it gives one, whatever the theme, through vscode-textmate
// and vscode-oniguruma, the libraries VS Code highlights with (record/areas/profiles/03-the-extension.md,
// "Highlighting"). The fixture's lines come from profiles/aircraft/bksq-baronpro.yaml, copied so a
// change to the profile can't move them, and a few forms the 58P lacks are added below them.
//
// VS Code's own JavaScript grammar ships with VS Code rather than in npm, so a stand-in for
// `source.js` takes its place. Its blocks and brackets nest, as the real one's do, so the test
// shows the grammar's names reaching a script's inner lines, which only its injection can, and its
// scopes are ones the real grammar gives, so the test shows the palette naming them.
//
//   node --test src/apps/profile-extension/src/grammar.test.ts

import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

import oniguruma from "vscode-oniguruma"
import textmate, { type IGrammar, type IRawTheme, type Registry } from "vscode-textmate"

import { palettes } from "./palette.ts"

const GRAMMAR = new URL("../syntaxes/dualinput-profile.tmLanguage.json", import.meta.url)
const PALETTES = palettes(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")))

const JAVASCRIPT = {
  scopeName: "source.js",
  patterns: [
    { match: "//.*$", name: "comment.line.double-slash.js" },
    { begin: "'", end: "'", name: "string.quoted.single.js" },
    { begin: "\\{", end: "\\}", name: "meta.block.js", patterns: [{ include: "$self" }] },
    { begin: "\\(", end: "\\)", beginCaptures: { 0: { name: "meta.brace.round.js" } }, endCaptures: { 0: { name: "meta.brace.round.js" } }, patterns: [{ include: "$self" }] },
    { match: "\\b(?:const|if|else|return)\\b", name: "keyword.control.js" },
    { match: "[A-Za-z_$][\\w$]*", name: "variable.other.readwrite.js" },
  ],
}

const FIXTURE = String.raw`maker: Black Square
name: Baron 58P Professional
status: experimental

aircraft:
  variants:
    press: bksq-aircraft-baronpropress
  pace: 2 frames

seats:
  copilot:
    name: Copilot
    hip: [-0.282, 0.212, -0.09]

state:
  # ═══ ELECTRICAL
  battery:
    name: Battery
    watch: B('ELECTRICAL_Battery_1')
    write:
      toggle: B('ELECTRICAL_Battery_1_Toggle')
    only: [press]
  external_power:
    name: External power
    watch: A('EXTERNAL POWER ON:1', 'Bool')
    write:
      toggle: K('TOGGLE_EXTERNAL_POWER')
    only: press

  # ── Breakers
  # Only the seven breakers that export a variable are synced: the others read through
  breaker_gear_relay:
    name: Landing gear relay breaker
    watch: L('var_Breaker_LandingGearRelay_readonly')
    write:
      toggle: K('ELECTRICAL_BUS_TO_BUS_CONNECTION_TOGGLE', 2, 6)
    only:
      - press
  breaker_starter:
    name: Starter relay breaker
    watch: L('var_Breaker_Starter_readonly')
    write: |
      (value) => {
        if (value == state.breaker_starter) return
        write(K('ELECTRICAL_BUS_TO_CIRCUIT_CONNECTION_TOGGLE', 1, 1))
      }
  throttle_1:
    name: Left throttle
    watch: A('GENERAL ENG THROTTLE LEVER POSITION:1', 'Position 16k')
    owner: pilot_flying
    location:
      press: [0.21, 0.55, 1.92]
  pms50_apga_running:
    name: PMS50 autopilot manager
    watch: L('PMS50_APGA_RUNNING')
    write: none
  kas_arm:
    name: Altitude arm
    watch: instrument('KAS297B_1|Index=1', 'optionalArmingMode')
  kas_armed_vs:
    write: |
      (value) => {
        if (steps > 0) write(H('kas297b_100_INC')).repeat(steps)
      }
  hsi_course:
    name: HSI course
    write:
      wrap: true
      range: [0, 359]

events:
  ap_test:
    name: Autopilot test
    watch: L('var_AutopilotStartupCounter')
    write: |
      () => {
        write(L('var_AutopilotStartupCounter'), 20)
      }
  # === FSC SECTION ===
  # ═══ FSC PADDED ═════════════════════════════════════════════════════════════
  # --- Fsc subsection ---
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    ignore:
      - K('TOGGLE_FLIGHT_DIRECTOR')
    write: |
      (value) => {
        write(K('AP_MASTER'), value).every('2 frames')
        // write(K('IN_A_COMMENT'))
        const note = 'state'
        write(A("DOUBLE QUOTED", 'Bool'), value)
        const all = items.every((item) => item)
        const rule = '-'.repeat(3)
        const some = items.filter((item) => item).every((item) => item)
        const many = items
          .every((item) => item)
        write(K('AP_MASTER'), list.every((item) => item))
        write(K('AP_MASTER')); const after = list.every((item) => item)
        write(K('AP_MASTER'))
          .repeat(2)
          .every('3 frames')
      }
  after_script:
    name: After a script # with a trailing comment
    watch: K('NESTED', round(value))
    note: 'quoted: value'`

const LINES = FIXTURE.split("\n")

type Token = { startIndex: number; endIndex: number; scopes: string[] }
/** A character's color and font style, as `IRawTheme`'s `fontStyle` flags: 1 italic, 2 bold, 4 underline. */
type Look = { color: string; fontStyle: number }

let loaded: Promise<{ registry: Registry; grammar: IGrammar }> | undefined

async function load(): Promise<{ registry: Registry; grammar: IGrammar }> {
  const require = createRequire(import.meta.url)
  const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"))
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: (sources) => new oniguruma.OnigScanner(sources), createOnigString: (text) => new oniguruma.OnigString(text) }),
    loadGrammar: async (scope) => {
      if (scope === "source.dualinput-profile") return textmate.parseRawGrammar(fs.readFileSync(GRAMMAR, "utf8"), GRAMMAR.pathname)
      if (scope === "source.js") return textmate.parseRawGrammar(JSON.stringify(JAVASCRIPT), "javascript.json")
      return null
    },
  })
  const grammar = await registry.loadGrammar("source.dualinput-profile")
  assert.ok(grammar)
  return { registry, grammar }
}

let tokens: Promise<Token[][]> | undefined

async function tokenize(): Promise<Token[][]> {
  const { grammar } = await (loaded ??= load())
  let stack = textmate.INITIAL
  return LINES.map((line) => {
    const result = grammar.tokenizeLine(line, stack)
    stack = result.ruleStack
    return result.tokens
  })
}

/**
 * Each character's look on each of the fixture's lines, under a theme of these rules. VS Code
 * packs a token's look into its metadata, with the font style at bits 11 to 14 and the color's
 * index at bits 15 to 23, by vscode-textmate's `EncodedTokenAttributes`, which it doesn't export.
 */
async function paint(settings: IRawTheme["settings"]): Promise<Look[][]> {
  const { registry, grammar } = await (loaded ??= load())
  registry.setTheme({ settings })
  const colors = registry.getColorMap()
  let stack = textmate.INITIAL
  return LINES.map((line) => {
    const result = grammar.tokenizeLine2(line, stack)
    stack = result.ruleStack
    const looks: Look[] = []
    for (let at = 0; at < result.tokens.length; at += 2) {
      const metadata = result.tokens[at + 1]!
      const end = at + 2 < result.tokens.length ? result.tokens[at + 2]! : line.length
      for (let char = result.tokens[at]!; char < end; char++) looks[char] = { color: colors[(metadata >>> 15) & 0x1ff]!.toLowerCase(), fontStyle: (metadata >>> 11) & 0xf }
    }
    return looks
  })
}

/** The scopes of each token that covers part of `text` on the fixture's line `line`. */
async function scopesOf(line: string, text: string): Promise<string[][]> {
  const at = LINES.indexOf(line)
  assert.notEqual(at, -1, `the fixture has no line ${JSON.stringify(line)}`)
  const start = line.indexOf(text)
  assert.notEqual(start, -1, `${JSON.stringify(line)} holds no ${JSON.stringify(text)}`)
  const end = start + text.length
  tokens ??= tokenize()
  return (await tokens)[at]!.filter((token) => token.startIndex < end && token.endIndex > start).map((token) => token.scopes)
}

/** Fails unless every part of `text` on `line` carries `scope`. */
async function looks(line: string, text: string, scope: string): Promise<void> {
  for (const scopes of await scopesOf(line, text)) assert.ok(scopes.includes(scope), `${JSON.stringify(text)} in ${JSON.stringify(line)} has ${scopes.join(" ")}, not ${scope}`)
}

/** Fails if any part of `text` on `line` carries a scope that starts with `prefix`. */
async function lacks(line: string, text: string, prefix: string): Promise<void> {
  for (const scopes of await scopesOf(line, text)) assert.ok(!scopes.some((scope) => scope.startsWith(prefix)), `${JSON.stringify(text)} in ${JSON.stringify(line)} has ${scopes.join(" ")}`)
}

/** The look of the first character of `text` on `line`, under a palette alone. */
function lookOf(painted: Look[][], line: string, text: string): Look {
  const at = LINES.indexOf(line)
  assert.notEqual(at, -1, `the fixture has no line ${JSON.stringify(line)}`)
  return painted[at]![line.indexOf(text)]!
}

const KIND = "entity.name.function.kind.dualinput-profile"
const NAME = "string.other.name.dualinput-profile"
const ARGUMENT = "variable.parameter.argument.dualinput-profile"
const PUNCTUATION = "punctuation.name-call.dualinput-profile"
const GIVEN = "variable.language.given.dualinput-profile"
const STATE_KEY = "variable.other.property.entry.dualinput-profile"
const BUILTIN = "support.function.builtin.dualinput-profile"
const SCRIPT = "meta.embedded.block.javascript.dualinput-profile"
const BLOCK = "entity.name.tag.block.dualinput-profile"
const FIELD = "entity.name.tag.field.dualinput-profile"
const ENTRY = "entity.name.tag.entry.dualinput-profile"
const PLAIN = "string.unquoted.plain.dualinput-profile"
const NUMBER = "constant.numeric.dualinput-profile"
const WORD = "keyword.other.word.dualinput-profile"
const VARIANT = "constant.other.variant.dualinput-profile"
const PACE = "constant.numeric.pace.dualinput-profile"
const SECTION = "markup.heading.section.dualinput-profile"
const SUBSECTION = "markup.heading.subsection.dualinput-profile"
const COMMENT = "comment.line.number-sign.dualinput-profile"

test("a name call's kind, name, other arguments, and punctuation each take their own scope", async () => {
  const line = "    watch: A('EXTERNAL POWER ON:1', 'Bool')"
  await looks(line, "A", KIND)
  await looks(line, "EXTERNAL POWER ON:1", NAME)
  await looks(line, "Bool", ARGUMENT)
  for (const at of ["(", "'", ",", ")"]) await looks(line, at, PUNCTUATION)
  const numbers = "      toggle: K('ELECTRICAL_BUS_TO_BUS_CONNECTION_TOGGLE', 2, 6)"
  await looks(numbers, "2", ARGUMENT)
  await looks(numbers, "6", ARGUMENT)
  await looks("    watch: instrument('KAS297B_1|Index=1', 'optionalArmingMode')", "instrument", KIND)
  await looks("    watch: instrument('KAS297B_1|Index=1', 'optionalArmingMode')", "KAS297B_1|Index=1", NAME)
  await looks("      - K('TOGGLE_FLIGHT_DIRECTOR')", "K", KIND)
  await looks("      - K('TOGGLE_FLIGHT_DIRECTOR')", "TOGGLE_FLIGHT_DIRECTOR", NAME)
  const nested = "    watch: K('NESTED', round(value))"
  await looks(nested, "round", ARGUMENT)
  await looks(nested, "value", ARGUMENT)
  await looks(nested, "))", PUNCTUATION)
})

test("a script is JavaScript, with Dual Input's names painted at every depth", async () => {
  await looks("        if (value == state.breaker_starter) return", "if", SCRIPT)
  await looks("        if (value == state.breaker_starter) return", "if", "keyword.control.js")
  await looks("      (value) => {", "value", GIVEN)
  await looks("        if (value == state.breaker_starter) return", "value", GIVEN)
  await looks("        if (value == state.breaker_starter) return", "state", GIVEN)
  await looks("        if (value == state.breaker_starter) return", "breaker_starter", STATE_KEY)
  const call = "        write(K('ELECTRICAL_BUS_TO_CIRCUIT_CONNECTION_TOGGLE', 1, 1))"
  await looks(call, "write", BUILTIN)
  await looks(call, "K", KIND)
  await looks(call, "ELECTRICAL_BUS_TO_CIRCUIT_CONNECTION_TOGGLE", NAME)
  await looks(call, "1", ARGUMENT)
  const chain = "        if (steps > 0) write(H('kas297b_100_INC')).repeat(steps)"
  await looks(chain, "repeat", BUILTIN)
  await looks(chain, "kas297b_100_INC", NAME)
  await looks(chain, "steps", "variable.other.readwrite.js")
  const every = "        write(K('AP_MASTER'), value).every('2 frames')"
  await looks(every, "every", BUILTIN)
  await looks(every, "value", GIVEN)
  await looks("        write(A(\"DOUBLE QUOTED\", 'Bool'), value)", "DOUBLE QUOTED", NAME)
})

test("a script's .every() and .repeat() are Dual Input's only in a chain that write() starts, on one line or across several", async () => {
  await lacks("        const all = items.every((item) => item)", "every", BUILTIN)
  await lacks("        const rule = '-'.repeat(3)", "repeat", BUILTIN)
  await lacks("        const some = items.filter((item) => item).every((item) => item)", "every", BUILTIN)
  await lacks("          .every((item) => item)", "every", BUILTIN)
  await lacks("        write(K('AP_MASTER'), list.every((item) => item))", "every", BUILTIN)
  await looks("        write(K('AP_MASTER'), list.every((item) => item))", "AP_MASTER", NAME)
  await lacks("        write(K('AP_MASTER')); const after = list.every((item) => item)", "every", BUILTIN)
  await looks("          .repeat(2)", "repeat", BUILTIN)
  await looks("          .every('3 frames')", "every", BUILTIN)
  await looks("          .every('3 frames')", "3 frames", PACE)
})

test("a script's comments and strings hold no names", async () => {
  await lacks("        // write(K('IN_A_COMMENT'))", "write", BUILTIN)
  await lacks("        // write(K('IN_A_COMMENT'))", "K", KIND)
  await looks("        // write(K('IN_A_COMMENT'))", "IN_A_COMMENT", "comment.line.double-slash.js")
  await lacks("        const note = 'state'", "state", GIVEN)
})

test("a script ends at the first line not indented below its key", async () => {
  await looks("  after_script:", "after_script", ENTRY)
  await lacks("  after_script:", "after_script", SCRIPT)
  await looks("  throttle_1:", "throttle_1", ENTRY)
})

test("blocks, fields, and entries' keys take their own scopes", async () => {
  await looks("state:", "state", BLOCK)
  await looks("events:", "events", BLOCK)
  await looks("maker: Black Square", "maker", BLOCK)
  await looks("  battery:", "battery", ENTRY)
  await looks("  copilot:", "copilot", ENTRY)
  await looks("    name: Battery", "name", FIELD)
  await looks("      toggle: B('ELECTRICAL_Battery_1_Toggle')", "toggle", FIELD)
  await looks("  variants:", "variants", FIELD)
  await looks("    location:", "location", FIELD)
})

test("a variant ID takes the variant scope where `variants` declares it and where `only` and a `location` map use it", async () => {
  await looks("    press: bksq-aircraft-baronpropress", "press", VARIANT)
  await looks("    press: bksq-aircraft-baronpropress", "bksq-aircraft-baronpropress", PLAIN)
  await looks("    only: [press]", "only", FIELD)
  await looks("    only: [press]", "press", VARIANT)
  await looks("    only: [press]", "[", "punctuation.definition.sequence.begin.dualinput-profile")
  await looks("    only: press", "press", VARIANT)
  await looks("      - press", "press", VARIANT)
  await looks("      - press", "-", "punctuation.definition.block.sequence.item.dualinput-profile")
  await looks("      press: [0.21, 0.55, 1.92]", "press", VARIANT)
  await looks("      press: [0.21, 0.55, 1.92]", "0.21", NUMBER)
  await looks("    owner: pilot_flying", "owner", FIELD)
})

test("a pace takes the pace scope, in the YAML and in a chain's .every()", async () => {
  await looks("  pace: 2 frames", "2 frames", PACE)
  await looks("        write(K('AP_MASTER'), value).every('2 frames')", "2 frames", PACE)
  await lacks("name: Baron 58P Professional", "58P", PACE)
})

test("values, numbers, and YAML's punctuation take their own scopes", async () => {
  await looks("name: Baron 58P Professional", "Baron 58P Professional", PLAIN)
  await looks("    press: bksq-aircraft-baronpropress", "bksq-aircraft-baronpropress", PLAIN)
  await looks("    name: After a script # with a trailing comment", "After a script", PLAIN)
  await lacks("    name: After a script # with a trailing comment", "# with", PLAIN)
  await looks("    name: After a script # with a trailing comment", "# with a trailing comment", COMMENT)
  await looks("    note: 'quoted: value'", "quoted: value", "string.quoted.single.dualinput-profile")
  await looks("    note: 'quoted: value'", "'", "punctuation.definition.string.begin.dualinput-profile")
  await lacks("    watch: B('ELECTRICAL_Battery_1')", "B('", PLAIN)
  await lacks("      wrap: true", "true", PLAIN)
  await looks("    hip: [-0.282, 0.212, -0.09]", "-0.282", NUMBER)
  await looks("      range: [0, 359]", "359", NUMBER)
  await looks("      range: [0, 359]", "[", "punctuation.definition.sequence.begin.dualinput-profile")
  await looks("      range: [0, 359]", ",", "punctuation.separator.sequence.dualinput-profile")
  await looks("maker: Black Square", ":", "punctuation.separator.key-value.mapping.dualinput-profile")
  await looks("      - K('TOGGLE_FLIGHT_DIRECTOR')", "-", "punctuation.definition.block.sequence.item.dualinput-profile")
  await looks("    write: |", "|", "punctuation.definition.block.scalar.dualinput-profile")
  await looks("        if (value == state.breaker_starter) return", ".", "punctuation.accessor.dualinput-profile")
})

test("the format's words take the keyword scope", async () => {
  await looks("status: experimental", "experimental", WORD)
  await looks("    owner: pilot_flying", "pilot_flying", WORD)
  await looks("    write: none", "none", WORD)
  await looks("      wrap: true", "true", WORD)
  await lacks("name: Baron 58P Professional", "Professional", "keyword")
})

test("headings take a section's or a subsection's scope, in each of their forms, and other comments stay comments", async () => {
  for (const line of ["  # ═══ ELECTRICAL", "  # === FSC SECTION ===", "  # ═══ FSC PADDED ═════════════════════════════════════════════════════════════"]) {
    await looks(line, line.trim(), SECTION)
    await looks(line, line.trim(), COMMENT)
  }
  for (const line of ["  # ── Breakers", "  # --- Fsc subsection ---"]) await looks(line, line.trim(), SUBSECTION)
  const prose = "  # Only the seven breakers that export a variable are synced: the others read through"
  await looks(prose, prose.trim(), COMMENT)
  await lacks(prose, prose.trim(), "markup.heading")
  await lacks(prose, "export", FIELD)
})

for (const palette of ["dark", "light"] as const) {
  test(`the ${palette} palette colors every character, over a theme with a rule for each of its scopes`, async () => {
    // A theme's rule for the very scope a token carries is the most a theme can do, so the palette
    // outranking these outranks any theme. VS Code puts an author's and an extension's rules after
    // the theme's, as this does.
    const scopes = new Set((await (tokens ??= tokenize())).flat().flatMap((token) => token.scopes))
    const theme = [...scopes].map((scope) => ({ scope, settings: { foreground: "#ff00ff", fontStyle: "italic bold underline" } }))
    const rules = PALETTES[palette] as IRawTheme["settings"]
    const base = { settings: { foreground: "#ff00ff", background: "#000000" } }
    const ours = await paint([base, ...rules])
    const theirs = await paint([base, ...theme, ...rules])
    ours.forEach((line, at) =>
      line.forEach((look, char) => {
        const where = `${JSON.stringify(LINES[at]!.slice(char, char + 12))} in ${JSON.stringify(LINES[at])}`
        assert.notEqual(look.color, "#ff00ff", `${where} has no color of the palette's`)
        assert.deepEqual(theirs[at]![char], look, `the theme colors ${where}`)
      }),
    )
  })

  test(`the ${palette} palette gives each name one look wherever it's declared and used, and tells the looks apart`, async () => {
    const painted = await paint([{ settings: { foreground: "#ff00ff" } }, ...(PALETTES[palette] as IRawTheme["settings"])])
    // A block's key and an entry's key are what an author navigates by, and a field's key sits under them.
    const block = lookOf(painted, "state:", "state")
    const field = lookOf(painted, "    name: Battery", "name")
    const entry = lookOf(painted, "  battery:", "battery")
    assert.deepEqual(entry, block)
    assert.notDeepEqual(field, entry)
    assert.deepEqual(lookOf(painted, "        if (value == state.breaker_starter) return", "breaker_starter"), entry)
    // A variant ID looks the same where it's declared and where it's used, as a value the format reads does.
    const variant = lookOf(painted, "    press: bksq-aircraft-baronpropress", "press")
    for (const line of ["    only: [press]", "    only: press", "      - press", "      press: [0.21, 0.55, 1.92]"]) assert.deepEqual(lookOf(painted, line, "press"), variant)
    const number = lookOf(painted, "      range: [0, 359]", "359")
    for (const [line, text] of [["  pace: 2 frames", "2 frames"], ["        write(K('AP_MASTER'), value).every('2 frames')", "2 frames"], ["    write: none", "none"], ["    owner: pilot_flying", "pilot_flying"]]) {
      assert.deepEqual(lookOf(painted, line!, text!), number, `${text} looks like a number`)
    }
    assert.deepEqual(variant, number)
    // Text an author writes looks the same as a value in the YAML and as a string in a script.
    const plain = lookOf(painted, "    name: Battery", "Battery")
    assert.deepEqual(lookOf(painted, "        const note = 'state'", "state"), plain)
    assert.notDeepEqual(plain, number)
    const call = "    watch: A('EXTERNAL POWER ON:1', 'Bool')"
    const parts = ["A", "EXTERNAL", "Bool", "("].map((text) => lookOf(painted, call, text))
    assert.equal(new Set(parts.map((look) => JSON.stringify(look))).size, parts.length, "a name call's kind, name, arguments, and punctuation share a look")
  })
}
