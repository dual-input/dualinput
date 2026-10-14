//! What p10's capture and loop share: the kinds of input, and the file a
//! recording of inputs is, one input after another, each as its time in µs, its
//! kind, its length, and its bytes, all little-endian.

use std::io::{self, Read, Write};

// Inputs from the sim, as the capture classifies each SimConnect record.
pub const FM: u16 = 1;
pub const PROFILE: u16 = 2;
pub const INPUT_EVENT: u16 = 3;
pub const TRAFFIC_AIR: u16 = 4;
pub const TRAFFIC_GROUND: u16 = 5;
pub const IDENT: u16 = 6;
pub const CAMERA: u16 = 7;
pub const MODULE: u16 = 8;
pub const SYSTEM: u16 = 9;
pub const FLOW: u16 = 10;
pub const EXCEPTION: u16 = 11;
pub const ENUM: u16 = 12;
pub const OTHER: u16 = 13;

// Inputs the loop makes up, standing in for the other pilot's core, the
// panels, the helper, timers, and slow work.
pub const NET_COCKPIT: u16 = 100;
pub const NET_AVATAR: u16 = 101;
pub const NET_HEARTBEAT: u16 = 102;
pub const PANEL: u16 = 103;
pub const HELPER_ATC: u16 = 104;
pub const HELPER_CURSOR: u16 = 105;
pub const TIMER_SLOT: u16 = 106;
pub const TIMER_STALL: u16 = 107;
pub const JOB_RESULT: u16 = 108;

pub const KINDS: [u16; 22] = [
    FM, PROFILE, INPUT_EVENT, TRAFFIC_AIR, TRAFFIC_GROUND, IDENT, CAMERA, MODULE, SYSTEM, FLOW, EXCEPTION, ENUM, OTHER, NET_COCKPIT, NET_AVATAR,
    NET_HEARTBEAT, PANEL, HELPER_ATC, HELPER_CURSOR, TIMER_SLOT, TIMER_STALL, JOB_RESULT,
];

pub fn kind_name(kind: u16) -> &'static str {
    match kind {
        FM => "flight model",
        PROFILE => "profile entries",
        INPUT_EVENT => "input events",
        TRAFFIC_AIR => "traffic, aircraft",
        TRAFFIC_GROUND => "traffic, ground",
        IDENT => "traffic identities",
        CAMERA => "camera",
        MODULE => "module slot",
        SYSTEM => "system events",
        FLOW => "flow events",
        EXCEPTION => "exceptions",
        ENUM => "input event list",
        OTHER => "other records",
        NET_COCKPIT => "net: cockpit",
        NET_AVATAR => "net: avatar",
        NET_HEARTBEAT => "net: heartbeat",
        PANEL => "panels",
        HELPER_ATC => "helper: ATC audio",
        HELPER_CURSOR => "helper: cursor",
        TIMER_SLOT => "timer: control slot",
        TIMER_STALL => "timer: plugin stall",
        JOB_RESULT => "slow job result",
        _ => "unknown",
    }
}

pub const HEADER: usize = 14;

#[derive(Clone)]
pub struct Input {
    pub us: u64,
    pub kind: u16,
    pub bytes: Vec<u8>,
}

/// Writes one input and returns how many bytes it took.
pub fn write_input(w: &mut impl Write, input: &Input) -> io::Result<usize> {
    w.write_all(&input.us.to_le_bytes())?;
    w.write_all(&input.kind.to_le_bytes())?;
    w.write_all(&(input.bytes.len() as u32).to_le_bytes())?;
    w.write_all(&input.bytes)?;
    Ok(HEADER + input.bytes.len())
}

/// Reads one input, or None at a clean end of the file.
pub fn read_input(r: &mut impl Read) -> io::Result<Option<Input>> {
    let mut head = [0u8; HEADER];
    match r.read_exact(&mut head) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let us = u64::from_le_bytes(head[0..8].try_into().unwrap());
    let kind = u16::from_le_bytes(head[8..10].try_into().unwrap());
    let len = u32::from_le_bytes(head[10..14].try_into().unwrap()) as usize;
    let mut bytes = vec![0u8; len];
    r.read_exact(&mut bytes)?;
    Ok(Some(Input { us, kind, bytes }))
}

pub fn read_all(r: &mut impl Read) -> io::Result<Vec<Input>> {
    let mut all = vec![];
    while let Some(i) = read_input(r)? {
        all.push(i);
    }
    Ok(all)
}
