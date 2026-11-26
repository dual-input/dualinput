// The keys a tool island takes, under its buttons, as the display picker and adding an aircraft list them.

import { Kbd } from "@dualinput/ui"

/** Each key and what it does, as `["Esc", "close"]`, in a row that wraps at a narrow side bar. */
export function Keys({ keys }: { keys: [key: string, does: string][] }) {
  return (
    <div className="mt-2.5 flex flex-wrap text-[11px] text-muted-foreground">
      {keys.map(([key, does]) => (
        <span key={key} className="mb-1 mr-2 flex items-center whitespace-nowrap last:mr-0">
          <Kbd size="sm" className="mr-1">
            {key}
          </Kbd>
          {does}
        </span>
      ))}
    </div>
  )
}
