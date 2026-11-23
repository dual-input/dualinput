// Dual Input's colors and sizes, the second entry point of @dualinput/ui, which the build that writes
// each page's stylesheet reads in Node, since it brings in Tailwind. The reasons for each choice are in
// record/areas/interface/decisions.md, "The apps take shadcn's Luma look".
//
// Each color is written as hex, since Coherent GT reads hex and not oklch
// (record/areas/architecture/coherent-gt.md, "CSS"). The kit's stylesheet
// holds most of them as RGB triplets with commas in a custom property, so Tailwind's opacity
// modifiers can write `rgba(var(--primary), 0.8)` (msfs-tailwind's colorVar).

import msfsTailwind, { colorVar } from "msfs-tailwind"

import { ROOT_CLASS } from "../src/lib/root-class.ts"

export { ROOT_CLASS }

export const colors = {
  // `background_color` in src/apps/desktop/src/screens.rs and the page in tools/lib/desktop-pages.ts name the same color, for the moment before this stylesheet draws, so change all three together.
  // `UNDER_KEY` in src/features/authoring/panel/src/outline.ts copies it at 80%, so change it there too.
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  "card-foreground": "#fafafa",
  popover: "#171717",
  "popover-foreground": "#fafafa",
  // `COLORS` in src/apps/profile-extension/src/boxes.ts and `SKY` in src/features/authoring/panel/src/outline.ts copy it, since neither can import this file, so change all three together.
  primary: "#74d4ff",
  "primary-foreground": "#052f4a",
  secondary: "#262626",
  "secondary-foreground": "#fafafa",
  muted: "#262626",
  "muted-foreground": "#a1a1a1",
  accent: "#262626",
  "accent-foreground": "#fafafa",
  ring: "#74d4ff",
  // Information, a notification's lowest level; then the warning, trouble, and success colors.
  info: "#bdd7f5",
  "info-foreground": "#0a0a0a",
  // `COLORS` in src/apps/profile-extension/src/boxes.ts copies it, so change both together.
  warning: "#f1be4d",
  "warning-foreground": "#461901",
  destructive: "#ea7977",
  "destructive-foreground": "#460809",
  success: "#6fd58d",
  "success-foreground": "#052e16",
} as const

export type ColorName = keyof typeof colors

// White at a fixed strength, which reads over any gray beneath it. These take no opacity modifier,
// since Tailwind would replace their alpha rather than multiply it, so each strength the kit draws
// has a name: shadcn's `border` and `input` at 10% and 15% of white, and `input` at the 50% a field
// fills with, the 90% a switch's track fills with, and the 30% an outline button hovers at.
const washes = {
  border: "rgba(255, 255, 255, 0.1)",
  input: "rgba(255, 255, 255, 0.15)",
  field: "rgba(255, 255, 255, 0.075)",
  track: "rgba(255, 255, 255, 0.135)",
  "outline-hover": "rgba(255, 255, 255, 0.045)",
  // `secondary` with 5% of `foreground` mixed in, computed in oklch as the frames' color-mix does.
  "secondary-hover": "#2f2f2f",
}

/**
 * The light palette, which a root takes with `palette="light"`, for a page outside the sim whose host is light, such as
 * the profile extension's panel in a light VS Code theme; the apps in the sim stay dark (record/areas/interface/decisions.md,
 * "The apps are dark only"). It takes Tailwind's neutral grays at the steps shadcn's light theme uses, sky-700 as the main
 * color, since sky-300 is too pale for text on white, and the status colors at the steps that read as text on white.
 */
export const lightColors: Record<ColorName, string> = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  "card-foreground": "#0a0a0a",
  popover: "#ffffff",
  "popover-foreground": "#0a0a0a",
  // `COLORS` in src/apps/profile-extension/src/boxes.ts copies it and `warning`, so change them together.
  primary: "#0369a1",
  "primary-foreground": "#f0f9ff",
  secondary: "#f5f5f5",
  "secondary-foreground": "#171717",
  muted: "#f5f5f5",
  "muted-foreground": "#737373",
  accent: "#f5f5f5",
  "accent-foreground": "#171717",
  ring: "#0369a1",
  info: "#475569",
  "info-foreground": "#ffffff",
  warning: "#b45309",
  "warning-foreground": "#ffffff",
  destructive: "#dc2626",
  "destructive-foreground": "#ffffff",
  success: "#15803d",
  "success-foreground": "#ffffff",
}

