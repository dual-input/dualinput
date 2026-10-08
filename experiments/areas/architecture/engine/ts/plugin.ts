/*
 * A plugin of the shape 03-v1-scope's plugins might take, for p04.
 * Every name here is hypothetical: no plugin interface exists yet, and the
 * RADAR_ values live only in the probe's host.
 */

/** Hypothetical: the functions the core would expose to a plugin. */
declare const host: {
  read(name: string): number
  write(name: string, value: number): void
}

/** Hypothetical: what a plugin hands the core. */
export interface Plugin {
  id: string
  exports(): Record<string, number>
  write: Record<string, (value: number) => void>
}

const RANGES_NM = [10, 20, 40, 80, 160, 320]

export const plugin: Plugin = {
  id: "probe.weather-radar",

  exports() {
    return {
      radar_range: RANGES_NM[host.read("RADAR_RANGE_INDEX")] ?? 0,
      radar_mode: host.read("RADAR_MODE"),
      radar_tilt: host.read("RADAR_TILT") / 10,
      radar_gain: host.read("RADAR_GAIN"),
    }
  },

  write: {
    // The radar has six ranges, so a range from the other pilot's display lands on the nearest.
    radar_range(nm: number): void {
      let best = 0
      for (let i = 1; i < RANGES_NM.length; i++) {
        if (Math.abs(RANGES_NM[i] - nm) < Math.abs(RANGES_NM[best] - nm)) best = i
      }
      host.write("RADAR_RANGE_INDEX", best)
    },

    // Tilt is stored in tenths of a degree, within the radar's 15 degrees up or down.
    radar_tilt(deg: number): void {
      host.write("RADAR_TILT", Math.round(Math.min(15, Math.max(-15, deg)) * 10))
    },
  },
}
