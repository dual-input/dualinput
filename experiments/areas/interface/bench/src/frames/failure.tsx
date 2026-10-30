// A failure's box, which the setup check shows under the check that failed and the app's window
// shows when the service isn't running, so a pilot who met one in setup knows it again later.
import { useUI } from "@/bench/ui"

// Its title and a line of detail, and the action that deals with it:
// - fix: Dual Input fixes it, after the pilot agrees to Windows' prompt, and the sequence goes on;
// - retry: the pilot fixes it outside Dual Input, then checks again;
// - restart: only a restart of the sim fixes it, which the tray app carries out;
// - wait: the pilot fixes it outside Dual Input, and the sequence goes on by itself once it's fixed.
// A failure Dual Input can work around also offers Continue anyway.
export type Failure = { title: string; detail: string; action: { kind: "fix" | "retry" | "restart" | "wait"; label?: string; busy: string }; skippable?: boolean }

// The EFB app reaches everything else through the core, Dual Input's service, so nothing can run
// without it. The EFB can't start a program, so the tray app starts the core whenever the sim
// runs; this shows only when the tray app isn't running either, and when it is, the wait is short.
export const SERVICE_NOT_RUNNING: Failure = {
  title: "Dual Input service isn't running",
  detail: "Open it from the Start menu.",
  action: { kind: "wait", busy: "Waiting for the service to start" },
}

// Written out whole, since Tailwind finds a class only where its full name appears. The kit's
// focus ring is sky, so it's given in the box's color too.
export function toneOf(failure: Failure) {
  return failure.skippable
    ? {
        tone: "warning" as const,
        box: "border-warning/20 bg-warning/10",
        text: "text-warning focus-visible:border-warning/40 focus-visible:ring-warning/30",
        button: "bg-warning text-warning-foreground hover:bg-warning/90 focus-visible:border-warning/40 focus-visible:ring-warning/30",
      }
    : {
        tone: "destructive" as const,
        box: "border-destructive/20 bg-destructive/10",
        text: "text-destructive focus-visible:border-destructive/40 focus-visible:ring-destructive/30",
        button: "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/30",
      }
}

// A failure sits in a tinted box: red for one that stops Dual Input, amber for one it can work
// around. Everything in it takes the box's color or near-white, since the page's gray text and
// sky-300 buttons clash with the tint. The failure's actions go in as children.
export function FailureBox({ failure, children }: { failure: Failure; children?: React.ReactNode }) {
  const { Spinner } = useUI()
  return (
    <div className={"flex w-full max-w-80 animate-in flex-col items-center gap-3 rounded-3xl border px-5 py-4 text-center duration-200 fade-in " + toneOf(failure).box}>
      <div className="flex flex-col gap-1">
        <p className={"text-sm font-medium " + toneOf(failure).text}>{failure.title}</p>
        <p className="text-sm text-foreground/75">{failure.detail}</p>
      </div>
      {/* A failure the pilot fixes outside Dual Input, which Dual Input notices by itself, shows
          that it's waiting rather than a button. */}
      {failure.action.kind === "wait" && (
        <span className="flex items-center gap-2 text-sm text-foreground/60">
          <Spinner className="size-4" /> {failure.action.busy}
        </span>
      )}
      {children}
    </div>
  )
}
