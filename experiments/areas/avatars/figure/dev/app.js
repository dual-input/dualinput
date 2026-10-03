/*
 * The figure's dev page: the figure in the Baron 58P's right seat, posed by
 * the same channels the sim will drive.
 *
 * The figure is model.mjs's glTF, built here from figure.json, and each
 * channel's value sets its animation's frame, as ANIM_CODE does in the sim.
 * The tracks are evaluated directly rather than through a mixer, so a value
 * lands on exactly one frame of exactly one animation.
 *
 * Click the cockpit to put the right hand there, shift-click for the left,
 * and alt-click (with shift for the left) to send a hand back to rest.
 */

import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import GUI from "three/addons/libs/lil-gui.module.min.js"
import { CHANNELS, FPS, buildGltf, colors, frameOf, toGlb, variable } from "/figure/model.mjs"
import { solve } from "/figure/solve.mjs"

const status = (text) => (document.getElementById("status").textContent = text)
const spec = await (await fetch("/figure/figure.json")).json()
const info = await (await fetch("/cockpit/info.json")).json()

// ------------------------------------------------ scene

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(devicePixelRatio)
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xc4d6e8)
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.9

const sun = new THREE.DirectionalLight(0xfff4e6, 2.4)
sun.position.set(1.5, 4, 2.5)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 10 })
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.02
scene.add(sun, sun.target, new THREE.HemisphereLight(0xe2ebff, 0x4d463e, 0.5))

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 200)
const controls = new OrbitControls(camera, renderer.domElement)
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// ------------------------------------------------ cockpit

const loader = new GLTFLoader()
const pick = { int: [], ext: [] }
const glass = []

// The section cut: cockpit right of the plane is clipped away, so the figure
// shows from the side against the floor and the seat.
const section = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
const clipping = []
renderer.localClippingEnabled = true

function prepare(root, list) {
  root.traverse((o) => {
    if (!o.isMesh) return
    o.material.clippingPlanes = clipping
    o.material.clipShadows = true
    const ud = o.material.userData
    if (ud.hidden) {
      o.visible = false
    } else if (ud.glass) {
      o.material.depthWrite = false
      glass.push(o)
    } else {
      o.castShadow = o.receiveShadow = true
      list.push(o)
    }
  })
}

const int = await loader.loadAsync("/cockpit/int.gltf")
prepare(int.scene, pick.int)
scene.add(int.scene)
scene.updateMatrixWorld(true)

let ext = null
async function showExterior(on) {
  if (on && !ext) {
    status("loading the exterior…")
    ext = (await loader.loadAsync("/cockpit/ext.gltf")).scene
    prepare(ext, pick.ext)
    status("")
  }
  if (ext) on ? scene.add(ext) : scene.remove(ext)
}

const seatNode = int.scene.getObjectByName("PILOT_1")
const seat = seatNode.getWorldPosition(new THREE.Vector3())
const v3 = (a) => new THREE.Vector3(...a)
const eyes = { pilot: v3(info.eyes.pilot), copilot: v3(info.eyes.copilot) }

// The figure's frame, forward, right, and up from the seat, against the
// model's +x left, +y up, +z forward.
const toFrame = (w) => ({ fwd: w.z - seat.z, right: -(w.x - seat.x), up: w.y - seat.y })

// ------------------------------------------------ figure

const figureRoot = new THREE.Group()
figureRoot.position.copy(seat)
scene.add(figureRoot)

const state = {
  color: 0,
  yaw: -55,
  pitch: -5,
  roll: 0,
  leanFwd: 0,
  leanRight: 0,
  leanUp: 0,
  feet: "rest",
  pedalUp: 0.1,
  pedalBack: 0.04,
  view: "pilot seat",
  fov: 50,
  cockpit: true,
  section: false,
  sectionRight: 0.2,
  exterior: false,
  glass: true,
  shadows: true,
}
const hands = { L: null, R: null }
let figure = null

