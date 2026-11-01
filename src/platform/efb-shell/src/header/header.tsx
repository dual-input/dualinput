// The header: the mark and version, or a session's phase, then each thing that needs the pilot as a word and
// an icon, together in a pill. Hovering the pill tints it, and resting there grows it from its top right
// corner, left and down, into an island of details over the window, a row for each with its action, while the
// window dims under it. A press keeps it open, so its actions don't close under the pointer; then a press
// elsewhere or Escape closes it.

import { cx, Link, toast } from "@dualinput/ui"
import { ExternalLink } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Mark } from "../mark.tsx"
import { TONE_ICON } from "./issues.tsx"
import type { Issue } from "./issues.tsx"
import { HeaderStart } from "./phase.tsx"
import type { SessionPhase } from "./phase.tsx"

/**
 * How the status opens, in milliseconds: after the pointer has rested on it this long, so a cursor passing
 * over it on the way to Host doesn't flash it open, nor a VR pointer that wavers; and it closes this long
 * after the pointer leaves, so moving down into it to press an action doesn't close it underneath. It grows on
 * a curve that overshoots and settles, and shrinks on a plain one. Open, it's `openWidth` wide, short of the
 * window's 516, so it floats.
 */
const ISLAND = { openAfter: 200, closeAfter: 300, grow: 260, shrink: 220, spring: "cubic-bezier(0.32, 1.18, 0.6, 1)", openWidth: 400 }

/** The header's height: its 32px pill centered, so it sits 11px from the window's top, as from its right, and a page starts 11px under it. */
export const HEADER_HEIGHT = 54

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="flex items-center">
      <span className="mr-3 shrink-0">{TONE_ICON[issue.tone]}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{issue.title}</span>
        <span className="text-xs text-muted-foreground">{issue.detail}</span>
      </span>
      {issue.action && <span className="ml-3 shrink-0">{issue.action}</span>}
    </div>
  )
}

/** Under the rows when something's wrong, a way to people for a pilot our words haven't helped. An update alone is news, and a PC that's offline can't load the page, so then it doesn't show. */
function HelpLine() {
  return (
    <p className="text-xs text-muted-foreground">
      Not sure what to do?{" "}
      <Link onClick={() => toast("Opening our Discord in your browser")}>
        Ask on our Discord <ExternalLink className="inline size-3 align-[-1px]" />
      </Link>
    </p>
  )
}

