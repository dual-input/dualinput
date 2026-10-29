// The session card's picture: an airliner's cockpit seen from just behind its seats, looking
// through the windshield toward the nose, with the invite code in the glass between the pilots'
// heads and the crew in the two seats, their backs to us. The cockpit is a few lines, as a car's
// shape is sketched in light in an advert: only those that tell what it is, each fading toward its
// ends, so the picture suggests the cockpit rather than drawing it. The seats are symbolic: the
// host sits on the left, as a captain would, whichever seat they take in the sim. A crew bigger
// than two shows its other pilots' heads in a row under the picture.
//
// The pilots are the figure their crew sees in the sim, drawn by the portrait's ray tracer
// (figure-portrait.tsx) through an orthographic camera (figure-head.tsx), so the lines and the
// figures have to line up: the camera looks forward and a little down, so a point in the cockpit
// lands on the picture by a fixed scale, and the seats, the pedestal, and the throttles are placed
// by projecting where they stand in the cockpit. The windshield's lines are drawn by hand around
// them.
import { useId } from "react"

import { Figures, project, type Camera } from "./figure-head"
import { add, scale, SPEC, type Shape, type V } from "./figure-portrait"

// The picture, 436 by 250 pixels, the card's width inside its padding. The camera sits low, at
// the pilots' shoulders, looking 8° down, close enough that a meter is 260 pixels across, so the
// heads stand in front of the windshield, one toward each side, with the code between them. Its
// origin is the floor between the seats at the pilots' hips, and forward, toward the nose, is -z.
const PICTURE = { width: 436, height: 250 }
const CAMERA: Camera = { cx: 218, cy: 270, k: 260, tilt: (8 * Math.PI) / 180 }

// Where a point in the cockpit lands on the picture.
const toPicture = (p: V) => project(p, CAMERA)

// The cockpit, in meters: each seat's center across; a seat back, behind the pilot, as wide and
// as high as it is, stopping short of the shoulders so the torso shows over it as shoulders do,
// where any higher the sliver that shows reads as a collar; the pedestal between the seats, from
// the panel back past them; and the two throttle handles on it.
const SEAT = { across: 0.55, halfWidth: 0.25, top: 0.38, behind: 0.18 }
const PEDESTAL = { halfWidth: 0.11, top: 0.12, front: -0.55, back: 0.3 }
const THROTTLES: V[] = [
  [-0.05, 0.22, -0.4],
  [0.05, 0.22, -0.4],
]

// The head comes down from where the cockpit's pose puts it, since the figure has no neck, until it
// sits on the torso: seen from behind and nearly level, the 3cm of air the portrait leaves
// (figure-portrait.tsx, NECK_DROP) shows as a dark band, and the head reads as floating.
const NECK_DROP = 0.092

// A pilot in the seat whose center is seatX across, from the figure's seated pose (the portrait's
// spec and POSE), looking ahead, with each hand where it's given: one on the throttle nearest, the
// other forward in their lap, out of sight behind the seat. The hips sit on the seat at the
// origin, and aren't drawn, since the seat hides them and the picture's edge would cut them.
function seatedPilot(seatX: number, hands: [V, V]): Shape[] {
  const look: V = [0, 0, -1]
  // The pose's eye is 5cm behind the hips and 0.63m above them; the head's center sits back from
  // the eye, and the chest part of the way from the hips to it.
  const toHead: V = [0, 0.63, 0.05 + SPEC.head.eyeForward]
  const head: V = [seatX, toHead[1] - NECK_DROP, toHead[2]]
  const chest: V = [seatX, toHead[1] * SPEC.chest.at, toHead[2] * SPEC.chest.at]
  const R = SPEC.head.radius, r = SPEC.nose.radius, rt = r * SPEC.nose.tip
  const out = Math.sqrt(R * R - r * r)
  const shapes: Shape[] = [
    { ball: true, c: chest, r: SPEC.chest.radius, light: true },
    { ball: true, c: head, r: R },
    { ball: false, a: add(head, scale(look, out)), b: add(head, scale(look, R + SPEC.nose.length - rt)), ra: r, rb: rt },
  ]
  for (const [side, hand] of [[-1, hands[0]], [1, hands[1]]] as const) {
    const shoulder: V = [seatX + (side * SPEC.shoulders.width) / 2, chest[1] - SPEC.shoulders.down, chest[2]]
    shapes.push({ ball: false, a: shoulder, b: hand, ra: SPEC.arm.radius, rb: SPEC.arm.radius }, { ball: true, c: hand, r: SPEC.hand.radius, hand: true })
  }
  return shapes
}

