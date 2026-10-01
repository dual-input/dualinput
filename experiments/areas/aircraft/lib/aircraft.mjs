/*
 * The 11 aircraft the harness runs, one entry each, keyed by the folder name of
 * the aircraft's study under record/areas/aircraft/.
 *
 * Each entry's title and livery are what its flight files load, copied from the
 * package on disk, as each study's Identity section says where to look. Where
 * the package's aircraft.cfg is encrypted, the title is the one the sim lists
 * for the package in a live session (SimConnect_EnumerateSimObjectsAndLiveries).
 *
 * The persistent files are what the runner backs up before loading the
 * aircraft and restores afterwards:
 *   - the aircraft's WASM work folder,
 *     %APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\<package>\work;
 *   - the sim's own folder for the aircraft,
 *     %APPDATA%\Microsoft Flight Simulator 2024\SimObjects\Airplanes\<folder>,
 *     where the sim writes state.CFG (engine hours, and the [LocalVars] an
 *     aircraft persists, such as Black Square's) when a flight ends: the
 *     PA-24's and the Fenix's were rewritten by our FlightLoad probe's run at
 *     19:30 on 2026-10-01 (listed 2026-10-01);
 *   - files outside the sim the aircraft's own programs write (the Fenix).
 *
 *   title        [Sim.0] Sim, byte for byte; null until a live session lists it
 *   match        how a live session finds the title in the sim's list
 *   livery       [Sim.0] Livery: the livery folder's name; null for an aircraft
 *                built the MSFS 2020 way, whose title already names its livery
 *   tail         [Sim.0] TailNumber, the livery's atc_id, or null
 *   packages     packages holding the aircraft and its livery, for the dry run
 *   folders      aircraft folders under SimObjects\Airplanes
 *   work         packages whose WASM work folder is backed up
 *   files        other persistent files, [{ label, path }]
 *   settleL      the aircraft's own values to watch while it settles
 *   ready        readiness marks the settle wait also needs
 *   identityL    L: variables the identity probe reads
 *   radios       the aircraft's own radio values, beside the stock ones, by
 *                comStandby, comActive, navActive, and xpdr
 *   phaseLocalVars  copy [LocalVars.0] from the package's own phase flight file
 */

import { join } from "node:path"

import { simDir } from "./flights.mjs"

const PROGRAMDATA = process.env.ProgramData ?? process.env.PROGRAMDATA ?? "C:\\ProgramData"

export const wasmWork = (pkg) => join(simDir(), "WASM", "MSFS2024", pkg, "work")
export const userSimObject = (folder) => join(simDir(), "SimObjects", "Airplanes", folder)

// A2A's Accu-Sim sets L:DATLoaded or L:DatNotFound once it's ready: the tablet
// shows an error while neither is set (read in a2a-aircraft-pa24 2.1.3,
// A2ATabletAppComanche250.js, NotificationsDataPublisher), and L:DATLoaded went to 1 about 7s after each load (measured on MSFS 2024, 2026-10-01, experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-18-20-15.txt).
const A2A_READY = {
  label: "L:DATLoaded or L:DatNotFound at 1",
  vars: ["L:DATLoaded", "L:DatNotFound"],
  test: (v) => v["L:DATLoaded"] === 1 || v["L:DatNotFound"] === 1,
}

// Black Square's XML sets L:var_startupComplete about 3 to 4s after load
// (record/areas/aircraft/black-square-baron-pro/study.md, Persistence).
const BKSQ_READY = {
  label: "L:var_startupComplete at 1",
  vars: ["L:var_startupComplete"],
  test: (v) => v["L:var_startupComplete"] === 1,
}