/** The washes in black for the light palette, at strengths that read on white. */
const lightWashes: Record<keyof typeof washes, string> = {
  border: "rgba(0, 0, 0, 0.1)",
  input: "rgba(0, 0, 0, 0.15)",
  field: "rgba(0, 0, 0, 0.05)",
  track: "rgba(0, 0, 0, 0.12)",
  "outline-hover": "rgba(0, 0, 0, 0.04)",
  "secondary-hover": "#ebebeb",
}

/**
 * Each class the pages draw a wash with, as the selector Tailwind writes for it, with the property it sets and its light
 * value. A wash is a fixed color rather than a custom property, so the dark palette's stylesheet stays as Coherent GT
 * reads it, and the light palette restates each class under its root. When a page draws a wash under another class,
 * add it here, or the light palette leaves it white.
 */
const LIGHT_WASH_CLASSES: [string, string, string][] = [
  [".bg-field", "background-color", lightWashes.field],
  [".bg-track", "background-color", lightWashes.track],
  [".bg-border", "background-color", lightWashes.border],
  [".border-border", "border-color", lightWashes.border],
  [".border-input", "border-color", lightWashes.input],
  [".hover\\:bg-outline-hover:hover", "background-color", lightWashes["outline-hover"]],
  [".hover\\:bg-secondary-hover:hover", "background-color", lightWashes["secondary-hover"]],
  // A choice's pill, white on the muted track as shadcn's light tabs draw it.
  [".bg-input\\/30", "background-color", lightColors.background],
]

/**
 * The light palette's rules, which go in Tailwind's base, ahead of the utilities: the colors as custom properties, the
 * reset's edge, which a class that sets an edge, such as `border-transparent`, still overrides from later in the sheet,
 * and the washes, which carry one more class than the utilities they restate.
 */
function lightRules(): Record<string, Record<string, string>> {
  const root = `.${ROOT_CLASS}[data-palette="light"]`
  return {
    [root]: Object.fromEntries(Object.entries(lightColors).map(([name, hex]) => [`--${name}`, triplet(hex)])),
    [`${root} *, ${root} *::before, ${root} *::after`]: { "border-color": lightWashes.border },
    ...Object.fromEntries(LIGHT_WASH_CLASSES.map(([selector, property, value]) => [`${root} ${selector}`, { [property]: value }])),
  }
}

/** The hex color as the comma-separated triplet colorVar reads. */
function triplet(hex: string): string {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")
}

/** The custom properties a root of the kit sets, as CSS. */
export function cssVariables(): string {
  return Object.entries(colors)
    .map(([name, hex]) => `--${name}: ${triplet(hex)};`)
    .join(" ")
}

/**
 * Every keyframe goes in the stylesheet whether or not a class names it, since Tailwind writes a keyframe only for an
 * `animate-` class in use, and our pages name most of theirs in an inline style, where it can't see them. They share
 * the document's one namespace too, so ours carry our name.
 */
