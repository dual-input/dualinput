import assert from "node:assert/strict"
import { test } from "node:test"

import type { Sample, View } from "../src/link.ts"
import { agoText, averageOf, CHART_HEIGHT, cpuText, DAY, memoryText, nearest, networkText, quitCost, shapeOf, totalOf } from "../src/usage.ts"

const MB = 1024 * 1024
const NOW = 2 * DAY

function sample(at: number, memory = 4 * MB, cpu = 0.1, network = 0): Sample {
  return { at, memory, cpu, network }
}

const memory = (one: Sample) => one.memory

test("an average and a total of nothing are 0", () => {
  assert.equal(averageOf([], memory), 0)
  assert.equal(totalOf([], memory), 0)
})

test("figures read in Task Manager's units, and a small one doesn't read as nothing", () => {
  assert.equal(memoryText(4.4 * MB), "4 MB")
  assert.equal(memoryText(100), "<1 MB")
  assert.equal(memoryText(0), "0 MB")
  assert.equal(cpuText(0.14), "0.1%")
  assert.equal(cpuText(0.02), "<0.1%")
  assert.equal(cpuText(0), "0.0%")
  assert.equal(networkText(0), "0 MB")
  assert.equal(networkText(30 * 1024), "30 KB")
  assert.equal(networkText(18 * MB), "18 MB")
})

test("a moment reads by the minute, then by the hour", () => {
  assert.equal(agoText(5), "now")
  assert.equal(agoText(12 * 60), "12m ago")
  assert.equal(agoText(3 * 60 * 60), "3h ago")
})

test("a flat line stays low until something passes the chart's least height", () => {
  const low = shapeOf([sample(NOW - 60), sample(NOW)], memory, NOW, 20 * MB, [])
  assert.ok(low.points[0]!.y > CHART_HEIGHT * 0.7, "4 MB of at least 20 MB should sit in the chart's low part")
  const spike = shapeOf([sample(NOW - 60), sample(NOW, 72 * MB)], memory, NOW, 20 * MB, [])
  assert.ok(spike.points[0]!.y > spike.points[1]!.y)
  assert.equal(spike.points[1]!.y, 4, "the highest value reaches the chart's top")
})

test("time the app wasn't running leaves a gap in the line", () => {
  const shape = shapeOf([sample(NOW - 7200), sample(NOW - 7140), sample(NOW - 60), sample(NOW)], memory, NOW, MB, [])
  assert.equal(shape.line.match(/M/g)?.length, 2)
  assert.equal(shape.area.match(/M/g)?.length, 2)
})

test("a lone sample still draws, and no samples draw nothing", () => {
  const lone = shapeOf([sample(NOW)], memory, NOW, MB, [])
  assert.match(lone.line, /^M[\d. ]+L[\d. ]+$/)
  assert.equal(lone.area, "")
  assert.deepEqual(shapeOf([], memory, NOW, MB, [NOW]).dots, [])
})

test("a dot sits on the first sample at or after its moment, or the last if none has come", () => {
  const shape = shapeOf([sample(NOW - 120), sample(NOW - 60), sample(NOW)], memory, NOW, MB, [NOW - 90, NOW + 5])
  assert.equal(shape.dots[0]!.sample.at, NOW - 60)
  assert.equal(shape.dots[1]!.sample.at, NOW)
})

test("two moments on one sample draw one dot", () => {
  const shape = shapeOf([sample(NOW - 60), sample(NOW)], memory, NOW, MB, [NOW - 30, NOW - 10, NOW])
  assert.equal(shape.dots.length, 1)
  assert.equal(shape.dots[0]!.sample.at, NOW)
})

test("a hover near a dot lands on it, and elsewhere on the nearest sample", () => {
  const shape = shapeOf([sample(NOW - 7200), sample(NOW - 7140), sample(NOW - 60), sample(NOW)], memory, NOW, MB, [NOW])
  assert.deepEqual(nearest(shape, shape.dots[0]!.x - 3), { point: shape.dots[0]!, onDot: true })
  assert.deepEqual(nearest(shape, shape.points[0]!.x), { point: shape.points[0]!, onDot: false })
  assert.equal(nearest(shapeOf([], memory, NOW, MB, []), 10), undefined)
})

function asked(state: Partial<Pick<View, "simRunning" | "sessionHeld">>, start: "on" | "off" | "off-in-windows" = "on"): string {
  return quitCost({ simRunning: false, sessionHeld: false, desktop: { update: { state: "current", checked: null }, firewall: "allows", start_with_windows: start }, ...state })
}

test("quitting costs what the sim and the session make it cost", () => {
  assert.equal(asked({ sessionHeld: true, simRunning: true }), "You'll leave your session now, and the EFB app will stop working until you open Dual Input again from the Start menu.")
  assert.equal(asked({ simRunning: true }), "The EFB app will stop working until you open Dual Input again from the Start menu.")
  assert.match(asked({}), /until you log in again or open it from the Start menu\. Certain features may break on some aircraft\.$/)
})

test("with Windows not starting it, logging in doesn't bring it back", () => {
  for (const start of ["off", "off-in-windows"] as const) assert.match(asked({}, start), /until you open it from the Start menu/)
})