// The host on the left, the pilot flying, with their right hand resting on the left throttle's
// handle; the crewmate on the right with both hands in their lap, since only the pilot flying
// holds the throttles, which also shows at a glance who's flying.
const ON_HANDLE: V = [0, SPEC.hand.radius * 0.8, 0]
const LAP = { across: 0.12, up: 0.2, forward: 0.3 }
const lap = (seatX: number, side: number): V => [seatX + side * LAP.across, LAP.up, -LAP.forward]
const PILOTS = {
  left: seatedPilot(-SEAT.across, [lap(-SEAT.across, -1), add(THROTTLES[0], ON_HANDLE)]),
  right: seatedPilot(SEAT.across, [lap(SEAT.across, -1), lap(SEAT.across, 1)]),
}

// The lines: hairlines in the page's text color, at most this strong, each fading to nothing
// toward its ends, so none of them is drawn whole.
const LINE = { width: 1, strongest: 0.5 }

// An id for a picture's gradients, unique on the page, since the canvas shows many frames at once.
// React's ids hold colons, which a url(#…) reference can trip on, so they're left out.
const useGradientId = () => useId().replace(/[^\w-]/g, "")

// A gradient a line takes its strength from, along x or y across the picture, given as stops of
// [where, from 0 to 1 along that span, and how strong, from 0 to 1 of LINE.strongest].
function Fade({ id, along, from, to, stops }: { id: string; along: "x" | "y"; from: number; to: number; stops: [number, number][] }) {
  const span = along === "x" ? { x1: from, x2: to, y1: 0, y2: 0 } : { x1: 0, x2: 0, y1: from, y2: to }
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" {...span}>
      {stops.map(([at, strength]) => (
        <stop key={at} offset={at} stopColor="currentColor" stopOpacity={strength * LINE.strongest} />
      ))}
    </linearGradient>
  )
}

const [pedestalLeft, pedestalFront] = toPicture([-PEDESTAL.halfWidth, PEDESTAL.top, PEDESTAL.front])
const [pedestalRight, pedestalBack] = toPicture([PEDESTAL.halfWidth, PEDESTAL.top, PEDESTAL.back])
const HANDLES = THROTTLES.map((t) => toPicture(t))
// Where each throttle's stem meets the pedestal's top, under its handle.
const STEM_FOOT = toPicture([0, PEDESTAL.top, THROTTLES[0][2]])[1]

// Each seat's headrest, in meters: narrower than the back and standing on it to above the pilot's
// head, with rounded corners. It's drawn behind the pilots, so a pilot's head hides its middle and
// its outline shows around the head, while an empty seat shows it whole.
const HEADREST = { halfWidth: 0.13, top: 0.72, round: 0.06 }
const headrest = (seatX: number) => {
  const [l, top] = toPicture([seatX - HEADREST.halfWidth, HEADREST.top, SEAT.behind])
  const [r, bottom] = toPicture([seatX + HEADREST.halfWidth, SEAT.top, SEAT.behind])
  const round = HEADREST.round * CAMERA.k
  return `M${l} ${bottom} L${l} ${top + round} Q${l} ${top} ${l + round} ${top} L${r - round} ${top} Q${r} ${top} ${r} ${top + round} L${r} ${bottom}`
}
const [, HEADREST_TOP] = toPicture([0, HEADREST.top, SEAT.behind])
const [, SEAT_TOP] = toPicture([0, SEAT.top, SEAT.behind])

