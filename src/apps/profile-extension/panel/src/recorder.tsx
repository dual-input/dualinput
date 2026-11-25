// The recorder's island, at the panel's bottom: Record, Stop, and Play, as on a tape deck, with a readout of the time,
// and above them a line when there's something to say, such as why the buttons are off
// (record/areas/profiles/05-the-recorder.md, "The recorder's island").

import { Button, cx, part, Room, Spinner, Tooltip, useMoment } from "@dualinput/ui"
import { Circle, Info, Play, Square, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import type { CSSProperties, ReactNode } from "react"

import { TOOLTIP_DELAY } from "./run.tsx"
import type { PanelHost, RecorderOff, RecorderView, Stopped } from "./view.ts"

export function Recorder({ recorder, host }: { recorder: RecorderView; host: PanelHost }) {
  const { kind } = recorder
  return (
    // The island grows upward from the panel's bottom edge, so the buttons stay put as the lines above them come and go.
    <div className="mt-2 shrink-0 rounded-2xl bg-background p-3">
      <Lines recorder={recorder} />
      <div className="flex items-center">
        <Transport label="Record" lit={kind === "recording" ? "record" : null} disabled={kind !== "empty" && kind !== "recorded"} onClick={host.record}>
          <Circle className="size-3.5 fill-current text-destructive" />
        </Transport>
        <Transport label="Stop" lit={null} disabled={kind !== "recording" && kind !== "putting-back" && kind !== "playing"} onClick={host.stop}>
          <Square className="size-3 fill-current" />
        </Transport>
        <Transport label="Play" lit={kind === "putting-back" || kind === "playing" ? "play" : null} disabled={kind !== "recorded"} onClick={host.play}>
          {/* The triangle's weight sits left of its box's center, so it moves right to look centered. */}
          <Play className="ml-0.5 size-3.5 fill-current" />
        </Transport>
        <Readout recorder={recorder} />
      </div>
    </div>
  )
}

/**
 * A deck's button. One that can't act now dims further than the kit's half, through its wrapper, so the one that can is
 * plain to see, and a pressed one, as Record while recording, dims with them, since it can't be pressed again and the red
 * dot and the readout already say what runs; it keeps a faint tint of its color as a hint (user, 2026-11-24).
 */
function Transport({ label, lit, disabled, onClick, children }: { label: string; lit: "record" | "play" | null; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <span className={cx("mr-1.5 inline-flex", disabled && "opacity-60")}>
      <Tooltip content={label} side="top" delay={TOOLTIP_DELAY}>
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={label}
          aria-pressed={lit ? true : undefined}
          disabled={disabled}
          onClick={onClick}
          className={cx(lit === "record" && "bg-destructive/20", lit === "play" && "bg-primary/15 text-primary")}
        >
          {children}
        </Button>
      </Tooltip>
    </span>
  )
}

/** The time: how long a recording runs so far, the recording's length, or how far playback has got of it. */
function Readout({ recorder }: { recorder: RecorderView }) {
  const counting = recorder.kind === "recording" || recorder.kind === "playing"
  const shown = recorder.kind === "recording" ? recorder.elapsedMs : recorder.kind === "playing" ? recorder.atMs : 0
  const length = "lengthMs" in recorder ? recorder.lengthMs : null
  const now = useCounted(recorder.kind, shown, counting, length ?? Infinity)
  const base = "ml-auto whitespace-nowrap font-mono text-sm tabular-nums"
  switch (recorder.kind) {
    case "recording":
      return (
        <span className={cx(base, "text-destructive")}>
          <span className="relative mr-2 inline-block size-1.5 align-[0.1em]">
            <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-75" />
            <span className="absolute inset-0 rounded-full bg-current" />
          </span>
          {clock(now)}
        </span>
      )
    case "playing":
      return (
        <span className={base}>
          {clock(now)}
          <span className="text-muted-foreground"> / {clock(recorder.lengthMs)}</span>
        </span>
      )
    case "recorded":
    case "putting-back":
      return <span className={base}>{clock(recorder.lengthMs)}</span>
    case "off":
      return <span className={cx(base, "text-muted-foreground")}>{recorder.lengthMs === null ? "0:00" : clock(recorder.lengthMs)}</span>
    case "empty":
      return <span className={cx(base, "text-muted-foreground")}>0:00</span>
  }
}

type Tone = "off" | "busy" | "warning"

/** A line's words and the icon it takes. */
type Said = { tone: Tone; text: string }

/**
 * The line above the buttons, only for what the buttons, the red dot, and the readout can't say, and only what the
 * status island doesn't already: a flight not started, or a profile still loading, shows there, or passes in seconds.
 */
function said(recorder: RecorderView): Said | null {
  switch (recorder.kind) {
    case "empty":
    case "recording":
    case "playing":
      return null
    case "recorded":
      return recorder.stopped && { tone: "warning", text: stoppedBy(recorder.stopped) }
    case "putting-back":
      return { tone: "busy", text: "Restoring your cockpit" }
    case "off": {
      const why = OFF[recorder.why]
      return why === null ? null : { tone: "off", text: why }
    }
  }
}

/**
 * The line comes and goes as a room, and one line gives way to the next in the page's moment, as the EFB app's lines
 * do: the old words fade up and out, the room eases to the new line's height, and the new words fade in.
 */
function Lines({ recorder }: { recorder: RecorderView }) {
  const line = said(recorder)
  const moment = useMoment(line ? `${line.tone}|${line.text}` : "", line)
  const shown = moment.shown
  return (
    <Room open={!!shown} pad="pb-3">
      {shown && (
        <Line tone={shown.tone} style={part(moment.stage, moment.from?.text !== moment.to?.text)}>
          {shown.text}
        </Line>
      )}
    </Room>
  )
}

/** One line, with the EFB app's icon for its kind: the amber triangle for a warning, and the info circle for why the buttons are off. */
function Line({ tone, style, children }: { tone: Tone; style: CSSProperties; children: ReactNode }) {
  const icon = "mr-2 mt-px size-3.5 shrink-0"
  return (
    <p style={style} className={cx("flex items-start text-xs leading-4", tone === "warning" ? "text-warning" : "text-muted-foreground")}>
      {tone === "warning" && <TriangleAlert className={icon} />}
      {tone === "off" && <Info className={icon} />}
      {tone === "busy" && <Spinner className={icon} />}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** Why the buttons are off, or null where the status island already says it, or the wait is a save's few seconds. */
const OFF: Record<RecorderOff, string | null> = {
  "no-flight": null,
  // The status line says "In a flight" from the flight's start, so only the island can say preflight hasn't ended.
  preflight: "Press Ready in the EFB to record or play",
  crew: "Works only while you're alone in the session",
  loading: null,
  unsaved: "Save the profile to record or play",
}

function stoppedBy({ what, by }: Stopped): string {
  const which = what === "recording" ? "Recording" : "Playback"
  return `${which} stopped because ${by.kind === "reload" ? "you saved" : `${by.who} joined`}`
}

/** A time as minutes and seconds, `0:42` or `12:05`. */
function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * A time that counts on by itself while `running`, from the `ms` the last view carried, up to `most`. The core's views
 * come as its slice changes, so the readout moves every second without waiting on one. A new `kind` counts afresh even
 * when its `ms` is the last kind's, as a playback's 0 after a recording's.
 */
function useCounted(kind: string, ms: number, running: boolean, most: number): number {
  const [since, setSince] = useState(() => ({ kind, ms, at: Date.now() }))
  const [now, setNow] = useState(() => Date.now())
  if (since.kind !== kind || since.ms !== ms) setSince({ kind, ms, at: Date.now() })
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [running])
  return running ? Math.min(most, since.ms + Math.max(0, now - since.at)) : ms
}
