// An aircraft package of our own, which avatars' scenarios load, since the Baron 58P's files
// can't be in the tree: a cabin with a panel and a switch, an invisible shell, a yoke for each
// seat marked with its grips, an exterior with a chock beside it, and a profile that gives it
// two seats and located entries (record/areas/build/plan.md, "17 Avatars").
//
// Every point is in the aircraft's frame, in meters from its reference point, x left, y up, and
// z forward, and the models' own space is that frame.

import fs from "node:fs"
import path from "node:path"

export type V3 = [number, number, number]

/** The aircraft, as flights.ts's `load` takes one. */
export const PLANE = { cfg: String.raw`SimObjects\Airplanes\dualinput-bench-plane\aircraft.cfg`, path: "dualinput-bench-plane" }
export const TITLE = "Dual Input Bench Plane"

/** The seats' hips and eyes, which `profile` writes. An eye is 0.63m above its hip and 0.05m behind it. */
export const SEATS = {
  pilot: { hip: [0.3, 0.4, -0.2] as V3, eye: [0.3, 1.03, -0.25] as V3 },
  copilot: { hip: [-0.3, 0.4, -0.2] as V3, eye: [-0.3, 1.03, -0.25] as V3 },
}

/** Each located entry's point, with a `deadband` for the one a hardware axis would jitter. */
export const LOCATED = {
  battery: { at: [0.3, 0.8, 0.95] as V3 },
  alternator: { at: [0.5, 0.8, 0.95] as V3 },
  avionics: { at: [0.7, 0.8, 0.95] as V3 },
  throttle: { at: [0, 0.5, 0.9] as V3, deadband: 2 },
}

/** The panel's plane, which a ray from a seat's eye meets above the yokes. */
export const PANEL_Z = 0.95
/** The exterior's chock, its middle, standing clear of the fuselage on the left. */
export const CHOCK: V3 = [1.35, -1.35, 0.65]

/** A glTF and its buffer, built from boxes. `Gltf` in src/engines/aircraft-model/src/tests.rs builds the engine's own fixture the same way. */
class Gltf {
  private readonly nodes: Record<string, unknown>[] = []
  private readonly meshes: unknown[] = []
  private readonly accessors: unknown[] = []
  private readonly views: unknown[] = []
  private readonly animations: unknown[] = []
  private bytes: Buffer[] = []
  private length = 0

  private push(bytes: Buffer): number {
    const at = this.length
    this.bytes.push(bytes)
    this.length += bytes.length
    return at
  }

  private floats(values: number[], type: string, count: number): number {
    const bytes = Buffer.alloc(values.length * 4)
    values.forEach((v, i) => bytes.writeFloatLE(v, i * 4))
    const byteOffset = this.push(bytes)
    this.views.push({ buffer: 0, byteOffset, byteLength: bytes.length })
    this.accessors.push({ bufferView: this.views.length - 1, componentType: 5126, count, type })
    return this.accessors.length - 1
  }

