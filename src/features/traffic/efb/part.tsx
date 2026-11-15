// The Traffic tab, traffic's part of the EFB app: "Share my traffic" and who shares, how traffic sharing works, its
// rules or its check, and this PC's traffic packs (record/areas/interface/decisions.md, "The Traffic and ATC audio
// tabs hold their sharing, settings, and warnings"). A receiving pilot's two counts are kept live, and either above 0
// lights the dot on the tab's icon, on every page. Rebuilt from the frames in
// experiments/areas/interface/bench/src/frames/traffic.tsx.

import { Rolling } from "@dualinput/crew"
import { Card, ScrollPage } from "@dualinput/ui"
import { Package, Plane } from "lucide-react"
import { useEffect, useRef } from "react"

import type { TrafficSlice } from "../../../engines/messages/ts/traffic/TrafficSlice.ts"
import { PhaseIcon } from "../../../platform/efb-shell/src/header/phase.tsx"
import { definePart, useCoreConnected, useCoreSlice, useShell } from "../../../platform/efb-shell/src/part.ts"
import { HowItWorks, RoleCard, useRole } from "../../../platform/efb-shell/src/roles/role-card.tsx"
import type { CheckLine } from "../../../platform/efb-shell/src/roles/role-card.tsx"

/** The role's label, which `register` in src/features/traffic/core/src/lib.rs gives it, so change both together. */
const LABEL = "Share my traffic"
/** The part's name, its unit's, which is its tab's too. */
const NAME = "traffic"

/**
 * What the check says: on a receiving pilot's tab, the traffic host's aircraft this sim shows as stand-ins or not at
 * all, and the aircraft that aren't the host's (record/areas/traffic-atc/01-traffic-and-atc.md, "Notifications"). The
 * first count sees only the creates the sim refused, so its passing line says the aircraft loaded, not that they show.
 * The host's own sim has nothing to check, so their tab has no check. While nobody shares, and outside a session, the
 * same place holds the rules, in the user's words (user, 2026-10-31); multiplayer off is a rule for all of Dual Input,
 * so it isn't here.
 */
function lines(sharer: string | undefined, mine: boolean, counts: TrafficSlice | undefined): CheckLine[] {
  if (mine) return []
  if (sharer) {
    const missing = counts?.missing ?? 0
    const others = counts?.others ?? 0
    return [
      missing
        ? {
            id: "missing",
            state: "differs",
            says: (
              <>
                <Rolling value={missing} /> aircraft from {sharer} {missing === 1 ? "is" : "are"} missing or shown incorrectly
              </>
            ),
            detail: "Usually caused by a difference in installed traffic packs",
          }
        : { id: "missing", state: "ok", says: `All aircraft from ${sharer} loaded in your sim` },
      others
        ? {
            id: "others",
            state: "differs",
            says: (
              <>
                <Rolling value={others} /> aircraft in your sim {others === 1 ? "isn't" : "aren't"} coming from {sharer}
              </>
            ),
            detail: "Turn off AI traffic on your PC",
          }
        : { id: "others", state: "ok", says: `No extra aircraft on top of what comes from ${sharer}` },
    ]
  }
  return [
    { id: "own", state: "rule", says: "Receiving pilots should turn off their own AI traffic", detail: "To ensure everyone sees the same traffic" },
    { id: "packs", state: "rule", says: "Everyone should have the same traffic packs installed", detail: "To avoid missing or incorrect aircraft" },
    { id: "scenery", state: "rule", says: "Everyone should have the same scenery", detail: "To avoid issues such as floating aircraft due to different ground elevation" },
  ]
}

/**
 * The traffic packs on this PC, as traffic lists them when asked, which pilots compare with the host's by hand. A pack
 * the list doesn't know isn't shown, so the title says the packs were detected. It's a supplement to the check, so it
 * sits in a tint at the page's foot, where it holds still as the parts above it open and shut (user, 2026-10-31).
 */
function PacksOnThisPc({ packs }: { packs: TrafficSlice["packs"] | undefined }) {
  return (
    <section className="mt-auto text-sm">
      <Card flush tint="bg-muted/20 text-muted-foreground">
        <h2 className="flex min-h-11 items-center px-4 py-3">
          <Package className="mr-2.5 size-4 shrink-0" />
          Detected traffic packs on this PC
        </h2>
        <ul className="flex flex-col space-y-1.5 px-4 pb-4">
          {packs?.length === 0 && <li>No known traffic pack found</li>}
          {packs?.map((pack) => (
            <li key={pack.name} className="flex items-center justify-between">
              <span className="mr-4 min-w-0 truncate">{pack.name}</span>
              {pack.version && <span className="shrink-0 tabular-nums text-muted-foreground/70">{pack.version}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

function TrafficPage() {
  const { link, setDot, tab } = useShell()
  const connected = useCoreConnected()
  const role = useRole(LABEL)
  const counts = useCoreSlice<TrafficSlice>("traffic")
  // The packs are read from disk once the tab first opens with the core there, since a pilot who installs one restarts the sim, and Dual Input with it.
  const asked = useRef(false)
  useEffect(() => {
    if (tab !== NAME || !connected || asked.current) return
    asked.current = true
    void link.client.command("traffic.list-packs", null).catch(() => {
      asked.current = false
    })
  }, [tab, connected, link])
  const sharer = role.session ? role.sharer : undefined
  const check = lines(sharer, role.mine, counts)
  const differs = check.some((line) => line.state === "differs")
  useEffect(() => setDot(NAME, differs), [differs, setDot])
  // The note speaks to the pilot whose traffic is shared, so it shows only on their tab.
  const note = role.mine
    ? "Performance issues? Since your traffic is shared as-is, PCs that aren't as powerful as yours might struggle to keep up. If that happens, decrease your traffic density in your AI traffic app."
    : undefined
  return (
    <ScrollPage>
      <RoleCard label={LABEL} noun="traffic" role={role} />
      <HowItWorks
        how="One pilot shares. Dual Input watches the AI traffic in their sim and injects it into everyone else's. This works by reading the traffic straight from the sim and works regardless of the original method of traffic generation."
        note={note}
        lines={check}
        rules={!sharer}
      />
      <PacksOnThisPc packs={counts?.packs} />
    </ScrollPage>
  )
}

/** The header's plane, in green while anyone in the session shares traffic. */
function Shared() {
  const role = useRole(LABEL)
  return (
    <PhaseIcon on={!!role.holder} label="Sharing traffic">
      <Plane />
    </PhaseIcon>
  )
}

export const traffic = definePart({
  name: NAME,
  tab: { icon: Plane, label: "Traffic", page: TrafficPage },
  phaseIcon: Shared,
  role: { label: LABEL, says: "Shares traffic" },
})
