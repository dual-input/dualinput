// Dual Input's mark: two lines merging into one, two pilots' inputs flying one aircraft.

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M4 8.5C12 8.5 13.5 16 20.5 16M4 23.5C12 23.5 13.5 16 20.5 16H28" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" />
    </svg>
  )
}

/** The mark cut out of a sky tile, sized in em so the tile stands as tall as a capital letter beside it: Geist's capital D measured 0.75em tall. */
export function MarkTile() {
  return (
    <span className="relative inline-block shrink-0 rounded-[0.16em] bg-primary text-background" style={{ width: "0.75em", height: "0.75em" }}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden className="absolute inset-x-0 inset-y-0 m-auto" style={{ width: "0.5em", height: "0.5em" }}>
        <path d="M4 8.5C12 8.5 13.5 16 20.5 16M4 23.5C12 23.5 13.5 16 20.5 16H28" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" />
      </svg>
    </span>
  )
}
