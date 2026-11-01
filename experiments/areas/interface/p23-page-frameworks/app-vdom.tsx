/*
 * The page for React and Preact: one source, which the build points at either, written as the bench's
 * frames are, with hooks, conditional JSX, keyed lists, and a Room that measures after every render.
 * Rows are memoized and the list's state sits on the list, as a careful app would have them; the card
 * has no memo, so a change there re-renders all of it, as most of a page's state would.
 */

import { memo, useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

import { chipClass, PART_ROWS, ROW_CLASS, run, SECTION_ROWS, SECTIONS, type Level, type RowData } from "./harness"

let setRows: (f: (rows: RowData[]) => RowData[]) => void
let setPart: (on: boolean) => void
let setRoomOpen: (open: boolean) => void

const Row = memo(function Row({ row }: { row: RowData }) {
  return (
    <li data-p23="row" className={ROW_CLASS}>
      <span>{row.name}</span>
      <span className={chipClass(row.level)}>{row.level}</span>
    </li>
  )
})

function List() {
  const [rows, set] = useState<RowData[]>([])
  setRows = set
  return <ul data-p23="list">{rows.map((row) => <Row key={row.id} row={row} />)}</ul>
}

function Card() {
  const [part, set] = useState(false)
  setPart = set
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {SECTIONS.map((s) => (
        <div key={s} className="space-y-3">
          <span className="text-sm text-muted-foreground">Section {s}</span>
          {SECTION_ROWS.map((r) => (
            <div key={r} className={ROW_CLASS}>
              <span>Name</span>
              <span>Where</span>
              <span className={chipClass("info")}>Ready</span>
            </div>
          ))}
        </div>
      ))}
      {part && (
        <div data-p23="part" className="space-y-3">
          {PART_ROWS.map((r) => (
            <div key={r} className={ROW_CLASS}>
              <span>Name</span>
              <span>Where</span>
              <span className={chipClass("warning")}>Part</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Room() {
  const [open, set] = useState(false)
  setRoomOpen = set
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const measured = inner.current?.offsetHeight ?? 0
    if (measured !== height) setHeight(measured)
  })
  return (
    <div data-p23="room" style={{ height: open ? height : 0, overflow: "hidden", transition: "height 220ms ease-in-out" }}>
      <div data-p23="room-inner" ref={inner} className="p-4 text-sm">The room's content</div>
    </div>
  )
}

function Controls() {
  const [presses, setPresses] = useState(0)
  const [text, setText] = useState("")
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <button data-p23="press" className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium bg-primary text-primary-foreground" onClick={() => setPresses((n) => n + 1)}>
        Press
      </button>
      <span data-p23="pressed" className="text-sm text-muted-foreground">Pressed {presses} {presses === 1 ? "time" : "times"}</span>
      <input data-p23="field" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground" value={text} onChange={(e) => setText(e.target.value)} />
      <span data-p23="mirror" className="font-mono">{text}</span>
    </div>
  )
}

function App() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-4 font-sans text-foreground">
      <Controls />
      <Room />
      <Card />
      <List />
    </div>
  )
}

const flush = (work: () => void) => flushSync(work)

run({
  name: (window as any).P23_FRAMEWORK,
  mount(root) {
    const app = createRoot(root)
    flush(() => app.render(<App />))
  },
  create: (rows) => flush(() => setRows(() => rows)),
  updateOne: (index: number, level: Level) => flush(() => setRows((rows) => {
    const next = rows.slice()
    next[index] = { ...next[index], level }
    return next
  })),
  updateAll: (levelAt) => flush(() => setRows((rows) => rows.map((row, i) => ({ ...row, level: levelAt(i) })))),
  reverse: () => flush(() => setRows((rows) => rows.slice().reverse())),
  clear: () => flush(() => setRows(() => [])),
  togglePart: (on) => flush(() => setPart(on)),
  setRoom: (open) => flush(() => setRoomOpen(open)),
})
