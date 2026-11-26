// The Sync log, the extension's view in VS Code's bottom panel: each cause the sync engine on this PC took a decision for,
// in time order, with its time, its entry, the value it brings, and its latest step, which opens to every step with its
// time from the first, drawn with the kit in the palette that matches VS Code's theme
// (record/areas/profiles/06-the-sync-log.md, "The Sync log view"). It draws from rows alone, so the extension wires it to
// `serve` by posting them, and it never follows the editor's cursor.

import { Button, cx, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle, Input, Link, Root, Separator } from "@dualinput/ui"
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, ChevronRight, CircleCheck, Clock, Eraser, Info, Play, RotateCcw, Search, SearchX, TriangleAlert } from "lucide-react"
import { createContext, Fragment, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, ReactNode } from "react"

import { INSET, ISLAND } from "../../panel/src/island.ts"
import type { Syntax, SyntaxPart } from "../../src/syntax.ts"
import type { Part, Word } from "../../src/words.ts"
import { Definitions, WordText } from "./definitions.tsx"
import { actionParts, causeOf, isBug, later, named, namesIn, noteOf, stepParts, timeOfDay, TROUBLE } from "./rows.ts"
import type { Cause, Palette, RowView, StepView, SyncLogHost } from "./view.ts"

/**
 * The log keeps 10,000 rows, too many to draw at once, so it draws them in blocks of this many, by id, and only the
 * blocks near the part in view; the rest hold their place at their height.
 */
const BLOCK = 50
/** A closed row's height in px, the `h-7` its line takes, which a block that hasn't drawn takes for each of its rows. */
const ROW = 28
/** How far past the part in view, in px, a block draws, so a scroll shows rows rather than their space. */
const AHEAD = 600

/**
 * A slim scrollbar for the list. The Dual Input panel's islands scroll with fades alone, but 10,000 rows need a bar to
 * find your place, so the list gets a rounded thumb at 30% of the muted color in a clear 10px gutter, brighter under the
 * pointer, with no buttons. Windows draws a wide bar
 * with arrows, and Chromium on Windows keeps small arrows even under the standard `scrollbar-width: thin`, which also
 * overrides these rules, so this styles ::-webkit-scrollbar alone. A webkit thumb repaints only on its own events, not
 * on a hover of the list, so it shows faintly all along rather than on hover (fsc-editor, src/renderer/src/index.css,
 * `.scrollbar-overlay`). It stays out of the kit, whose classes reach the sim's pages too, since Coherent GT is untested
 * on a scrollbar's thumb and track.
 */
const THIN_SCROLLBAR =
  "[&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-corner]:bg-transparent [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50"

/**
 * The columns of a row's line: its chevron, time, entry, cause, value, and verdict. The verdict keeps 8rem however
 * narrow the panel, since a grid shares the room out to the columns before it first, and they'd leave it none.
 */
const COLUMNS = "grid-cols-[20px_96px_minmax(0,13rem)_minmax(0,11rem)_minmax(0,8rem)_minmax(8rem,1fr)]"
/**
 * Where an open row's steps start, in px from its left edge: the line's padding, chevron, and time, less the rail's
 * 24px, so each step's words line up under the entry's key.
 */
const STEPS_AT = "pl-[100px]"

