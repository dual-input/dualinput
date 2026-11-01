import { createContext, useContext, useState } from "react"
import type { CSSProperties, HTMLAttributes, MouseEvent as ReactMouseEvent } from "react"

import { cx } from "./cx.ts"
import { ROOT_CLASS } from "./root-class.ts"

type RootValue = { element: HTMLElement | null; scale: number }

const RootContext = createContext<RootValue>({ element: null, scale: 1 })

/** The kit's root around this component: the element popups render into, and its scale. */
export function useRoot(): RootValue {
  return useContext(RootContext)
}

/**
 * Where a mouse event fell, in the kit root's own units. Layout and every rect inside a scaled root
 * read in its units, and only a mouse event's position reads in the window's pixels.
 */
export function mouseIn(event: MouseEvent | ReactMouseEvent, scale: number): { x: number; y: number } {
  return { x: event.clientX / scale, y: event.clientY / scale }
}

/**
 * Everything of the kit draws inside one of these. `scale` fits the page to its view with the zoom
 * property, since a transform blurs text in Coherent GT and sizes written through calc() would have
 * to reach every number in our code (record/areas/interface/log.md, p24). `--hair` is the length of
 * one real pixel at that scale, for lines that must neither vanish nor blur.
 */
export function Root({ scale = 1, className, style, children, ...rest }: HTMLAttributes<HTMLDivElement> & { scale?: number }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setElement} className={cx(ROOT_CLASS, className)} style={{ ...style, zoom: scale, "--hair": `${1 / scale}px` } as CSSProperties} {...rest}>
      <RootContext.Provider value={{ element, scale }}>{children}</RootContext.Provider>
    </div>
  )
}
