/** The folders of code that runs in the sim, each from the repository's root, whose edits rebuild our bundles. */
const IN_SIM = /^src\/(engines\/page-client\/src|packages\/(ui|crew)|platform\/(panel-bridge\/(src|vcockpit)|efb-shell|banner|[^/]+\/panel)|sim-package\/pages|features\/[^/]+\/(panel|efb))\//

/** Whether an edit to `file`, a path from the root such as `src/sim-package/pages/menu.ts`, reaches code that runs in the sim. */
export function isInSimCode(file: string): boolean {
  return IN_SIM.test(file)
}
