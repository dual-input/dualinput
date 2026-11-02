// A way to people for a pilot our words haven't helped. A page in the sim can't open anything outside it, so the core does,
// in the pilot's Discord app or else their browser.

import { toast } from "@dualinput/ui"

import type { CoreLink } from "../../../engines/page-client/src/core-link.ts"

export function openDiscord(link: CoreLink): void {
  void link.client.command("clients.open-discord", null).then(
    () => toast("Opening our Discord"),
    () => toast("Couldn't open our Discord"),
  )
}
