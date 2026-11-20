// The EFB app in the dev loop, as tools/dev.ts runs it: the shell's sample, with each feature's part in `BUILT`, one
// line each, as efb.tsx lists them. A part in `BUILT` takes its sample's place, so the tabs keep their order.

import { avatars } from "../../features/avatars/efb/part.tsx"
import { stateSync } from "../../features/state-sync/efb/part.tsx"
import takeControl from "../../features/take-control/efb/index.tsx"
import { mountDev } from "../../platform/efb-shell/dev/main.tsx"
import { SAMPLE_PARTS } from "../../platform/efb-shell/dev/sample-parts.tsx"

const BUILT = [takeControl, avatars, stateSync]

mountDev([
  ...SAMPLE_PARTS.map((sample) => BUILT.find((part) => part.name === sample.name) ?? sample),
  ...BUILT.filter((part) => !SAMPLE_PARTS.some((sample) => sample.name === part.name)),
])