  /** A box from `min` to `max`, as a mesh, in material 0, plastic, or 1, invisible. */
  cuboid(min: V3, max: V3, material = 0): number {
    const corners: number[] = []
    for (let i = 0; i < 8; i++) corners.push(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2])
    const positions = this.floats(corners, "VEC3", 8)
    const faces = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3]
    const indices = Buffer.alloc(72)
    faces.forEach((f, i) => indices.writeUInt16LE(f, i * 2))
    const byteOffset = this.push(indices)
    this.views.push({ buffer: 0, byteOffset, byteLength: 72 })
    this.accessors.push({ bufferView: this.views.length - 1, componentType: 5123, count: 36, type: "SCALAR" })
    this.meshes.push({ primitives: [{ attributes: { POSITION: positions }, indices: this.accessors.length - 1, material }] })
    return this.meshes.length - 1
  }

  node(node: Record<string, unknown>, parent?: number): number {
    this.nodes.push(node)
    const at = this.nodes.length - 1
    if (parent !== undefined) ((this.nodes[parent]!.children ??= []) as number[]).push(at)
    return at
  }

  /** An animation over 1s that moves `nodes` from `from` to `to`, translations or rotations. */
  animation(name: string, nodes: number[], target: "translation" | "rotation", from: number[], to: number[]): void {
    const input = this.floats([0, 1], "SCALAR", 2)
    const output = this.floats([...from, ...to], from.length === 4 ? "VEC4" : "VEC3", 2)
    this.animations.push({ name, samplers: [{ input, output }], channels: nodes.map((node) => ({ sampler: 0, target: { node, path: target } })) })
  }

  files(name: string): { json: string; bin: Buffer } {
    return {
      json: JSON.stringify({
        extensionsRequired: ["MSFT_texture_dds"],
        nodes: this.nodes,
        meshes: this.meshes,
        materials: [{ name: "Plastic" }, { name: "Shell", extensions: { ASOBO_material_invisible: {} } }],
        accessors: this.accessors,
        bufferViews: this.views,
        buffers: [{ uri: `${name}.bin`, byteLength: this.length }],
        animations: this.animations,
      }),
      bin: Buffer.concat(this.bytes),
    }
  }
}

/** A quaternion turning by `degrees` about z. */
function aboutZ(degrees: number): number[] {
  const half = (degrees * Math.PI) / 360
  return [0, 0, Math.sin(half), Math.cos(half)]
}

function interior(): { json: string; bin: Buffer } {
  const g = new Gltf()
  const root = g.node({ name: "Cabin" })
  g.node({ name: "Panel", mesh: g.cuboid([-1, 0, PANEL_Z], [1, 1.2, 1.05]) }, root)
  const battery = LOCATED.battery.at
  const switchNode = g.node({ name: "Switch_Battery", mesh: g.cuboid([-0.01, -0.03, -0.02], [0.01, 0.03, 0]), translation: battery }, root)
  g.node({ name: "Shell", mesh: g.cuboid([-1.5, -0.5, -2], [1.5, 1.6, 2], 1) }, root)
  const horn = g.cuboid([-0.15, -0.03, -0.02], [0.15, 0.03, 0.02])
  const yoke = (side: "L" | "R", x: number): { pitch: number; roll: number; wheel: number } => {
    const place = g.node({ name: `YOKE_${side}_VISIBILITY`, translation: [x, 0.7, 0.7] }, root)
    const pitch = g.node({ name: `YokePitch_${side}` }, place)
    const roll = g.node({ name: `YokeRoll_${side}` }, pitch)
    return { pitch, roll, wheel: g.node({ name: `Yoke_${side}`, mesh: horn }, roll) }
  }
  const left = yoke("L", SEATS.pilot.hip[0])
  const right = yoke("R", SEATS.copilot.hip[0])
  // The grips sit inside the horn, 12cm either side of the wheel's center, on the pilot's yoke
  // alone, so the engine finds the copilot's as their copy.
  g.node({ name: "HANDLING_Yoke_1_Hand_Left", translation: [0.12, 0, 0] }, left.wheel)
  g.node({ name: "HANDLING_Yoke_1_Hand_Right", translation: [-0.12, 0, 0] }, left.wheel)
  g.animation("HANDLING_Yoke_Lever_StickForeAft", [left.pitch, right.pitch], "translation", [0, 0, -0.1], [0, 0, 0.1])
  g.animation("HANDLING_YOKE_LEVER_StickLR", [left.roll, right.roll], "rotation", aboutZ(90), aboutZ(-90))
  g.animation("Switch_Battery", [switchNode], "rotation", aboutZ(0), aboutZ(60))
  return g.files("bench_INT")
}

function exterior(): { json: string; bin: Buffer } {
  const g = new Gltf()
  const root = g.node({ name: "Aircraft" })
  g.node({ name: "Fuselage", mesh: g.cuboid([-1, -0.5, -4], [1, 1.5, 4]) }, root)
  g.node({ name: "Chock", mesh: g.cuboid([1.2, -1.5, 0.5], [1.5, -1.2, 0.8]) }, root)
  return g.files("bench_EXT")
}