let building = false, dirty = false
async function rebuild() {
  if (building) { dirty = true; return }
  building = true
  const { json, bin } = buildGltf(spec, state.color)
  const glb = toGlb(json, bin)
  const gltf = await loader.parseAsync(glb.buffer, "")
  const tracks = {}
  for (const clip of gltf.animations) {
    tracks[clip.name] = clip.tracks.map((t) => {
      const dot = t.name.lastIndexOf(".")
      return { obj: gltf.scene.getObjectByName(t.name.slice(0, dot)), prop: t.name.slice(dot + 1), interp: t.createInterpolant() }
    })
  }
  const materials = {}
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = o.receiveShadow = state.shadows
    materials[o.material.name] = o.material
  })
  if (figure) figureRoot.remove(figure.scene)
  figure = { scene: gltf.scene, tracks, materials }
  figureRoot.add(gltf.scene)
  update()
  building = false
  if (dirty) { dirty = false; rebuild() }
}

function recolor() {
  if (!figure) return
  const c = colors(spec, state.color)
  figure.materials.CROSSCHECK_Main?.color.setRGB(...c.main, THREE.LinearSRGBColorSpace)
  figure.materials.CROSSCHECK_Light?.color.setRGB(...c.light, THREE.LinearSRGBColorSpace)
  for (const mat of Object.values(figure.materials)) mat.roughness = spec.material.roughness
}

function pedal(name) {
  const p = int.scene.getObjectByName(name)?.getWorldPosition(new THREE.Vector3())
  return p && toFrame(p.add(new THREE.Vector3(0, state.pedalUp, -state.pedalBack)))
}

function pose() {
  const e = toFrame(eyes.copilot)
  const onPedals = state.feet === "pedals"
  return {
    eye: { fwd: e.fwd + state.leanFwd, right: e.right + state.leanRight, up: e.up + state.leanUp },
    look: { yaw: state.yaw, pitch: state.pitch, roll: state.roll },
    handL: hands.L && toFrame(hands.L),
    handR: hands.R && toFrame(hands.R),
    // The copilot's pedals: _2_1 is the inboard one, under the left foot.
    footL: onPedals ? pedal("HANDLING_RudderPedals_2_1") : null,
    footR: onPedals ? pedal("HANDLING_RudderPedals_2_2") : null,
  }
}

const varsEl = document.getElementById("vars")
function update() {
  if (!figure) return
  const values = solve(spec, pose())
  for (const ch of CHANNELS) {
    const t = frameOf(ch, values[ch.name]) / FPS
    for (const { obj, prop, interp } of figure.tracks[variable(ch)]) obj[prop].fromArray(interp.evaluate(t))
  }
  varsEl.textContent = CHANNELS.map((ch) => {
    const v = values[ch.name]
    const unit = ch.kind === "turn" ? "°" : " m"
    return `${variable(ch).padEnd(24)} ${v.toFixed(ch.kind === "turn" ? 1 : 3).padStart(8)}${unit}`
  }).join("\n")
}

// ------------------------------------------------ views

function setView() {
  camera.fov = state.fov
  camera.updateProjectionMatrix()
  if (state.view === "orbit") {
    Object.assign(controls, { enableZoom: true, enablePan: true, rotateSpeed: 1, minDistance: 0.1, maxDistance: 20 })
    controls.target.copy(seat).add(new THREE.Vector3(0, 0.3, 0.1))
    camera.position.copy(seat).add(new THREE.Vector3(-0.9, 0.5, 1.1))
  } else {
    // Looking around from a fixed eye: orbit a target 1cm in front of it.
    const eye = state.view === "pilot seat" ? eyes.pilot : seat.clone().add(new THREE.Vector3(0.2, 0.62, 0.42))
    const at = seat.clone().add(new THREE.Vector3(0, 0.4, 0.1))
    camera.position.copy(eye)
    controls.target.copy(eye).addScaledVector(at.sub(eye).normalize(), 0.01)
    Object.assign(controls, { enableZoom: false, enablePan: false, rotateSpeed: -0.35, minDistance: 0.01, maxDistance: 0.01 })
  }
  controls.update()
}

// ------------------------------------------------ hands by clicking

const raycaster = new THREE.Raycaster()
let down = null
renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }))
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
  const side = e.shiftKey ? "L" : "R"
  if (e.altKey) {
    hands[side] = null
    update()
    return
  }
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hit = raycaster.intersectObjects(state.exterior ? [...pick.int, ...pick.ext] : pick.int, false)[0]
  if (!hit) return
  hands[side] = hit.point.clone()
  status(`${side === "L" ? "left" : "right"} hand on ${hit.object.name || "(unnamed)"}`)
  update()
})

