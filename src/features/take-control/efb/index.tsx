// Take-control's part in the EFB app: its button under the tab bar, and its binding in Settings
// (record/areas/interface/01-apps.md, "A feature's parts").

import { definePart } from "../../../platform/efb-shell/src/part.ts"
import { Binding } from "./binding.tsx"
import { NAME } from "./names.ts"
import { TakeControlStrip } from "./strip.tsx"

export default definePart({ name: NAME, underTabs: TakeControlStrip, settings: Binding })
