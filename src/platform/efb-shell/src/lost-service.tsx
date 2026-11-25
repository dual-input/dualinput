// What the app's window shows without the service, since the EFB app reaches everything through it, and with an add-on
// from another version than the service's (record/areas/interface/decisions.md, "Without the service the EFB app shows
// one of three screens, and another version asks to restart the sim").

import { Button, Confirm, Spinner } from "@dualinput/ui"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"

/** How long a restart the pilot asked for holds its button busy, in milliseconds. */
const RESTART_WAIT = 30_000

/** A failure's box, with a line that it's waiting where it waits for something. */
function FailureBox({ title, detail, waiting, children }: { title: string; detail: string; waiting?: string; children?: ReactNode }) {
  return (
    <div className="w-full max-w-80 animate-fade-in rounded-3xl border border-destructive/20 bg-destructive/10 px-5 py-4 text-center">
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="mt-1 text-sm text-foreground/75">{detail}</p>
      {waiting && (
        <span className="mt-3 flex items-center justify-center text-sm text-foreground/60">
          <Spinner className="mr-2 size-4" />
          {waiting}
        </span>
      )}
      {children}
    </div>
  )
}

/** The window with no service: the pilot quit it, or it isn't running, which comes back by itself once it starts. */
export function ServiceDown({ closed, headerHeight }: { closed: boolean; headerHeight: number }) {
  return (
    // As much room under it as the header takes above, so it centers in the window.
    <div className="flex flex-1 flex-col items-center justify-center px-12 text-center" style={{ paddingBottom: headerHeight }}>
      {closed ? (
        <div>
          <p className="text-lg font-semibold">Dual Input is closed</p>
          <p className="mt-1 text-sm text-muted-foreground">Open it from the Start menu to fly together.</p>
        </div>
      ) : (
        <FailureBox title="Dual Input service isn't running" detail="Open it from the Start menu." waiting="Waiting for the service to start" />
      )}
    </div>
  )
}

/**
 * The window in place of its pages when the sim loaded another version of our add-on than the service runs. The EFB app
 * is part of the add-on, so the add-on loaded; it can only be from another version, since the sim loads add-ons when it
 * starts and Dual Input updates while it's closed.
 */
export function AddonMismatch({ addon, service, headerHeight, onRestart }: { addon: string; service: string; headerHeight: number; onRestart: () => boolean }) {
  const [restarting, setRestarting] = useState(false)
  // A restart the pilot turns down, or that never happens, stops waiting after a while, and offers itself again.
  useEffect(() => {
    if (!restarting) return
    const timer = window.setTimeout(() => setRestarting(false), RESTART_WAIT)
    return () => window.clearTimeout(timer)
  }, [restarting])
  return (
    // As much room under it as the header takes above, so it centers in the window.
    <div className="flex flex-1 flex-col items-center justify-center px-12" style={{ paddingBottom: headerHeight }}>
      <FailureBox title="Add-on version mismatch" detail={`The sim loaded version ${addon} of Dual Input's add-on when Dual Input is ${service}. Restart the sim to load the right one.`}>
        <div className="mt-3 flex items-center justify-center">
          {restarting ? (
            <Button variant="danger" disabled>
              <Spinner />
              Closing the sim
            </Button>
          ) : (
            <Confirm
              variant="danger"
              question="Restart the sim?"
              go="Restart now"
              onConfirm={() => {
                if (onRestart()) setRestarting(true)
              }}
            >
              Restart the sim
            </Confirm>
          )}
        </div>
      </FailureBox>
    </div>
  )
}

/** How long the pill takes to fade, in milliseconds, during which it stays mounted. */
const PILL_FADE = 200

/** While the link is down for a moment: the window dims, the page stays as it was, and the dimming takes every press, since every command would fail. */
export function Reconnecting({ on }: { on: boolean }) {
  const [shown, setShown] = useState(on)
  useEffect(() => {
    if (on) {
      setShown(true)
      return
    }
    const timer = window.setTimeout(() => setShown(false), PILL_FADE)
    return () => window.clearTimeout(timer)
  }, [on])
  if (!shown) return null
  return (
    <div className="absolute inset-x-0 inset-y-0 z-40 flex items-center justify-center bg-black/50 transition-opacity duration-200" style={{ opacity: on ? 1 : 0 }}>
      <div className="flex items-center rounded-full border border-foreground/10 bg-popover py-2.5 pl-4 pr-5 text-sm shadow-xl">
        <Spinner className="mr-2.5 size-4 text-muted-foreground" />
        Reconnecting to the Dual Input service
      </div>
    </div>
  )
}
