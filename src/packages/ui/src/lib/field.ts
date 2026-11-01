import { useEffect, useRef } from "react"
import type { FocusEvent, KeyboardEvent, MouseEvent, RefObject } from "react"

import { askForKeyboard, holdsKeyboard, releaseKeyboard, stillTyping } from "./sim.ts"

/**
 * What makes an input take a pilot's keys in the sim: it cancels the press and focuses itself, asks
 * for the keyboard while it has the focus, and gives it back on blur and when it leaves the page, as
 * the EFB's own text box does (read in MSFS 2024's efb_os.js).
 */
export function useField(field: RefObject<HTMLInputElement | null>, title: string) {
  const latest = useRef(title)
  latest.current = title
  useEffect(() => {
    const element = field.current
    return () => {
      if (element && holdsKeyboard(element)) releaseKeyboard()
    }
  }, [field])
  return {
    onMouseDown(event: MouseEvent<HTMLInputElement>) {
      event.preventDefault()
      if (document.activeElement !== event.currentTarget) event.currentTarget.focus()
    },
    onFocus(event: FocusEvent<HTMLInputElement>) {
      askForKeyboard(event.currentTarget, latest.current)
    },
    onBlur(event: FocusEvent<HTMLInputElement>) {
      if (holdsKeyboard(event.currentTarget)) releaseKeyboard()
    },
    onKeyDown(_: KeyboardEvent<HTMLInputElement>) {
      stillTyping()
    },
  }
}
