// A feature shows itself in the EFB app through one part, which the app's entry lists in one line, so
// deleting a feature deletes its folder and that line, and this shell never names a feature
// (record/areas/interface/01-apps.md, "A feature's parts").

import { createContext, useContext } from "react"
import type { ComponentType, ReactNode } from "react"

import type { JsonValue } from "../../../engines/messages/ts/serde_json/JsonValue.ts"
import type { SessionSlice } from "../../../engines/messages/ts/session/SessionSlice.ts"
import type { SliceMember } from "../../../engines/messages/ts/session/SliceMember.ts"
import type { CoreLink } from "../../../engines/page-client/src/core-link.ts"
import { useCoreState, useSlice } from "../../../engines/page-client/src/core-link.ts"
import type { DesktopLink } from "./desktop-link.ts"

/** What a part reaches of the core: slices, commands, and the `unit` messages it trades with its own unit. */
export type PartApi = {
  watch(slice: string, hear: (value: JsonValue) => void): () => void
  command(name: string, args: JsonValue): Promise<void>
  onUnit(unit: string, hear: (body: JsonValue) => void): () => void
  sendUnit(unit: string, body: JsonValue): boolean
}

export type Part = {
  /** Its unit's name in the core. */
  name: string
  /** Runs when the app loads, for code with no screen of its own. */
  start?(api: PartApi): void
  stop?(): void
  /** A tab of its own, between the Session tab and Settings. */
  tab?: {
    icon: ComponentType<{ className?: string }>
    label: string
    page: ComponentType
    /** The landing a click on a banner's card opens this tab for, as avatars' "This seat is taken" does Figures. */
    landing?: string
  }
  /** What shows on the Session tab under the session card during preflight, which the card folds to keep in view. */
  preflight?: ComponentType
  /** What shows under the tab bar on every tab, as Take control does, which can't wait for a tab switch. */
  underTabs?: ComponentType
  /** A section of the Settings tab, above the platform's, as Take control's binding is. */
  settings?: ComponentType
  /** An icon after the phase's name in the header while the feature is shared, as a `PhaseIcon`, so it shows on every page. */
  phaseIcon?: ComponentType
  /** The role the feature declares, by its label in the session's slice, whose holder's crew row carries a chip of the tab's icon, which says `says`. */
  role?: { label: string; says: string }
  /**
   * What the part shows on the session card's crew rows, as Go to's Join on the pilot flying's row: a hook, which
   * the card calls once each time it draws, answering for each row. A row shows the first part's answer, in the
   * parts' order, since a row has room for one.
   */
  useCrewRow?: () => (member: SliceMember, session: SessionSlice) => CrewRowView | undefined
}

/** A part's words under a pilot's name, in place of where they are, unless their link is lost or their sim crashed, and what ends their row, unless preflight's Ready does. */
export type CrewRowView = { under?: string; end?: ReactNode }

export function definePart(part: Part): Part {
  return part
}

/** Starts each part. A part that throws stops only itself. */
export function startParts(parts: Part[], link: CoreLink): void {
  const api: PartApi = {
    watch: (slice, hear) => link.client.watch(slice, hear),
    command: (name, args) => link.client.command(name, args),
    onUnit: (unit, hear) => link.client.onUnit(unit, hear),
    sendUnit: (unit, body) => link.client.sendUnit(unit, body),
  }
  for (const part of parts) {
    try {
      part.start?.(api)
    } catch (error) {
      console.error(`Dual Input: the ${part.name} part's start threw: ${error}`)
    }
  }
}

/** Stops each part, as starting them does. */
export function stopParts(parts: Part[]): void {
  for (const part of parts) {
    try {
      part.stop?.()
    } catch (error) {
      console.error(`Dual Input: the ${part.name} part's stop threw: ${error}`)
    }
  }
}

/** The app around a page: the link to the core, and the frame's own controls. */
export type Shell = {
  link: CoreLink
  desktop: DesktopLink
  /** The tab that's open. Every tab's page stays mounted, and a hidden one measures nothing, so a page waits for this before it measures, and measures again when it opens. */
  tab: string
  /** Whether the EFB is closed, in which case a page has no one to draw for. */
  efbClosed(): boolean
  /** Opens a tab, as a part's own link to Settings does. */
  open(tab: string): void
  /** An amber dot on a tab's icon, while the tab holds a warning. */
  setDot(tab: string, on: boolean): void
  /** Counts the header's View update presses, each of which Settings answers by scrolling to its update section. */
  updateAsks: number
}

export const ShellContext = createContext<Shell | null>(null)

export function useShell(): Shell {
  const shell = useContext(ShellContext)
  if (!shell) throw new Error("a page of the EFB app sits outside its frame")
  return shell
}

/** A slice of client state, typed by the message crate's type its unit registered, or undefined until the core has sent it. */
export function useCoreSlice<T>(name: string): T | undefined {
  return useSlice<T>(useShell().link, name)
}

/** Whether the core is there to answer, as a part waits for before it sends a command a tab's opening asks for. */
export function useCoreConnected(): boolean {
  return useCoreState(useShell().link) === "connected"
}
