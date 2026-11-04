import assert from "node:assert/strict"
import { test } from "node:test"

import { Hold, HOLD_MS, TAKEN_MS } from "../hold.ts"
import type { HoldState } from "../hold.ts"

/** A hold on a clock the test moves by hand. */
function bench() {
  const states: HoldState[] = []
  let takes = 0
  let timers: { at: number; then: () => void; id: number }[] = []
  let now = 0
  let next = 1
  const hold = new Hold({
    setTimer: (then, ms) => {
      timers.push({ at: now + ms, then, id: next })
      return next++
    },
    clearTimer: (id) => {
      timers = timers.filter((timer) => timer.id !== id)
    },
    changed: (state) => void states.push(state),
    take: () => void takes++,
  })
  const wait = (ms: number) => {
    now += ms
    const due = timers.filter((timer) => timer.at <= now)
    timers = timers.filter((timer) => timer.at > now)
    due.forEach((timer) => timer.then())
  }
  return { hold, states, wait, takes: () => takes }
}

test("a click takes nothing, and shows at once that it wants a hold", () => {
  const { hold, states, wait, takes } = bench()
  hold.press()
  assert.deepEqual(states, ["holding"])
  wait(100)
  hold.release()
  wait(HOLD_MS * 2)
  assert.equal(takes(), 0)
  assert.deepEqual(states, ["holding", "idle"])
})

test("a hold takes control once, at its end, and needs no release", () => {
  const { hold, states, wait, takes } = bench()
  hold.press()
  wait(HOLD_MS - 1)
  assert.equal(takes(), 0)
  wait(1)
  assert.equal(takes(), 1)
  assert.deepEqual(states, ["holding", "taken"])
  wait(TAKEN_MS * 3)
  assert.equal(takes(), 1)
})

test("a second press while one holds or has just taken does nothing, and the button holds again after a refused take", () => {
  const { hold, wait, takes } = bench()
  hold.press()
  hold.press()
  wait(HOLD_MS)
  assert.equal(takes(), 1)
  hold.press()
  wait(HOLD_MS)
  assert.equal(takes(), 1, "the swell was still running")
  wait(TAKEN_MS)
  hold.press()
  wait(HOLD_MS)
  assert.equal(takes(), 2)
})

test("the pointer leaving the button cancels the hold, as a release does", () => {
  const { hold, wait, takes } = bench()
  hold.press()
  hold.release()
  hold.release()
  wait(HOLD_MS)
  assert.equal(takes(), 0)
})
