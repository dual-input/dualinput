import { OctagonX, TriangleAlert } from "lucide-react"
import { useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { cx } from "../lib/cx.ts"
import { useRoot } from "../lib/root.tsx"

/** A toast about something that went partly or wholly wrong, which leads with the icon the frames' toasts give it. */
export type ToastLevel = "warning" | "error"

type Toast = { id: number; text: string; level?: ToastLevel; leaving: boolean }

const ICONS = { warning: TriangleAlert, error: OctagonX }

/** How long a toast stays, then how long its way out takes, in milliseconds. */
const STAYS = 4000
const LEAVES = 200

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function publish(next: Toast[]): void {
  toasts = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Shows a short line for a moment. A toast of one sentence takes no period. */
export function toast(text: string, level?: ToastLevel): void {
  const id = nextId++
  publish([...toasts, { id, text, level, leaving: false }])
  window.setTimeout(() => {
    publish(toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    window.setTimeout(() => publish(toasts.filter((t) => t.id !== id)), LEAVES)
  }, STAYS)
}

/** One toast's look, which the kit's page shows on its own. */
export function ToastCard({ text, level, leaving, style }: { text: string; level?: ToastLevel; leaving?: boolean; style?: React.CSSProperties }) {
  const Icon = level && ICONS[level]
  return (
    <div className={cx("flex w-80 items-start rounded-4xl border border-border bg-popover p-4 text-[13px] leading-4 text-popover-foreground shadow-lg", leaving ? "animate-fade-out" : "animate-rise-in")} style={style}>
      {Icon && <Icon className="mr-2 size-4 shrink-0" />}
      <span>{text}</span>
    </div>
  )
}

/** Where toasts show: at the foot of the kit's root, the newest in front and the two before it peeking behind. */
export function Toaster() {
  const { element: root } = useRoot()
  const shown = useSyncExternalStore(subscribe, () => toasts)
  if (!root) return null
  const front = shown.slice(-3)
  return createPortal(
    <div className="pointer-events-none absolute inset-x-0 bottom-8 z-50 flex justify-center">
      <div className="relative h-12 w-80">
        {front.map((t, i) => {
          const behind = front.length - 1 - i
          return (
            <ToastCard
              key={t.id}
              text={t.text}
              level={t.level}
              leaving={t.leaving}
              style={{ position: "absolute", left: 0, bottom: 0, zIndex: i, transform: behind ? `translateY(${-14 * behind}px) scale(${1 - 0.05 * behind})` : undefined, transition: "transform 400ms ease" }}
            />
          )
        })}
      </div>
    </div>,
    root,
  )
}
