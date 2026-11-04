// The key or button that takes control, and whether it takes a press or a hold (record/areas/control/01-take-control.md,
// "The binding"). A pilot binds it here, in the sim, with the sim's window in front, where a bound key counts. The core
// hands over the next press, which this section writes into the setting, so the setting changes as any setting does, and
// the core helper's service sends the helper the new binding.

import { Button, Choice, Kbd, part, useMoment } from "@dualinput/ui"
import { X } from "lucide-react"
import { useEffect, useState } from "react"

import type { Bound } from "../../../engines/messages/ts/core_helper/Bound.ts"
import type { TakeControlSlice } from "../../../engines/messages/ts/take-control/TakeControlSlice.ts"
import { useCoreSlice, useShell } from "../../../platform/efb-shell/src/part.ts"
import { Row, Section, SettingsCard } from "../../../platform/efb-shell/src/settings/section.tsx"
import { useSetting, writeSetting } from "../../../platform/efb-shell/src/settings/setting.ts"
import { isCurrentApp } from "../../../platform/efb-shell/src/view.ts"
import { BIND, INPUT, LONG_PRESS, NAME } from "./names.ts"

type How = "press" | "hold"

/** How often Bind looks at whether the pilot can still see it waiting, in milliseconds, since closing the EFB gives the app no signal. */
const WATCH_EVERY = 500

export function Binding() {
  const { link, tab, efbClosed } = useShell()
  const slice = useCoreSlice<TakeControlSlice>(NAME)
  const bind = (on: boolean) => void link.client.command(BIND, { on }).catch(() => {})
  // The next press counts whatever is in front, so Bind waits only while the pilot can see it waiting, or a key typed into
  // another program later would bind with nothing on screen to say so.
  const waiting = !!slice?.waiting
  useEffect(() => {
    if (!waiting) return
    const watch = () => {
      if (tab !== "settings" || efbClosed() || !isCurrentApp()) bind(false)
    }
    watch()
    const timer = window.setInterval(watch, WATCH_EVERY)
    return () => window.clearInterval(timer)
    // `bind` and `efbClosed` hold nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, tab])
  const next = slice?.next_press
  const nextName = next?.name
  useEffect(() => {
    if (!next) return
    writeSetting(link, INPUT, next)
    bind(false)
    // A press comes once, however many times the slice is sent with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(next)])
  const bound = useSetting(link, INPUT) as Bound | null | undefined
  const shown = waiting ? "waiting" : (nextName ?? bound?.name ?? "")
  // The key's row changes in the page's moment.
  const moment = useMoment(shown, shown)
  // A control a pilot pressed answers at once, ahead of the setting's coming back from the core.
  const longPress = useSetting(link, LONG_PRESS)
  const [pressed, setPressed] = useState<How | null>(null)
  useEffect(() => setPressed(null), [longPress])
  // Until the settings arrive it draws the setting's default, which src/features/take-control/core/src/lib.rs holds, so change both together.
  const how: How = pressed ?? (longPress === false ? "press" : "hold")
  return (
    <Section title="Take control" foot="Keep it unbound in the sim's own controls, so it does only this">
      <SettingsCard>
        <Row label="Key or button">
          <span className="flex items-center" style={part(moment.stage, true)}>
            {moment.shown === "waiting" ? (
              <>
                <span className="mr-2 text-sm text-primary">Press a key or button…</span>
                <Button size="sm" variant="secondary" onClick={() => bind(false)}>
                  Cancel
                </Button>
              </>
            ) : moment.shown ? (
              <>
                <Kbd className="mr-3 max-w-[10rem] border border-foreground/45 bg-transparent font-semibold text-foreground/45">
                  <span className="truncate">{moment.shown}</span>
                </Kbd>
                <Button size="sm" variant="secondary" onClick={() => bind(true)}>
                  Change
                </Button>
                <span className="ml-1">
                  <Button size="icon-sm" variant="ghost" aria-label="Unbind" onClick={() => writeSetting(link, INPUT, null)}>
                    <X />
                  </Button>
                </span>
              </>
            ) : (
              <>
                <span className="mr-2 text-sm text-muted-foreground">Not set</span>
                <Button size="sm" variant="secondary" onClick={() => bind(true)}>
                  Bind
                </Button>
              </>
            )}
          </span>
        </Row>
        <Row label="Take control with a">
          <Choice
            value={how}
            options={[
              ["press", "Press"],
              ["hold", "Hold"],
            ]}
            onChange={(choice) => {
              setPressed(choice)
              writeSetting(link, LONG_PRESS, choice === "hold")
            }}
          />
        </Row>
      </SettingsCard>
    </Section>
  )
}
