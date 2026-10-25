// The figure viewer's page, which serve.ts serves: avatars' figure built from model.ts and
// figure.json at a level of detail, posed each frame from what `Figure` wrote in this folder's
// scripts, in the Baron 58P's cockpit as aircraft-model posed it. Its axes are the sim's and
// the glTF's: x left, y up, z forward, in meters from the 58P's reference point.

import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

import { DETAILS, buildGltf, channels, colorChannel, variable } from "/src/features/avatars/figure/model.ts"
import { glb, reader, sample, shown, timeOf } from "./pose.ts"

const $ = (id) => document.getElementById(id)
const rad = THREE.MathUtils.degToRad
const count = (n) => Math.round(n).toLocaleString("en-US")

async function get(url, as = "json") {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`)
  return as === "json" ? r.json() : r.arrayBuffer()
}

const state = {
  /** figure.json as the file holds it, with the sliders' changes, and as the scripts ran. */
  written: null,
  spec: null,
  ran: null,
  /** The seat the scripts ran in, and with the sliders' changes. */
  seat: null,
  seatEdit: null,
  budget: null,
  cockpit: null,
  scripts: null,
  script: 0,
  t: 0,
  playing: true,
  lod: 0,
  color: "",
  shows: "",
  view: "copilot",
  running: false,
}

// ---------------------------------------------------------------- the scene

const view = $("view")
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(devicePixelRatio)
renderer.localClippingEnabled = true
view.append(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x15171b)
const camera = new THREE.PerspectiveCamera(60, 1, 0.02, 300)
const controls = new OrbitControls(camera, renderer.domElement)
scene.add(new THREE.HemisphereLight(0xdfe7f2, 0x2a2622, 1.7))
const sun = new THREE.DirectionalLight(0xffffff, 1.6)
sun.position.set(3, 6, 2)
scene.add(sun)

function resize() {
  const w = view.clientWidth
  const h = view.clientHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
addEventListener("resize", resize)
resize()

/** The cut that takes the cabin's left wall away, so a view from outside sees the seat. */
const cut = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
const materials = {
  interior: new THREE.MeshStandardMaterial({ color: 0x8d939c, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
  ghost: new THREE.MeshStandardMaterial({ color: 0xaab4c4, roughness: 0.9, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.14, depthWrite: false }),
  solid: new THREE.MeshStandardMaterial({ color: 0xc4c9d0, roughness: 0.8, flatShading: true }),
  target: new THREE.MeshBasicMaterial({ color: 0xff5a50, wireframe: true }),
}

/** Triangles as the program writes them, nine floats each, as one mesh. */
function trianglesMesh(floats, material) {
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(floats, 3))
  g.computeBoundingSphere()
  return new THREE.Mesh(g, material)
}

const cockpit = { interior: null, exterior: null, parts: [], ground: new THREE.Group() }
const targets = [0, 1].map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), materials.target)
  scene.add(m)
  return m
})

// ---------------------------------------------------------------- loading

async function load(withCockpit) {
  const [written, budget, cockpitJson, scripts, parts] = await Promise.all([
    get("/figure.json"),
    get("/budget.json"),
    get("/data/cockpit.json"),
    get("/data/scripts.json"),
    get("/data/parts.bin", "bin"),
  ])
  Object.assign(state, { written, spec: structuredClone(written), ran: scripts.spec, budget, cockpit: cockpitJson, scripts })
  state.seat = cockpitJson.seat
  state.seatEdit = structuredClone(cockpitJson.seat)
  if (withCockpit) {
    const [inside, outside] = await Promise.all([get("/data/interior.bin", "bin"), get("/data/exterior.bin", "bin")])
    cockpit.interior = trianglesMesh(new Float32Array(inside), materials.interior)
    cockpit.exterior = trianglesMesh(new Float32Array(outside), materials.ghost)
    scene.add(cockpit.interior, cockpit.exterior)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 1 }))
    disc.rotation.x = -Math.PI / 2
    const grid = new THREE.GridHelper(40, 40, 0x3c414a, 0x30343b)
    grid.position.y = 0.002
    cockpit.ground.add(disc, grid)
    scene.add(cockpit.ground)
  }
  cockpit.ground.position.y = cockpitJson.ground
  for (const p of cockpit.parts) scene.remove(p)
  cockpit.parts = cockpitJson.parts.map((p) => {
    const mesh = trianglesMesh(new Float32Array(parts, p.at * 36, p.triangles * 9), p.scene === "interior" ? materials.interior : materials.ghost)
    mesh.matrixAutoUpdate = false
    mesh.matrix.fromArray(p.rest)
    mesh.matrixWorldNeedsUpdate = true
    scene.add(mesh)
    return mesh
  })
  partFrames.clear()
  // The 58P's left wall is about 0.2m left of the hip, where the reach script's cast met it,
  // and the cut leaves the figure whole, since it cuts only the aircraft.
  cut.constant = state.seat.hip[0] + 0.12
}

/** Each script's parts' frames, as its file holds them, loaded when the script plays. */
const partFrames = new Map()
async function loadParts(script) {
  if (!script.parts || partFrames.has(script.name)) return
  partFrames.set(script.name, null)
  partFrames.set(script.name, new Float32Array(await get(`/data/${script.parts}`, "bin")))
}

// ---------------------------------------------------------------- the figure

let figure = null
let building = 0

/** Builds the figure from the sliders' spec at the picked level of detail, as generate would. */
async function buildFigure() {
  const n = ++building
  const built = buildGltf(state.spec, DETAILS[state.lod])
  const gltf = await new GLTFLoader().parseAsync(glb(built.json, built.bin), "")
  if (n !== building) return
  if (figure) scene.remove(figure.group)
  const group = new THREE.Group()
  group.add(gltf.scene)
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const actions = new Map()
  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip)
    action.play()
    action.paused = true
    actions.set(clip.name, action)
  }
  const nodes = new Map()
  const mats = new Map()
  gltf.scene.traverse((o) => {
    nodes.set(o.name, o)
    if (o.material) mats.set(o.material.name, o.material)
  })
  const colorAnimation = built.json.animations.findIndex((a) => a.name === variable("COLOR"))
  figure = { group, mixer, actions, nodes, mats, built, colorAnimation }
  scene.add(group)
  for (const t of targets) t.scale.setScalar(state.spec.hand.radius)
  showCost()
}

const current = () => state.scripts.scripts[state.script]
const frameIndex = () => Math.min(current().frames.length - 1, Math.round(state.t * state.scripts.fps))
let lastRoot = null

/** Poses the figure, the yoke, and the targets at the current frame, as the sim would draw it. */
function pose() {
  if (!figure || !state.scripts) return
  const script = current()
  const k = frameIndex()
  const f = script.frames[k]
  const names = state.scripts.channels
  const values = f.values.slice()
  if (state.color !== "") values[names.indexOf("COLOR")] = Number(state.color)
  if (state.shows !== "") values[names.indexOf("SHOWS")] = Number(state.shows)
  const read = reader(names, values)
  for (const ch of [...channels(state.spec), colorChannel(state.spec)]) {
    const action = figure.actions.get(variable(ch.name))
    if (!action) continue
    action.time = timeOf(ch, read, action.getClip().duration)
    if (ch.name === "COLOR" && figure.colorAnimation >= 0) {
      const [main, light] = [1, 2].map((s) => sample(figure.built, figure.colorAnimation, s, action.time))
      figure.mats.get("DUALINPUT_FIGURE_MAIN")?.color.setRGB(main[0], main[1], main[2], THREE.LinearSRGBColorSpace)
      figure.mats.get("DUALINPUT_FIGURE_LIGHT")?.color.setRGB(light[0], light[1], light[2], THREE.LinearSRGBColorSpace)
    }
  }
  figure.mixer.update(0)
  const drawn = shown(figure.built, read)
  for (const [name, visible] of drawn.visible) {
    const node = figure.nodes.get(name)
    if (node) node.visible = visible
  }
  figure.group.position.set(f.at[0], f.at[1], f.at[2])
  figure.group.rotation.set(rad(f.pitch), rad(-f.facing), rad(-f.bank), "YXZ")

  const frames = partFrames.get(script.name)
  cockpit.parts.forEach((mesh, i) => {
    const at = frames ? (k * cockpit.parts.length + i) * 16 : -1
    if (at >= 0) mesh.matrix.fromArray(frames, at)
    else mesh.matrix.fromArray(state.cockpit.parts[i].rest)
    mesh.matrixWorldNeedsUpdate = true
  })
  targets.forEach((m, i) => {
    const t = f.targets[i]
    m.visible = Boolean(t) && $("targets").checked
    if (t) m.position.set(t[0], t[1], t[2])
  })
  if (state.view === "follow") {
    const root = new THREE.Vector3(...f.at)
    if (lastRoot) {
      const d = root.clone().sub(lastRoot)
      camera.position.add(d)
      controls.target.add(d)
    }
    lastRoot = root
  }
  $("frame-cost").textContent = `This frame, ${DETAILS[state.lod].name} draws ${count(drawn.triangles)} triangles in ${drawn.draws} draw calls, and Figure wrote ${f.writes} of the 35 variables it can write.`
  $("hud").textContent = [
    `${script.title}   ${f.t.toFixed(2)}s   frame ${k} of ${script.frames.length - 1}`,
    `root  ${f.at.map((v) => v.toFixed(3)).join("  ")}   facing ${f.facing.toFixed(1)}°`,
    `the 58P: ${state.cockpit.report.posed} of its ${state.cockpit.report.animationCodes + state.cockpit.report.visibilityCodes} codes posed`,
  ].join("\n")
  $("time").value = String(k)
  $("clock").textContent = `${f.t.toFixed(2)}s`
}

// ---------------------------------------------------------------- the camera

const views = {
  copilot: "Copilot's seat",
  face: "Face",
  behind: "Behind",
  side: "Side",
  follow: "Follow",
  free: "Free",
}

function setView(name) {
  state.view = name
  lastRoot = null
  const e = state.cockpit.eye
  const h = state.seat.hip
  const f = current().frames[frameIndex()]
  const put = (position, target) => {
    camera.position.set(...position)
    controls.target.set(...target)
  }
  const chest = [h[0], h[1] + 0.35, h[2] + 0.15]
  // From the copilot's eye, leaned back and out, so the whole figure is in view.
  if (name === "copilot") put([-e[0] - 0.15, e[1] + 0.05, e[2] - 0.25], chest)
  else if (name === "face") put([h[0], e[1] - 0.02, e[2] + 0.5], [h[0], e[1] - 0.1, e[2]])
  // Over the right shoulder from the centerline, in front of the seat back.
  else if (name === "behind") put([0.02, e[1] + 0.12, h[2] - 0.4], [h[0], e[1] - 0.3, h[2] + 0.45])
  else if (name === "side") put([h[0] + 1.9, e[1] + 0.1, h[2] + 0.25], chest)
  else if (name === "follow") put([f.at[0] + 3.4, f.at[1] + 0.6, f.at[2] - 2.6], [f.at[0], f.at[1], f.at[2]])
  $("cut").checked = name === "side"
  applyCut()
  for (const b of $("views").children) b.classList.toggle("on", b.dataset.view === name)
  controls.update()
}

function applyCut() {
  const planes = $("cut").checked ? [cut] : []
  for (const m of [materials.interior, materials.ghost, materials.solid]) {
    m.clippingPlanes = planes
    m.needsUpdate = true
  }
}

// ---------------------------------------------------------------- the panel

function leaves(value, pointer = "") {
  if (typeof value === "number") return [{ pointer, value }]
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, `${pointer}/${k}`))
  return []
}
const at = (obj, pointer) => pointer.split("/").slice(1).reduce((o, k) => o[k], obj)
function put(obj, pointer, value) {
  const keys = pointer.split("/").slice(1)
  const last = keys.pop()
  keys.reduce((o, k) => o[k], obj)[last] = value
}

/** A slider beside a number box, over a range around `value`, calling `change` with each new value. */
function numberRow(label, value, change, around) {
  const row = document.createElement("div")
  row.className = "num"
  const whole = Number.isInteger(value) && Math.abs(value) >= 1
  const span = around ?? Math.max(Math.abs(value), whole ? 1 : 0.05)
  const lo = value >= 0 && around === undefined ? 0 : value - span
  const step = whole ? 1 : Math.max(span / 200, 0.0005)
  row.innerHTML = `<label title="${label}">${label}</label><input type="range"><input type="number">`
  const [, range, box] = row.children
  Object.assign(range, { min: lo, max: value + span, step, value })
  Object.assign(box, { step, value })
  const set = (v) => {
    if (!Number.isFinite(v)) return
    range.value = String(v)
    box.value = String(v)
    change(v)
  }
  range.addEventListener("input", () => set(Number(range.value)))
  box.addEventListener("change", () => set(Number(box.value)))
  return row
}

let rebuildSoon = 0
function sizesChanged() {
  clearTimeout(rebuildSoon)
  rebuildSoon = setTimeout(() => buildFigure().catch(fail), 60)
  showStatus()
}

function buildSizes() {
  const host = $("sizes")
  host.innerHTML = ""
  const groups = new Map()
  for (const leaf of leaves(state.written)) {
    const top = leaf.pointer.split("/")[1]
    if (top === "palette") continue
    if (!groups.has(top)) groups.set(top, [])
    groups.get(top).push(leaf)
  }
  for (const [top, list] of groups) {
    const box = document.createElement("details")
    box.innerHTML = `<summary>${top}</summary>`
    for (const { pointer, value } of list) {
      const row = numberRow(pointer.slice(top.length + 2) || top, value, (v) => {
        put(state.spec, pointer, v)
        row.classList.toggle("changed", v !== at(state.written, pointer))
        sizesChanged()
      })
      box.append(row)
    }
    host.append(box)
  }
}

const SEAT = [
  ["hip x, left", "/hip/0"], ["hip y, up", "/hip/1"], ["hip z, forward", "/hip/2"],
  ["knees up", "/knees/0"], ["knees forward", "/knees/1"], ["feet up", "/feet/0"], ["feet forward", "/feet/1"],
  ["eye up", "/eye/0"], ["eye forward", "/eye/1"], ["facing", "/facing"],
]

function buildSeat() {
  const host = $("seat")
  host.innerHTML = ""
  for (const [label, pointer] of SEAT) {
    const value = at(state.seat, pointer)
    const row = numberRow(label, value, (v) => {
      put(state.seatEdit, pointer, v)
      row.classList.toggle("changed", v !== at(state.seat, pointer))
      showStatus()
    }, pointer === "/facing" ? 30 : 0.3)
    host.append(row)
  }
}

/** Each number of `a` that differs in `b`, by its pointer, with `a`'s value. */
const differ = (a, b) =>
  Object.fromEntries(leaves(a).filter(({ pointer, value }) => value !== at(b, pointer)).map(({ pointer, value }) => [pointer, value]))
const changes = () => differ(state.spec, state.written)
const seatChanged = () => Object.keys(differ(state.seatEdit, state.seat)).length > 0

function showStatus(error) {
  const s = $("status")
  const n = Object.keys(changes()).length
  // The program writes the spec back with its keys sorted, so the two compare number by number.
  const ranOther = Object.keys(differ(state.written, state.ran)).length > 0
  s.className = error ? "error" : n || seatChanged() || ranOther ? "pending" : ""
  if (error) s.textContent = error
  else if (state.running) s.textContent = "Writing figure.json and running the scripts again: a build and a run take a minute or less."
  else if (n || seatChanged()) {
    const parts = [n ? `${n} size${n === 1 ? "" : "s"}` : "", seatChanged() ? "the seat" : ""].filter(Boolean).join(" and ")
    s.textContent = `${parts} changed and not applied. The figure's model shows the sizes; its poses come from the numbers Figure ran with.`
  } else if (ranOther) s.textContent = "figure.json differs from the numbers the scripts ran with. Apply runs them again."
  else s.textContent = "Poses from Figure as compiled from figure.json, in the seat below."
  $("apply").disabled = state.running || !(n || seatChanged() || ranOther)
  $("revert").disabled = state.running || !(n || seatChanged())
}

