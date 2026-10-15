//! p11's stand-in for the message crate (decision 025): a data slot's struct of
//! fixed-width fields with its size asserted, and a message with a UUID, both
//! with serde's and ts-rs's derives, built for x86_64 by the core and for wasm32
//! by the module.

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// What the sim service writes at the head of every routine's slot.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
pub struct SlotHeader {
    pub feeds: u32,
    pub ended: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
pub struct PoseSample {
    pub t_us: u64,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub alt_ft: f64,
    pub pitch_deg: f64,
    pub bank_deg: f64,
    pub hdg_deg: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
pub struct FollowSlot {
    pub header: SlotHeader,
    pub sample: PoseSample,
}

const _: () = assert!(size_of::<FollowSlot>() == 64);
const _: () = assert!(std::mem::offset_of!(FollowSlot, sample) == 8);

pub const FOLLOW: &str = "FOLLOW";

/// A message that crosses as JSON, with an ID as text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Hello {
    Pilot { id: Uuid, version: String },
}
