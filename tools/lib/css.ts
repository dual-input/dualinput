// Builds a page's stylesheet: the kit's stylesheet with the palette's custom properties, through
// Tailwind 3 on msfs-tailwind, then two steps of our own (record/areas/interface/decisions.md, "The
// kit follows what the sim gives an EFB app").

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { plugins } from "msfs-tailwind"
import postcss from "postcss"
import type { Plugin } from "postcss"

import { ROOT } from "./repo.ts"

/** The kit's package, whose stylesheet and fonts every page's stylesheet starts from. */
export const KIT = path.join(ROOT, "src", "packages", "ui")

/** The source files every page's classes can come from, on top of the page's own. */
const KIT_CONTENT = ["src/packages/ui/src/**/*.{ts,tsx}"]

/**
 * The px each rem of Tailwind's writes. A rem counts from the document's font size, and in the EFB
 * the document is the EFB's, shared with its other apps, so our sizes can't rest on it.
 */
export function remToPx(): Plugin {
  return {
    postcssPlugin: "dualinput-rem-to-px",
    Declaration(decl) {
      if (!decl.value.includes("rem")) return
      const written = decl.value.replace(/(-?\d*\.?\d+)rem\b/g, (_, n: string) => `${Number((Number(n) * 16).toFixed(3))}px`)
      if (written !== decl.value) decl.value = written
    },
  }
}

/**
 * Tailwind writes its `--tw-` defaults on `*`, which in the EFB's document would hand them to every
 * element of the EFB and its other apps, so they go on our root and what's inside it.
 */
export function scopeDefaults(rootClass: string): Plugin {
  return {
    postcssPlugin: "dualinput-scope-defaults",
    Rule(rule) {
      if (!rule.selectors.includes("*")) return
      const scoped = rule.selectors.map((s) => (s === "*" ? `.${rootClass}, .${rootClass} *` : `.${rootClass} ${s}`))
      if (scoped.join() !== rule.selectors.join()) rule.selectors = scoped
    },
  }
}

/**
 * With `important` set to a selector, Tailwind wraps a selector of several parts in `:is()`, as in
 * `.root :is(.space-x-1 > :not([hidden]) ~ :not([hidden]))`, and Coherent GT drops `:is`, which takes
 * the whole rule with it (record/areas/architecture/coherent-gt.md, "CSS"). Under one root the plain
 * form means the same.
 */
export function unwrapIs(): Plugin {
  return {
    postcssPlugin: "dualinput-unwrap-is",
    Rule(rule) {
      if (!rule.selector.includes(":is(")) return
      const plain = rule.selectors.map((s) => s.replace(/^(\.[\w-]+) :is\((.*)\)$/, "$1 $2"))
      if (plain.join() !== rule.selectors.join()) rule.selectors = plain
    },
  }
}

/**
 * Lets a page show a state it can't hold by itself: an element with data-force="hover" draws as if
 * the mouse were on it, and the same for active and focus. It's the kit's page's alone, so nothing of
 * it reaches a stylesheet we ship.
 */
export function forceStates(): Plugin {
  return {
    postcssPlugin: "dualinput-force-states",
    Rule(rule) {
      if (rule.selector.includes("data-force")) return
      // A colon a backslash escapes is part of a class's name, such as hover\:bg-primary.
      const state = /(?<!\\):(hover|active|focus)\b/g
      const forced = rule.selectors.filter((s) => s.search(state) >= 0).map((s) => s.replace(state, '[data-force~="$1"]'))
      if (forced.length) rule.selectors = [...rule.selectors, ...forced]
    },
  }
}

/**
 * The stylesheet of the page whose own source files `content` names, by globs from the root, with
 * any `extra` steps after ours. The palette is loaded fresh on each build, so a long-running
 * development build follows an edit to it.
 */
export async function buildCss(content: string[], extra: Plugin[] = []): Promise<string> {
  const palette = (await import(`${pathToFileURL(path.join(KIT, "palette", "palette.ts")).href}?at=${Date.now()}`)) as typeof import("../../src/packages/ui/palette/palette.ts")
  const from = path.join(KIT, "src", "kit.css")
  const source = fs.readFileSync(from, "utf8").replace("/* @kit-variables */", palette.cssVariables())
  // Tailwind reads its globs from the working directory unless they're whole paths.
  const whole = [...KIT_CONTENT, ...content].map((glob) => path.join(ROOT, glob).split(path.sep).join("/"))
  const result = await postcss([...plugins(palette.tailwindConfig(whole)), remToPx(), scopeDefaults(palette.ROOT_CLASS), unwrapIs(), ...extra]).process(source, { from })
  return result.css
}
