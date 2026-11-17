// Go to's part in the EFB app, which the app labels Join: Join on the pilot flying's crew row, with where they are
// under their name (record/areas/interface/01-apps.md, "A feature's parts").

import { definePart } from "../../../platform/efb-shell/src/part.ts"
import { useJoinRow } from "./join.tsx"
import { NAME } from "./names.ts"

export default definePart({ name: NAME, useCrewRow: useJoinRow })
