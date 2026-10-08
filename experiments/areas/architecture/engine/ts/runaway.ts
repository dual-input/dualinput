/*
 * Scripts that break an engine's limits on purpose, for p04.
 */

// Keeps another 1,024-element array on each pass, until the engine stops it.
export function allocForever(): number {
  const hold: number[][] = []
  for (;;) hold.push(new Array(1024).fill(hold.length))
}

export function loopForever(): number {
  let i = 0
  for (;;) i = (i + 1) | 0
}

// Keeps `mb` buffers of 1 MB each. Filling each one commits its pages, so the
// process's private bytes grow by what the script holds.
export function allocBuffers(mb: number): number {
  const hold: Uint8Array[] = []
  for (let i = 0; i < mb; i++) hold.push(new Uint8Array(1 << 20).fill(1))
  return hold.length
}

export function recurseForever(n: number): number {
  return recurseForever(n + 1) + 1
}
