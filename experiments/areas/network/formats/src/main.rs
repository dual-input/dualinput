//! p02: how many bytes each v1 channel's message takes in each binary format
//! the cores could use between them, and how long encoding and decoding take
//! (architecture plan, node 2.2). Needs no sim.
//!
//! Every message derives serde's traits, bitcode's own `Encode` and `Decode`,
//! and wincode's `SchemaWrite` and `SchemaRead`, so all six encodings read one
//! definition. Each sample is encoded, decoded back, and compared with the
//! original, so a format that loses a value fails here rather than in a size.
//!
//! The values are shaped like a session's: a stamp is whole µs since the PC
//! started, about 3 days in, and a message number is a few thousand into the
//! session, because a varint's size depends on how big the number is.

use std::hint::black_box;
use std::time::Instant;

use bitcode::{Decode, Encode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use wincode::{SchemaRead, SchemaWrite};

/// About 3 days of a PC running, in µs.
const STAMP_US: u64 = 259_200_123_456;

/// One counter of a vector clock, named by the pilot's ID and restart count.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct ClockByPilot {
    pilot: Uuid,
    restart: u32,
    count: u64,
}

/// One counter of a vector clock, named by a place in the member list.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct ClockBySlot {
    slot: u8,
    restart: u32,
    count: u64,
}

/// A cockpit change whose entry crosses by name and whose clock names pilots.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct CockpitByName {
    number: u64,
    stamp_us: u64,
    entry: String,
    value: f64,
    made_by_pf: bool,
    clock: Vec<ClockByPilot>,
}

/// The same change with the entry's index in the profile and member-list slots.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct CockpitByIndex {
    number: u64,
    stamp_us: u64,
    entry: u16,
    value: f64,
    made_by_pf: bool,
    clock: Vec<ClockBySlot>,
}

/// The flying machine's pose and velocities, every field an `f64`, as FS
/// Copilot's `Physics` packet carries 13 doubles.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct FlightF64 {
    number: u64,
    stamp_us: u64,
    lat_deg: f64,
    lon_deg: f64,
    alt_ft: f64,
    pitch_rad: f64,
    bank_rad: f64,
    heading_rad: f64,
    vel_body_fps: [f64; 3],
    vel_rot_rads: [f64; 3],
}

/// The same sample with position in `f64` and attitude and velocities in `f32`.
/// An `f32` latitude in degrees would step by about 4µ° near 40°, about 0.4m,
/// so position stays `f64`.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct FlightF32 {
    number: u64,
    stamp_us: u64,
    lat_deg: f64,
    lon_deg: f64,
    alt_ft: f64,
    pitch_rad: f32,
    bank_rad: f32,
    heading_rad: f32,
    vel_body_fps: [f32; 3],
    vel_rot_rads: [f32; 3],
}

/// One figure's pose: 27 joints and a color, as the p24 figure has.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct AvatarPose {
    number: u64,
    stamp_us: u64,
    figure: u8,
    joints: [f32; 27],
    color: u32,
}

/// One AI aircraft's sample in a traffic batch.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct TrafficState {
    object: u32,
    age_ms: u16,
    lat_deg: f64,
    lon_deg: f64,
    alt_ft: f32,
    pitch_deg: f32,
    bank_deg: f32,
    heading_deg: f32,
    speed_kt: f32,
    on_ground: bool,
}

/// A batch of traffic samples, 23 aircraft, as FS Copilot's batches hold.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct TrafficBatch {
    number: u64,
    stamp_us: u64,
    states: Vec<TrafficState>,
}

/// One frame of ATC audio: about 60 bytes of Opus at 24 kbps.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct AudioFrame {
    number: u64,
    stamp_us: u64,
    #[serde(with = "serde_bytes")]
    opus: Vec<u8>,
}

/// A pilot's join, with UUIDs as 16 bytes and the crate's hash as 32 bytes.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct JoinBinary {
    session: Uuid,
    pilot: Uuid,
    restart: u32,
    name: String,
    code: String,
    version: String,
    crate_hash: [u8; 32],
}

/// The same join with each ID and the hash as text, as JSON would carry them.
#[derive(Serialize, Deserialize, Encode, Decode, SchemaWrite, SchemaRead, Debug, Clone, PartialEq)]
struct JoinText {
    session: String,
    pilot: String,
    restart: u32,
    name: String,
    code: String,
    version: String,
    crate_hash: String,
}

const PILOT_A: &str = "6f1c2a4e-8b3d-4c5e-9a7f-1b2c3d4e5f60";
const PILOT_B: &str = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const SESSION: &str = "3e7d1f2a-5b6c-4d8e-9f0a-1b2c3d4e5f6a";

fn uuid(s: &str) -> Uuid {
    Uuid::parse_str(s).unwrap()
}

