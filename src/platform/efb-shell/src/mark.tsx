// Dual Input's mark: two lines merging into one, two pilots' inputs flying one aircraft.

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M4 8.5C12 8.5 13.5 16 20.5 16M4 23.5C12 23.5 13.5 16 20.5 16H28" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" />
    </svg>
  )
}