function showCost() {
  const rows = DETAILS.map((d) => {
    const c = buildGltf(state.spec, d).cost
    const b = state.budget[d.name] ?? { triangles: Infinity, draws: Infinity }
    const cell = (v, most) => `<td class="${v > most ? "over" : "ok"}">${count(v)} <span style="color:var(--dim)">/ ${count(most)}</span></td>`
    return `<tr><td>${d.name}</td>${cell(c.triangles, b.triangles)}${cell(c.draws, b.draws)}<td>${c.nodes}</td><td>${c.materials}</td></tr>`
  })
  $("cost").innerHTML = `<tr><th>Level</th><th>Triangles</th><th>Draws</th><th>Nodes</th><th>Materials</th></tr>${rows.join("")}`
}

async function apply(body) {
  state.running = true
  showStatus()
  try {
    const r = await fetch("/apply", { method: "POST", body: JSON.stringify(body) })
    const answer = await r.json()
    if (!r.ok) throw new Error(answer.error ?? `the run failed with ${r.status}`)
    await load(false)
    state.running = false
    buildSizes()
    buildSeat()
    await loadParts(current())
    await buildFigure()
    showStatus()
  } catch (e) {
    state.running = false
    showStatus(`The run failed, so the poses are from the last one that worked:\n${e.message}`)
  }
}

