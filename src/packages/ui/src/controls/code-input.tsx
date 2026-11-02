import { Minus } from "lucide-react"
import { useRef, useState } from "react"
import type { KeyboardEvent } from "react"

import { cx } from "../lib/cx.ts"
import { useField } from "../lib/field.ts"

export type CodeInputProps = {
  value: string
  onChange: (value: string) => void
  /** The slots of each group, which a dash parts. */
  groups?: number[]
  disabled?: boolean
  invalid?: boolean
  title?: string
  /** Shows its active slot with no focus, as the kit's page does. */
  focused?: boolean
  onEnter?: () => void
  /** The pilot selected the box. */
  onSelected?: () => void
  className?: string
}

/**
 * An invite code's slots: one real input, which takes the keys and shows nothing, over a slot for each
 * character. It keeps letters and digits, in capitals, since that's what a code holds.
 */
export function CodeInput({ value, onChange, groups = [3, 3], disabled, invalid, title = "Invite code", focused: focusedFromOutside, onEnter, onSelected, className }: CodeInputProps) {
  const own = useRef<HTMLInputElement>(null)
  const [focusedHere, setFocused] = useState(false)
  const focused = focusedFromOutside ?? focusedHere
  const field = useField(own, title)
  const length = groups.reduce((sum, n) => sum + n, 0)
  const active = focused ? Math.min(value.length, length - 1) : -1
  let at = 0
  return (
    <div className={cx("relative inline-flex items-center", disabled && "opacity-50", className)}>
      {groups.map((slots, group) => {
        const first = at
        at += slots
        return (
          <div key={group} className="flex items-center">
            {group > 0 && <Minus className="size-4" aria-hidden />}
            <div className="flex items-center rounded-3xl">
              {Array.from({ length: slots }, (_, i) => {
                const index = first + i
                const isActive = index === active
                return (
                  <div
                    key={index}
                    data-active={isActive || undefined}
                    className={cx(
                      "relative flex size-9 items-center justify-center border-b border-r border-t bg-field font-mono text-sm first:rounded-l-3xl first:border-l last:rounded-r-3xl",
                      isActive ? (invalid ? "z-10 border-destructive" : "z-10 border-ring") : invalid ? "border-destructive/60" : "border-input",
                    )}
                  >
                    {/* The focus ring is a border of its own, around the slot's, since Coherent GT squares off the corners of a box-shadow on a box rounded on one side. */}
                    {isActive && (
                      <span
                        aria-hidden
                        className={cx(
                          "pointer-events-none absolute -bottom-1 -right-1 -top-1 border-[3px]",
                          i === 0 ? "-left-1 rounded-l-[11.8px]" : "-left-[3px]",
                          i === slots - 1 && "rounded-r-[11.8px]",
                          invalid ? "border-destructive/20" : "border-ring/30",
                        )}
                      />
                    )}
                    {value[index]}
                    {isActive && value.length < length && <div className="pointer-events-none absolute h-4 animate-caret border-l border-foreground" />}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <input
        ref={own}
        aria-label={title}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        maxLength={length}
        autoComplete="off"
        spellCheck={false}
        value={value}
        className="absolute inset-x-0 inset-y-0 z-20 h-full w-full cursor-text opacity-0 disabled:cursor-default"
        onChange={(event) => onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, length))}
        onMouseDown={field.onMouseDown}
        onFocus={(event) => {
          setFocused(true)
          field.onFocus(event)
          onSelected?.()
        }}
        onBlur={(event) => {
          setFocused(false)
          field.onBlur(event)
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          field.onKeyDown(event)
          if (event.keyCode === 13) onEnter?.()
        }}
      />
    </div>
  )
}