fn hash() -> [u8; 32] {
    let mut h = [0u8; 32];
    for (i, b) in h.iter_mut().enumerate() {
        *b = (i as u8).wrapping_mul(97).wrapping_add(13);
    }
    h
}

fn cockpit_by_name() -> CockpitByName {
    CockpitByName {
        number: 4_217,
        stamp_us: STAMP_US,
        entry: "ELECTRICAL_MASTER_BATTERY".into(),
        value: 1.0,
        made_by_pf: false,
        clock: vec![
            ClockByPilot { pilot: uuid(PILOT_A), restart: 0, count: 2_108 },
            ClockByPilot { pilot: uuid(PILOT_B), restart: 1, count: 2_109 },
        ],
    }
}

fn cockpit_by_index() -> CockpitByIndex {
    CockpitByIndex {
        number: 4_217,
        stamp_us: STAMP_US,
        entry: 37,
        value: 1.0,
        made_by_pf: false,
        clock: vec![
            ClockBySlot { slot: 0, restart: 0, count: 2_108 },
            ClockBySlot { slot: 1, restart: 1, count: 2_109 },
        ],
    }
}

fn flight_f64() -> FlightF64 {
    FlightF64 {
        number: 61_442,
        stamp_us: STAMP_US,
        lat_deg: 37.618_972_3,
        lon_deg: -122.374_889_1,
        alt_ft: 4_512.37,
        pitch_rad: 0.052_3,
        bank_rad: -0.174_5,
        heading_rad: 4.712_3,
        vel_body_fps: [0.31, -2.04, 211.6],
        vel_rot_rads: [0.001_2, -0.000_4, 0.021_8],
    }
}

fn flight_f32() -> FlightF32 {
    let f = flight_f64();
    FlightF32 {
        number: f.number,
        stamp_us: f.stamp_us,
        lat_deg: f.lat_deg,
        lon_deg: f.lon_deg,
        alt_ft: f.alt_ft,
        pitch_rad: f.pitch_rad as f32,
        bank_rad: f.bank_rad as f32,
        heading_rad: f.heading_rad as f32,
        vel_body_fps: f.vel_body_fps.map(|v| v as f32),
        vel_rot_rads: f.vel_rot_rads.map(|v| v as f32),
    }
}

fn avatar() -> AvatarPose {
    let mut joints = [0f32; 27];
    for (i, j) in joints.iter_mut().enumerate() {
        *j = (i as f32 * 0.37).sin() * 1.2;
    }
    AvatarPose { number: 12_903, stamp_us: STAMP_US, figure: 1, joints, color: 0x00c8_7a2f }
}

fn traffic() -> TrafficBatch {
    let states = (0..23u32)
        .map(|i| TrafficState {
            object: 10_000 + i * 7,
            age_ms: 40 + (i as u16 * 13) % 400,
            lat_deg: 37.6 + i as f64 * 0.013,
            lon_deg: -122.4 + i as f64 * 0.017,
            alt_ft: if i % 4 == 0 { 13.0 } else { 1_500.0 + i as f32 * 410.0 },
            pitch_deg: 2.5 - i as f32 * 0.1,
            bank_deg: if i % 3 == 0 { 0.0 } else { 15.0 - i as f32 },
            heading_deg: (i as f32 * 47.0) % 360.0,
            speed_kt: if i % 4 == 0 { 0.0 } else { 180.0 + i as f32 * 9.0 },
            on_ground: i % 4 == 0,
        })
        .collect();
    TrafficBatch { number: 1_884, stamp_us: STAMP_US, states }
}

fn audio() -> AudioFrame {
    // Opus output looks like noise, so every byte value is equally likely.
    let opus = (0..60u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 24) as u8).collect();
    AudioFrame { number: 30_771, stamp_us: STAMP_US, opus }
}

fn join_binary() -> JoinBinary {
    JoinBinary {
        session: uuid(SESSION),
        pilot: uuid(PILOT_B),
        restart: 1,
        name: "Adam".into(),
        code: "K7RM2Q".into(),
        version: "0.1.0".into(),
        crate_hash: hash(),
    }
}

fn join_text() -> JoinText {
    let b = join_binary();
    JoinText {
        session: b.session.to_string(),
        pilot: b.pilot.to_string(),
        restart: b.restart,
        name: b.name,
        code: b.code,
        version: b.version,
        crate_hash: b.crate_hash.iter().map(|x| format!("{x:02x}")).collect(),
    }
}

const FORMATS: [&str; 6] = ["postcard", "msgpack", "msgpack+names", "bitcode serde", "bitcode", "wincode"];

/// One format's encoded size and the mean time to encode and decode once, or
/// why it failed.
type Outcome = Result<(usize, f64), String>;

