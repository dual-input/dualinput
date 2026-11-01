/*
 * The page for FSComponent: the same DOM as app-vdom.tsx, written as our kit would have to write it.
 * The SDK has no conditional rendering and no keyed list, so this holds the small layer we'd own: rows
 * kept by hand with their subjects, a part rendered and destroyed by hand, and a room that's told when
 * to measure, since there's no render to measure after and Coherent GT has no ResizeObserver.
 */

import { DisplayComponent, FSComponent, Subject, type VNode } from "@microsoft/msfs-sdk"

import { chipClass, PART_ROWS, ROW_CLASS, run, SECTION_ROWS, SECTIONS, type Level, type RowData } from "./harness"

class Row extends DisplayComponent<{ name: string; level: Subject<Level> }> {
  render(): VNode {
    return (
      <li data-p23="row" class={ROW_CLASS}>
        <span>{this.props.name}</span>
        <span class={this.props.level.map(chipClass)}>{this.props.level}</span>
      </li>
    )
  }
}

type Kept = { node: VNode; el: HTMLElement; level: Subject<Level> }

const list = FSComponent.createRef<HTMLUListElement>()
const partHost = FSComponent.createRef<HTMLDivElement>()
const room = FSComponent.createRef<HTMLDivElement>()
const roomInner = FSComponent.createRef<HTMLDivElement>()
const pressButton = FSComponent.createRef<HTMLButtonElement>()
const field = FSComponent.createRef<HTMLInputElement>()
const presses = Subject.create(0)
const text = Subject.create("")
const pressedLabel = presses.map((n) => `Pressed ${n} ${n === 1 ? "time" : "times"}`)

let rows: Kept[] = []
let part: { node: VNode; el: HTMLElement } | null = null

function removeRow(row: Kept) {
  FSComponent.remove(row.el)
  FSComponent.shallowDestroy(row.node)
}

const app = (
  <div class="mx-auto max-w-md space-y-4 p-4 font-sans text-foreground">
    <div class="space-y-3 rounded-lg border border-border bg-card p-4">
      <button data-p23="press" ref={pressButton} class="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium bg-primary text-primary-foreground">Press</button>
      <span data-p23="pressed" class="text-sm text-muted-foreground">{pressedLabel}</span>
      <input data-p23="field" ref={field} class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground" />
      <span data-p23="mirror" class="font-mono">{text}</span>
    </div>
    <div data-p23="room" ref={room} style="height: 0px; overflow: hidden; transition: height 220ms ease-in-out">
      <div data-p23="room-inner" ref={roomInner} class="p-4 text-sm">The room's content</div>
    </div>
    <div class="rounded-lg border border-border bg-card p-4">
      {SECTIONS.map((s) => (
        <div class="space-y-3">
          <span class="text-sm text-muted-foreground">Section {s}</span>
          {SECTION_ROWS.map(() => (
            <div class={ROW_CLASS}>
              <span>Name</span>
              <span>Where</span>
              <span class={chipClass("info")}>Ready</span>
            </div>
          ))}
        </div>
      ))}
      <div ref={partHost} />
    </div>
    <ul data-p23="list" ref={list} />
  </div>
)

run({
  name: "fscomponent",
  mount(root) {
    FSComponent.render(app, root)
    pressButton.instance.addEventListener("click", () => presses.set(presses.get() + 1))
    field.instance.addEventListener("input", () => text.set(field.instance.value))
    text.sub((v) => { if (field.instance.value !== v) field.instance.value = v })
  },
  create(data: RowData[]) {
    rows.forEach(removeRow)
    rows = data.map((row) => {
      const level = Subject.create(row.level)
      const node = <Row name={row.name} level={level} />
      FSComponent.render(node, list.instance)
      return { node, el: list.instance.lastElementChild as HTMLElement, level }
    })
  },
  updateOne: (index, level) => rows[index].level.set(level),
  updateAll: (levelAt) => rows.forEach((row, i) => row.level.set(levelAt(i))),
  reverse() {
    rows.reverse()
    rows.forEach((row) => list.instance.appendChild(row.el))
  },
  clear() {
    rows.forEach(removeRow)
    rows = []
  },
  togglePart(on) {
    if (on && !part) {
      const node = (
        <div data-p23="part" class="space-y-3">
          {PART_ROWS.map(() => (
            <div class={ROW_CLASS}>
              <span>Name</span>
              <span>Where</span>
              <span class={chipClass("warning")}>Part</span>
            </div>
          ))}
        </div>
      )
      FSComponent.render(node, partHost.instance)
      part = { node, el: partHost.instance.lastElementChild as HTMLElement }
    } else if (!on && part) {
      FSComponent.remove(part.el)
      FSComponent.shallowDestroy(part.node)
      part = null
    }
  },
  setRoom(open) {
    room.instance.style.height = open ? `${roomInner.instance.offsetHeight}px` : "0px"
  },
})
