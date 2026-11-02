// A way to people for a pilot our words haven't helped. A page in the sim can't open a browser, so the core does, and the
// toast says where, since the browser opens behind the sim, where a pilot in VR won't see it.

import { toast } from "@dualinput/ui"

import type { CoreLink } from "../../../engines/page-client/src/core-link.ts"

export function openDiscord(link: CoreLink): void {
  void link.client.command("clients.open-discord", null).then(
    () => toast("Opening our Discord in your browser"),
    () => toast("Couldn't open our Discord"),
  )
}
