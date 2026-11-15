// The ATC audio tab, ATC audio's part of the EFB app: "Share my ATC" and who shares, with the setting of the role
// this pilot has under it, then how ATC audio works (record/areas/interface/decisions.md, "The Traffic and ATC audio
// tabs hold their sharing, settings, and warnings"). The card holds the ATC app while this pilot shares, the volume
// while another pilot does, nothing while nobody does, and both outside a session, where the settings still change
// (user, 2026-10-31). The tab holds no check and no rules, since the only failures are Dual Input's own pipeline's,
// and the header, the banner, and Settings already say those. Rebuilt from the frames in
// experiments/areas/interface/bench/src/frames/traffic.tsx.

import { ScrollPage, Select, SelectContent, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, Slider } from "@dualinput/ui"
import { ChevronRight, Headset, Volume2 } from "lucide-react"
import { useEffect, useState } from "react"

import type { AtcSlice } from "../../../engines/messages/ts/atc-audio/AtcSlice.ts"
import type { HelperSlice } from "../../../engines/messages/ts/core_helper/HelperSlice.ts"
import { PhaseIcon } from "../../../platform/efb-shell/src/header/phase.tsx"
import { definePart, useCoreConnected, useCoreSlice, useShell } from "../../../platform/efb-shell/src/part.ts"
import { HowItWorks, RoleCard, useRole } from "../../../platform/efb-shell/src/roles/role-card.tsx"
import type { RoleNow } from "../../../platform/efb-shell/src/roles/role-card.tsx"
import { useSetting, writeSetting } from "../../../platform/efb-shell/src/settings/setting.ts"

/** The role's label, which `register` in src/features/atc-audio/core/src/lib.rs gives it, so change both together. */
const LABEL = "Share my ATC"
/** The part's name, its unit's, which is its tab's too. */
const NAME = "atc-audio"
/** `APP`, `VOLUME`, and `AUTOMATIC` in src/engines/messages/src/atc_audio.rs name the same settings and programs. */
const APP = "atc-audio.app"
const VOLUME = "atc-audio.volume"
const AUTOMATIC = ["BeyondATC", "SayIntentionsAI"]
/** The picker's value for Automatic, which the setting holds as empty. */
const AUTO = "auto"

/** What the card holds, by where this pilot stands with the role: the ATC app for the sharer, the volume for the rest, both outside a session. */
const holds = (role: RoleNow) => ({ app: !role.session || role.mine, volume: !role.session || (!!role.holder && !role.mine) })

/**
 * The programs the picker offers, as the core helper lists those that own an audio session: the known ATC apps first.
 * The sim and Dual Input's own programs never show, since capturing the sim would take all its sound.
 */
function offered(programs: string[]): string[] {
  const ours = (name: string) => /^(flightsimulator|dualinput)/i.test(name)
  const known = (name: string) => AUTOMATIC.includes(name)
  return programs.filter((name) => !ours(name)).sort((a, b) => Number(known(b)) - Number(known(a)))
}

/**
 * The ATC app setting, as FS Copilot's dropdown was: Automatic, which captures the first known ATC app that's
 * running, then every program playing audio, the known ATC apps first (record/areas/traffic-atc/01-traffic-and-atc.md,
 * "The ATC host"). Closed, it says what it captures, with a green dot by the chevron while it does, as in "Automatic ·
 * BeyondATC", or "Automatic" alone while no ATC app runs; open, the dot sits beside the program it captures. A program
 * picked that isn't playing audio stays in the list, so the picker can say what's set (user, 2026-10-31).
 */
