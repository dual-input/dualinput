// The desktop app's windows as Windows 11 draws ours, for the two dev pages here: on a desktop's color, with no title bar
// of Windows', a hairline edge, rounded corners, and a shadow. The kit's classes reach only inside a root, so the frame is
// styled inline.

import type { ReactNode, Ref } from "react"

/** The windows' width. `WIDTH` in src/apps/desktop/src/screens.rs names the same one, so change both together. */
export const WIDTH = 400
/** A Windows desktop's color behind a window, so its edge shows. */
export const DESKTOP_COLOR = "#2c4a66"

/** A window on a margin of the desktop, wide enough for its shadow, which is the element a screenshot takes. */
export function WindowOnDesktop({ height, shot, children }: { height?: number; shot?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div ref={shot} style={{ padding: 40, background: DESKTOP_COLOR, flexShrink: 0 }}>
      <div style={{ width: WIDTH, height, overflow: "hidden", borderRadius: 8, boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 16px 48px rgba(0,0,0,0.5)" }}>{children}</div>
    </div>
  )
}
