// Two ways a page changes smoothly, for pages whose content changes while a pilot watches, as the
// Traffic tab's does when sharing starts or stops, or a count moves. Coherent GT has no
// ResizeObserver, so heights are measured when what they hold changes.
import { useEffect, useLayoutEffect, useRef, useState } from "react"

// Swap: one thing in a spot gives way to another, as the header's phase does (phase.tsx): what
// leaves fades up and out, and what arrives fades up in from 4px below, a beat later, both drawn in
// the same grid cell so neither moves the other. It suits things of one height, such as a line of
// text, an icon, or a control; the id says when it's a new thing, so a switch that only flips stays
// the same thing and slides as it does.
const SWAP = { out: 150, in: 220, inAfter: 70, rise: 4 }
export function Swap({ id, children, className = "" }: { id: string; children: React.ReactNode; className?: string }) {
  const [lastId, setLastId] = useState(id)
  const [leaving, setLeaving] = useState<{ id: string; node: React.ReactNode }>()
  const prev = useRef(children)
  if (id !== lastId) {
    setLastId(id)
    setLeaving({ id: lastId, node: prev.current })
  }
  useLayoutEffect(() => {
    prev.current = children
  })
  useEffect(() => {
    if (!leaving) return
    const t = window.setTimeout(() => setLeaving(undefined), SWAP.out + SWAP.inAfter)
    return () => clearTimeout(t)
  }, [leaving])
  const cell = { gridArea: "1 / 1" }
  return (
    <span className={"grid " + className}>
      {leaving && (
        <span key={`out-${leaving.id}`} aria-hidden className="pointer-events-none" style={{ ...cell, opacity: 0, transform: `translateY(-${SWAP.rise}px)`, animation: `swap-out ${SWAP.out}ms ease-in` }}>
          {leaving.node}
        </span>
      )}
      <span key={id} style={{ ...cell, ...(leaving ? { animation: `swap-in ${SWAP.in}ms ease-out ${SWAP.inAfter}ms both` } : {}) }}>
        {children}
      </span>
    </span>
  )
}

// Room: a part that comes and goes opens and shuts, as the session card's rooms do (home.tsx,
// EaseRoom): opening, the room eases to its content's height and the content fades in as it
// finishes; shutting, the content fades out first, still showing what it had, and the room eases
// shut as it goes. Its spacing from what it follows sits inside it, so a shut room leaves none.
// Once open, it takes its content's own height, so a line that grows inside it isn't cut off.
const ROOM = { ease: 300, showAt: 160, in: 180, out: 120, shutAt: 80 }
export function Room({ children, pad = "" }: { children?: React.ReactNode; pad?: string }) {
  const has = !!children
  const last = useRef(children)
  if (children) last.current = children
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | "auto">(has ? "auto" : 0)
  const [shown, setShown] = useState(has)
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const h = inner.current?.offsetHeight ?? 0
    if (has) {
      setHeight(h)
      const show = window.setTimeout(() => setShown(true), ROOM.showAt)
      const settle = window.setTimeout(() => setHeight("auto"), ROOM.ease)
      return () => {
        clearTimeout(show)
        clearTimeout(settle)
      }
    }
    // From its own height, pinned, so the ease to none has somewhere to start.
    setShown(false)
    setHeight(h)
    const shut = window.setTimeout(() => setHeight(0), ROOM.shutAt)
    return () => clearTimeout(shut)
  }, [has])
  return (
    <div className="overflow-hidden" style={{ height: height === "auto" ? undefined : height, transition: `height ${ROOM.ease}ms ease-out` }}>
      <div ref={inner} className={pad}>
        <div
          style={{
            opacity: shown ? 1 : 0,
            transform: shown ? "none" : "scale(0.97)",
            transition: shown ? `opacity ${ROOM.in}ms ease-out, transform ${ROOM.in}ms ease-out` : `opacity ${ROOM.out}ms ease-in, transform ${ROOM.out}ms ease-in`,
          }}
        >
          {last.current}
        </div>
      </div>
    </div>
  )
}
