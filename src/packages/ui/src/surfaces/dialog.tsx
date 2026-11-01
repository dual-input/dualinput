import { X } from "lucide-react"
import { useEffect } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"

import { Button } from "../controls/button.tsx"
import { usePresence } from "../lib/popup.ts"
import { useRoot } from "../lib/root.tsx"

export type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}

/** The large popup over the app's window, which a press on what's around it, Escape, or its × closes. */
export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  const { element: root } = useRoot()
  const { mounted, leaving } = usePresence(open)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.keyCode === 27) onOpenChange(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])
  if (!mounted || !root) return null
  return createPortal(
    <>
      <div className={leaving ? "absolute inset-x-0 inset-y-0 z-50 animate-fade-out bg-black/50" : "absolute inset-x-0 inset-y-0 z-50 animate-fade-in bg-black/50"} onClick={() => onOpenChange(false)} />
      <div role="dialog" className={"absolute inset-x-4 inset-y-4 z-50 flex flex-col rounded-4xl bg-popover text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10 " + (leaving ? "animate-pop-out" : "animate-pop-in")}>
        <div className="flex shrink-0 items-start justify-between pb-3 pl-6 pr-4 pt-5">
          <div className="pt-1.5">
            <div className="text-base font-medium leading-none">{title}</div>
            {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <Button variant="secondary" size="icon-sm" aria-label="Close" className="ml-3" onClick={() => onOpenChange(false)}>
            <X />
          </Button>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </>,
    root,
  )
}
