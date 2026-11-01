// The settings the EFB app's own screens read and write, which the core keeps (decision 016).

import type { Setting } from "../../../../engines/messages/ts/clients/Setting.ts"
import type { JsonValue } from "../../../../engines/messages/ts/serde_json/JsonValue.ts"
import { useSlice } from "../../../../engines/page-client/src/core-link.ts"
import type { CoreLink } from "../../../../engines/page-client/src/core-link.ts"

/** `SETUP_DONE` and `GUIDE_DONE` in src/engines/messages/src/clients.rs, and `NAME` in src/engines/messages/src/session.rs, name the same settings. */
export const SETUP_DONE = "app.setup-done"
export const GUIDE_DONE = "app.guide-done"
export const NAME = "session.name"
/** `OUTPUT` in src/platform/core-helper-service/src/lib.rs names the same setting. */
export const OUTPUT = "core-helper.output"
/** TODO: when avatars' stage registers the figure's color as a setting, have it use this key, or change this one. A core that doesn't know it refuses the write, and the figure wears its default. */
export const FIGURE_COLOR = "avatars.color"

/** A setting's value, or undefined until the core has sent the slice. */
export function useSetting(link: CoreLink, key: string): JsonValue | undefined {
  return useSlice<Setting[]>(link, "settings")?.find((setting) => setting.key === key)?.value
}

/** Changes a setting, which any client may. A refusal changes nothing, and the slice goes on saying what holds. */
export function writeSetting(link: CoreLink, key: string, value: JsonValue): void {
  void link.client.command("clients.set-setting", { key, value }).catch(() => {})
}