const BEHAVIOR_INT = `<?xml version="1.0" encoding="utf-8"?>
<ModelInfo>
  <LODS><LOD minSize="80" ModelFile="bench_INT.gltf"/></LODS>
  <Behaviors>
    <Component ID="YOKES">
      <Component ID="YokePitch_L" Node="YokePitch_L">
        <UseTemplate Name="ASOBO_GT_Anim_Code">
          <ANIM_NAME>HANDLING_Yoke_Lever_StickForeAft</ANIM_NAME>
          <ANIM_CODE>(A:YOKE Y POSITION WITH AP, Percent) 2 / 50 +</ANIM_CODE>
        </UseTemplate>
        <UseTemplate Name="ASOBO_GT_Anim_Code">
          <ANIM_NAME>HANDLING_YOKE_LEVER_StickLR</ANIM_NAME>
          <ANIM_CODE>(A:YOKE X POSITION WITH AP LINEAR, Percent) 2 / 50 +</ANIM_CODE>
        </UseTemplate>
      </Component>
    </Component>
    <Component ID="Battery" Node="Switch_Battery">
      <UseTemplate Name="ASOBO_GT_Anim_Code">
        <ANIM_NAME>Switch_Battery</ANIM_NAME>
        <ANIM_CODE>(L:BENCH_Battery, bool) 100 *</ANIM_CODE>
      </UseTemplate>
    </Component>
  </Behaviors>
</ModelInfo>`

/**
 * Writes `<folder>/packages/Community/...` with the aircraft, and a `UserCfg.opt` naming it, and
 * returns the file for the setting `sim.user-cfg`. With `unreadable`, its glTF files can't be
 * parsed, so the model's job fails, as it does on an aircraft that ships its files as `.fsc`.
 */
export function writePackage(folder: string, { unreadable = false } = {}): string {
  const packages = path.join(folder, "packages")
  const pkg = path.join(packages, "Community", "dualinput-bench-aircraft")
  const plane = path.join(pkg, "SimObjects", "Airplanes", PLANE.path)
  const model = path.join(plane, "model")
  fs.mkdirSync(model, { recursive: true })
  fs.writeFileSync(path.join(pkg, "manifest.json"), JSON.stringify({ package_version: "1.0.0" }))
  fs.writeFileSync(path.join(plane, "aircraft.cfg"), `[FLTSIM.0]\r\ntitle = "${TITLE}"\r\nmodel = ""\r\nui_manufacturer = "Dual Input"\r\nui_type = "Bench Plane"\r\n`)
  fs.writeFileSync(path.join(model, "model.cfg"), "[models]\r\nnormal = bench_EXT.xml\r\ninterior = bench_INT.xml\r\n")
  fs.writeFileSync(path.join(model, "bench_INT.xml"), BEHAVIOR_INT)
  fs.writeFileSync(path.join(model, "bench_EXT.xml"), `<ModelInfo><LODS><LOD minSize="80" ModelFile="bench_EXT.gltf"/></LODS></ModelInfo>`)
  for (const [name, { json, bin }] of [
    ["bench_INT", interior()],
    ["bench_EXT", exterior()],
  ] as const) {
    fs.writeFileSync(path.join(model, `${name}.gltf`), unreadable ? "not a glTF" : json)
    fs.writeFileSync(path.join(model, `${name}.bin`), bin)
  }
  const cfg = path.join(folder, "UserCfg.opt")
  fs.writeFileSync(cfg, userCfgText(packages))
  return cfg
}

/** What a `UserCfg.opt` naming the packages folder `packages` holds. */
export function userCfgText(packages: string): string {
  return `Version 1\r\nInstalledPackagesPath "${packages}"\r\n`
}