export const AIRCRAFT = {
  "a2a-pa24-comanche": {
    name: "A2A PA-24 Comanche 250",
    title: "A2A Piper PA-24-250 Comanche",
    livery: "N8351P",
    tail: "N8351P",
    packages: ["a2a-aircraft-pa24"],
    folders: ["pa24-250"],
    work: ["a2a-aircraft-pa24"],
    files: [],
    settleL: ["L:DATLoaded", "L:DatNotFound", "L:FlightPhase", "L:Battery1Switch"],
    ready: [A2A_READY],
    identityL: ["L:AircraftID", "L:Mark", "L:AvionicsConfiguration", "L:RNAV", "L:G5", "L:CockpitPersistence", "L:OptionSaveStatePerLivery"],
    radios: {},
  },

  "a2a-aerostar-600": {
    name: "A2A Aerostar 600",
    title: "A2A Piper Aerostar 600",
    // NI22PC already has an airframe file in the work folder, so a run wears a
    // backed-up airframe rather than creating one the restore would leave behind.
    livery: "NI22PC",
    tail: "N122PC",
    packages: ["a2a-aircraft-aerostar600"],
    folders: ["aerostar600"],
    work: ["a2a-aircraft-aerostar600"],
    files: [],
    settleL: ["L:DATLoaded", "L:DatNotFound", "L:FlightPhase", "L:Accusim2Loaded", "L:ModelCode1Loaded", "L:ModelCode2Loaded", "L:FlightOn"],
    ready: [A2A_READY],
    identityL: ["L:AircraftID", "L:CockpitPersistence", "L:OptionSaveStatePerLivery"],
    radios: {},
  },

  "black-square-baron-pro": {
    name: "Black Square Baron Pro, piston",
    title: "Black Square Baron 58 Professional N972HJ",
    livery: null,
    tail: "N972HJ",
    packages: ["bksq-aircraft-baronpro"],
    folders: ["bksq-aircraft-baronpro", "bksq-aircraft-baronproturbo", "bksq-aircraft-baronpropress"],
    work: [],
    files: [],
    settleL: ["L:var_startupComplete", "L:var_radio1Mode", "L:bksq_controlLocks"],
    ready: [BKSQ_READY],
    identityL: ["L:BKSQ_Turbocharged", "L:BKSQ_Pressurized", "L:BKSQ_Winglets", "L:BKSQ_TurbochargerExcessFuelBurn", "L:var_radio1Mode"],
    radios: {},
  },

  "black-square-bonanza-pro": {
    name: "Black Square Bonanza Pro, piston",
    title: "Black Square A36 Bonanza Professional N6TQ",
    livery: null,
    tail: "N6TQ",
    packages: ["bksq-aircraft-bonanzapro"],
    folders: ["bksq-aircraft-bonanzapro", "bksq-aircraft-bonanzaproturbo", "bksq-aircraft-bonanzaproturbine"],
    work: [],
    files: [],
    settleL: ["L:var_startupComplete", "L:var_radio1Mode", "L:bksq_controlLocks"],
    ready: [BKSQ_READY],
    identityL: ["L:BKSQ_Turbocharged", "L:BKSQ_TipTanks", "L:BKSQ_TurbochargerExcessFuelBurn", "L:var_radio1Mode"],
    radios: {},
  },

  "fenix-a320-family": {
    name: "Fenix A320, CFM, sharklets",
    title: "FenixA320 CFM SL",
    livery: "pgt-tc-dci-248f",
    tail: "TC-DCI",
    packages: ["fnx-aircraft-320", "fnx-aircraft-320-liveries"],
    folders: ["FNX_32X"],
    work: ["fnx-aircraft-320"],
    // The programs' settings and state; not `user` or `user_key`, which hold
    // the account, and not the logs.
    files: ["fenixConfig.xml", "persistancy.xml", "cockpitsetup.xml", "calibration.xml"].map((f) => (
      { label: `Fenix ${f}`, path: join(PROGRAMDATA, "Fenix", "FenixSim A320", f) })),
    settleL: ["L:Panel_state", "L:FNX_FLT_LOADED", "L:S_OH_ELEC_BAT1", "L:I_OH_ELEC_BAT1_L", "L:S_MIP_PARKING_BRAKE"],
    // The settle wait also waits for this 4-byte client data area to read 1,
    // which it did 7.4s after one load (measured on MSFS 2024, 2026-10-01,
    // experiments/areas/aircraft/results/run-fenix-a320-family-2026-10-01-18-29-25.txt);
    // what sets it, and when, is unverified.
    ready: [{
      label: "client data Fenix:Ready at 1",
      clientData: { name: "Fenix:Ready", size: 4 },
      test: (b) => b.length >= 4 && (b.readInt32LE(0) === 1 || b.readFloatLE(0) === 1),
    }],
    identityL: ["L:Panel_state", "L:FNX_FLT_LOADED"],
    radios: {},
    // The Fenix's own phase files set L:Panel_state 1 (read in fnx-aircraft-320
    // 2.4.0.4720, SimObjects\Airplanes\FNX_32X\common\flt\*.flt), and Fenix:Ready may wait on it (unverified),
    // so its flight files carry the phase file's [LocalVars.0] in case the sim
    // doesn't apply the phase file itself.
    phaseLocalVars: { pkg: "fnx-aircraft-320", dir: ["SimObjects", "Airplanes", "FNX_32X", "common", "flt"] },
  },

  "fsreborn-phenom-300e": {
    name: "FSReborn Phenom 300E",
    // The package's aircraft.cfg files are encrypted
    // (record/areas/aircraft/fsreborn-phenom-300e/study.md, Identity), so the
    // title is the sim's: it listed 8 Phenom 300E titles, among them this one,
    // the Pro flight model the manual's figures are for (measured on MSFS 2024,
    // 2026-10-01, SimConnect_EnumerateSimObjectsAndLiveries, in
    // experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-17-59-48.ndjson).
    title: "FSReborn Phenom 300E PRO Tristan Interior",
    livery: "fsreborn_official",
    tail: null,
    packages: ["fsreborn-aircraft-phenom300e"],
    folders: ["fsreborn_phenom300e"],
    work: ["fsreborn-aircraft-phenom300e"],
    files: [],
    settleL: ["L:FSR_300E_WASM_Started", "L:FSR_300E_BATTERY_1_SWITCH_ON", "L:FSR_300E_VERSION"],
    ready: [],
    identityL: ["L:FSR_300E_VERSION", "L:FSR_300E_WASM_Started"],
    radios: {},
  },

  "inibuilds-a350": {
    name: "iniBuilds A350-900",
    title: "A350-900 (Default Cabin)",
    livery: "A359_Emirates_EXA",
    tail: null,
    packages: ["inibuilds-aircraft-a350", "inibuilds-aircraft-a350-900-uae-exa"],
    folders: ["A350"],
    work: ["inibuilds-aircraft-a350"],
    files: [],
    settleL: ["L:INI_IS_FIRST_LOAD", "L:INI_PANELSTATE_LOADING_TIMER", "L:INI_LOAD_ON_GPU", "L:INI_LOAD_READY_FOR_TAKEOFF", "L:INI_REQ_APU_PANELSTATE"],
    ready: [],
    identityL: ["L:INI_IS_FIRST_LOAD"],
    radios: {
      comActive: ["L:INI_VHF1_ACTIVE_FREQ"],
      comStandby: ["L:INI_VHF1_STANDBY_FREQ"],
      navActive: ["L:INI_VOR1_FREQUENCY"],
    },
  },

  "inibuilds-a380": {
    name: "iniBuilds A380, Rolls-Royce",
    // The package's aircraft.cfg files are encrypted
    // (record/areas/aircraft/inibuilds-a380/study.md, Identity), so the title
    // is the sim's: it listed A380-800 RR Cabin, RR Basic, EA Cabin, and EA
    // Basic (measured on MSFS 2024, 2026-10-01, in
    // experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-17-59-48.ndjson).
    // The livery is a Rolls-Royce one.
    title: "A380-800 RR Cabin",
    livery: "Emirates Old A6-EVN",
    tail: null,
    packages: ["inibuilds-aircraft-a380", "inibuilds-aircraft-a380-800-uae-evn"],
    folders: ["inibuilds-a380"],
    work: ["inibuilds-aircraft-a380"],
    files: [],
    settleL: ["L:INI_AUTOSAVE_LOADING", "L:INI_EFB_IS_loading", "L:INI_PANELSTATE_LOADING_TIMER", "L:INI_CABIN_IS_READY", "L:FMGS1_LOADING_SUBSYSTEM"],
    ready: [],
    identityL: [],
    radios: { navActive: ["L:INI_VOR1_FREQUENCY"] },
  },

  "inibuilds-l1011": {
    name: "iniBuilds L-1011-500",
    title: "L1011-500 Standard Cabin",
    livery: "iniBuilds House",
    tail: null,
    packages: ["inibuilds-aircraft-l1011"],
    folders: ["inibuilds-l1011"],
    work: ["inibuilds-aircraft-l1011"],
    files: [],
    settleL: ["L:RELOAD", "L:IS_CRUISE", "L:INI_INIT", "L:TRANPONDER_SET_FLAG"],
    ready: [],
    identityL: [],
    // L1011_RADIO.js mirrors the stock COM frequencies into these every 1,000ms
    // (read in the deobfuscated copies, not in the study; unverified).
    radios: {
      comActive: ["L:COM_RADIO_SET_HZ"],
      comStandby: ["L:COM_STBY_RADIO_SET_HZ"],
      navActive: ["L:DRUM_1_NAV_1", "L:DRUM_2_NAV_1", "L:DRUM_3_NAV_1", "L:DRUM_4_NAV_1", "L:DRUM_5_NAV_1"],
      xpdr: ["L:TRANPONDER_SET_FLAG"],
    },
  },

  "pmdg-777-300er": {
    name: "PMDG 777-300ER",
    title: "777-300ER",
    // B-KQU already has an options file in the work folder, Aircraft\B-KQU.ini
    // (listed 2026-09-29), so the aircraft likely finds its registration there
    // (unverified).
    livery: "cathay_pacific_bkqu_or_2020",
    tail: "B-KQU",
    packages: ["pmdg-aircraft-77w", "pmdg-aircraft-77w-liveries"],
    folders: ["PMDG 777-300ER"],
    work: ["pmdg-aircraft-77w"],
    files: [],
    settleL: ["L:FLT_File_Loaded"],
    ready: [],
    identityL: ["L:FLT_File_Loaded"],
    radios: {},
  },

  "synaptic-a220": {
    name: "Synaptic A220-300",
    title: "A220-300",
    livery: "A_BCS3_SYN_HOUSE",
    tail: "C-FFCO",
    packages: ["synaptic-aircraft-a220"],
    folders: ["Synaptic_A220"],
    work: ["synaptic-aircraft-a220"],
    files: [],
    settleL: ["L:A22X Flight Stage", "L:A22X RDC Powered", "L:A22X FCP Powered"],
    ready: [],
    identityL: ["L:A22X Flight Stage", "L:A22X Reversion Mode"],
    radios: {},
  },
}

