// Tests which palette a theme gets, and the edit that writes it under the theme's key in the
// author's settings while keeping the author's own rules (record/areas/profiles/03-the-extension.md,
// "Highlighting"). The palettes are the manifest's own.
//
//   node --test src/apps/profile-extension/src/palette.test.ts

import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "node:test"

import { defaultPalette, isOurs, paletteFor, paletteOf, palettes, uiThemeOf, withPalette } from "./palette.ts"

const MANIFEST: unknown = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const ALL = palettes(MANIFEST)
const AUTHOR = { scope: "comment", settings: { fontStyle: "" } }

test("the manifest holds a dark and a light palette over the same scopes, every rule one the extension can take back out", () => {
  const scopes = (palette: typeof ALL.dark) => palette.map((rule) => rule.scope)
  assert.ok(ALL.dark.length > 0)
  assert.deepEqual(scopes(ALL.light), scopes(ALL.dark))
  for (const rule of [...ALL.dark, ...ALL.light]) assert.ok(isOurs(rule), `${JSON.stringify(rule.scope)} isn't the extension's`)
  assert.notDeepEqual(ALL.light, ALL.dark)
})

test("a theme's kind takes its palette, and the defaults give one by the theme's name alone", () => {
  assert.equal(paletteOf("vs"), "light")
  assert.equal(paletteOf("hc-light"), "light")
  assert.equal(paletteOf("vs-dark"), "dark")
  assert.equal(paletteOf("hc-black"), "dark")
  assert.equal(defaultPalette("Solarized Light"), "light")
  assert.equal(defaultPalette("GitHub Light Default"), "light")
  assert.equal(defaultPalette("Dark Modern"), "dark")
  // VS Code matches `[*Light*]` case and all, so a light theme named otherwise gets the dark palette.
  assert.equal(defaultPalette("Catppuccin Latte"), "dark")
  assert.equal(defaultPalette("Moonlight"), "dark")
})

test("dualInput.colors forces its palette over the theme's kind, and auto leaves the kind's", () => {
  assert.equal(paletteFor("light", "vs-dark"), "light")
  assert.equal(paletteFor("dark", "vs"), "dark")
  assert.equal(paletteFor("auto", "vs"), "light")
  assert.equal(paletteFor(undefined, "hc-black"), "dark")
})

test("a theme is found by its contribution's id, or else its label", () => {
  const manifests = [
    { contributes: { themes: [{ id: "Dark Modern", label: "%darkModern%", uiTheme: "vs-dark" }] } },
    { contributes: { languages: [] } },
    { contributes: { themes: [{ label: "Catppuccin Latte", uiTheme: "vs" }, { label: "No Kind" }] } },
  ]
  assert.equal(uiThemeOf("Dark Modern", manifests), "vs-dark")
  assert.equal(uiThemeOf("Catppuccin Latte", manifests), "vs")
  assert.equal(uiThemeOf("No Kind", manifests), "vs-dark")
  assert.equal(uiThemeOf("%darkModern%", manifests), undefined)
  assert.equal(uiThemeOf("Missing", manifests), undefined)
})

test("a light theme the defaults give the dark palette gets the light one, after the author's own rules", () => {
  assert.deepEqual(withPalette(undefined, "Catppuccin Latte", "light", ALL), { value: { "[Catppuccin Latte]": { textMateRules: ALL.light } } })
  const mine = { textMateRules: [AUTHOR], "[Catppuccin Latte]": { comments: "#00ff00", textMateRules: [AUTHOR] } }
  assert.deepEqual(withPalette(mine, "Catppuccin Latte", "light", ALL), {
    value: { textMateRules: [AUTHOR], "[Catppuccin Latte]": { comments: "#00ff00", textMateRules: [AUTHOR, ...ALL.light] } },
  })
})

test("a dark theme whose name holds Light gets the dark palette", () => {
  assert.deepEqual(withPalette(undefined, "Moonlight Light", "dark", ALL), { value: { "[Moonlight Light]": { textMateRules: ALL.dark } } })
})

test("rules an older release wrote give way to the manifest's, and the palette the name already gets takes them out", () => {
  const older = { scope: "entity.name.tag.block.dualinput-profile", settings: { foreground: "#000000" } }
  const written = { "[Catppuccin Latte]": { textMateRules: [AUTHOR, older] }, "[Dark Modern]": { comments: "#00ff00" } }
  assert.deepEqual(withPalette(written, "Catppuccin Latte", "light", ALL), {
    value: { "[Catppuccin Latte]": { textMateRules: [AUTHOR, ...ALL.light] }, "[Dark Modern]": { comments: "#00ff00" } },
  })
  // `dualInput.colors` set to `dark` asks for the palette the name gets from the defaults.
  assert.deepEqual(withPalette(written, "Catppuccin Latte", "dark", ALL), {
    value: { "[Catppuccin Latte]": { textMateRules: [AUTHOR] }, "[Dark Modern]": { comments: "#00ff00" } },
  })
})

test("taking the last rule out of a key drops the key, and of the setting drops the setting", () => {
  assert.deepEqual(withPalette({ "[Catppuccin Latte]": { textMateRules: ALL.light }, editorDefault: true }, "Catppuccin Latte", "dark", ALL), { value: { editorDefault: true } })
  assert.deepEqual(withPalette({ "[Catppuccin Latte]": { textMateRules: ALL.light } }, "Catppuccin Latte", "dark", ALL), { value: undefined })
})

test("a setting that already holds what the theme needs is left alone", () => {
  assert.equal(withPalette(undefined, "Dark Modern", "dark", ALL), null)
  assert.equal(withPalette({ "[Solarized Light]": { textMateRules: [AUTHOR] } }, "Solarized Light", "light", ALL), null)
  assert.equal(withPalette({ "[Catppuccin Latte]": { textMateRules: [AUTHOR, ...ALL.light] } }, "Catppuccin Latte", "light", ALL), null)
})

test("a setting of a shape VS Code doesn't write is left alone rather than overwritten", () => {
  assert.equal(withPalette("#ff0000", "Catppuccin Latte", "light", ALL), null)
  assert.equal(withPalette({ "[Catppuccin Latte]": [] }, "Catppuccin Latte", "light", ALL), null)
  assert.equal(withPalette({ "[Catppuccin Latte]": { textMateRules: "comment" } }, "Catppuccin Latte", "light", ALL), null)
})

test("only a rule whose every selector names a profile scope is the extension's", () => {
  assert.ok(isOurs({ scope: "entity.name.tag.block.dualinput-profile" }))
  assert.ok(isOurs({ scope: "meta.embedded.block.javascript.dualinput-profile keyword.control.flow.js" }))
  assert.ok(isOurs({ scope: "source.dualinput-profile, string.other.name.dualinput-profile" }))
  assert.ok(!isOurs({ scope: ["entity.name.tag.block.dualinput-profile", "comment"] }))
  assert.ok(!isOurs({ scope: "keyword.control.flow.js" }))
  assert.ok(!isOurs({ scope: "" }))
  assert.ok(!isOurs({ settings: { foreground: "#ffffff" } }))
  assert.ok(!isOurs("entity.name.tag.block.dualinput-profile"))
})
