// The EFB app in the dev loop, as tools/dev.ts runs it: the shell's sample, with each feature's part that's built, one
// line each, as efb.tsx lists them, and the sample's stand-ins for those that aren't.

import takeControl from "../../features/take-control/efb/index.tsx"
import { mountDev } from "../../platform/efb-shell/dev/main.tsx"
import { SAMPLE_PARTS } from "../../platform/efb-shell/dev/sample-parts.tsx"

mountDev([...SAMPLE_PARTS, takeControl])
