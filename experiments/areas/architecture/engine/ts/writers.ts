/*
 * 100 write functions of the shape a profile entry's write might take, for p04.
 * Every name here is hypothetical: Writer stands in for the writer of
 * record/areas/sync/01-profile-entries.md ("The writer API"), and no PROBE_
 * variable or event exists in the sim. Each function makes exactly one call into
 * the host, so 100 calls a frame are 100 crossings each way.
 */

/** Hypothetical: the writer's methods, each one a function of the host. */
export interface Writer {
  k(name: string, ...values: number[]): void
  l(name: string, value: number, unit: string): void
  b(name: string, value: number): void
  h(name: string): void
}

export function w000(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_000", v >= 50 ? 1 : 0, "bool")
}

export function w001(v: number, w: Writer): void {
  w.k("PROBE_AXIS_001_SET", Math.round(v * 327.67) - 16384)
}

export function w002(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_002", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w003(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_003_ON")
  else if (v < 40) w.k("PROBE_003_OFF")
  else w.h("H:PROBE_003_HOLD")
}

export function w004(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_004", Math.floor(v / 10) * 10)
}

export function w005(v: number, w: Writer): void {
  w.k("PROBE_HEADING_005_SET", (((v * 3.6 + 5) % 360) + 360) % 360, 2)
}

export function w006(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_006", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w007(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_007", v >= 50 ? 1 : 0, "bool")
}

export function w008(v: number, w: Writer): void {
  w.k("PROBE_AXIS_008_SET", Math.round(v * 327.67) - 16384)
}

export function w009(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_009", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w010(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_010_ON")
  else if (v < 40) w.k("PROBE_010_OFF")
  else w.h("H:PROBE_010_HOLD")
}

export function w011(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_011", Math.floor(v / 10) * 10)
}

export function w012(v: number, w: Writer): void {
  w.k("PROBE_HEADING_012_SET", (((v * 3.6 + 12) % 360) + 360) % 360, 1)
}

export function w013(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_013", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w014(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_014", v >= 50 ? 1 : 0, "bool")
}

export function w015(v: number, w: Writer): void {
  w.k("PROBE_AXIS_015_SET", Math.round(v * 327.67) - 16384)
}

export function w016(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_016", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w017(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_017_ON")
  else if (v < 40) w.k("PROBE_017_OFF")
  else w.h("H:PROBE_017_HOLD")
}

export function w018(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_018", Math.floor(v / 10) * 10)
}

export function w019(v: number, w: Writer): void {
  w.k("PROBE_HEADING_019_SET", (((v * 3.6 + 19) % 360) + 360) % 360, 4)
}

export function w020(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_020", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w021(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_021", v >= 50 ? 1 : 0, "bool")
}

export function w022(v: number, w: Writer): void {
  w.k("PROBE_AXIS_022_SET", Math.round(v * 327.67) - 16384)
}

export function w023(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_023", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w024(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_024_ON")
  else if (v < 40) w.k("PROBE_024_OFF")
  else w.h("H:PROBE_024_HOLD")
}

export function w025(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_025", Math.floor(v / 10) * 10)
}

export function w026(v: number, w: Writer): void {
  w.k("PROBE_HEADING_026_SET", (((v * 3.6 + 26) % 360) + 360) % 360, 3)
}

export function w027(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_027", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w028(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_028", v >= 50 ? 1 : 0, "bool")
}

export function w029(v: number, w: Writer): void {
  w.k("PROBE_AXIS_029_SET", Math.round(v * 327.67) - 16384)
}

export function w030(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_030", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w031(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_031_ON")
  else if (v < 40) w.k("PROBE_031_OFF")
  else w.h("H:PROBE_031_HOLD")
}

export function w032(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_032", Math.floor(v / 10) * 10)
}

export function w033(v: number, w: Writer): void {
  w.k("PROBE_HEADING_033_SET", (((v * 3.6 + 33) % 360) + 360) % 360, 2)
}

export function w034(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_034", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w035(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_035", v >= 50 ? 1 : 0, "bool")
}

export function w036(v: number, w: Writer): void {
  w.k("PROBE_AXIS_036_SET", Math.round(v * 327.67) - 16384)
}

export function w037(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_037", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w038(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_038_ON")
  else if (v < 40) w.k("PROBE_038_OFF")
  else w.h("H:PROBE_038_HOLD")
}

export function w039(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_039", Math.floor(v / 10) * 10)
}

export function w040(v: number, w: Writer): void {
  w.k("PROBE_HEADING_040_SET", (((v * 3.6 + 40) % 360) + 360) % 360, 1)
}

export function w041(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_041", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w042(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_042", v >= 50 ? 1 : 0, "bool")
}

export function w043(v: number, w: Writer): void {
  w.k("PROBE_AXIS_043_SET", Math.round(v * 327.67) - 16384)
}

export function w044(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_044", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w045(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_045_ON")
  else if (v < 40) w.k("PROBE_045_OFF")
  else w.h("H:PROBE_045_HOLD")
}

export function w046(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_046", Math.floor(v / 10) * 10)
}

export function w047(v: number, w: Writer): void {
  w.k("PROBE_HEADING_047_SET", (((v * 3.6 + 47) % 360) + 360) % 360, 4)
}