function AtcAppPicker({ capturing }: { capturing: string | undefined }) {
  const { link, tab } = useShell()
  const connected = useCoreConnected()
  // The helper runs only while something wants it, so the programs are asked for each time this tab opens.
  useEffect(() => {
    if (tab === NAME && connected) void link.client.command("core-helper.list", null).catch(() => {})
  }, [tab, connected, link])
  const programs = offered(useCoreSlice<HelperSlice>("core-helper")?.programs ?? [])
  const app = String(useSetting(link, APP) ?? "").trim()
  const value = app || AUTO
  const listed = app && !programs.includes(app) ? [app, ...programs] : programs
  const dot = <span className="size-1.5 shrink-0 rounded-full bg-success" />
  return (
    <div className="flex flex-col">
      <span className="mb-3 text-sm">ATC app</span>
      <Select value={value} onValueChange={(chosen) => writeSetting(link, APP, chosen === AUTO ? "" : chosen)}>
        <SelectTrigger className="w-full">
          <span className="flex min-w-0 flex-1 items-center">
            <span className="shrink-0">{app || "Automatic"}</span>
            {!app && capturing && <span className="ml-1.5 truncate text-muted-foreground">· {capturing}</span>}
            {capturing && <span className="ml-auto mr-1 flex pl-2">{dot}</span>}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Automatic</SelectItem>
          <SelectSeparator />
          <SelectLabel>Playing audio</SelectLabel>
          {listed.map((program) => (
            <SelectItem key={program} value={program}>
              <span className="truncate">{program}</span>
              {program === capturing && dot}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * The volume of another pilot's ATC here, and the device it plays on, which Settings sets: the device's name in one
 * quiet row under the slider, the whole row opening Settings, so a VR pointer has one wide target (user, 2026-10-31).
 * The slider moves with the drag, and the setting follows it.
 */
function AtcVolume() {
  const { link, open } = useShell()
  const saved = Number(useSetting(link, VOLUME) ?? 100)
  const [dragged, setDragged] = useState<number>()
  // The drag's value shows until the setting catches up with it, so an older write's echo doesn't pull the thumb back.
  useEffect(() => {
    if (dragged === saved) setDragged(undefined)
  }, [dragged, saved])
  const volume = dragged ?? saved
  const device = useCoreSlice<HelperSlice>("core-helper")?.in_use?.name
  const change = (value: number) => {
    setDragged(value)
    writeSetting(link, VOLUME, value)
  }
  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span>Volume</span>
        <span className="tabular-nums text-muted-foreground">{volume ? `${volume}%` : "Muted"}</span>
      </div>
      <Slider value={volume} step={5} onValueChange={change} />
      <button
        type="button"
        onClick={() => open("settings")}
        className="-mx-2 -mb-2.5 mt-3 flex items-center rounded-lg px-2 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <Volume2 className="mr-2 size-3.5 shrink-0" />
        <span className="truncate">{device ?? "Windows default"}</span>
        <ChevronRight className="ml-auto size-3.5 shrink-0" />
      </button>
    </div>
  )
}

function AtcPage() {
  const role = useRole(LABEL)
  // Only the sharing pilot's capture runs, so only theirs names a program.
  const capturing = useCoreSlice<AtcSlice>("atc-audio")?.capturing ?? undefined
  return (
    <ScrollPage>
      <RoleCard
        label={LABEL}
        noun="ATC"
        role={role}
        settings={(shown) => {
          const { app, volume } = holds(shown)
          if (!app && !volume) return undefined
          return (
            <>
              {app && <AtcAppPicker capturing={shown.mine ? capturing : undefined} />}
              {volume && <AtcVolume />}
            </>
          )
        }}
      />
      <HowItWorks how="One pilot shares. Dual Input captures audio from their selected ATC app and plays it on every other pilot's machine." lines={[]} rules={false} />
    </ScrollPage>
  )
}

/** The header's headset, in green while anyone in the session shares ATC, and gray and slashed on a receiving pilot's machine with its volume at 0. */
function Shared() {
  const { link } = useShell()
  const role = useRole(LABEL)
  const muted = Number(useSetting(link, VOLUME) ?? 100) === 0
  return (
    <PhaseIcon on={!!role.holder} hushed={!role.mine && muted} label={!role.mine && muted ? "ATC muted" : "Sharing ATC"}>
      <Headset />
    </PhaseIcon>
  )
}

export const atcAudio = definePart({
  name: NAME,
  tab: { icon: Headset, label: "ATC audio", page: AtcPage },
  phaseIcon: Shared,
  role: { label: LABEL, says: "Shares ATC" },
})
