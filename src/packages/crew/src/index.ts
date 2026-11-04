// What the EFB app and the banner both draw of a crew: a pilot's head, the same head badged with where they stand
// in preflight, and this pilot's Ready with the countdown it starts. It's a package since neither page's code may
// reach into the other's (record/areas/interface/decisions.md, "The banner draws with React and the kit").

export { BadgedHead } from "./badged-head.tsx"
export type { HeadState } from "./badged-head.tsx"
export { CrewHeads, EmptyHead, FIGURE_COLORS, Head, HeadColors, useCrew } from "./heads/head.tsx"
export type { HeadProps } from "./heads/head.tsx"
export { HEAD_CUE, HEAD_SIZE, setHeadTurn } from "./heads/live.ts"
export { crewInPreflight, inPreflight } from "./in-preflight.ts"
export { COUNTDOWN, CountdownRing, ReadyButton, Rolling, useCountdown } from "./ready.tsx"
