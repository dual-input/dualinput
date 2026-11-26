// The colors the Sync log paints entry keys, values, and a write's name calls in: Dual Input's own token colors, the
// ones the manifest's configurationDefaults give each scope of the profile grammar, so a key, a value, or a name in the
// log looks as it does in the profile, in either palette (record/areas/profiles/03-the-extension.md, "Highlighting").
// The extension and the log's dev page read the colors from the manifest with `syntaxes()`, and the extension posts the
// active palette's to the log's webview. It imports nothing of VS Code's, so Node's test runner tests it alone, and the
// webview and its dev page bundle it.

import { type Palette, palettes, type Rule } from "./palette.ts"

/**
 * Each part of a profile the log shows, by the scope the grammar in syntaxes/dualinput-profile.tmLanguage.json gives it
 * in the editor, so change them together.
 */
export const SCOPES = {
  entry: "entity.name.tag.entry.dualinput-profile",
  kind: "entity.name.function.kind.dualinput-profile",
  name: "string.other.name.dualinput-profile",
  argument: "variable.parameter.argument.dualinput-profile",
  punctuation: "punctuation.name-call.dualinput-profile",
  number: "constant.numeric.dualinput-profile",
  text: "string.quoted.single.dualinput-profile",
} as const

export type SyntaxPart = keyof typeof SCOPES

/** A part's look, from its rule's `foreground` and `fontStyle`. */
export type Look = { color: string; bold: boolean; italic: boolean }

/** Each part's look in one palette, without a part no rule colors. */
export type Syntax = Partial<Record<SyntaxPart, Look>>

/** The look a palette's rules give each part: the last rule that names its scope, as VS Code reads a list of rules. */
export function syntaxOf(rules: Rule[]): Syntax {
  const syntax: Syntax = {}
  for (const part of Object.keys(SCOPES) as SyntaxPart[]) {
    for (const { scope, settings } of rules) {
      const scopes = typeof scope === "string" ? scope.split(",").map((one) => one.trim()) : Array.isArray(scope) ? scope : []
      if (!scopes.includes(SCOPES[part]) || typeof settings !== "object" || settings === null) continue
      const { foreground, fontStyle } = settings as { foreground?: unknown; fontStyle?: unknown }
      if (typeof foreground !== "string") continue
      const style = typeof fontStyle === "string" ? fontStyle : ""
      syntax[part] = { color: foreground, bold: style.includes("bold"), italic: style.includes("italic") }
    }
  }
  return syntax
}

/** Each palette's looks, from the token colors the extension's manifest gives the profile grammar's scopes. */
export function syntaxes(manifest: unknown): Record<Palette, Syntax> {
  const rules = palettes(manifest)
  return { dark: syntaxOf(rules.dark), light: syntaxOf(rules.light) }
}
