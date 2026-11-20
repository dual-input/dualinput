// The EFB app in the dev loop, as tools/dev.ts runs it: every feature's part the app runs, on the stand-in core's
// scenes in src/platform/efb-shell/dev/stand-in.ts.

import { mountDev } from "../../platform/efb-shell/dev/main.tsx"
import { PARTS } from "./parts.ts"

mountDev(PARTS)
