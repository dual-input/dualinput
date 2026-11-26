// The status line at the panel's top: whether your Dual Input is running, whether you're in a session's flight, and the
// aircraft loaded, and when nothing shows under it, why. Its dot and label are the EFB app's header's, so an author reads
// the state as a pilot does there.

import { cx } from "@dualinput/ui"

import type { Status } from "./view.ts"

type Tone = "off" | "waiting" | "on" | "warning"

const TONES: Record<Tone, string> = { off: "text-muted-foreground", waiting: "text-primary", on: "text-success", warning: "text-warning" }

/** The tone, the label beside the dot, the line under it, and the line that says more, if any, for each state. */
function says(status: Status): { tone: Tone; label: string; title: string; detail: string | null } {
  switch (status.kind) {
    case "not-running":
      return { tone: "off", label: "Not running", title: "Dual Input isn't running", detail: "Start it to use the live tools." }
    case "other-release":
      return status.update === "dual-input"
        ? { tone: "warning", label: "Version mismatch", title: `Dual Input is ${status.dualInput}. This extension was built for ${status.extension}.`, detail: "Update Dual Input." }
        : { tone: "warning", label: "Version mismatch", title: `This extension was built for ${status.extension}. Dual Input is ${status.dualInput}.`, detail: "Update the extension." }
    case "other-window":
      return { tone: "off", label: "In another window", title: "Another VS Code window has the sim", detail: "Dual Input's live tools work in one VS Code window at a time." }
    case "no-session":
      return { tone: "off", label: "No session", title: "Host a session from the EFB app", detail: "Live tools only work while a session is in flight." }
    case "not-in-flight":
      return { tone: "waiting", label: "In a session", title: "Waiting for the flight to start", detail: "Load a flight to use the live tools." }
    case "in-flight":
      return status.runs
        ? { tone: "on", label: "In a flight", title: status.aircraft, detail: null }
        : { tone: "warning", label: "Mismatching aircraft", title: status.aircraft, detail: "The loaded aircraft isn't the one this profile is for." }
    case "no-profile":
      return { tone: "warning", label: "No profile", title: status.title, detail: "No profile covers this aircraft." }
  }
}

export function StatusLine({ status }: { status: Status }) {
  const { tone, label, title, detail } = says(status)
  return (
    <div className="px-4 py-3">
      {/* The dot sits on the label's baseline, raised so its center meets the capitals', which stand 0.74em in Geist. */}
      <p className={cx("whitespace-nowrap text-[10px] font-semibold uppercase leading-4 tracking-widest", TONES[tone])}>
        <span className="relative mr-2 inline-block size-1.5 align-[0.07em]">
          {tone === "waiting" && <span className="absolute inset-x-0 inset-y-0 animate-ping rounded-full bg-current opacity-75" />}
          <span className="absolute inset-x-0 inset-y-0 rounded-full bg-current" />
        </span>
        {label}
      </p>
      <p className="mt-1.5 text-sm font-medium">{title}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}
