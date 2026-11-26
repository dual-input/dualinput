// Adding the loaded aircraft, in Run's place: the aircraft by the path the core matches a profile on, what in the open
// profile covers it now and why an author would add more, and a choice of its preset or its whole folder, into the
// variant the author names (record/areas/profiles/07-adding-an-aircraft.md, "The island"). A choice whose path a variant
// already names is closed, so Add never writes a path twice.

import { Button, Card, cx, fadeMask, Input, NO_SCROLLBAR, RadioGroup, RadioGroupItem, useScroller } from "@dualinput/ui"
import { Check, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent, ReactNode } from "react"

import type { Syntax } from "../../src/syntax.ts"
import { Keys } from "./keys.tsx"
import type { AddView, PanelHost } from "./view.ts"

type What = "preset" | "folder"

const KEYS: [string, string][] = [
  ["↑↓", "choose"],
  ["Enter", "add"],
  ["Esc", "close"],
]

/** A variant ID as the checker takes one. `is_variant_id` in src/engines/profile-engine/src/check.rs holds the same rule, so change both together. */
const ID = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function Add({ add, syntax, host }: { add: AddView; syntax: Syntax; host: PanelHost }) {
  const open = (what: What) => (what === "preset" ? add.preset !== null && add.named.preset === null : add.named.folder === null)
  const choices = (["preset", "folder"] as const).filter(open)
  // The author's last pick, while it's open: a save that names its path closes it, and the pick moves to the other.
  const [chosen, setChosen] = useState<What | null>(null)
  const picked = chosen !== null && open(chosen) ? chosen : (choices[0] ?? null)
  // The field starts with the suggestion for the choice, and follows the choice until the author types in it.
  const [typed, setTyped] = useState<string | null>(null)
  const id = (typed ?? (picked === "folder" ? add.suggested.folder : add.suggested.preset)).trim()
  const joins = add.variants.includes(id)
  // A variant that covers the aircraft through its folder already covers its preset, so the preset gains it nothing.
  const already = picked === "preset" && add.cover?.by === "folder" && add.cover.variant === id
  const valid = ID.test(id)
  const ready = picked !== null && valid && !already
  const submit = () => {
    if (ready) host.add({ what: picked, id })
  }
  // A variant's ID and a path in the colors the profile's own text gives them, so the island and the file read as one.
  const colors = { variant: syntax.variant?.color, path: syntax.plain?.color }
  const variant = (name: string) => <Word color={colors.variant}>{name}</Word>
  const path = (text: string) => <Word color={colors.path}>{text}</Word>

  // It scrolls as our apps' pages do, with no scrollbar and a fade at an end that has more past it.
  const scroller = useScroller()
  // The picked choice takes the keys as the island opens, so Up and Down choose, Enter adds, and Escape closes with no
  // click first. It's the choice that takes them rather than the ID field, since focusing the field scrolls the island
  // down to it, past the aircraft's name.
  // With nothing to pick, the island itself takes them.
  const island = useRef<HTMLElement>(null)
  const group = useRef<HTMLDivElement>(null)
  const focus = (what: What) => group.current?.querySelector<HTMLElement>(`[data-choice="${what}"]`)?.focus({ preventScroll: true })
  useEffect(() => {
    if (picked) focus(picked)
    else island.current?.focus({ preventScroll: true })
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const at = picked === null ? -1 : choices.indexOf(picked)
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
    if (event.key === "Escape") host.leave()
    // In the field's form, Enter goes through its submit.
    else if (event.key === "Enter" && !(event.target as HTMLElement).closest("form")) submit()
    else if (step !== 0 && group.current?.contains(event.target as Node) && choices[at + step]) {
      setChosen(choices[at + step]!)
      focus(choices[at + step]!)
    } else return
    event.preventDefault()
  }

  return (
    // The choices scroll, and the variant's field and Add stay put under them.
    <section ref={island} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none" onKeyDown={onKeyDown}>
      <div
        ref={scroller.ref}
        onScroll={scroller.onScroll}
        onWheel={scroller.onWheel}
        onMouseDown={scroller.onMouseDown}
        style={fadeMask(scroller.above, scroller.below, 24, 24)}
        className={cx("min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3", NO_SCROLLBAR, scroller.cursor)}
      >
        {/* Its path shows under each choice, so the name stands alone here. */}
        <h2 className="text-base font-semibold leading-snug">{add.title}</h2>
        <Explained add={add} variant={variant} path={path} />
        {/* 16px above the choices, under the box or the name alike, reads as the 12px over the box does: the name's line
            leaves air under its letters, and a picked choice's ring reaches a pixel past its row. */}
        <RadioGroup ref={group} aria-label="What to add" className="mt-4 space-y-2">
          {add.preset !== null && (
            <Option
              what="preset"
              picked={picked === "preset"}
              closedBy={add.named.preset}
              label="This preset only"
              path={add.preset}
              why="This aircraft alone, for entries of its own, such as a lever only it has."
              colors={colors}
              onPick={() => setChosen("preset")}
            />
          )}
          <Option
            what="folder"
            picked={picked === "folder"}
            closedBy={add.named.folder}
            label={add.preset === null ? "Its folder" : "Its whole folder"}
            path={add.folder}
            why={add.preset === null ? "This aircraft, in each of its liveries." : "Every aircraft in the folder, for entries they all share."}
            colors={colors}
            onPick={() => setChosen("folder")}
          />
        </RadioGroup>
      </div>
      <div className="shrink-0 border-t border-border px-4 pb-2 pt-3">
        {/* A form, so Enter in the field adds through its submit. */}
        <form
          className="flex items-center"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          {/* At 13px, as Run's value field is and the picker's keys are, since a monospaced ID reads larger than the kit
              field's 14px words; a style, since the field's own class sets its size and two classes would win by the
              stylesheet's order. */}
          <Input aria-label="Variant" className="mr-2 min-w-0 flex-1 font-mono" style={{ fontSize: 13 }} placeholder="Variant" value={typed ?? id} onChange={(event) => setTyped(event.target.value)} />
          <Button type="submit" disabled={!ready}>
            <Plus />
            Add
          </Button>
        </form>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {picked === null ? (
            "The profile already names both."
          ) : id === "" ? (
            "Name the variant it goes in."
          ) : !valid ? (
            "An ID starts with a letter or _, then takes letters, digits, _, and -."
          ) : already ? (
            <>{variant(id)} already covers this aircraft, through its folder.</>
          ) : joins ? (
            <>Goes in {variant(id)}, beside the paths it has.</>
          ) : (
            <>Goes in a new variant, {variant(id)}.</>
          )}
        </p>
        <Keys keys={KEYS} />
      </div>
    </section>
  )
}

type Colored = (text: string) => ReactNode

/**
 * What already covers the aircraft, in one line: why an author would add its preset anyway is the choice's own line to
 * say, and an author needs telling only once. Nothing shows when nothing covers it, since the choices under it say all
 * there is.
 */
function Explained({ add, variant, path }: { add: AddView; variant: Colored; path: Colored }) {
  const { cover } = add
  if (!cover) return null
  return (
    <Card flush tint="bg-muted/40" className="mt-3">
      <div className="px-3 py-2.5 text-xs leading-5">
        {cover.by === "folder" ? (
          <p>
            The variant {variant(cover.variant)} already covers this aircraft through its folder {path(add.folder)}.
          </p>
        ) : (
          <p>The variant {variant(cover.variant)} already names this {add.preset === null ? "folder" : "preset"}.</p>
        )}
      </div>
    </Card>
  )
}

type Colors = { variant: string | undefined; path: string | undefined }

type OptionProps = { what: What; picked: boolean; closedBy: string | null; label: string; path: string; why: string; colors: Colors; onPick: () => void }

/**
 * One choice, the whole row its target. The picked row takes the keys, as a radio group's checked radio does. A path a
 * variant already names is no choice at all, so it shows a tick where the circle would be and says which variant holds
 * it, in place of why one would pick it.
 */
function Option({ what, picked, closedBy, label, path, why, colors, onPick }: OptionProps) {
  const closed = closedBy !== null
  return (
    <div
      data-choice={what}
      role="radio"
      aria-checked={picked}
      aria-disabled={closed || undefined}
      tabIndex={picked ? 0 : -1}
      onClick={() => !closed && onPick()}
      // The row's inset is the box's above it, so the circle starts where the box's words do, and the circle sits in the
      // middle of the label's 20px line.
      className={cx("flex cursor-default items-start rounded-xl px-3 py-2 outline-none", closed ? "opacity-60" : picked ? "bg-accent ring-1 ring-primary/60" : "hover:bg-muted/50")}
    >
      {closed ? <Check aria-hidden className="mr-2.5 mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <RadioGroupItem checked={picked} tabIndex={-1} aria-hidden className="pointer-events-none mr-2.5 mt-0.5" />}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-5">{label}</p>
        <p className="break-all font-mono text-[11px] leading-4" style={{ color: colors.path }}>
          {path}
        </p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {closed ? (
            <>
              In the profile already, as <Word color={colors.variant}>{closedBy}</Word>.
            </>
          ) : (
            why
          )}
        </p>
      </div>
    </div>
  )
}

/** A variant's ID or a path, in the color the profile's text gives it. */
function Word({ color, children }: { color: string | undefined; children: string }) {
  return (
    <span className="font-mono" style={{ color }}>
      {children}
    </span>
  )
}