export function Header({ version, phase, issues, offline, opened }: { version: string; phase: SessionPhase | undefined; issues: Issue[]; offline: boolean; /** Counts the banner's cards that landed on the header, each opening its island on the rows. */ opened: number }) {
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    if (opened === 0) return
    setPinned(true)
    setOpen(true)
  }, [opened])
  const place = useRef<HTMLDivElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  const timer = useRef(0)
  const later = (ms: number, then: () => void) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(then, ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // Coherent GT has no ResizeObserver, so the pill and the rows are measured after every render.
  const [size, setSize] = useState({ pill: 0, rows: 0 })
  useLayoutEffect(() => {
    const pill = place.current?.offsetWidth ?? 0
    const height = rows.current?.offsetHeight ?? 0
    if (pill !== size.pill || height !== size.rows) setSize({ pill, rows: height })
  })
  const close = () => {
    setPinned(false)
    setOpen(false)
  }
  useEffect(() => {
    if (!pinned) return
    const onPress = (event: MouseEvent) => {
      if (!place.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.keyCode === 27) close()
    }
    document.addEventListener("mousedown", onPress, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPress, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [pinned])

  const brand = (
    <HeaderStart
      phase={phase}
      brand={
        <div className="flex items-center">
          <Mark className="mr-2 size-4 text-primary" />
          <span className="mr-2 text-sm font-medium">Dual Input</span>
          <span className="text-xs text-muted-foreground">v{version}</span>
        </div>
      }
    />
  )
  const trouble = issues.some((issue) => issue.tone !== "news")
  // The mark lines up with the pages' 20px gutter.
  if (!issues.length) {
    return (
      <div className="flex shrink-0 select-none items-center px-5" style={{ height: HEADER_HEIGHT }}>
        {brand}
      </div>
    )
  }
  const eased = open ? { duration: ISLAND.grow, curve: ISLAND.spring } : { duration: ISLAND.shrink, curve: "ease-in-out" }
  return (
    <>
      {/* The whole window dims under the open island, the mark too; pinned, it takes the press that closes it. */}
      <div className={cx("absolute inset-x-0 inset-y-0 z-20 bg-black/40 transition-opacity duration-200", open ? "opacity-100" : "opacity-0", !(open && pinned) && "pointer-events-none")} />
      {/* Both ends line up with the pages' 20px gutter: the mark, and the pill's last icon, 11px of the row's padding and 9px of the pill's. */}
      <div className="flex shrink-0 select-none items-center pl-5 pr-[11px]" style={{ height: HEADER_HEIGHT }}>
        {brand}
        <div
          ref={place}
          className="relative z-30 ml-auto"
          onMouseEnter={() => {
            setHovered(true)
            if (open) window.clearTimeout(timer.current)
            else later(ISLAND.openAfter, () => setOpen(true))
          }}
          onMouseLeave={() => {
            setHovered(false)
            if (pinned) window.clearTimeout(timer.current)
            else later(ISLAND.closeAfter, () => setOpen(false))
          }}
        >
          {/* The pill's tint on hover, apart from the island, so it shows at once while the island eases. */}
          {hovered && !open && <span className="absolute inset-x-0 inset-y-0 rounded-full bg-muted/60" />}
          {/* The island grows from the top right corner, its corners tightening from the pill's half height to the rows' 12px. The rows sit at their open width from the start, anchored right, so growing uncovers them rather than reflowing them. */}
          <div
            className={cx("absolute right-0 top-0 overflow-hidden", open ? "bg-popover shadow-xl" : "")}
            style={{ width: open ? ISLAND.openWidth : size.pill, height: open ? 32 + size.rows : 32, borderRadius: open ? 12 : 16, transition: `width ${eased.duration}ms ${eased.curve}, height ${eased.duration}ms ${eased.curve}, border-radius ${eased.duration}ms ${eased.curve}, background-color ${eased.duration}ms` }}
          >
            <div
              ref={rows}
              onMouseDown={() => setPinned(true)}
              className="absolute right-0 top-8 space-y-3 px-4 pb-4 pt-2"
              style={{ width: ISLAND.openWidth, opacity: open ? 1 : 0, transition: open ? "opacity 160ms 80ms" : "opacity 100ms" }}
            >
              {issues.map((issue) => (
                <IssueRow key={issue.word} issue={issue} />
              ))}
              {!offline && trouble && <HelpLine />}
            </div>
          </div>
          {/* The last icon sits 9px from the pill's right, as from its top and bottom, so it's concentric with the pill's round end. A VR pointer wavers, so while it rests, the pill takes hovers and presses past its edges, into the space around it no one aims at. Open, the island is the target, so the margin goes. */}
          <button
            type="button"
            aria-expanded={open}
            className={cx("relative flex h-8 cursor-pointer items-center whitespace-nowrap pl-3 pr-[9px] text-xs", !open && "before:absolute before:-bottom-[11px] before:-left-3 before:-right-[11px] before:-top-[11px]")}
            onClick={() => {
              if (pinned) close()
              else {
                setPinned(true)
                setOpen(true)
              }
            }}
          >
            {issues.map((issue, at) => (
              <span key={issue.word} className={cx("flex items-center text-muted-foreground", at > 0 && "ml-4")}>
                <span className="mr-1">{issue.word}</span>
                <span className="[&_svg]:size-3.5">{TONE_ICON[issue.tone]}</span>
              </span>
            ))}
          </button>
        </div>
      </div>
    </>
  )
}
