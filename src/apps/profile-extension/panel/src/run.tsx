// Run, for the entry whose Run lens you clicked: its live value, the value field, the values its watch has seen, what
// Run sends for the value typed, and a notice when the aircraft puts a run's value back
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The panel's Run").

import { Button, Card, cx, fadeMask, Input, Link, NO_SCROLLBAR, Tooltip, useScroller } from "@dualinput/ui"
import { CircleAlert, Lock, Play, RotateCcw } from "lucide-react"
import { useState } from "react"
import type { ReactNode } from "react"

import type { Action, PanelHost, Preview, Reading, Refusal, Revert, RunView } from "./view.ts"

/** How long the mouse rests on a control before its tooltip opens, in milliseconds, here and in the picker. */
export const TOOLTIP_DELAY = 700

const PLACEHOLDERS: Record<RunView["takes"], string> = { value: "Value", event: "Value, or none", steps: "Steps, as +3 or -2" }

export function Run({ run, host }: { run: RunView; host: PanelHost }) {
  // The text lives here rather than in the view, since a round trip through the extension for each key would land after
  // the next key, and set the field back under the caret.
  const [text, setText] = useState(run.field)
  const type = (next: string) => {
    setText(next)
    host.typed(next)
  }
  const runs = !run.refused && run.preview.kind !== "error"
  const canRun = (value: string) => runs && (run.takes === "event" || value.trim() !== "")
  // It scrolls as our apps' pages do, with no scrollbar and a fade at an end that has more past it.
  const scroller = useScroller()
  return (
    <section
      ref={scroller.ref}
      onScroll={scroller.onScroll}
      onWheel={scroller.onWheel}
      onMouseDown={scroller.onMouseDown}
      style={fadeMask(scroller.above, scroller.below, 24, 24)}
      className={cx("min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3", NO_SCROLLBAR, scroller.cursor)}
    >
      <h2 className="text-base font-semibold leading-snug">{run.name}</h2>
      <p className="font-mono text-xs text-muted-foreground">{run.key}</p>
      <Live readings={run.live} />
      {/* A form, so Enter runs through its submit and the field keeps both the focus and its own key handling. */}
      <form
        className="mt-4 flex items-center"
        onSubmit={(event) => {
          event.preventDefault()
          if (canRun(text)) host.run(text)
        }}
      >
        <Input autoFocus aria-label="Value" className="mr-2 flex-1 font-mono" placeholder={PLACEHOLDERS[run.takes]} value={text} onChange={(event) => type(event.target.value)} />
        <Button type="submit" disabled={!canRun(text)}>
          <Play />
          Run
        </Button>
      </form>
      <Seen
        seen={run.seen}
        onPick={type}
        onRun={(value) => {
          type(value)
          if (canRun(value)) host.run(value)
        }}
      />
      {run.refused && <Refused refusal={run.refused} />}
      <Sends preview={run.preview} onReveal={host.reveal} />
      {run.revert && <PutBack revert={run.revert} />}
    </section>
  )
}

/** The watch's values, larger than the box after the line in the editor and in its live lime on a tint of it, so the two read as one thing. */
function Live({ readings }: { readings: Reading[] }) {
  if (!readings.length) return <p className="mt-3 text-sm text-muted-foreground">No reading yet</p>
  return (
    <div className="mt-3 flex flex-wrap">
      {readings.map((reading) => (
        // A name the sim can't read is amber, as its box after the line is, since nothing went wrong in the sim.
        <span key={reading.of ?? ""} className={cx("mb-1 mr-1 inline-flex max-w-full items-baseline rounded-xl px-3 py-1", reading.error ? "bg-warning/10 text-warning" : "bg-live/10 text-live")}>
          {reading.of && <span className="mr-2 font-mono text-xs opacity-70">{reading.of}</span>}
          <span className={cx("min-w-0 break-words font-mono", reading.error ? "py-1 text-sm" : "text-2xl leading-9")}>{reading.value}</span>
          {reading.carried !== undefined && <span className="ml-2 whitespace-nowrap font-mono text-xs opacity-70">last {reading.carried}</span>}
        </span>
      ))}
    </div>
  )
}

