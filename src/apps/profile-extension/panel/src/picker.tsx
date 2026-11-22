// The display picker, in Run's place: a row for each of the cockpit's panels, from their `hello`s, ticked for those
// already in `displays`, with the row you're on outlined in the sim, which is how you tell which panel a key names
// (record/areas/profiles/04-the-extension-in-the-sim.md, "The display picker"). The keys and the mouse reach the same
// rows: Up and Down move, Space ticks, Enter syncs, Escape leaves, and a click moves to a row and ticks it.

import { Button, Checkbox, cx, fadeMask, Kbd, NO_SCROLLBAR, Tooltip, useScroller } from "@dualinput/ui"
import { useEffect } from "react"
import type { KeyboardEvent } from "react"

import { TOOLTIP_DELAY } from "./run.tsx"
import type { DisplayRow, PanelHost, PickerView } from "./view.ts"

const REASONS: Record<NonNullable<DisplayRow["refused"]>, string> = { "wasm-instrument": "Can't sync" }

const KEYS = [
  ["↑↓", "move"],
  ["Space", "tick"],
  ["Enter", "sync"],
  ["Esc", "leave"],
]

export function Picker({ picker, host }: { picker: PickerView; host: PanelHost }) {
  // The list scrolls as our apps' lists do, with no scrollbar and a fade at an end that has more past it.
  const scroller = useScroller()
  const list = scroller.ref
  const rows = picker.groups.flatMap((group) => (group.kind === "single" ? [group.row] : group.rows))
  // The rows and headings in the order Up and Down walk them.
  const stops = picker.groups.flatMap((group) => (group.kind === "single" ? [group.row.key] : [group.identifier, ...group.rows.map((row) => row.key)]))
  const tickable = (stop: string) => !rows.some((row) => row.key === stop && row.refused)
  const ticked = rows.filter((row) => row.ticked).length

  // The keys move the rows from the moment the picker opens, with no click on the list first.
  useEffect(() => list.current?.focus(), [])
  useEffect(() => {
    list.current?.querySelector(`[data-stop="${CSS.escape(picker.active)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [picker.active])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = stops.indexOf(picker.active)
    if (event.key === "ArrowDown") host.move(stops[Math.min(at + 1, stops.length - 1)]!)
    else if (event.key === "ArrowUp") host.move(stops[Math.max(at - 1, 0)]!)
    else if (event.key === " " && tickable(picker.active)) host.tick(picker.active)
    else if (event.key === "Enter") host.write()
    else if (event.key === "Escape") host.leave()
    else return
    event.preventDefault()
  }

  const stop = (id: string, refused: boolean) => ({
    active: picker.active === id,
    // Hovering a row outlines its display in the sim, as moving to it with the keys does, so the mouse walks the cockpit too.
    onHover: () => {
      if (picker.active !== id) host.move(id)
    },
    onPress: () => {
      host.move(id)
      if (!refused) host.tick(id)
    },
  })

  return (
    // The heading and the buttons stay put, and the list scrolls between them.
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-2 pt-4">
        <h2 className="text-base font-semibold leading-snug">Displays</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Select the panels Dual Input should sync.</p>
      </div>
      <div
        ref={list}
        role="listbox"
        aria-multiselectable
        tabIndex={0}
        aria-label="The cockpit's panels"
        onKeyDown={onKeyDown}
        onScroll={scroller.onScroll}
        onWheel={scroller.onWheel}
        onMouseDown={scroller.onMouseDown}
        style={fadeMask(scroller.above, scroller.below, 24, 24)}
        className={cx("min-h-0 flex-1 overflow-y-auto px-2 pb-2 outline-none", NO_SCROLLBAR, scroller.cursor)}
      >
        {picker.groups.map((group) => {
          if (group.kind === "single") {
            const { row } = group
            return <Row key={row.key} id={row.key} checked={row.ticked} row={row} {...stop(row.key, !!row.refused)} />
          }
          const open = group.rows.filter((row) => !row.refused)
          const all = open.length > 0 && open.every((row) => row.ticked)
          const some = open.some((row) => row.ticked)
          return (
            <div key={group.identifier} role="group" aria-label={group.identifier}>
              <Row id={group.identifier} checked={all ? true : some ? "mixed" : false} label={group.identifier} meta={`${group.rows.length} instruments`} {...stop(group.identifier, open.length === 0)} />
              {group.rows.map((row) => (
                <Row key={row.key} id={row.key} indent checked={row.ticked} row={row} {...stop(row.key, !!row.refused)} />
              ))}
            </div>
          )
        })}
      </div>
      <div className="shrink-0 border-t border-border px-4 pb-2 pt-3">
        <div className="flex items-center">
          <Button size="sm" onClick={() => host.write()}>
            {`Sync ${ticked} ${ticked === 1 ? "display" : "displays"}`}
          </Button>
          <Button size="sm" variant="ghost" className="ml-1 text-muted-foreground" onClick={() => host.leave()}>
            Leave
          </Button>
        </div>
        <div className="mt-2.5 flex flex-wrap text-[11px] text-muted-foreground">
          {KEYS.map(([key, does]) => (
            <span key={key} className="mb-1 mr-2 flex items-center whitespace-nowrap last:mr-0">
              <Kbd size="sm" className="mr-1">
                {key}
              </Kbd>
              {does}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

type RowProps = {
  id: string
  checked: boolean | "mixed"
  /** The display the row writes, or none for a heading, which `label` and `meta` name instead. */
  row?: DisplayRow
  label?: string
  meta?: string
  indent?: boolean
  active: boolean
  onHover: () => void
  onPress: () => void
}

/**
 * The whole row is the target, so its checkbox takes no press of its own. A row that can't be ticked stays an ordinary
 * row, muted, with its key cut to one line, since a WASM instrument's runs past 70 characters, and whole on a hover.
 */
function Row({ id, checked, row, label = row?.key ?? "", meta, indent, active, onHover, onPress }: RowProps) {
  const refused = row?.refused ?? null
  const trailing = refused ? REASONS[refused] : (meta ?? (row && row.panels > 1 ? `${row.panels} panels` : null))
  const line = (
    <div
      data-stop={id}
      role="option"
      aria-selected={checked === true}
      aria-disabled={refused ? true : undefined}
      onMouseEnter={onHover}
      onClick={onPress}
      className={cx("flex cursor-default items-center rounded-xl py-1.5 pr-2", indent ? "pl-8" : "pl-2", active ? "bg-accent ring-1 ring-primary/60" : "hover:bg-muted/50", refused && "text-muted-foreground")}
    >
      <Checkbox checked={checked} disabled={!!refused} tabIndex={-1} aria-hidden className="pointer-events-none mr-2.5" />
      <span className={cx("min-w-0 flex-1 font-mono text-[13px] leading-5", refused ? "truncate" : "break-words")}>{refused ? row!.fullKey : label}</span>
      {trailing && <span className="ml-2 shrink-0 whitespace-nowrap text-xs text-muted-foreground">{trailing}</span>}
    </div>
  )
  if (!refused) return line
  return (
    <Tooltip content={<span className="break-all font-mono">{row!.fullKey}</span>} delay={TOOLTIP_DELAY}>
      {line}
    </Tooltip>
  )
}
