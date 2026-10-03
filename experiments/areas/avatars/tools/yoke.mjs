/*
 * Where an aircraft's yoke grips are across the yoke's travel: the model's
 * HANDLING_Yoke_1_Hand_Left, _Hand_Right, and _Wheel_Center nodes, posed by
 * the yoke animations its aircraft.cfg [VR] section names, at frames 0, 50,
 * and 100 of each (lib/animate.mjs). Positions are in the model's space, meters,
 * +x left, y up, z forward.
 *
 *   node experiments/areas/avatars/tools/yoke.mjs "Black Square Baron 58 Professional N972HJ"
 *
 * It reads the installed aircraft's files only; the sim needn't run.
 */

import { cockpitFiles } from "../lib/cockpit-files.mjs"
import { findAnimation, poseAt } from "../lib/animate.mjs"
import { apply, readGltf } from "../lib/gltf.mjs"

const title = process.argv[2]
const files = title && cockpitFiles(title)
if (!files?.gltf) { console.error(`usage: node yoke.mjs "<aircraft title>" (no interior model found for ${JSON.stringify(title)})`); process.exit(1) }
const model = readGltf(files.gltf)
const lr = findAnimation(model.g, files.vr.yoke_anim_x ?? "")
const fa = findAnimation(model.g, files.vr.yoke_anim_y ?? "")
console.log(`${files.package}, ${model.name}: [VR] yoke_node ${files.vr.yoke_node ?? "none"}, roll ${lr?.name ?? "not found"}, fore-aft ${fa?.name ?? "not found"}`)
const anchors = ["HANDLING_Yoke_1_Hand_Left", "HANDLING_Yoke_1_Hand_Right", "HANDLING_Yoke_1_Wheel_Center"].map((n) => [n, model.nodes.findIndex((x) => x.name === n)])
for (const [n, i] of anchors) if (i < 0) console.log(`  no ${n}`)
const fmt = (p) => p.map((x) => x.toFixed(3).padStart(6)).join(", ")
for (const [x, y] of [[50, 50], [0, 50], [100, 50], [50, 0], [50, 100]]) {
  const world = poseAt(model, [lr && { animation: lr, frame: x }, fa && { animation: fa, frame: y }].filter(Boolean))
  const at = Object.fromEntries(anchors.filter(([, i]) => i >= 0).map(([n, i]) => [n, apply(world[i], [0, 0, 0])]))
  const L = at.HANDLING_Yoke_1_Hand_Left, R = at.HANDLING_Yoke_1_Hand_Right
  const gap = L && R ? ` | hands ${Math.hypot(L[0] - R[0], L[1] - R[1], L[2] - R[2]).toFixed(3)}m apart, ${((L[1] - R[1]) * 100).toFixed(1)}cm level difference` : ""
  console.log(`  roll ${String(x).padStart(3)}, fore-aft ${String(y).padStart(3)}: ${Object.entries(at).map(([n, p]) => `${n.replace("HANDLING_Yoke_1_", "")} ${fmt(p)}`).join(" | ")}${gap}`)
}