/** A button for each value seen: a click fills the field, and a double-click runs it. */
function Seen({ seen, onPick, onRun }: { seen: RunView["seen"]; onPick: (value: string) => void; onRun: (value: string) => void }) {
  if (seen === "many") return <p className="mt-2.5 text-xs text-muted-foreground">Seen more than 8 values</p>
  if (!seen.length) return null
  return (
    <div className="mt-2.5 flex flex-wrap items-center">
      <span className="mb-1 mr-2 text-xs text-muted-foreground">Seen</span>
      {seen.map((value) => (
        // Below, so it leaves the field the click fills in sight, and after a rest, so a click on its way isn't covered.
        <Tooltip key={value} content="Double-click to run" side="bottom" delay={TOOLTIP_DELAY}>
          <Button size="xs" variant="secondary" className="mb-1 mr-1 font-mono" onClick={() => onPick(value)} onDoubleClick={() => onRun(value)}>
            {value}
          </Button>
        </Tooltip>
      ))}
    </div>
  )
}

function Note({ tint, icon, children }: { tint: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card flush tint={tint} className="mt-4">
      <div className="flex items-start px-3 py-2.5 [&>svg]:mr-2.5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0">
        {icon}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Card>
  )
}

function Refused({ refusal }: { refusal: Refusal }) {
  return (
    <Note tint="bg-muted/40 text-muted-foreground" icon={<Lock />}>
      <p className="font-medium text-foreground">Pilot flying only</p>
      <p className="mt-0.5 text-xs">{refusal.pilotFlying} has control, so your change would be reverted. Try again after you take control.</p>
    </Note>
  )
}

/** What Run sends for the value typed, which catches a wrong scale or target before anything reaches the sim, or the build's first error in its place. */
function Sends({ preview, onReveal }: { preview: Preview; onReveal: (where: string) => void }) {
  if (preview.kind === "error") {
    const { where } = preview
    return (
      <Note tint="bg-destructive/10 text-destructive" icon={<CircleAlert />}>
        <p>{preview.message}</p>
        <p className="mt-0.5 break-words font-mono text-xs">
          <Link tone="destructive" onClick={() => onReveal(where)}>
            {where}
          </Link>
        </p>
      </Note>
    )
  }
  return (
    <div className="mt-4">
      <p className="text-xs text-muted-foreground">Sends</p>
      {preview.kind === "waiting" ? (
        <p className="mt-1 text-sm text-muted-foreground">Type a value to see what Run sends.</p>
      ) : preview.actions.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nothing, for this value.</p>
      ) : (
        <ol className="mt-1 space-y-1 font-mono text-xs leading-5">
          {preview.actions.map((action, at) => (
            <ActionLine key={at} action={action} />
          ))}
        </ol>
      )}
    </div>
  )
}

/** An action in words, its verbs muted so the names and values stand out: `set L:BKSQ_MixtureLeverPosition_1 to 0.5`. */
function ActionLine({ action: { does, name, values, times, apart } }: { action: Action }) {
  const muted = (words: string) => <span className="text-muted-foreground">{words}</span>
  return (
    <li className="break-words">
      {muted(`${does} `)}
      {name}
      {values.length > 0 && (
        <>
          {muted(does === "set" ? " to " : " with ")}
          {values.join(", ")}
        </>
      )}
      {times > 1 && muted(` ×${times}${apart ? `, ${apart} apart` : ""}`)}
    </li>
  )
}

/** The reason fsc-editor built Run: an aircraft that owns a variable puts it back faster than an author sees, who'd read it as a write with no effect. */
function PutBack({ revert }: { revert: Revert }) {
  return (
    <Note tint="bg-warning/10 text-warning" icon={<RotateCcw />}>
      <p className="font-medium">
        Back to <span className="font-mono">{revert.to}</span> after {revert.afterMs}ms
      </p>
      <p className="mt-0.5 text-xs opacity-80">Your write landed, and the aircraft put the value back.</p>
    </Note>
  )
}
