// How the aircraft picker knows its pick: which tile it is, and when the sim has loaded it, so the tile says Loaded and
// the popup closes. A pick asks the world map for a folder of the tile's profile, so the picker watches for the loaded
// aircraft's folder rather than its names: a profile names its aircraft as its authors chose, while the sim names the
// loaded one from its `aircraft.cfg`, which may name a variant its own way or give a token of the sim's localization.

/** A tile's names, as the core's `profiles.pick` finds its profile by. */
type Named = { maker: string; model: string }

/**
 * Whether two tiles are the same aircraft. The core sends its slice again whenever it changes, as when a pick loads and
 * the loaded aircraft's status changes with it, and each copy is new, so a tile is known by its names.
 */
export function sameAircraft(a: Named, b: Named): boolean {
  return a.maker === b.maker && a.model === b.model
}

/**
 * Whether the loaded aircraft, by its path in the slice `sim`, such as `pa24-250/presets/a2a/pa24-250`, is in one of a
 * tile's folders. The path's first part is its folder, and the core gives both in lowercase. `Aircraft::folder` in
 * src/engines/messages/src/sim.rs reads a path the same way, so change both together.
 */
export function inFolders(path: string, folders: string[]): boolean {
  return folders.includes(path.split("/")[0]!)
}
