# Bench fixtures

Files the bench plays into a bench build of the core, each recorded from the real sim.

## flight-58p-egll-600s.bin.zst

Every input a flying machine's core would take from the sim through 600s of a flight in the Black Square Baron 58P at EGLL with AI traffic on, as p10's capture recorded them on MSFS 2024 on 2026-10-16 ([architecture log](../../../record/areas/architecture/log.md#2026-10-16-a-flying-machine-that-hosts-traffic-at-egll-takes-in-285-mb-of-inputs-an-hour-45-mb-with-zstd-mostly-traffic-and-one-loop-carries-them-at-05-of-a-core-and-replays-them-exactly)).
It's that capture byte for byte: 312,702 records, 47.5 MB before zstd.
The [loop under load](../../../record/areas/build/02-testing.md#the-loop-under-load) plays it.

Uncompressed, it's one record after another, each little-endian:

| Bytes | Holds |
| --- | --- |
| 8 | The record's time in µs, on the capture's own clock |
| 2 | Its kind, below |
| 4 | Its length in bytes |
| The length | The SimConnect message, copied whole, from its `SIMCONNECT_RECV` header |

| Kind | Records | What the capture classed it as |
| --- | --- | --- |
| 1 | 15,617 | The flight model, every sim frame |
| 2 | 2,676 | The 58P profile's entries that changed |
| 3 | 8 | Input events |
| 4 | 174,715 | AI aircraft within 200km, every 500ms |
| 5 | 100,088 | Ground vehicles within 5km, every 500ms |
| 6 | 1,023 | Each new AI object's identity |
| 7 | 15,616 | The camera, every sim frame |
| 8 | 2,957 | p08's module's slot |
| 11 | 1 | An exception |
| 12 | 1 | The input events' list |

p10 also had kinds 9, 10, and 13, for system events, flow events, and other messages, which this capture holds none of (read in `experiments/areas/architecture/recording/common/src/lib.rs`).
