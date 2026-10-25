// Tailwind 3, tuned for Coherent GT as p13 and p14 measured it: every color is written as
// rgba() with commas around a custom property's RGB triplet, since the engine drops rgb()
// with spaces, which Tailwind 3 writes for a color by default. The tokens are shadcn's names.
const token = (name) => `rgba(var(--${name}-rgb), <alpha-value>)`

module.exports = {
  content: [], // p17 passes the content for each run
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "rgba(255, 255, 255, <alpha-value>)",
      black: "rgba(0, 0, 0, <alpha-value>)",
      background: token("background"),
      foreground: token("foreground"),
      card: { DEFAULT: token("card"), foreground: token("card-foreground") },
      popover: { DEFAULT: token("popover"), foreground: token("popover-foreground") },
      primary: { DEFAULT: token("primary"), foreground: token("primary-foreground") },
      secondary: { DEFAULT: token("secondary"), foreground: token("secondary-foreground") },
      muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
      accent: { DEFAULT: token("accent"), foreground: token("accent-foreground") },
      destructive: { DEFAULT: token("destructive"), foreground: token("destructive-foreground") },
      warning: { DEFAULT: token("warning"), foreground: token("warning-foreground") },
      success: { DEFAULT: token("success"), foreground: token("success-foreground") },
      info: { DEFAULT: token("info"), foreground: token("info-foreground") },
      border: token("border"),
      input: token("input"),
      ring: token("ring"),
    },
    extend: {
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      fontFamily: { sans: ["Geist", "sans-serif"], mono: ["Geist Mono", "monospace"] },
    },
  },
}
