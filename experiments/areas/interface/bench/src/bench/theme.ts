// Builds shadcn's dark tokens for one combination of the bench's switches, from Tailwind's
// own palette, so every base gray shadcn offers comes out as shadcn's CLI would write it:
// background at step 950, cards at 900, muted surfaces at 800, and so on.
import themeCss from "tailwindcss/theme.css?raw"

export type Theme = {
  preset: string
  base: string
  accent: string
  shade: number
  custom: string
  radius: number
  font: string
  info: string
  infoChroma?: number
  statusShade?: number
  statusCap?: number
  warningHue?: string
  troubleHue?: string
  successHue?: string
  chip?: string
}

// The status colors' switches. A cap on chroma, oklch's saturation, can hold every status
// color to sky-300's 0.111, so none is louder than the main color.
export const STATUS_SHADES = [200, 300, 400]
export const STATUS_CAPS = [0, 0.14, 0.111, 0.09, 0.07]
export const WARNING_HUES = ["amber", "yellow", "orange"]
export const TROUBLE_HUES = ["red", "rose"]
export const SUCCESS_HUES = ["emerald", "green", "teal"]
export const CHIPS = ["soft", "solid", "outline", "dot"]
// Slate-300's own chroma is 0.022; more of it moves information farther from the neutral grays.
export const INFO_CHROMAS = [0.022, 0.03, 0.04, 0.05, 0.06]

// Candidates for information's color. "neutral" gives it the base gray's step 200, "slate"
// a gray with a cool tint, "main" the main color itself, and the rest their step 400:
// blue sits at a hue of 255° and cyan at 212°, either side of sky-300's 230°, teal at
// 182°, near success's emerald at 163°, and indigo and violet at 277° and 294°.
export const INFO_COLORS = ["neutral", "slate", "main", "blue", "cyan", "teal", "indigo", "violet"]

// A Tailwind color with its chroma held to a cap, which 0 turns off.
function capped(name: string, step: number, cap: number) {
  const m = color(name, step).match(/oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/)
  if (!m || !cap || Number(m[2]) <= cap) return color(name, step)
  return `oklch(${m[1]}% ${cap} ${m[3]})`
}

function infoColor(t: Theme, g: (step: number) => string, accent: string | null) {
  if (t.info === "neutral") return g(200)
  if (t.info === "slate") return `oklch(86.9% ${t.infoChroma ?? 0.022} 252.894)`
  if (t.info === "main") return accent ?? g(200)
  return color(t.info ?? "neutral", 400)
}

export const PRESETS = ["nova", "vega", "maia", "lyra", "mira", "luma", "sera", "rhea"]
export const BASES = ["neutral", "stone", "zinc", "mauve", "olive", "mist", "taupe", "gray", "slate"]
export const HUES = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"]
export const RADII = [0, 0.25, 0.375, 0.5, 0.625, 0.75, 1]
export const FONTS: Record<string, { label: string; sans: string; mono: string }> = {
  geist: { label: "Geist", sans: "'Geist Variable', sans-serif", mono: "'Geist Mono Variable', monospace" },
  inter: { label: "Inter", sans: "'Inter Variable', sans-serif", mono: "'JetBrains Mono Variable', monospace" },
  roboto: { label: "Roboto, the sim's", sans: "'Roboto', sans-serif", mono: "'Roboto Mono', monospace" },
  plex: { label: "IBM Plex Sans", sans: "'IBM Plex Sans', sans-serif", mono: "'IBM Plex Mono', monospace" },
  figtree: { label: "Figtree", sans: "'Figtree Variable', sans-serif", mono: "'JetBrains Mono Variable', monospace" },
}
// The pilots' figure colors p24 showed, for the avatar swatches and the crew's dots.
export const PILOT_COLORS = ["red", "blue", "green", "yellow", "purple", "teal", "pink", "orange"]