// ------------------------------------------------ controls

const gui = new GUI({ title: "Figure" })
const palette = Object.fromEntries(spec.palette.map((p, i) => [p.name, i]))
const edit = { hex: spec.palette[0].hex }
const editColor = gui.addColor(edit, "hex").name("edit color").onChange((v) => {
  spec.palette[state.color].hex = v
  recolor()
})
gui.add(state, "color", palette).onChange(() => {
  edit.hex = spec.palette[state.color].hex
  editColor.updateDisplay()
  recolor()
})

const poseF = gui.addFolder("Pose")
poseF.add(state, "yaw", -180, 180, 1).onChange(update)
poseF.add(state, "pitch", -90, 90, 1).onChange(update)
poseF.add(state, "roll", -60, 60, 1).onChange(update)
poseF.add(state, "leanFwd", -0.3, 0.3, 0.005).name("lean forward").onChange(update)
poseF.add(state, "leanRight", -0.3, 0.3, 0.005).name("lean right").onChange(update)
poseF.add(state, "leanUp", -0.3, 0.3, 0.005).name("lean up").onChange(update)
poseF.add(state, "feet", ["rest", "pedals"]).onChange(update)
poseF.add(state, "pedalUp", -0.1, 0.3, 0.005).name("pedal up").onChange(update)
poseF.add(state, "pedalBack", -0.2, 0.2, 0.005).name("pedal back").onChange(update)
poseF.add({ rest: () => { hands.L = hands.R = null; update() } }, "rest").name("hands to rest")

const dims = gui.addFolder("Dimensions (m)").close()
const range = (k) =>
  k === "at" ? [0, 1, 0.01]
  : k === "segments" ? [1, 16, 1]
  : ["up", "down", "back"].includes(k) ? [-0.3, 0.5, 0.001]
  : [0, 0.5, 0.001]
for (const part of ["head", "nose", "chest", "hips", "shoulders", "legs", "arm", "leg", "knee", "hand", "foot"]) {
  const f = dims.addFolder(part).close()
  for (const k of Object.keys(spec[part])) f.add(spec[part], k, ...range(k)).onChange(rebuild)
}
const restF = dims.addFolder("rest points").close()
for (const part of ["hand", "foot"]) for (const k of ["fwd", "right", "up"]) restF.add(spec.rest[part], k, -0.6, 0.8, 0.005).name(`${part} ${k}`).onChange(update)
const matF = dims.addFolder("material").close()
matF.add(spec.material, "roughness", 0, 1, 0.01).onChange(recolor)
matF.add(spec.material, "lighten", 0, 0.8, 0.01).name("chest lighten").onChange(recolor)
dims.add({
  save: async () => {
    const r = await fetch("/figure/figure.json", { method: "POST", body: JSON.stringify(spec) })
    status(r.ok ? "saved figure.json" : `save failed: ${r.status}`)
  },
}, "save").name("save to figure.json")

const viewF = gui.addFolder("View")
viewF.add(state, "view", ["pilot seat", "from the panel", "orbit"]).onChange(setView)
viewF.add(state, "fov", 20, 100, 1).name("vertical fov").onChange(setView)
viewF.add(state, "cockpit").onChange((on) => (int.scene.visible = on))
const cut = () => {
  // Kept where x >= the seat's x minus the cut's distance right of the seat.
  section.constant = -(seat.x - state.sectionRight)
  clipping.length = 0
  if (state.section) clipping.push(section)
}
viewF.add(state, "section").name("section cut").onChange(cut)
viewF.add(state, "sectionRight", -0.3, 0.6, 0.01).name("cut, right of seat").onChange(cut)
viewF.add(state, "exterior").onChange(showExterior)
viewF.add(state, "glass").onChange((on) => glass.forEach((o) => (o.visible = on)))
viewF.add(state, "shadows").onChange((on) => figure?.scene.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = on)))

// For driving the page from the browser's console.
window.dev = { THREE, scene, camera, controls, int, seat, eyes, state, spec, hands, update, rebuild, setView, cut }

setView()
await rebuild()
status("click: right hand · shift-click: left hand · alt-click: back to rest")

renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})