export function w048(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_048", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w049(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_049", v >= 50 ? 1 : 0, "bool")
}

export function w050(v: number, w: Writer): void {
  w.k("PROBE_AXIS_050_SET", Math.round(v * 327.67) - 16384)
}

export function w051(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_051", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w052(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_052_ON")
  else if (v < 40) w.k("PROBE_052_OFF")
  else w.h("H:PROBE_052_HOLD")
}

export function w053(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_053", Math.floor(v / 10) * 10)
}

export function w054(v: number, w: Writer): void {
  w.k("PROBE_HEADING_054_SET", (((v * 3.6 + 54) % 360) + 360) % 360, 3)
}

export function w055(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_055", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w056(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_056", v >= 50 ? 1 : 0, "bool")
}

export function w057(v: number, w: Writer): void {
  w.k("PROBE_AXIS_057_SET", Math.round(v * 327.67) - 16384)
}

export function w058(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_058", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w059(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_059_ON")
  else if (v < 40) w.k("PROBE_059_OFF")
  else w.h("H:PROBE_059_HOLD")
}

export function w060(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_060", Math.floor(v / 10) * 10)
}

export function w061(v: number, w: Writer): void {
  w.k("PROBE_HEADING_061_SET", (((v * 3.6 + 61) % 360) + 360) % 360, 2)
}

export function w062(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_062", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w063(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_063", v >= 50 ? 1 : 0, "bool")
}

export function w064(v: number, w: Writer): void {
  w.k("PROBE_AXIS_064_SET", Math.round(v * 327.67) - 16384)
}

export function w065(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_065", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w066(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_066_ON")
  else if (v < 40) w.k("PROBE_066_OFF")
  else w.h("H:PROBE_066_HOLD")
}

export function w067(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_067", Math.floor(v / 10) * 10)
}

export function w068(v: number, w: Writer): void {
  w.k("PROBE_HEADING_068_SET", (((v * 3.6 + 68) % 360) + 360) % 360, 1)
}

export function w069(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_069", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w070(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_070", v >= 50 ? 1 : 0, "bool")
}

export function w071(v: number, w: Writer): void {
  w.k("PROBE_AXIS_071_SET", Math.round(v * 327.67) - 16384)
}

export function w072(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_072", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w073(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_073_ON")
  else if (v < 40) w.k("PROBE_073_OFF")
  else w.h("H:PROBE_073_HOLD")
}

export function w074(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_074", Math.floor(v / 10) * 10)
}

export function w075(v: number, w: Writer): void {
  w.k("PROBE_HEADING_075_SET", (((v * 3.6 + 75) % 360) + 360) % 360, 4)
}

export function w076(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_076", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w077(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_077", v >= 50 ? 1 : 0, "bool")
}

export function w078(v: number, w: Writer): void {
  w.k("PROBE_AXIS_078_SET", Math.round(v * 327.67) - 16384)
}

export function w079(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_079", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w080(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_080_ON")
  else if (v < 40) w.k("PROBE_080_OFF")
  else w.h("H:PROBE_080_HOLD")
}

export function w081(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_081", Math.floor(v / 10) * 10)
}

export function w082(v: number, w: Writer): void {
  w.k("PROBE_HEADING_082_SET", (((v * 3.6 + 82) % 360) + 360) % 360, 3)
}

export function w083(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_083", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w084(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_084", v >= 50 ? 1 : 0, "bool")
}

export function w085(v: number, w: Writer): void {
  w.k("PROBE_AXIS_085_SET", Math.round(v * 327.67) - 16384)
}

export function w086(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_086", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w087(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_087_ON")
  else if (v < 40) w.k("PROBE_087_OFF")
  else w.h("H:PROBE_087_HOLD")
}

export function w088(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_088", Math.floor(v / 10) * 10)
}

export function w089(v: number, w: Writer): void {
  w.k("PROBE_HEADING_089_SET", (((v * 3.6 + 89) % 360) + 360) % 360, 2)
}

export function w090(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_090", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w091(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_091", v >= 50 ? 1 : 0, "bool")
}

export function w092(v: number, w: Writer): void {
  w.k("PROBE_AXIS_092_SET", Math.round(v * 327.67) - 16384)
}

export function w093(v: number, w: Writer): void {
  w.l("L:PROBE_PERCENT_093", Math.min(100, Math.max(0, v * 1.5 - 10)), "percent")
}

export function w094(v: number, w: Writer): void {
  if (v > 60) w.k("PROBE_094_ON")
  else if (v < 40) w.k("PROBE_094_OFF")
  else w.h("H:PROBE_094_HOLD")
}

export function w095(v: number, w: Writer): void {
  w.b("B:PROBE_KNOB_095", Math.floor(v / 10) * 10)
}

export function w096(v: number, w: Writer): void {
  w.k("PROBE_HEADING_096_SET", (((v * 3.6 + 96) % 360) + 360) % 360, 1)
}

export function w097(v: number, w: Writer): void {
  w.l("L:PROBE_MODE_097", v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3, "enum")
}

export function w098(v: number, w: Writer): void {
  w.l("L:PROBE_SWITCH_098", v >= 50 ? 1 : 0, "bool")
}

export function w099(v: number, w: Writer): void {
  w.k("PROBE_AXIS_099_SET", Math.round(v * 327.67) - 16384)
}