/** Writes a profiles' folder that covers only the aircraft, and returns it, with no seats when `seats` is false. */
export function writeProfiles(folder: string, { seats = true } = {}): string {
  const profiles = path.join(folder, "profiles")
  fs.mkdirSync(path.join(profiles, "aircraft"), { recursive: true })
  const entry = (key: string, { at, deadband }: { at: V3; deadband?: number }): string =>
    [`  ${key}:`, `    name: ${key}`, `    watch: L('BENCH_${key}')`, `    write: L('BENCH_${key}')`, `    location: [${at.join(", ")}]`, ...(deadband === undefined ? [] : [`    deadband: ${deadband}`])].join("\n")
  const seat = (key: string, name: string, { hip }: { hip: V3 }): string =>
    [`  ${key}:`, `    name: ${name}`, `    hip: [${hip.join(", ")}]`, "    knees: [0.05, 0.45]", "    feet: [-0.42, 0.62]", "    eye: [0.63, -0.05]"].join("\n")
  const lines = [
    "maker: Dual Input",
    "name: Bench Plane",
    "maturity: experimental",
    "authors: Dual Input",
    "aircraft:",
    "  variants:",
    `    plane: ${PLANE.path}`,
    "state:",
    ...Object.entries(LOCATED).map(([key, located]) => entry(key, located)),
    ...(seats ? ["seats:", seat("pilot", "Pilot", SEATS.pilot), seat("copilot", "Copilot", SEATS.copilot)] : []),
  ]
  fs.writeFileSync(path.join(profiles, "aircraft", "bench-plane.yaml"), `${lines.join("\n")}\n`)
  return profiles
}

/** The field of view every scenario's camera has, the view's height, in radians. */
export const FOV = 1
/** The stand-in core helper's window: 1920 by 1080. */
const ASPECT = 16 / 9

/** Where a cursor sits, −1 to 1 right and up, for a ray from a `SIMOBJECT` camera at `from`, looking along +z, to reach `to`. */
export function cursorFor(from: V3, to: V3): { x: number; y: number } {
  const tv = Math.tan(FOV / 2)
  const forward = to[2] - from[2]
  return { x: -(to[0] - from[0]) / forward / (tv * ASPECT), y: (to[1] - from[1]) / forward / tv }
}

/** The aircraft's pose on the stand-in, where a scenario's walkaround stands: its latitude and longitude in degrees, and its altitude in feet, facing north. */
export const PARKED = { latitude: 47, longitude: 8, altitude: 1_000 }

const EQUATOR_M = 6_378_137
const FLATTENING = 1 / 298.257223563
const FT = 0.3048

/**
 * A point of the frame in the world, around `PARKED`, as latitude and longitude in degrees, and
 * altitude in feet. `world_to_frame` in src/engines/aircraft-model/src/frame.rs turns a point the
 * other way, so change both together.
 */
export function worldOf([x, y, z]: V3): { latitude: number; longitude: number; altitude: number } {
  const e2 = FLATTENING * (2 - FLATTENING)
  const latitude = (PARKED.latitude * Math.PI) / 180
  const w = Math.sqrt(1 - e2 * Math.sin(latitude) ** 2)
  const meridian = (EQUATOR_M * (1 - e2)) / w ** 3
  const normal = EQUATOR_M / w
  return {
    latitude: PARKED.latitude + (z / meridian) * (180 / Math.PI),
    longitude: PARKED.longitude + (-x / (normal * Math.cos(latitude))) * (180 / Math.PI),
    altitude: PARKED.altitude + y / FT,
  }
}

/** The `WORLD` camera at the frame's point `from`, looking at the frame's point `to`, for the stand-in. */
export function worldCamera(from: V3, to: V3): { referential: number; position: [number, number, number]; pitch: number; yaw: number; roll: number; fov: number } {
  const world = worldOf(from)
  const [north, east, down] = [to[2] - from[2], -(to[0] - from[0]), -(to[1] - from[1])]
  return {
    referential: 2,
    position: [world.latitude, world.longitude, world.altitude * FT],
    pitch: (Math.atan2(down, Math.hypot(north, east)) * 180) / Math.PI,
    yaw: (Math.atan2(east, north) * 180) / Math.PI,
    roll: 0,
    fov: FOV,
  }
}