function pickScript(i) {
  state.script = i
  state.t = 0
  const s = current()
  $("time").max = String(s.frames.length - 1)
  for (const b of $("scripts").children) b.classList.toggle("on", Number(b.dataset.index) === i)
  loadParts(s).catch(fail)
  const hip = state.seat.hip
  const onFoot = Math.hypot(s.frames[0].at[0] - hip[0], s.frames[0].at[2] - hip[2]) > 1
  setView(onFoot ? "follow" : "copilot")
  $("exterior").value = onFoot ? "solid" : "ghost"
  showExterior()
}

function showExterior() {
  const how = $("exterior").value
  if (!cockpit.exterior) return
  cockpit.exterior.visible = how !== "off"
  cockpit.exterior.material = how === "solid" ? materials.solid : materials.ghost
}

function fail(e) {
  console.error(e)
  showStatus(e.message ?? String(e))
}

function wire() {
  $("scripts").innerHTML = ""
  state.scripts.scripts.forEach((s, i) => {
    const b = document.createElement("button")
    b.textContent = s.title
    b.dataset.index = String(i)
    b.addEventListener("click", () => pickScript(i))
    $("scripts").append(b)
  })
  for (const [name, title] of Object.entries(views)) {
    const b = document.createElement("button")
    b.textContent = title
    b.dataset.view = name
    b.addEventListener("click", () => setView(name))
    $("views").append(b)
  }
  $("lod").innerHTML = DETAILS.map((d, i) => `<option value="${i}">${d.name}, from ${d.minSize}</option>`).join("")
  $("lod").addEventListener("change", () => {
    state.lod = Number($("lod").value)
    buildFigure().catch(fail)
  })
  $("color").innerHTML = `<option value="">as the script feeds it</option>` + state.written.palette.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")
  $("color").addEventListener("change", () => (state.color = $("color").value))
  $("shows").addEventListener("change", () => (state.shows = $("shows").value))
  $("exterior").addEventListener("change", showExterior)
  $("cut").addEventListener("change", applyCut)
  $("play").addEventListener("click", () => setPlaying(!state.playing))
  $("time").addEventListener("input", () => {
    setPlaying(false)
    state.t = Number($("time").value) / state.scripts.fps
  })
  $("apply").addEventListener("click", () => apply({ changes: changes(), seat: seatChanged() ? state.seatEdit : undefined }))
  $("revert").addEventListener("click", () => {
    state.spec = structuredClone(state.written)
    state.seatEdit = structuredClone(state.seat)
    buildSizes()
    buildSeat()
    sizesChanged()
  })
  $("seat-reset").addEventListener("click", () => apply({ seat: null }))
  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === "number") return
    if (e.code === "Space") {
      setPlaying(!state.playing)
      e.preventDefault()
    } else if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
      setPlaying(false)
      const step = (e.code === "ArrowRight" ? 1 : -1) / state.scripts.fps
      state.t = Math.min(Math.max(state.t + step, 0), current().seconds)
      e.preventDefault()
    }
  })
}

function setPlaying(on) {
  state.playing = on
  $("play").textContent = on ? "Pause" : "Play"
}

let lastFrame = performance.now()
function frame() {
  requestAnimationFrame(frame)
  const now = performance.now()
  const dt = Math.min((now - lastFrame) / 1000, 0.1)
  lastFrame = now
  if (state.scripts && state.playing) {
    state.t += dt * Number($("speed").value)
    if (state.t > current().seconds) {
      if ($("loop").checked) {
        state.t = 0
        if (state.view === "follow") setView("follow")
      } else {
        state.t = current().seconds
        setPlaying(false)
      }
    }
  }
  pose()
  controls.update()
  renderer.render(scene, camera)
}

async function start() {
  await load(true)
  wire()
  buildSizes()
  buildSeat()
  await buildFigure()
  pickScript(0)
  showStatus()
  frame()
}

start().catch(fail)
