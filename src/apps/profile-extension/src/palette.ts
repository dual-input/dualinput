// Which of Dual Input's two palettes a theme gets, and the edit to the author's settings that
// gives it. Dual Input colors every token in a profile itself, so every author reads the same
// colors whatever their theme, and the manifest's configurationDefaults hold a dark palette and a
// light one. VS Code picks the light one by a theme's name alone, through the `[*Light*]` key, so a
// light theme named otherwise gets the dark palette until the extension writes the light one under
// that theme's own key in the author's user settings (record/areas/profiles/03-the-extension.md,
// "Highlighting"). It imports nothing of VS Code's, so Node's test runner tests it alone.
//
// A palette's rules for a script's JavaScript name each scope VS Code's JavaScript grammar gives a
// token, in full and under the script's own scope, as `meta.embedded.block.javascript.dualinput-profile
// keyword.control.flow.js`. VS Code ranks a rule for a longer scope ahead of one for a shorter scope,
// whatever their parent scopes, so a rule for `keyword` in a script loses to Dark+'s for
// `keyword.control` (measured with vscode-textmate 9.3.2 on the JavaScript grammar and the 30 themes
// of a VS Code 1.147.0 install, 2026-11-22). When VS Code's grammar names a new scope, add it to both
// palettes; meanwhile each group's shortest scopes, such as `keyword`, color it in any theme whose
// rules for it are as short.

export type Palette = "dark" | "light"

/** One of `editor.tokenColorCustomizations`' TextMate rules, as the manifest or the author's settings hold it. */
export type Rule = { scope?: unknown; settings?: unknown }

type Settings = Record<string, unknown>

/**
 * The key the manifest gives the light palette under. VS Code matches `[*Light*]` to every theme
 * whose name holds "Light", case and all, and `defaultPalette` reads a name the same way, so
 * change both together.
 */
const LIGHT_KEY = "[*Light*]"

/** The manifest's two palettes, from the `editor.tokenColorCustomizations` in its configurationDefaults. */
export function palettes(manifest: unknown): Record<Palette, Rule[]> {
  const defaults = field(field(field(manifest, "contributes"), "configurationDefaults"), "editor.tokenColorCustomizations")
  return { dark: rules(field(defaults, "textMateRules")), light: rules(field(field(defaults, LIGHT_KEY), "textMateRules")) }
}

/** The palette the manifest's defaults give a theme by its name alone. */
export function defaultPalette(theme: string): Palette {
  return theme.includes("Light") ? "light" : "dark"
}

/**
 * The palette a theme's kind calls for, from the `uiTheme` its contribution declares: `vs` and
 * `hc-light` are light themes, and `vs-dark`, `hc-black`, and a missing one dark, as VS Code reads
 * them.
 */
export function paletteOf(uiTheme: string): Palette {
  return uiTheme === "vs" || uiTheme === "hc-light" ? "light" : "dark"
}

/**
 * The palette the setting `dualInput.colors` forces, `dark` or `light`, or else the one the active theme's kind calls
 * for, from the `uiTheme` a theme of that kind declares. The token colors, the boxes after `watch:` lines, and the Dual
 * Input panel all take it, so a profile reads in one palette.
 */
export function paletteFor(forced: unknown, uiTheme: string): Palette {
  return isForced(forced) ? forced : paletteOf(uiTheme)
}

/** Whether `dualInput.colors` names a palette, rather than `auto`. */
export function isForced(colors: unknown): colors is Palette {
  return colors === "dark" || colors === "light"
}

/**
 * The `uiTheme` of the theme named `theme`, among the themes the extensions' manifests contribute,
 * or undefined when none does. VS Code names a theme in `workbench.colorTheme` by its
 * contribution's `id`, or else its `label`, and reads a missing `uiTheme` as `vs-dark`.
 */
export function uiThemeOf(theme: string, manifests: unknown[]): string | undefined {
  for (const manifest of manifests) {
    const themes = field(field(manifest, "contributes"), "themes")
    if (!Array.isArray(themes)) continue
    for (const contributed of themes) {
      const name = field(contributed, "id") ?? field(contributed, "label")
      if (name !== theme) continue
      const uiTheme = field(contributed, "uiTheme")
      return typeof uiTheme === "string" ? uiTheme : "vs-dark"
    }
  }
  return undefined
}

/**
 * Whether a rule is the extension's: each of its selectors names a scope of the profile language,
 * as `entity.name.tag.block.dualinput-profile` and `meta.embedded.block.javascript.dualinput-profile
 * keyword.control.flow.js` do. An author's own rule for one of those scopes counts as the
 * extension's, so a palette written over it replaces it.
 */
export function isOurs(rule: unknown): boolean {
  const scope = field(rule, "scope")
  const selectors = typeof scope === "string" ? scope.split(",") : Array.isArray(scope) ? scope : []
  return selectors.length > 0 && selectors.every((selector) => typeof selector === "string" && selector.trim().split(/\s+/).some((name) => name.endsWith(".dualinput-profile")))
}

/**
 * The author's global `editor.tokenColorCustomizations`, with the extension's rules under the
 * theme's key set for `palette`: none when the theme's name already gets that palette from the
 * defaults, or else that palette's rules, after the author's own. Every other rule and key stays
 * as it was. VS Code replaces a list of rules whole rather than merging it with the defaults' or
 * the author's, so the result carries the author's rules too.
 *
 * Returns null when nothing changes, and when the setting holds a shape other than VS Code's,
 * which writing would overwrite. A `value` of undefined removes the setting.
 */
export function withPalette(customizations: unknown, theme: string, palette: Palette, all: Record<Palette, Rule[]>): { value: Settings | undefined } | null {
  const settings = copy(customizations)
  const key = `[${theme}]`
  const themed = settings && copy(settings[key])
  const existing = themed?.textMateRules ?? []
  if (!settings || !themed || !Array.isArray(existing)) return null

  const next = [...existing.filter((rule) => !isOurs(rule)), ...(palette === defaultPalette(theme) ? [] : all[palette])]
  if (JSON.stringify(next) === JSON.stringify(existing)) return null
  if (next.length) themed.textMateRules = next
  else delete themed.textMateRules
  if (Object.keys(themed).length) settings[key] = themed
  else delete settings[key]
  return { value: Object.keys(settings).length ? settings : undefined }
}

function isSettings(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A shallow copy of a settings object, an empty one for a missing value, or null for any other value. */
function copy(value: unknown): Settings | null {
  return value === undefined ? {} : isSettings(value) ? { ...value } : null
}

function field(value: unknown, name: string): unknown {
  return isSettings(value) ? value[name] : undefined
}

function rules(value: unknown): Rule[] {
  return Array.isArray(value) ? value.filter(isSettings) : []
}
