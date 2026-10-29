// A button for an action that's hard to take back, such as restarting the sim, which asks first in
// the kit's popover: the question, and the action's own button at the far end. A press outside it
// or Escape cancels. The popover opens above the button, or below where there's no room above,
// pointing at it, so the press that opened it stays on the button, and a second one there, from a
// double click or a VR controller's trigger jolting as it's pulled, shuts it rather than
// confirming. The popover itself takes the focus, so Enter can't confirm either.
import { useRef, useState } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { useUI } from "@/bench/ui"

export function ConfirmButton({ label, question, go, onConfirm, className }: { label: string; question: string; go: string; onConfirm: () => void; className?: string }) {
  const { Button, Popover, PopoverTrigger, PopoverContent, PopoverTitle } = useUI()
  const [open, setOpen] = useState(false)
  const popup = useRef<HTMLDivElement>(null)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* While it asks, the button that opened it softens to the kit's tinted red, so the solid red
          is the action's own button alone; Base UI marks an open popover's trigger
          data-popup-open. */}
      <PopoverTrigger render={<Button className={className + " data-popup-open:bg-destructive/20 data-popup-open:text-destructive data-popup-open:hover:bg-destructive/20"} />}>{label}</PopoverTrigger>
      <PopoverContent
        ref={popup}
        initialFocus={popup}
        side="top"
        align="start"
        sideOffset={11}
        // Its edge is a border, inside it, where the kit's ring draws outside and reads as a light
        // halo over the box under it. Its corners run parallel to the button's: the kit's button
        // radius, rounded-4xl, plus the 1px border and 12px of padding around the button.
        className="w-auto flex-row items-center gap-4 rounded-[calc(var(--radius)*2.6+13px)] border border-foreground/10 py-3 pr-3 pl-5 ring-0"
      >
        {/* The kit's tooltip arrow, in the popover's colors, its two edges outside the popover
            bordered as the popover is, so one line runs around both. A transform rather than the
            rotate and translate properties, which Coherent GT lacks
            (record/areas/architecture/coherent-gt.md). */}
        <PopoverPrimitive.Arrow className="size-3.5 rounded-[3px] border-foreground/10 bg-popover data-[side=bottom]:top-0 data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=bottom]:[transform:translateY(-50%)_rotate(45deg)] data-[side=top]:bottom-0 data-[side=top]:border-r data-[side=top]:border-b data-[side=top]:[transform:translateY(50%)_rotate(45deg)]" />
        <PopoverTitle className="text-sm">{question}</PopoverTitle>
        <Button
          className={className}
          onClick={() => {
            setOpen(false)
            onConfirm()
          }}
        >
          {go}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
