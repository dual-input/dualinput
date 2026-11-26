// The Dual Input panel, the extension's view in VS Code's secondary side bar: an island for the status line, one for Run
// on one entry, or the display picker or adding the loaded aircraft in its place, and the recorder's, drawn with the kit
// in the palette that matches VS Code's theme (record/areas/profiles/04-the-extension-in-the-sim.md, "The Dual Input
// panel"). It draws from a
// `PanelView` alone, so the extension wires it to `serve` by posting views and answering the host's calls.

import { Button, Card, cx, Root } from "@dualinput/ui"
import { Info, Plane, Play, SquareMousePointer, X } from "lucide-react"
import type { ReactNode } from "react"

import { Add } from "./add.tsx"
import { GAP, INSET, ISLAND } from "./island.ts"
import { Picker } from "./picker.tsx"
import { Recorder } from "./recorder.tsx"
import { Run } from "./run.tsx"
import { StatusLine } from "./status-line.tsx"
import type { PanelHost, PanelView } from "./view.ts"

export function Panel({ view, host }: { view: PanelView; host: PanelHost }) {
  const { status, body } = view
  const runs = status.kind === "in-flight" && status.runs
  // A tool's island opens with its name, in the words of the lens that opened it, and closes from its title. Its icon only
  // marks the island, so Add this aircraft takes a plane rather than its lens's add icon, which would read as a button
  // beside the close button.
  const leave = () => host.leave()
  const title =
    body.kind === "run" ? (
      <IslandTitle icon={<Play />} onClose={leave}>
        Run
      </IslandTitle>
    ) : body.kind === "picker" ? (
      <IslandTitle icon={<SquareMousePointer />} onClose={leave}>
        Pick displays
      </IslandTitle>
    ) : body.kind === "add" ? (
      <IslandTitle icon={<Plane />} onClose={leave}>
        Add this aircraft
      </IslandTitle>
    ) : null
  const tool =
    body.kind === "run" ? (
      // A new entry starts its value field afresh.
      <Run key={body.run.key} run={body.run} host={host} />
    ) : body.kind === "picker" ? (
      <Picker picker={body.picker} host={host} />
    ) : body.kind === "add" ? (
      // Another aircraft starts the choices afresh.
      <Add key={body.add.preset ?? body.add.folder} add={body.add} syntax={view.syntax} host={host} />
    ) : runs ? (
      <p className="px-4 py-4 text-xs leading-5 text-muted-foreground">
        Click <Lens icon={<Play />}>Run</Lens> above an entry to test its write, or <Lens icon={<SquareMousePointer />}>Pick displays</Lens> above <span className="font-mono">displays:</span> to select the panels Dual Input should sync.
      </p>
    ) : null
  return (
    // Each island keeps our own background, so our colors read the same in any theme, with rounded corners rather than
    // edge to edge, so the panel reads as windows onto our app instead of a block of another theme's color. Between them
    // shows whatever VS Code paints behind the view, the side bar's color or the bottom panel's, since VS Code's
    // stylesheet leaves a webview's body transparent (read in VS Code 1.147.0,
    // out/vs/workbench/contrib/webview/browser/pre/index.html, `_defaultStyles`) and webview.css paints nothing.
    <Root palette={view.palette} style={{ height: "100%" }}>
      {/* The same inset on every side and between the islands, VS Code's own, so they sit evenly inside its card, but
          none at the bottom: in VS Code 1.148 the side bar's webview stops about 5px above the card's inner edge, which
          makes the bottom's gap (measured in a screenshot of VS Code 1.148.0, 2026-11-26: 4px at the sides, 9px below
          with our inset; the rule behind it is unverified). */}
      <div className={cx("flex h-full flex-col pb-0", INSET)}>
        <div className={cx("shrink-0", ISLAND)}>
          <StatusLine status={status} />
        </div>
        {/* Run's island takes the height between the status island and the recorder's, where the picker's list and
            adding an aircraft scroll. With no tool open, as outside a flight, it stays empty, so the panel keeps its
            shape. */}
        <div className={cx("flex min-h-0 flex-1 flex-col overflow-hidden", GAP, ISLAND)}>
          {title}
          {runs && status.crew && view.unpinned && <Unpinned />}
          {tool}
        </div>
        <Recorder recorder={view.recorder} host={host} />
      </div>
    </Root>
  )
}

/**
 * An island's name, in the type of the status line's label. Unlike that label, which belongs with the line under it, it
 * names the whole island, so it keeps as much room below it as above. Its close button sits at its right, the same on
 * every tool island, and takes no more height than the name, so the island's first line stays where it was.
 */
function IslandTitle({ icon, children, onClose }: { icon: ReactNode; children: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center px-4 pt-3">
      <p className="flex min-w-0 flex-1 items-center whitespace-nowrap text-[10px] font-semibold uppercase leading-4 tracking-widest text-muted-foreground [&>svg]:mr-2 [&>svg]:size-3">
        {icon}
        {children}
      </p>
      <Button variant="ghost" size="icon-sm" aria-label="Close" className="-my-2 -mr-2 ml-2 text-muted-foreground" onClick={onClose}>
        <X className="size-3.5" />
      </Button>
    </div>
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
    <Card flush tint="bg-info/10 text-info" className="mx-4 mt-3 shrink-0">
      <p className="flex items-start px-3 py-2.5 text-xs">
        <Info className="mr-2.5 size-4 shrink-0" />
        <span>Unsaved edits run on this PC only. Your crew gets them when you save.</span>
      </p>
    </Card>
  )
}
