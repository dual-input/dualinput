// The page's posing: the figure's own code run on a recorded frame's values.

import assert from "node:assert/strict"
import { test } from "node:test"

import { DETAILS, FRAMES, buildGltf, channels, colorChannel, colors } from "../../src/features/avatars/figure/model.ts"
import { spec } from "../lib/figure.ts"
import { glb, reader, rpn, sample, shown, timeOf } from "./page/pose.ts"

const s = spec()
const all = [...channels(s), colorChannel(s)].map((c) => c.name)

/** A frame's reader with every channel at 0 but those in `set`, and every part showing. */
function frame(set: Record<string, number>) {
  const values = all.map((name) => set[name] ?? 0)
  return reader([...all, "SHOWS"], [...values, set.SHOWS ?? 1 | 2 | 4])
}

test("a channel's frame is (value − min) × 120 / (max − min), clamped, as the code gives it", () => {
  const yaw = channels(s).find((c) => c.name === "HEAD_YAW")!
  const duration = FRAMES / 30
  // The code writes 120 / 360 to six places, as the sim will run it.
  assert.ok(Math.abs(timeOf(yaw, frame({ HEAD_YAW: 90 }), duration) - (270 / 360) * duration) < 1e-5)
  assert.equal(timeOf(yaw, frame({ HEAD_YAW: 400 }), duration), duration)
  assert.equal(rpn("(A:YOKE X POSITION, percent) 2 * 3 max", () => 1), 3)
  assert.throws(() => rpn("1 2 atg2", () => 0), /atg2/)
})

test("each stick draws one pair of its telescope's pieces, and hidden hands draw nothing", () => {
  const built = buildGltf(s, DETAILS[0]!)
  const reach = frame({ ARM_L_LEN: 0.5, ARM_R_LEN: 0.5, LEG_L_LEN: 0.4, LEG_R_LEN: 0.4, LEG_L_SHIN: 0.4, LEG_R_SHIN: 0.4 })
  const { visible, draws, triangles } = shown(built, reach)
  assert.equal(visible.get("arm_l_fore_4"), true, "0.5m is in the 0.32 piece's pair")
  assert.equal(visible.get("arm_l_fore_3"), false)
  assert.ok(triangles <= built.cost.triangles && draws <= built.cost.draws, `${triangles} and ${draws} against ${JSON.stringify(built.cost)}`)
  const handsHidden = shown(built, frame({ ARM_L_LEN: 0.5, SHOWS: 1 | 2 }))
  assert.equal(handsHidden.visible.get("arm_l_ball"), false)
})

test("the color's property animation gives the palette's shade at its frame", () => {
  const built = buildGltf(s, DETAILS[2]!)
  const animations = (built.json.animations as { name: string }[]).map((a) => a.name)
  const color = animations.indexOf("DUALINPUT_FIGURE_COLOR")
  const t = timeOf(colorChannel(s), frame({ COLOR: 2 }), FRAMES / 30)
  const main = sample(built, color, 1, t)
  colors(s, 2).main.forEach((c, i) => assert.ok(Math.abs(main[i]! - c) < 1e-6, `${main} against ${colors(s, 2).main}`))
})

test("a GLB holds the glTF's JSON and its buffer, each padded to four bytes", () => {
  const out = new DataView(glb({ asset: { version: "2.0" } }, new Uint8Array([1, 2, 3])))
  assert.equal(out.getUint32(0, true), 0x46546c67)
  assert.equal(out.getUint32(8, true), out.byteLength)
  const jsonLength = out.getUint32(12, true)
  assert.equal(jsonLength % 4, 0)
  assert.equal(out.getUint32(20 + jsonLength, true), 4)
})