// Behind the pilots, the few shapes that make it an A320's cockpit: the overhead panel hanging down
// at the top in the middle;
// the two big front panes, their outer pillars leaning in as they come down to the glareshield, and
// the narrow center post between them, there only at its foot and top, so the code shows in the
// glass; the side windows beyond; the long glareshield with the autopilot's panel, the FCU, in its
// middle; the headrests; and the pedestal with its two thrust levers. Each line fades toward its
// ends. Drawn on the picture's 436 by 250 pixels, symmetric about its middle, 218.
function Behind() {
  const id = useGradientId()
  const url = (name: string) => `url(#${id}-${name})`
  const W = PICTURE.width
  const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${W - Number(x)} ${y}`)
  // The front pane's glass, for the sky: from the outer pillar's top, along the top edge to the
  // overhead panel, under it to the center post, down the post, and back along the glareshield.
  const glass = "M40 12 C80 9.5 120 9 156 9.5 L176 24 L210 24 L210 136 C160 137 110 144 60 152 Z"
  const paneTop = "M40 12 C80 9.5 120 9 156 9.5"
  const outerPillar = "M40 12 L60 152"
  const sideWindowTop = "M40 12 C26 14 12 18 -4 26"
  const sideWindowBack = "M10 34 L18 166"
  return (
    <svg viewBox={`0 0 ${W} ${PICTURE.height}`} className="absolute top-0 left-0 text-foreground" style={{ width: W, height: PICTURE.height }} fill="none" strokeWidth={LINE.width} strokeLinecap="round" aria-hidden>
      <defs>
        <radialGradient id={`${id}-sky`} gradientUnits="userSpaceOnUse" cx={218} cy={20} r={220}>
          <stop offset={0} style={{ stopColor: "var(--primary)" }} stopOpacity={0.1} />
          <stop offset={1} style={{ stopColor: "var(--primary)" }} stopOpacity={0} />
        </radialGradient>
        <Fade id={`${id}-across`} along="x" from={0} to={W} stops={[[0, 0], [0.2, 1], [0.8, 1], [1, 0]]} />
        <Fade id={`${id}-across-faint`} along="x" from={0} to={W} stops={[[0, 0], [0.25, 0.5], [0.75, 0.5], [1, 0]]} />
        <Fade id={`${id}-overhead`} along="y" from={24} to={0} stops={[[0, 0.8], [1, 0]]} />
        <Fade id={`${id}-rising`} along="y" from={152} to={12} stops={[[0, 0.9], [0.6, 0.45], [1, 0.15]]} />
        <Fade id={`${id}-side`} along="y" from={166} to={34} stops={[[0, 0], [0.5, 0.35], [1, 0]]} />
        <Fade id={`${id}-post`} along="y" from={136} to={24} stops={[[0, 0.7], [0.14, 0], [0.8, 0], [1, 0.5]]} />
        <Fade id={`${id}-headrest`} along="y" from={HEADREST_TOP} to={SEAT_TOP} stops={[[0, 0.8], [1, 0.25]]} />
        <Fade id={`${id}-down`} along="y" from={pedestalFront} to={PICTURE.height} stops={[[0, 0.7], [1, 0]]} />
      </defs>
      <path d={glass} fill={url("sky")} stroke="none" />
      <path d={mirror(glass)} fill={url("sky")} stroke="none" />
      <path d="M150 0 L176 24 L260 24 L286 0" stroke={url("overhead")} />
      {[paneTop, outerPillar, sideWindowTop].map((d) => (
        <g key={d}>
          <path d={d} stroke={url(d === outerPillar ? "rising" : "across-faint")} />
          <path d={mirror(d)} stroke={url(d === outerPillar ? "rising" : "across-faint")} />
        </g>
      ))}
      <path d={sideWindowBack} stroke={url("side")} />
      <path d={mirror(sideWindowBack)} stroke={url("side")} />
      <path d="M210 24 L210 136 M226 24 L226 136" stroke={url("post")} />
      <path d={`M-10 168 C20 162 40 156 60 152 C110 144 160 137 218 136 C276 137 326 144 376 152 C396 156 416 162 ${W + 10} 168`} stroke={url("across")} />
      <path d="M30 178 C100 163 160 157 218 157 C276 157 336 163 406 178" stroke={url("across-faint")} />
      <rect x={158} y={141} width={120} height={11} rx={3} stroke="currentColor" strokeOpacity={LINE.strongest * 0.55} />
      {[-SEAT.across, SEAT.across].map((x) => (
        <path key={x} d={headrest(x)} stroke={url("headrest")} />
      ))}
      <path d={`M${pedestalLeft} ${pedestalFront} L${pedestalRight} ${pedestalFront} M${pedestalLeft} ${pedestalFront} L${pedestalLeft - 6} ${pedestalBack} M${pedestalRight} ${pedestalFront} L${pedestalRight + 6} ${pedestalBack}`} stroke={url("down")} />
      {HANDLES.map(([x, y]) => (
        <g key={x} stroke="currentColor" strokeOpacity={LINE.strongest * 0.7}>
          <path d={`M${x} ${y + 3} L${x} ${STEM_FOOT}`} />
          <rect x={x - 7} y={y - 3} width={14} height={6} rx={3} />
        </g>
      ))}
    </svg>
  )
}

// The seat backs, in front of the pilots, filled with the card's color so they hide all but each
// pilot's head, shoulders, and the arm reaching for the throttle; each is outlined only around its
// top, the line fading as it runs down the sides.
function SeatBacks() {
  const id = useGradientId()
  const round = 28
  const [, top] = toPicture([0, SEAT.top, SEAT.behind])
  return (
    <svg viewBox={`0 0 ${PICTURE.width} ${PICTURE.height}`} className="pointer-events-none absolute top-0 left-0 text-foreground" style={{ width: PICTURE.width, height: PICTURE.height }} strokeWidth={LINE.width} aria-hidden>
      <defs>
        <Fade id={`${id}-seat`} along="y" from={top} to={top + 70} stops={[[0, 0.8], [1, 0]]} />
      </defs>
      {[-SEAT.across, SEAT.across].map((seatX) => {
        const [l] = toPicture([seatX - SEAT.halfWidth, 0, 0])
        const [r] = toPicture([seatX + SEAT.halfWidth, 0, 0])
        const bottom = PICTURE.height + 2
        const d = `M${l} ${bottom} L${l} ${top + round} Q${l} ${top} ${l + round} ${top} L${r - round} ${top} Q${r} ${top} ${r} ${top + round} L${r} ${bottom}`
        return <path key={seatX} d={d} style={{ fill: "var(--card)" }} stroke={`url(#${id}-seat)`} />
      })}
    </svg>
  )
}

// The picture: the lines, the pilots in it, the seat backs, and in the windshield, between the
// heads, whatever's given, such as the invite code.
export function Cockpit({ host, crewmate, children }: { host: string; crewmate?: string; children?: React.ReactNode }) {
  const figures = [{ shapes: PILOTS.left, hex: host }, ...(crewmate ? [{ shapes: PILOTS.right, hex: crewmate }] : [])]
  return (
    <div className="relative mx-auto shrink-0" style={{ width: PICTURE.width, height: PICTURE.height }}>
      <Behind />
      <Figures width={PICTURE.width} height={PICTURE.height} figures={figures} cam={CAMERA} />
      <SeatBacks />
      {children}
    </div>
  )
}

// The picture's width, which a two-column row under it takes, so each column centers under a seat.
export const COCKPIT_WIDTH = PICTURE.width
