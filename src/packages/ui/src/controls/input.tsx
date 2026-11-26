import { useRef } from "react"
import type { FocusEvent, InputHTMLAttributes, KeyboardEvent, MouseEvent, Ref } from "react"

import { cx } from "../lib/cx.ts"
import { useField } from "../lib/field.ts"

/**
 * How a line of text draws: in a field of its own, or flat, as bare text on the surface it sits on, for a filter at the
 * head of a list, where a field's fill would read as one more box over the rows. A flat one's caller gives it an icon or
 * placeholder that says it takes text, since it has no edge to say so.
 */
const LOOKS = {
  field: "h-9 rounded-3xl border bg-field px-3 py-1 text-sm",
  // No edge at all, so its text starts where its box does and lines up with what's beside it, and a fainter placeholder,
  // which with no field around it would otherwise read as words already typed.
  flat: "h-8 border-0 bg-transparent py-1 text-[13px] placeholder:text-muted-foreground/60",
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; look?: keyof typeof LOOKS; title?: string; ref?: Ref<HTMLInputElement> }

/**
 * A line of text. `title` is what the sim's own keyboard, where it shows one, says it's for. A caller's press, focus,
 * blur, and key handlers run after the field's own, which take a pilot's keys in the sim, rather than in place of them.
 */
export function Input({ invalid, look = "field", title = "", className, ref, onMouseDown, onFocus, onBlur, onKeyDown, ...rest }: InputProps) {
  const own = useRef<HTMLInputElement>(null)
  const sim = useField(own, title)
  const field = {
    onMouseDown: (event: MouseEvent<HTMLInputElement>) => {
      sim.onMouseDown(event)
      onMouseDown?.(event)
    },
    onFocus: (event: FocusEvent<HTMLInputElement>) => {
      sim.onFocus(event)
      onFocus?.(event)
    },
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      sim.onBlur(event)
      onBlur?.(event)
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      sim.onKeyDown(event)
      onKeyDown?.(event)
    },
  }
  return (
    <input
      ref={(element) => {
        own.current = element
        if (typeof ref === "function") ref(element)
        else if (ref) ref.current = element
      }}
      aria-invalid={invalid || undefined}
      className={cx(
        "w-full min-w-0 disabled:pointer-events-none disabled:opacity-50",
        LOOKS[look],
        look === "field" && (invalid ? "border-destructive ring-3 ring-destructive/20" : "border-transparent focus:border-ring focus:ring-3 focus:ring-ring/30"),
        className,
      )}
      {...field}
      {...rest}
    />
  )
}
