// A click takes nothing, so a stray click or a VR trigger's jolt can't take control, and holding the button does
// (user, 2026-10-31). `HOLD` in src/features/take-control/core/src/lib.rs holds a bound key's hold, the same number, so
// the gesture has one, and changes with this.

/** In milliseconds. */
export const HOLD_MS = 350
/** How long a take's swell runs, in milliseconds, after which the button can be held again, should the core have refused. */
export const TAKEN_MS = 320

export type HoldState = "idle" | "holding" | "taken"

export type HoldEnv = {
  setTimer: (then: () => void, ms: number) => number
  clearTimer: (timer: number) => void
  changed: (state: HoldState) => void
  take: () => void
}

export class Hold {
  private readonly env: HoldEnv
  private state: HoldState = "idle"
  private timer: number | undefined

  constructor(env: HoldEnv) {
    this.env = env
  }

  private become(state: HoldState): void {
    this.state = state
    this.env.changed(state)
  }

  press(): void {
    if (this.state !== "idle") return
    this.become("holding")
    this.timer = this.env.setTimer(() => {
      this.become("taken")
      this.env.take()
      this.timer = this.env.setTimer(() => this.become("idle"), TAKEN_MS)
    }, HOLD_MS)
  }

  /** The pilot let go, or the pointer left the button, as `mouseup` wouldn't then come. */
  release(): void {
    if (this.state !== "holding") return
    this.stop()
    this.become("idle")
  }

  stop(): void {
    if (this.timer !== undefined) this.env.clearTimer(this.timer)
    this.timer = undefined
  }
}