/** The log, which starts with `filter` in its filter box and the rows `open` names open, as the dev page's scenes do. */
export function SyncLog({ rows, palette, syntax, host, filter: first = "", open = [] }: { rows: RowView[]; palette: Palette; syntax: Syntax; host: SyncLogHost; filter?: string; open?: number[] }) {
  const [filter, setFilter] = useState(first)
  // Which rows are open, by id, kept here so a row stays open when it scrolls out of drawing and back, or a filter hides it.
  const opened = useRef(new Set(open))
  const names = useMemo(() => namesIn(filter), [filter])
  const shown = useMemo(() => (names.length ? rows.filter((row) => named(row, names)) : rows), [rows, names])
  return (
    // An island with rounded corners, as the Dual Input panel is, so it reads as a window onto our app in any theme.
    <Root palette={palette} style={{ height: "100%" }}>
      <Tokens.Provider value={syntax}>
        {/* The same inset on every side as the Dual Input panel's islands, VS Code's own, so the log sits evenly inside its card. */}
        <Definitions className={cx("flex h-full flex-col", INSET)}>
          <div className={cx("flex min-h-0 flex-1 flex-col overflow-hidden", ISLAND)}>
            {/*
              The toolbar's padding is the header's, and the search icon with its margin is the chevrons' 20px column, so the
              filter's text starts where the Time column does.
            */}
            <div className="flex shrink-0 items-center px-3.5 py-1.5">
              <label className="flex w-72 shrink items-center text-muted-foreground">
                <Search className="mr-1.5 size-3.5 shrink-0" />
                <Input look="flat" aria-label="Filter by entry" placeholder="Filter: battery, throttle" value={filter} onChange={(event) => setFilter(event.target.value)} className="text-foreground" />
              </label>
              {/* An empty log says so in the middle, so the count shows only over rows. */}
              <span className="ml-auto mr-3 whitespace-nowrap pl-3 text-xs text-muted-foreground">{rows.length > 0 && counted(shown.length, rows.length)}</span>
              <Button size="xs" variant="ghost" disabled={!rows.length} onClick={host.clear}>
                <Eraser />
                Clear
              </Button>
            </div>
            {shown.length > 0 && <Header />}
            <Separator />
            {shown.length ? <List rows={shown} opened={opened.current} host={host} /> : <Nothing filter={rows.length > 0 ? filter.trim() : null} clearFilter={() => setFilter("")} />}
          </div>
        </Definitions>
      </Tokens.Provider>
    </Root>
  )
}

/**
 * The columns' names, over the rows and outside their scroll, so they stay in view. Its padding is the list's and a
 * row's together, so each name sits over its column.
 */
function Header() {
  return (
    <div className={cx("grid h-5 shrink-0 select-none items-center px-3.5 pb-1 text-[11px] font-semibold text-muted-foreground", COLUMNS)}>
      <span />
      <span>Time</span>
      <span>Entry</span>
      <span>Cause</span>
      <span>Value</span>
      <span>Result</span>
    </div>
  )
}