/// Encodes `v` in every format, checks that each decodes back to `v`, and times
/// encode plus decode over `iters` rounds.
fn measure<T>(v: &T, iters: u32) -> Vec<Outcome>
where
    T: Serialize
        + for<'de> Deserialize<'de>
        + Encode
        + for<'a> Decode<'a>
        + SchemaWrite<wincode::config::DefaultConfig, Src = T>
        + for<'de> SchemaRead<'de, wincode::config::DefaultConfig, Dst = T>
        + PartialEq
        + std::fmt::Debug,
{
    fn run<T: PartialEq + std::fmt::Debug>(
        v: &T,
        iters: u32,
        enc: impl Fn(&T) -> Result<Vec<u8>, String>,
        dec: impl Fn(&[u8]) -> Result<T, String>,
    ) -> Outcome {
        let bytes = enc(v)?;
        let back = dec(&bytes)?;
        if &back != v {
            return Err(format!("decoded differently: {back:?}"));
        }
        let t = Instant::now();
        for _ in 0..iters {
            let b = enc(black_box(v))?;
            black_box(dec(black_box(&b))?);
        }
        Ok((bytes.len(), t.elapsed().as_nanos() as f64 / iters as f64))
    }
    let e = |x: &dyn std::fmt::Display| x.to_string();
    vec![
        run(v, iters, |v| postcard::to_allocvec(v).map_err(|x| e(&x)), |b| postcard::from_bytes(b).map_err(|x| e(&x))),
        run(v, iters, |v| rmp_serde::to_vec(v).map_err(|x| e(&x)), |b| rmp_serde::from_slice(b).map_err(|x| e(&x))),
        run(v, iters, |v| rmp_serde::to_vec_named(v).map_err(|x| e(&x)), |b| rmp_serde::from_slice(b).map_err(|x| e(&x))),
        run(v, iters, |v| bitcode::serialize(v).map_err(|x| e(&x)), |b| bitcode::deserialize(b).map_err(|x| e(&x))),
        run(v, iters, |v| Ok(bitcode::encode(v)), |b| bitcode::decode(b).map_err(|x| e(&x))),
        run(v, iters, |v| wincode::serialize(v).map_err(|x| e(&x)), |b| wincode::deserialize(b).map_err(|x| e(&x))),
    ]
}

fn main() {
    let iters = 200_000;
    let rows: Vec<(&str, &str, Vec<Outcome>)> = vec![
        ("Cockpit change, entry by name, clock by pilot ID", "cockpit", measure(&cockpit_by_name(), iters)),
        ("Cockpit change, entry by index, clock by slot", "cockpit", measure(&cockpit_by_index(), iters)),
        ("Flight-model sample, all f64", "flight", measure(&flight_f64(), iters)),
        ("Flight-model sample, attitude and velocities f32", "flight", measure(&flight_f32(), iters)),
        ("Avatar pose, 27 joints and a color", "avatar", measure(&avatar(), iters)),
        ("Traffic batch, 23 aircraft", "traffic", measure(&traffic(), iters / 10)),
        ("ATC audio frame, 60 bytes of Opus", "audio", measure(&audio(), iters)),
        ("Join, IDs and hash as bytes", "session", measure(&join_binary(), iters)),
        ("Join, IDs and hash as text", "session", measure(&join_text(), iters)),
    ];

    let width = rows.iter().map(|r| r.0.len()).max().unwrap();
    println!("p02: bytes per message in each format (rmp-serde writes MessagePack; +names keeps field names)");
    println!();
    print!("{:width$}", "");
    for f in FORMATS {
        print!(" | {f:>13}");
    }
    println!();
    for (name, _, outcomes) in &rows {
        print!("{name:width$}");
        for o in outcomes {
            match o {
                Ok((size, _)) => print!(" | {size:>13}"),
                Err(_) => print!(" | {:>13}", "FAILED"),
            }
        }
        println!();
    }
    println!();
    println!("Mean time to encode and decode once, in ns (release build, this PC)");
    println!();
    print!("{:width$}", "");
    for f in FORMATS {
        print!(" | {f:>13}");
    }
    println!();
    for (name, _, outcomes) in &rows {
        print!("{name:width$}");
        for o in outcomes {
            match o {
                Ok((_, ns)) => print!(" | {:>13.0}", ns),
                Err(_) => print!(" | {:>13}", "FAILED"),
            }
        }
        println!();
    }
    let failures: Vec<String> = rows
        .iter()
        .flat_map(|(name, _, outcomes)| {
            outcomes.iter().zip(FORMATS).filter_map(move |(o, f)| o.as_ref().err().map(|e| format!("{name} in {f}: {e}")))
        })
        .collect();
    println!();
    if failures.is_empty() {
        println!("Every message decoded back to the value it was encoded from, in every format.");
    } else {
        println!("Failures:");
        for f in failures {
            println!("  {f}");
        }
    }
}
