// The Dual Input panel, the extension's view in VS Code's secondary side bar: the status line, then Run for one entry
// or the display picker in its place, drawn with the kit in the palette that matches VS Code's theme
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The Dual Input panel"). It draws from a `PanelView` alone, so
// the extension wires it to `serve` by posting views and answering the host's calls.

import { Card, Root, Separator } from "@dualinput/ui"
import { Info, Play, SquareMousePointer } from "lucide-react"
import type { ReactNode } from "react"

import { Picker } from "./picker.tsx"
import { Recorder } from "./recorder.tsx"
import { Run } from "./run.tsx"
import { StatusLine } from "./status-line.tsx"
import type { PanelHost, PanelView } from "./view.ts"

export function Panel({ view, host }: { view: PanelView; host: PanelHost }) {
  const { status, body } = view
  const runs = status.kind === "in-flight" && status.runs
  return (
    // It keeps our own background, so our colors read the same in any theme, but as an island with rounded corners rather
    // than edge to edge, so it reads as a window onto our app instead of a block of another theme's color. Around it shows
    // whatever VS Code paints behind the view, the side bar's color or the bottom panel's, since VS Code's stylesheet
    // leaves a webview's body transparent (read in VS Code 1.147.0, out/vs/workbench/contrib/webview/browser/pre/index.html,
    // `_defaultStyles`) and webview.css paints nothing.
    <Root palette={view.palette} style={{ height: "100%" }}>
      {/* No inset at the top, where the view's title already sets it apart. The status island takes the height the
          recorder's island below it leaves. */}
      <div className="flex h-full flex-col px-2 pb-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background">
          <div className="shrink-0">
            <StatusLine status={status} />
            {runs && status.crew && view.unpinned && <Unpinned />}
            <Separator />
          </div>
          {body.kind === "run" ? (
            // A new entry starts its value field afresh.
            <Run key={body.run.key} run={body.run} host={host} />
          ) : body.kind === "picker" ? (
            <Picker picker={body.picker} host={host} />
          ) : runs ? (
            <p className="px-4 py-4 text-xs leading-5 text-muted-foreground">
              Click <Lens icon={<Play />}>Run</Lens> above an entry to test its write, or <Lens icon={<SquareMousePointer />}>Pick displays</Lens> above <span className="font-mono">displays:</span> to select the panels Dual Input should sync.
            </p>
          ) : null}
        </div>
        <Recorder recorder={view.recorder} host={host} />
      </div>
    </Root>
  )
}

/** A lens's words as the editor shows them over an entry, with its icon. */
function Lens({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span className="whitespace-nowrap font-medium text-foreground [&>svg]:mr-1 [&>svg]:inline [&>svg]:size-3.5 [&>svg]:align-[-2px]">
      {icon}
      {children}
    </span>
  )
}

function Unpinned() {
  return (
    <Card flush tint="bg-info/10 text-info" className="mx-4 mb-3">
      <p className="flex items-start px-3 py-2.5 text-xs">
        <Info className="mr-2.5 size-4 shrink-0" />
        <span>Unsaved edits run on this PC only. Your crew gets them when you save.</span>
      </p>
    </Card>
  )
}