// The user's pick of 2026-10-25 (record/areas/interface/decisions.md).
export const DEFAULT_THEME: Theme = { preset: "nova", base: "neutral", accent: "sky", shade: 300, custom: "#00b4ff", radius: 0.625, font: "geist", info: "slate",
  infoChroma: 0.05, statusShade: 400, statusCap: 0.14, warningHue: "amber", troubleHue: "red", successHue: "green", chip: "soft" }

const PALETTE: Record<string, Record<number, string>> = {}
for (const m of themeCss.matchAll(/--color-([a-z]+)-(\d+):\s*(oklch\([^)]*\))/g)) {
  ;(PALETTE[m[1]] ??= {})[Number(m[2])] = m[3]
}

export function color(name: string, step: number) {
  return PALETTE[name]?.[step] ?? "magenta"
}

// A light color takes dark text and a dark one white, by its lightness.
function lightnessOf(value: string) {
  const ok = value.match(/oklch\(([\d.]+)%/)
  if (ok) return Number(ok[1]) / 100
  const hex = value.replace("#", "")
  if (hex.length === 6) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    return Math.cbrt(0.2126 * r + 0.7152 * g + 0.0722 * b)
  }
  return 0.5
}

export function themeVars(t: Theme): Record<string, string> {
  const g = (step: number) => color(t.base, step)
  const accent = t.accent === "none" ? null : t.accent === "custom" ? t.custom : color(t.accent, t.shade)
  const accentText = accent && (lightnessOf(accent) > 0.72 ? (t.accent === "custom" ? g(950) : color(t.accent, 950)) : "oklch(98.5% 0 0)")
  const chart = (step: number) => (accent && t.accent !== "custom" ? color(t.accent, step) : g(step))
  const font = FONTS[t.font] ?? FONTS.geist
  const status = (hue: string) => capped(hue, t.statusShade ?? 400, t.statusCap ?? 0)
  return {
    "--background": g(950),
    "--foreground": g(50),
    "--card": g(900),
    "--card-foreground": g(50),
    "--popover": g(900),
    "--popover-foreground": g(50),
    "--primary": accent ?? g(200),
    "--primary-foreground": accentText ?? g(900),
    "--secondary": g(800),
    "--secondary-foreground": g(50),
    "--muted": g(800),
    "--muted-foreground": g(400),
    "--accent": g(800),
    "--accent-foreground": g(50),
    "--destructive": status(t.troubleHue ?? "red"),
    "--border": "oklch(100% 0 0 / 10%)",
    "--input": "oklch(100% 0 0 / 15%)",
    "--ring": accent ?? g(500),
    "--chart-1": chart(300),
    "--chart-2": chart(500),
    "--chart-3": chart(600),
    "--chart-4": chart(700),
    "--chart-5": chart(800),
    "--sidebar": g(900),
    "--sidebar-foreground": g(50),
    "--sidebar-primary": accent ?? g(200),
    "--sidebar-primary-foreground": accentText ?? g(900),
    "--sidebar-accent": g(800),
    "--sidebar-accent-foreground": g(50),
    "--sidebar-border": "oklch(100% 0 0 / 10%)",
    "--sidebar-ring": accent ?? g(500),
    // shadcn has no warning, success, or information color, so these stand in until we pick ours.
    "--warning": status(t.warningHue ?? "amber"),
    "--warning-foreground": color(t.warningHue ?? "amber", 950),
    "--success": status(t.successHue ?? "emerald"),
    "--success-foreground": color(t.successHue ?? "emerald", 950),
    "--destructive-foreground": color(t.troubleHue ?? "red", 950),
    "--info": infoColor(t, g, accent),
    "--info-foreground": g(950),
    "--radius": `${t.radius}rem`,
    "--bench-font": font.sans,
    "--bench-mono": font.mono,
  }
}

export function themeLabel(t: Theme) {
  const accent = t.accent === "none" ? "no accent" : t.accent === "custom" ? t.custom : `${t.accent}-${t.shade}`
  return `${t.preset} · ${t.base} · ${accent} · ${t.radius}rem · ${FONTS[t.font]?.label ?? t.font} · info ${t.info ?? "neutral"}`
}