const KEYFRAMES = {
  "dualinput-spin": { to: { transform: "rotate(360deg)" } },
  "dualinput-pop-in": { from: { opacity: "0", transform: "scale(0.95)" }, to: { opacity: "1", transform: "scale(1)" } },
  "dualinput-pop-out": { from: { opacity: "1", transform: "scale(1)" }, to: { opacity: "0", transform: "scale(0.95)" } },
  "dualinput-fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
  "dualinput-fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
  "dualinput-rise-in": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
  "dualinput-caret": { "0%, 50%": { opacity: "1" }, "51%, 100%": { opacity: "0" } },
  "dualinput-ping": { "75%, 100%": { transform: "scale(2)", opacity: "0" } },
  // A head growing out of its window and swelling past its edge before it rests.
  "dualinput-head-pop": {
    "0%": { transform: "scale(0)", "animation-timing-function": "cubic-bezier(0.2, 0.8, 0.4, 1)" },
    "38%": { transform: "scale(1.25)", "animation-timing-function": "ease-in-out" },
    "62%": { transform: "scale(0.9)", "animation-timing-function": "ease-in-out" },
    "82%": { transform: "scale(1.05)", "animation-timing-function": "ease-in-out" },
    "100%": { transform: "scale(1)" },
  },
  // A ring that spreads from a button pressed into a good state, in its text color, and fades.
  "dualinput-ready-pulse": { from: { "box-shadow": "0 0 0 0 currentColor", opacity: "0.6" }, to: { "box-shadow": "0 0 0 8px currentColor", opacity: "0" } },
  // A button held down until it took, swelling past its size before it settles.
  "dualinput-swell": { "0%": { transform: "scale(0.97)" }, "45%": { transform: "scale(1.025)" }, "100%": { transform: "scale(1)" } },
  "dualinput-zoom-in": { from: { opacity: "0", transform: "scale(0.5)" }, to: { opacity: "1", transform: "scale(1)" } },
  "dualinput-sink-out": { from: { opacity: "1", transform: "translateY(0)" }, to: { opacity: "0", transform: "translateY(16px)" } },
  // A page of the guide, drifting 6px the way the turn goes.
  "dualinput-page-in": { from: { opacity: "0", transform: "translateX(6px)" }, to: { opacity: "1", transform: "translateX(0)" } },
  "dualinput-page-in-back": { from: { opacity: "0", transform: "translateX(-6px)" }, to: { opacity: "1", transform: "translateX(0)" } },
  "dualinput-page-out": { from: { opacity: "1", transform: "translateX(0)" }, to: { opacity: "0", transform: "translateX(-6px)" } },
  "dualinput-page-out-back": { from: { opacity: "1", transform: "translateX(0)" }, to: { opacity: "0", transform: "translateX(6px)" } },
  // What arrives as a card turns to its other side.
  "dualinput-turn-in": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
  // A digit of a rolling count, as a counter's wheel turns: the old one up out of its window, the new one up in from below.
  "dualinput-roll-in": { from: { opacity: "0", transform: "translateY(100%)" }, to: { opacity: "1", transform: "translateY(0)" } },
  "dualinput-roll-out": { from: { opacity: "1", transform: "translateY(0)" }, to: { opacity: "0", transform: "translateY(-100%)" } },
}

/** Tailwind's config for a page: msfs-tailwind, then our colors and sizes, for the source files in `content`. */
export function tailwindConfig(content: string[]) {
  return {
    presets: [msfsTailwind],
    content,
    plugins: [
      ({ addBase }: { addBase: (rules: never) => void }) => addBase(Object.fromEntries(Object.entries(KEYFRAMES).map(([name, frames]) => [`@keyframes ${name}`, frames])) as never),
      ({ addBase }: { addBase: (rules: never) => void }) => addBase(lightRules() as never),
    ],
    // Our stylesheet shares the EFB's document with the EFB and its other apps, so a class of ours
    // named like one of theirs, such as `hidden`, must reach only what's inside our root.
    important: `.${ROOT_CLASS}`,
    theme: {
      extend: {
        colors: { ...Object.fromEntries(Object.keys(colors).map((name) => [name, colorVar(name)])), ...washes },
        // Luma draws each corner from a radius of 4px by a step of its own.
        borderRadius: { sm: "2.4px", md: "3.2px", lg: "4px", xl: "5.6px", "2xl": "7.2px", "3xl": "8.8px", "4xl": "10.4px" },
        fontFamily: { sans: ["DualInput Geist", "sans-serif"], mono: ["DualInput Geist Mono", "monospace"], checklist: ["DualInput B612 Mono", "monospace"] },
        // A card's edge is one real pixel at any scale, from the length the kit's root sets
        // (src/lib/root.tsx), since a root's zoom would round a 1px ring below 1 down to nothing.
        ringWidth: { 1: "var(--hair)", 3: "3px" },
        spacing: { 5.5: "1.375rem" },
        animation: {
          spin: "dualinput-spin 1s linear infinite",
          "pop-in": "dualinput-pop-in 100ms ease-out",
          "pop-out": "dualinput-pop-out 100ms ease-in forwards",
          "fade-in": "dualinput-fade-in 100ms ease-out",
          "fade-out": "dualinput-fade-out 100ms ease-in forwards",
          "rise-in": "dualinput-rise-in 200ms ease-out",
          caret: "dualinput-caret 1s step-end infinite",
          ping: "dualinput-ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
          "roll-in": "dualinput-roll-in 250ms ease-out",
          "roll-out": "dualinput-roll-out 250ms ease-in forwards",
          "zoom-in": "dualinput-zoom-in 200ms ease-out",
          "turn-in": "dualinput-turn-in 170ms ease-out",
        },
      },
    },
  }
}
