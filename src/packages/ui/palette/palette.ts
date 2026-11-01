// Dual Input's colors and sizes, the second entry point of @dualinput/ui, which the build that writes
// each page's stylesheet reads in Node, since it brings in Tailwind. The reasons for each choice are in
// record/areas/interface/decisions.md, "The apps take shadcn's Luma look".
//
// Each color is written as hex, since Coherent GT reads hex and not oklch. The kit's stylesheet
// holds most of them as RGB triplets with commas in a custom property, so Tailwind's opacity
// modifiers can write `rgba(var(--primary), 0.8)` (msfs-tailwind's colorVar).

import msfsTailwind, { colorVar } from "msfs-tailwind"

import { ROOT_CLASS } from "../src/lib/root-class.ts"

export { ROOT_CLASS }

export const colors = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  "card-foreground": "#fafafa",
  popover: "#171717",
  "popover-foreground": "#fafafa",
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

/** Tailwind's config for a page: msfs-tailwind, then our colors and sizes, for the source files in `content`. */
export function tailwindConfig(content: string[]) {
  return {
    presets: [msfsTailwind],
    content,
    // Our stylesheet shares the EFB's document with the EFB and its other apps, so a class of ours
    // named like one of theirs, such as `hidden`, must reach only what's inside our root.
    important: `.${ROOT_CLASS}`,
    theme: {
      extend: {
        colors: { ...Object.fromEntries(Object.keys(colors).map((name) => [name, colorVar(name)])), ...washes },
        // Luma draws each corner from a radius of 4px by a step of its own.
        borderRadius: { sm: "2.4px", md: "3.2px", lg: "4px", xl: "5.6px", "2xl": "7.2px", "3xl": "8.8px", "4xl": "10.4px" },
        fontFamily: { sans: ["DualInput Geist", "sans-serif"], mono: ["DualInput Geist Mono", "monospace"] },
        // A card's edge is one real pixel at any scale, from the length the kit's root sets
        // (src/lib/root.tsx), since a root's zoom would round a 1px ring below 1 down to nothing.
        ringWidth: { 1: "var(--hair)", 3: "3px" },
        spacing: { 5.5: "1.375rem" },
        // Keyframes share the document's one namespace too, so ours carry our name.
        keyframes: {
          "dualinput-spin": { to: { transform: "rotate(360deg)" } },
          "dualinput-pop-in": { from: { opacity: "0", transform: "scale(0.95)" }, to: { opacity: "1", transform: "scale(1)" } },
          "dualinput-pop-out": { from: { opacity: "1", transform: "scale(1)" }, to: { opacity: "0", transform: "scale(0.95)" } },
          "dualinput-fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
          "dualinput-fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
          "dualinput-rise-in": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
          "dualinput-caret": { "0%, 50%": { opacity: "1" }, "51%, 100%": { opacity: "0" } },
        },
        animation: {
          spin: "dualinput-spin 1s linear infinite",
          "pop-in": "dualinput-pop-in 100ms ease-out",
          "pop-out": "dualinput-pop-out 100ms ease-in forwards",
          "fade-in": "dualinput-fade-in 100ms ease-out",
          "fade-out": "dualinput-fade-out 100ms ease-in forwards",
          "rise-in": "dualinput-rise-in 200ms ease-out",
          caret: "dualinput-caret 1s step-end infinite",
        },
      },
    },
  }
}
