// The look of an island in the extension's webviews, the Dual Input panel's and the Sync log's, which both draw their
// islands from here so they match.

/**
 * An island: our own background, so our colors read the same in any theme, with the corners VS Code gives its own panels,
 * `panels.cornerRadius`, whose default is `cornerRadius.large`, 8px (read in VS Code 1.148.0,
 * out/vs/workbench/workbench.desktop.main.js), so an island inside VS Code's card has the card's corners.
 */
export const ISLAND = "rounded-[8px] bg-background"

/**
 * The inset around a view's islands, on every side, and the gap between them: VS Code's own between its cards,
 * `panels.spacing`, whose default is `spacing.size40`, 4px (read in the same file).
 */
export const INSET = "p-1"
export const GAP = "mt-1"
