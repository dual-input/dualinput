// How a field asks the sim for the keyboard, as the EFB's own text box does (read in MSFS 2024's
// efb_os.js, the text box's onmousedown and onFocusIn; record/areas/interface/log.md, 2026-11-01).
// While a field holds the keyboard the pilot's keys don't reach the sim, so anything that goes wrong
// must give it back: each field releases it on blur and when it leaves the page, a field left idle
// lets go by itself, and window.DUALINPUT_UI_RELEASE_KEYBOARD() gives it back from anywhere.

type CoherentApi = {
  trigger(name: string, ...args: unknown[]): void
  on(name: string, handler: (...args: never[]) => void): unknown
  off(name: string, handler: (...args: never[]) => void): void
}

declare global {
  interface Window {
    Coherent?: CoherentApi
    DUALINPUT_UI_RELEASE_KEYBOARD?: () => void
  }
}

/** How long a field keeps the keyboard with no key pressed, in milliseconds. */
const IDLE_RELEASE = 60_000

let holder: HTMLInputElement | null = null
let idle = 0

function clearHold(): void {
  window.clearTimeout(idle)
  holder = null
  const coherent = window.Coherent
  coherent?.off("mousePressOutsideView", pressedOutside)
  coherent?.off("SetInputTextFromOS", textFromOs)
}

function pressedOutside(): void {
  holder?.blur()
}

/** Writes through the input's own setter, so React's onChange hears text the sim typed, as it hears a key. */
function textFromOs(text: string): void {
  if (!holder) return
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(holder, String(text))
  holder.dispatchEvent(new Event("input", { bubbles: true }))
}

/** Gives the keyboard back to the sim, whatever holds it. The sim hears first, so nothing that throws after it can keep the pilot's keys from the sim. */
export function releaseKeyboard(): void {
  const field = holder
  window.Coherent?.trigger("UNFOCUS_INPUT_FIELD", "DUALINPUT_UI_FIELD")
  clearHold()
  field?.blur()
}

/** Starts or restarts the wait that lets the keyboard go, for each key the field takes. */
export function stillTyping(): void {
  window.clearTimeout(idle)
  idle = window.setTimeout(releaseKeyboard, IDLE_RELEASE)
}

/** Asks the sim for the keyboard, for `field`, which has the focus. */
export function askForKeyboard(field: HTMLInputElement, title: string): void {
  if (holder) clearHold()
  holder = field
  stillTyping()
  const coherent = window.Coherent
  coherent?.trigger("FOCUS_INPUT_FIELD", { title, description: "", default_text: field.value, is_numeric: false, is_efb: true })
  coherent?.on("mousePressOutsideView", pressedOutside)
  coherent?.on("SetInputTextFromOS", textFromOs)
}

/** Whether `field` is the one holding the keyboard. */
export function holdsKeyboard(field: HTMLInputElement): boolean {
  return holder === field
}

if (typeof window !== "undefined") window.DUALINPUT_UI_RELEASE_KEYBOARD = releaseKeyboard
