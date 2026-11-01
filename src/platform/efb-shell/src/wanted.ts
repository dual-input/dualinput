// What the screens read that the core's slices don't carry yet: a core with none of it leaves it undefined, and the
// screens leave out what it says, while the dev loop's stand-in core feeds it. TODO: when `recording` carries this field,
// read it there and take this file out.

export type Wanted = {
  /** For `recording`: why the run in progress stopped, if it has. */
  recordingStopped?: "no-space" | "failed-write"
}

export const WANTED = "wanted"