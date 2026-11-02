import assert from "node:assert/strict"
import { test } from "node:test"

import { BannerPanel, CALL_AGAIN_AFTER } from "../src/banner-panel.ts"

/** A panel on a stand-in toolbar and a clock the test moves by hand. */
function bench() {
  const calls: boolean[] = []
  let timers: { at: number; then: () => void; id: number }[] = []
  let now = 0
  let next = 1
  const panel = new BannerPanel({
    toolbar: (open) => void calls.push(open),
    setTimer: (then, ms) => {
      timers.push({ at: now + ms, then, id: next })
      return next++
    },
    clearTimer: (id) => {
      timers = timers.filter((timer) => timer.id !== id)
    },
  })
  const wait = (ms: number) => {
    now += ms
    const due = timers.filter((timer) => timer.at <= now)
    timers = timers.filter((timer) => timer.at > now)
    due.forEach((timer) => timer.then())
  }
  return { panel, calls, wait }
}

const inFlight = { held: true, flying: true, loading: false, pageOpen: false }
const atMenu = { held: true, flying: false, loading: false, pageOpen: false }
const ended = { held: false, flying: true, loading: false, pageOpen: true }

test("a toolbar call that goes unheard is made again until a page connects", () => {
  const { panel, calls, wait } = bench()
  panel.follow(inFlight)
  assert.deepEqual(calls, [true])
  wait(CALL_AGAIN_AFTER)
  wait(CALL_AGAIN_AFTER)
  assert.deepEqual(calls, [true, true, true])
  panel.follow({ ...inFlight, pageOpen: true })
  wait(CALL_AGAIN_AFTER * 3)
  assert.deepEqual(calls, [true, true, true], "no call once the page is up")
})

test("a banner closed by its toolbar button stays closed until the next flight", () => {
  const { panel, calls, wait } = bench()
  panel.follow(inFlight)
  panel.follow({ ...inFlight, pageOpen: true })
  calls.length = 0
  panel.follow({ ...inFlight, pageOpen: false })
  wait(CALL_AGAIN_AFTER * 3)
  assert.deepEqual(calls, [], "the pilot closed it, so nothing reopens it in this flight")
  panel.follow(atMenu)
  panel.follow(inFlight)
  assert.deepEqual(calls, [true], "the next flight opens it")
})

test("the session's end closes the banner with one call, and with no flight it makes none", () => {
  const { panel, calls, wait } = bench()
  panel.follow(atMenu)
  panel.follow({ ...atMenu, held: false })
  assert.deepEqual(calls, [])
  panel.follow(inFlight)
  panel.follow({ ...inFlight, pageOpen: true })
  calls.length = 0
  panel.follow(ended)
  panel.follow(ended)
  wait(CALL_AGAIN_AFTER * 3)
  assert.deepEqual(calls, [false])
})

test("the core's bye closes the banner with one call and stops any call to come", () => {
  const { panel, calls, wait } = bench()
  panel.follow(inFlight)
  calls.length = 0
  panel.coreQuit()
  panel.coreQuit()
  wait(CALL_AGAIN_AFTER * 3)
  assert.deepEqual(calls, [false])
})

test("a Restart is the next flight, with no menu between, so a banner the pilot closed opens again", () => {
  const { panel, calls, wait } = bench()
  panel.follow(inFlight)
  panel.follow({ ...inFlight, pageOpen: true })
  panel.follow(inFlight)
  calls.length = 0
  wait(CALL_AGAIN_AFTER * 3)
  assert.deepEqual(calls, [], "closed by the pilot, in this flight")
  panel.follow({ ...inFlight, loading: true })
  assert.deepEqual(calls, [true])
})

test("a load that takes the open page down opens it again once its socket says so", () => {
  const { panel, calls } = bench()
  panel.follow(inFlight)
  panel.follow({ ...inFlight, pageOpen: true })
  calls.length = 0
  panel.follow({ ...inFlight, loading: true, pageOpen: true })
  assert.deepEqual(calls, [], "the page's socket still says it's open")
  panel.follow({ ...inFlight, loading: true, pageOpen: false })
  assert.deepEqual(calls, [true])
})

test("a lost link stops the calls, and they start again once the core is back", () => {
  const { panel, calls, wait } = bench()
  panel.follow(inFlight)
  calls.length = 0
  panel.coreLost()
  wait(CALL_AGAIN_AFTER * 3)
  assert.deepEqual(calls, [], "nothing can say a page came up")
  panel.follow(inFlight)
  assert.deepEqual(calls, [true])
})
