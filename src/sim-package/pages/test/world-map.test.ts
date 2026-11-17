import assert from "node:assert/strict"
import { test } from "node:test"

import { aircraftFor, folderOf, liveryFor, standFor } from "../world-map.ts"
import type { ListedAircraft } from "../world-map.ts"

test("PARKING 14 at an airport that has PARKING 140 selects PARKING 14", () => {
  const taxis = [
    { ID: 7, name: "PARKING 140 -- RAMP CARGO" },
    { ID: 9, name: "PARKING 14 -- RAMP GA SMALL" },
  ]
  assert.equal(standFor(taxis, "PARKING", 14)?.ID, 9)
  assert.equal(standFor(taxis, "PARKING", 140)?.ID, 7)
  assert.equal(standFor(taxis, "PARKING", 1), undefined)
})

test("a stand listed with no `--` after its number matches it whole", () => {
  assert.equal(standFor([{ ID: 3, name: "GATE 12" }], "GATE", 12)?.ID, 3)
})

test("a gate the flight file writes with an underscore matches the list's space, as KSEA's GATE_N 17 did", () => {
  assert.equal(standFor([{ ID: 4, name: "GATE N 17 -- GATE MEDIUM" }], "GATE_N", 17)?.ID, 4)
})

// p08's entries, cut to the fields the menu script reads.
const A380: ListedAircraft = { aircraftId: 108, variationIndex: 2, variation: "A380-800 RR Basic", thumbnailPath: "coui://html_ui/VFS/SimObjects/Airplanes/inibuilds-a380/liveries/inibuilds/emirates old a6-evn/thumbnail/thumbnail.png", isUsable: true }
const A380_GP: ListedAircraft = { ...A380, variationIndex: 3, variation: "A380-800 GP Basic" }
const A220: ListedAircraft = { aircraftId: 134, variationIndex: 12, variation: "A220-300", thumbnailPath: "coui://html_ui/VFS/SimObjects/Airplanes/Synaptic_A220/liveries/iniBuilds/white/thumbnail/thumbnail.png", isUsable: true }

test("an aircraft's folder is in its thumbnail's path", () => {
  assert.equal(folderOf(A220.thumbnailPath), "Synaptic_A220")
  assert.equal(folderOf(undefined), undefined)
})

test("the pilot flying's aircraft is the entry in their folder whose variation is their title, or else the folder's first", () => {
  const list = [A220, A380_GP, A380]
  assert.equal(aircraftFor(list, "inibuilds-a380", "A380-800 RR Basic"), A380)
  assert.equal(aircraftFor(list, "INIBUILDS-A380", "A title the list lacks"), A380_GP)
  assert.equal(aircraftFor(list, "synaptic_a220", null), A220)
  assert.equal(aircraftFor([{ ...A220, isUsable: false }], "synaptic_a220", null), undefined)
})

// The Baron 58P's liveries as the world map listed them on 2026-11-17, cut to the fields the menu script reads.
const BARON_LIVERIES = [
  { id: "18070071185185781799:0", title: "N513LW" },
  { id: "18070071185185781799:1", title: "N515MR" },
]

test("a livery is the entry titled with the pilot flying's livery name, or with none, the one that ends their title", () => {
  assert.equal(liveryFor(BARON_LIVERIES, "n515mr", "anything")?.id, "18070071185185781799:1")
  assert.equal(liveryFor(BARON_LIVERIES, null, "Black Square Baron 58P Professional N515MR")?.id, "18070071185185781799:1")
  assert.equal(liveryFor(BARON_LIVERIES, null, "Black Square Baron 58P Professional N999XX"), undefined)
  assert.equal(liveryFor(BARON_LIVERIES, "Delta", "Black Square Baron 58P Professional N515MR"), undefined)
})
