// What the sim's own stylesheets set on bare elements, which reach our pages in the sim and which the dev loop's copy of
// the engine doesn't load. Without them a page can look right in the debugger and wrong in the sim, as the banner's lines
// at twice their size did (measured on MSFS 2024, 2026-11-02, record/areas/interface/log.md, "The sim's stylesheets set
// text-align, size, and font on bare elements around our pages, and Coherent GT draws no `title`"). The kit's reset
// answers them in src/packages/ui/src/kit.css, so when you find another such rule, restate it here and answer it there.

/** Every element the EFB's efb_os/Assets/reset.css lists that our pages can draw, whose rule sets text-align: left. */
const RESET_LISTS = "a, b, button, div, em, h1, h2, h3, h4, h5, h6, i, img, input, label, li, ol, p, select, small, span, strong, textarea, ul"

/** The EFB's document: efb_os/Assets/reset.css and efb_os/efb_os.css. */
export const EFB_RULES = `
${RESET_LISTS} { background-color: transparent; border: 0; font-family: inherit; font-size: inherit; font-style: inherit; font-weight: inherit; line-height: inherit; margin: 0; outline: none; padding: 0; text-align: left; text-decoration: none; vertical-align: baseline; }
body { line-height: normal; margin: 0; }
ol, ul { list-style: none; }
h2 { font-size: 16px; font-family: Roboto-Bold, Arial; color: white; }
svg { width: 100%; height: 100%; }
`

/** An in-game panel's document: the sim's /SCSS/common.css, with its sizes as they come to on a 1,080-line screen. */
export const PANEL_RULES = `
*, *:before, *:after { box-sizing: border-box; margin: 0; padding: 0; }
p { font-weight: 400; font-size: 18px; line-height: 1; color: white; }
body { -webkit-user-select: none; font-family: sans-serif; font-size: 18px; color: white; height: 100%; width: 100%; margin: 0; padding: 0; }
input { font-size: 18px; font-family: sans-serif; color: black; }
i { font-style: italic; }
`