// A stock aircraft with no WASM module and no work folder, loaded at the end of
// a run so the tested aircraft is unloaded before its files are restored, and
// at the start if the sim already has the tested aircraft loaded. The sim
// writes its state.CFG too, which holds engine hours.
export const NEUTRAL = {
  id: "neutral",
  name: "Asobo Cessna 152",
  // The sim listed it with the liveries Default, Kenmore, and Psychedelic
  // (measured on MSFS 2024, 2026-10-01, in
  // experiments/areas/aircraft/results/run-a2a-pa24-comanche-2026-10-01-17-59-48.ndjson).
  title: "Cessna C152",
  match: /^cessna c152$/i,
  livery: null,
  tail: null,
  folders: ["asobo_c152"],
}

export function aircraft(id) {
  const a = AIRCRAFT[id]
  if (!a) throw new Error(`no aircraft ${JSON.stringify(id)}; the 11 are ${Object.keys(AIRCRAFT).join(", ")}`)
  return { id, ...a }
}

// [{ label, path, kind }] for the backup.
export function persistentItems(a) {
  return [
    ...a.work.map((pkg) => ({ label: `WASM work ${pkg}`, path: wasmWork(pkg), kind: "dir" })),
    ...a.folders.map((f) => ({ label: `SimObjects ${f}`, path: userSimObject(f), kind: "dir" })),
    ...a.files.map((f) => ({ label: f.label, path: f.path, kind: "file" })),
  ]
}
