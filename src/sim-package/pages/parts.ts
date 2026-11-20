// Each feature's part in the EFB app, one line each, in the order their tabs show
// (record/areas/interface/01-apps.md, "A feature's parts"). The app's entry, efb.tsx, and its dev loop, efb-dev.tsx,
// both run this list, so a part added here shows in both.

import { atcAudio } from "../../features/atc-audio/efb/part.tsx"
import { avatars } from "../../features/avatars/efb/part.tsx"
import goTo from "../../features/go-to/efb/index.tsx"
import rateAndPause from "../../features/rate-and-pause/efb/index.ts"
import { stateSync } from "../../features/state-sync/efb/part.tsx"
import takeControl from "../../features/take-control/efb/index.tsx"
import { traffic } from "../../features/traffic/efb/part.tsx"
import type { Part } from "../../platform/efb-shell/src/part.ts"

export const PARTS: Part[] = [takeControl, traffic, atcAudio, avatars, stateSync, rateAndPause, goTo]
