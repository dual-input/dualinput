import { useRef } from "react"
import type { InputHTMLAttributes, Ref } from "react"

import { cx } from "../lib/cx.ts"
import { useField } from "../lib/field.ts"

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; title?: string; ref?: Ref<HTMLInputElement> }

/** A line of text. `title` is what the sim's own keyboard, where it shows one, says it's for. */
export function Input({ invalid, title = "", className, ref, ...rest }: InputProps) {
  const own = useRef<HTMLInputElement>(null)
  const field = useField(own, title)
  return (
    <input
      ref={(element) => {
        own.current = element
        if (typeof ref === "function") ref(element)
        else if (ref) ref.current = element
      }}
      aria-invalid={invalid || undefined}
      className={cx(
        "h-9 w-full min-w-0 rounded-3xl border bg-field px-3 py-1 text-sm transition-all disabled:pointer-events-none disabled:opacity-50",
        invalid ? "border-destructive ring-3 ring-destructive/20" : "border-transparent focus:border-ring focus:ring-3 focus:ring-ring/30",
        className,
      )}
      {...field}
      {...rest}
    />
  )
}
