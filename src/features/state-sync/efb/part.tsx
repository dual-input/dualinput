// State sync's part of the EFB app: the pilot flying's checklist on the Session tab during
// preflight (record/areas/interface/decisions.md, "The checklist takes any entry an author
// writes, and every pilot has one").

import type { StateSyncSlice } from "../../../engines/messages/ts/state-sync/StateSyncSlice.ts"
import { definePart, useCoreSlice } from "../../../platform/efb-shell/src/part.ts"
import { Checklist } from "../../../platform/efb-shell/src/session/checklist.tsx"

/** `NAME` in src/engines/messages/src/state_sync.rs names the same unit and slice, so change both together. */
const NAME = "state-sync"

function PreflightChecklist() {
  const items = useCoreSlice<StateSyncSlice>(NAME)?.checklist ?? []
  if (items.length === 0) return null
  return <Checklist items={items.map((item) => ({ ...item, description: item.description ?? undefined }))} />
}

export const stateSync = definePart({ name: NAME, preflight: PreflightChecklist })
