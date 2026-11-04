import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { cx } from "../lib/cx.ts"

export type ChoiceProps<T extends string> = {
  value: T
  options: [T, string][]
  onChange?: (value: T) => void
  className?: string
}

/**
 * A few choices side by side at a row's 32px, where a switch would name only one of them. The picked one's pill
 * slides to a press at once, as a switch's thumb does, since a control a pilot pressed answers outside the page's
 * moment. Coherent GT has no ResizeObserver, so the pill is measured from the buttons' offsets after every render
 * (record/areas/architecture/coherent-gt.md). A hidden page measures nothing, so a pill stays as it was until its
 * page shows, rather than sliding in from the left each time.
 */
export function Choice<T extends string>({ value, options, onChange, className }: ChoiceProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const [pill, setPill] = useState<{ left: number; width: number }>()
  useLayoutEffect(() => {
    const button = buttons.current.get(value)
    if (button && button.offsetWidth > 0 && (button.offsetLeft !== pill?.left || button.offsetWidth !== pill?.width)) setPill({ left: button.offsetLeft, width: button.offsetWidth })
  })
  // It's in place at first, with no slide.
  const first = useRef(true)
  useEffect(() => {
    first.current = false
  }, [])
  return (
    <span role="radiogroup" className={cx("relative inline-flex h-8 items-center rounded-full bg-muted p-0.5", className)}>
      {pill && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0 rounded-full border border-input bg-input/30"
          style={{ width: pill.width, transform: `translateX(${pill.left}px)`, transition: first.current ? "none" : "transform 200ms ease-out, width 200ms ease-out" }}
        />
      )}
      {options.map(([option, label]) => (
        <button
          key={option}
          ref={(button) => {
            if (button) buttons.current.set(option, button)
          }}
          type="button"
          role="radio"
          aria-checked={option === value}
          onClick={() => onChange?.(option)}
          className={cx("relative h-full rounded-full border border-transparent px-3.5 text-sm font-medium transition-colors duration-200", option === value ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {label}
        </button>
      ))}
    </span>
  )
}