function counted(shown: number, all: number): string {
  const rows = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`
  return shown === all ? rows(all) : `${shown.toLocaleString("en-US")} of ${rows(all)}`
}

/**
 * The log with no rows to show: none yet, or none the filter's text matches, with a way to clear it. The bottom panel
 * opens about 160px tall under the toolbar, so this takes the kit's compact empty state, and clears the filter from a
 * link in its line rather than a button under it.
 */
function Nothing({ filter, clearFilter }: { filter: string | null; clearFilter: () => void }) {
  return (
    <Empty compact>
      <EmptyHeader>
        <EmptyMedia variant="icon">{filter === null ? <ArrowRightLeft /> : <SearchX />}</EmptyMedia>
        <EmptyTitle>{filter === null ? "Nothing synced yet" : `No results for ${filter}`}</EmptyTitle>
        <EmptyDescription>
          {filter === null ? (
            "Fly in a session, and each change the sync engine handles shows here, step by step."
          ) : (
            <>
              No entry in the log matches your filter.{" "}
              <Link className="font-medium" onClick={clearFilter}>
                Clear filter
              </Link>
            </>
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/**
 * The rows in blocks, scrolled to the newest at the bottom, which it stays at as rows arrive until you scroll up, as an
 * IDE's own logs do. Only a block whose rows changed draws again, so a change to one row leaves the other 9,999 alone.
 */
function List({ rows, opened, host }: { rows: RowView[]; opened: Set<number>; host: SyncLogHost }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  // Where the log last scrolled itself to the bottom. A browser fires a scroll event a frame after the scroll, when rows
  // may have come in under it, so an event at this place is the log's own, which leaves it at the bottom.
  const ours = useRef(-1)
  const heights = useRef(new Map<number, Measured>())
  const blocks = useBlocks(rows)
  useEffect(() => {
    const box = content.current
    if (!box || !scroller || typeof ResizeObserver !== "function") return
    const observer = new ResizeObserver(() => {
      if (!atBottom.current) return
      scroller.scrollTop = scroller.scrollHeight
      ours.current = scroller.scrollTop
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [scroller])
  // A row you open grows down from its line, which stays where you clicked it: the list scrolls by the least that shows
  // its steps, never past its line, and follows the newest row again only if that leaves it at the bottom. Chromium's
  // scroll anchoring would hold a row below the opened one in place instead, scrolling the opened row up, so the list
  // turns it off; a block that draws above the view keeps its place without it, since its stand-in holds its measured
  // height.
  const reveal = useCallback(
    (card: HTMLElement) => {
      if (!scroller) return
      const view = scroller.getBoundingClientRect()
      const box = card.getBoundingClientRect()
      const below = box.bottom - view.bottom
      if (below > 0) scroller.scrollTop += Math.max(0, Math.min(below, box.top - view.top))
      atBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 8
      ours.current = scroller.scrollTop
    },
    [scroller],
  )
  return (
    <div
      ref={setScroller}
      onScroll={(event) => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
        if (scrollHeight - scrollTop - clientHeight < 8) atBottom.current = true
        else if (scrollTop !== ours.current) atBottom.current = false
      }}
      className={cx("min-h-0 flex-1 overflow-y-auto py-1 [overflow-anchor:none]", THIN_SCROLLBAR)}
    >
      <Reveal.Provider value={reveal}>
        <div ref={content} className="px-1.5">
          {blocks.map(([at, block]) => (
            <Block key={at} at={at} rows={block} scroller={scroller} heights={heights.current} opened={opened} host={host} />
          ))}
        </div>
      </Reveal.Provider>
    </div>
  )
}

/** The rows by block, each block's array kept from the last render while its rows are the same, so its memo holds. */
function useBlocks(rows: RowView[]): [number, RowView[]][] {
  const last = useRef(new Map<number, RowView[]>())
  return useMemo(() => {
    const next = new Map<number, RowView[]>()
    for (const row of rows) {
      const at = Math.floor(row.id / BLOCK)
      const block = next.get(at)
      if (block) block.push(row)
      else next.set(at, [row])
    }
    for (const [at, block] of next) {
      const before = last.current.get(at)
      if (before && before.length === block.length && before.every((row, place) => row === block[place])) next.set(at, before)
    }
    last.current = next
    return [...next]
  }, [rows])
}

/** A block's height when it last drew, and how many rows it had then. */
type Measured = { height: number; rows: number }

type BlockProps = { at: number; rows: RowView[]; scroller: HTMLElement | null; heights: Map<number, Measured>; opened: Set<number>; host: SyncLogHost }

const Block = memo(function Block({ at, rows, scroller, heights, opened, host }: BlockProps) {
  const ref = useRef<HTMLDivElement>(null)
  // A page with no IntersectionObserver draws every block, so the log still works in a browser engine that lacks one.
  const [near, setNear] = useState(typeof IntersectionObserver !== "function")
  useEffect(() => {
    const element = ref.current
    if (!element || !scroller || typeof IntersectionObserver !== "function") return
    const seen = new IntersectionObserver((entries) => setNear(entries.some((entry) => entry.isIntersecting)), { root: scroller, rootMargin: `${AHEAD}px 0px` })
    seen.observe(element)
    // A block that drew remembers its height, which it holds once it stops drawing; its space alone has no rows to count.
    const sized =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (element.childElementCount) heights.set(at, { height: element.offsetHeight, rows: element.childElementCount })
          })
        : null
    sized?.observe(element)
    return () => {
      seen.disconnect()
      sized?.disconnect()
    }
  }, [scroller, heights, at])
  if (!near) {
    // Rows that opened add their steps' height, which a block keeps as it gains rows.
    const measured = heights.get(at)
    const extra = measured ? measured.height - measured.rows * ROW : 0
    return <div ref={ref} style={{ height: rows.length * ROW + extra }} />
  }
  return (
    <div ref={ref}>
      {rows.map((row) => (
        <Row key={row.id} row={row} opened={opened} host={host} />
      ))}
    </div>
  )
})

/** Shows a row you just opened, from the list that scrolls. */
const Reveal = createContext<(card: HTMLElement) => void>(() => undefined)

const Row = memo(function Row({ row, opened, host }: { row: RowView; opened: Set<number>; host: SyncLogHost }) {
  const [open, setOpen] = useState(() => opened.has(row.id))
  const card = useRef<HTMLDivElement>(null)
  const reveal = useContext(Reveal)
  // Whether you opened the row just now, as opposed to its drawing open, as a scene's rows do, or scrolling back into view.
  const toggled = useRef(false)
  const toggle = () => {
    if (open) opened.delete(row.id)
    else opened.add(row.id)
    toggled.current = true
    setOpen(!open)
  }
  useLayoutEffect(() => {
    if (open && toggled.current && card.current) reveal(card.current)
    toggled.current = false
  }, [open, reveal])
  const trouble = TROUBLE.has(row.verdict)
  // A bug in the profile shows on the row's line whichever step met it, since a function that threw still leaves its
  // value to read back, and the row can end `pending` or `landed` with the bug midway.
  const bug = row.steps.some(isBug)
  return (
    // An open row rises into a card of its own, so its steps read as part of it and stop where the next row starts. The
    // card adds nothing above its line, so the line stays under the cursor that opened it, and a second click on its top
    // edge closes it.
    <div ref={card} className={cx(open && "mb-1 rounded-xl bg-card")}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        // A press on a link or a word does what that does, and opens nothing.
        onClick={(event) => {
          if (!(event.target instanceof Element && event.target.closest("a, [data-word]"))) toggle()
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
          event.preventDefault()
          toggle()
        }}
        className={cx("grid h-7 cursor-pointer select-none items-center rounded-lg px-2 text-[13px] outline-none", !open && "hover:bg-muted/50 focus-visible:bg-muted/50", COLUMNS)}
      >
        <ChevronRight className={cx("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Time time={row.time} />
        <span className="min-w-0 truncate pr-3">
          <Key entry={row.entry} host={host} />
        </span>
        <span className="flex min-w-0 items-center pr-3 text-muted-foreground">
          <CauseIcon cause={row.cause} className="mr-1.5 size-3.5 shrink-0" />
          <span className="truncate">
            <Words parts={causeOf(row.cause)} />
          </span>
        </span>
        <span className="truncate pr-3">{row.value !== null && <Value text={row.value} />}</span>
        <span className={cx("flex min-w-0 items-center", bug ? "text-destructive" : trouble && "text-warning")}>
          <Status word={row.verdict} bug={bug} open={row.open} className="mr-1.5 size-3.5 shrink-0" />
          <span className="truncate">
            <WordText word={row.verdict} />
          </span>
          {row.notes.length > 0 && <Info aria-label="A note" className="ml-1.5 size-3.5 shrink-0 text-muted-foreground" />}
        </span>
      </div>
      {open && <Steps row={row} host={host} />}
    </div>
  )
})

/** A row's time of day, its milliseconds fainter, since an author reads the time to the second and rarely past it. */
function Time({ time }: { time: number }) {
  const [clock, ms] = timeOfDay(time).split(".")
  return (
    <span className="whitespace-nowrap pr-3 tabular-nums text-muted-foreground">
      {clock}
      <span className="opacity-50">.{ms}</span>
    </span>
  )
}

/** Where a row's value came from: out from this PC, in from a crew member, a playback, a catch-up, or control passing. */
function CauseIcon({ cause, className }: { cause: Cause; className?: string }) {
  if (cause.kind === "local-change") return <ArrowUpRight className={className} />
  if (cause.kind === "control-passed") return <ArrowRightLeft className={className} />
  if (cause.kind === "catch-up") return <RotateCcw className={className} />
  return cause.from === null && cause.playback ? <Play className={className} /> : <ArrowDownLeft className={className} />
}

/** A row's verdicts that are done and went right: its write read back, or its compare matched. */
const WENT_RIGHT = new Set<Word>(["landed", "matches", "sent"])

/**
 * A verdict's mark: trouble, in red when the profile has a bug to fix and amber when the aircraft or the sim didn't do
 * what the write set out to, then done, under way, as `serve` says a row is while it waits on the engine, or ended with
 * nothing to do.
 */
function Status({ word, bug, open, className }: { word: Word; bug?: boolean; open?: boolean; className?: string }) {
  if (bug) return <TriangleAlert className={cx("text-destructive", className)} />
  if (TROUBLE.has(word)) return <TriangleAlert className={cx("text-warning", className)} />
  if (WENT_RIGHT.has(word)) return <CircleCheck className={cx(word === "sent" ? "text-muted-foreground" : "text-success", className)} />
  if (open) return <Clock className={cx("text-muted-foreground", className)} />
  return (
    <span className={cx("flex items-center justify-center", className)}>
      <span className="size-1.5 rounded-full bg-muted-foreground/60" />
    </span>
  )
}

/**
 * Every step of a row down a rail, each with a mark: the cause first, trouble in the warning color, a landing in the
 * success color. A step shows its time from the row's first only where time passed, since most steps take none and an
 * author reads the order, not the milliseconds. The notes `serve` adds sit under the last step.
 */
function Steps({ row, host }: { row: RowView; host: SyncLogHost }) {
  const last = row.steps.length - 1
  return (
    // The kit's root turns selection off for its pages in the sim, and a row's line stays a click target, but its steps
    // select, so an author can copy an error's words or a value.
    <div className={cx("select-text pb-2.5 pr-3 pt-0.5 text-[13px]", STEPS_AT)}>
      {row.steps.map((step, at) => (
        <div key={at} className="grid grid-cols-[24px_minmax(0,1fr)]">
          <Rail first={at === 0} last={at === last}>
            {at === 0 ? (
              <span className="flex size-[18px] items-center justify-center rounded-full bg-muted text-muted-foreground">
                <CauseIcon cause={row.cause} className="size-3" />
              </span>
            ) : (
              <StepMark step={step} />
            )}
          </Rail>
          <p className="min-w-0 break-words py-0.5 leading-5">
            <Step row={row} step={step} at={at} host={host} />
            {later(row, at) && <span className="ml-2 text-xs tabular-nums text-muted-foreground">{later(row, at)}</span>}
          </p>
        </div>
      ))}
      {row.notes.map((note, at) => (
        <div key={at} className="ml-6 mt-2 flex items-start rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
          <Info className="mr-2 mt-[3px] size-3.5 shrink-0" />
          <span>
            {noteOf(row, note).map((part, place) =>
              "key" in part ? (
                <Key key={place} entry={part.key} host={host} />
              ) : "time" in part ? (
                <span key={place} className="font-semibold tabular-nums text-foreground">
                  {part.time}
                </span>
              ) : (
                <Fragment key={place}>{part.text}</Fragment>
              ),
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

/** The rail beside the steps: a line from step to step, with each step's mark on it, centered on its first line. */
function Rail({ first, last, children }: { first: boolean; last: boolean; children: ReactNode }) {
  return (
    <div className="relative flex justify-center">
      {!first && <span className="absolute left-1/2 top-0 h-3 border-l border-muted-foreground/30" />}
      {!last && <span className="absolute bottom-0 left-1/2 top-3 border-l border-muted-foreground/30" />}
      <span className="relative mt-[3px] flex size-[18px] items-center justify-center rounded-full bg-card">{children}</span>
    </div>
  )
}

function StepMark({ step }: { step: StepView }) {
  if (TROUBLE.has(step.word)) return <TriangleAlert className={cx("size-3.5", isBug(step) ? "text-destructive" : "text-warning")} />
  if (step.also === "landed" || step.word === "matches") return <CircleCheck className="size-3.5 text-success" />
  return <span className="size-1.5 rounded-full bg-muted-foreground/70" />
}

/**
 * A step in words, from its pieces in rows.ts: its words in red when the profile has a bug and amber when it's other
 * trouble, what it carries by its word, and who sent it and a second word muted.
 */
function Step({ row, step, at, host }: { row: RowView; step: StepView; at: number; host: SyncLogHost }) {
  const tone = isBug(step) ? "text-destructive" : TROUBLE.has(step.word) && "text-warning"
  return (
    <>
      {stepParts(row, step, at).map((part, place) =>
        "word" in part ? (
          <span key={place} className={cx(tone)}>
            <WordText word={part.word} />
          </span>
        ) : "link" in part ? (
          <Key key={place} entry={part.link} host={host} />
        ) : "detail" in part ? (
          <Detail key={place} word={part.of} text={part.detail} />
        ) : "also" in part ? (
          <span key={place} className="text-muted-foreground">
            <WordText word={part.also} />
          </span>
        ) : part.muted ? (
          <span key={place} className="text-muted-foreground">
            {part.text}
          </span>
        ) : (
          <Fragment key={place}>{part.text}</Fragment>
        ),
      )}
    </>
  )
}

function Detail({ word, text }: { word: Word; text: string }) {
  // A write's actions, and the event an `ignore` names, are names as the profile writes them.
  if (word === "writes" || word === "ignored" || word === "ignore-expired") return <Actions text={text} />
  // An error's words, from a function that threw or stopped its entry, are the profile's bug.
  if (word === "function-failed" || word === "stopped") return <span className="text-destructive">{text}</span>
  return <Value text={text} />
}

/**
 * The token colors keys, values, and the parts of a name call take, which the extension posts with the palette, as the
 * profile's own in the editor; with none, as before the first post, each takes the text's color.
 */
const Tokens = createContext<Syntax>({})

/** A part's look as a style, the way the editor draws that part of a profile. */
function useLook(part: SyntaxPart): CSSProperties | undefined {
  const look = useContext(Tokens)[part]
  return look && { color: look.color, fontWeight: look.bold ? 600 : undefined, fontStyle: look.italic ? "italic" : undefined }
}

/**
 * A value, in the profile's color for a number or a text, as the editor colors one. Each is what a step saw or wrote at
 * its time, so none takes the kit's lime, which the box after a `watch:` line and the Dual Input panel keep for the
 * sim's value right now.
 */
function Value({ text }: { text: string }) {
  // A text value can run to 4 KB, which in full would make its step a page tall, so it stops at a line's worth, whole
  // on hover.
  const clipped = text.length > LONGEST
  return (
    <span className="tabular-nums" style={useLook(numbers(text) ? "number" : "text")} title={clipped ? text : undefined}>
      {clipped ? `${text.slice(0, LONGEST)}…` : text}
    </span>
  )
}

/** A value `serve` wrote from a number, as `-5`, `0.75`, or `121500000`, which it never writes with an exponent. */
const NUMBER = /^-?\d+(\.\d+)?$/

/** Whether a value is numbers alone, as an action's values are, such as a K event's `2 6`, which `serve` joins with spaces. */
function numbers(text: string): boolean {
  return text.split(" ").every((part) => NUMBER.test(part))
}

/** The most of a value the log shows, in characters, about a line of a step in a panel 1,100px wide. */
const LONGEST = 120

/** An entry's key, which opens its line, as the profile's editor colors a key. */
function Key({ entry, host }: { entry: string; host: SyncLogHost }) {
  return (
    <Link tone="plain" style={useLook("entry")} onClick={() => host.reveal(entry)}>
      {entry}
    </Link>
  )
}

/** A write's actions, each part as the profile's editor colors it in a name call, and the values it sends as values. */
function Actions({ text }: { text: string }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-px font-mono text-xs">
      {actionParts(text).map((part, at) => (part.part === "value" ? <Value key={at} text={part.text} /> : part.part === "space" ? part.text : <Painted key={at} part={part.part} text={part.text} />))}
    </code>
  )
}

function Painted({ part, text }: { part: SyntaxPart; text: string }) {
  return <span style={useLook(part)}>{text}</span>
}

/** A row's cause in words, each engine word underlined. */
function Words({ parts }: { parts: Part[] }) {
  return <>{parts.map((part, at) => ("word" in part ? <WordText key={at} word={part.word} /> : <Fragment key={at}>{part.text}</Fragment>))}</>
}
