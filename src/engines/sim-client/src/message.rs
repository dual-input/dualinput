//! SimConnect's messages, which the edge copies whole from `SimConnect_GetNextDispatch` and
//! the loop reads here. `Message::record` writes one back into SimConnect's layout, as the
//! stand-in sim hands its messages up.
//!
//! A message is a packed struct that starts with `SIMCONNECT_RECV`, whose `dwID` says which
//! struct it is. Its fields are read by their offsets in the SDK's structs, which bindgen
//! generated, so a new SDK that moved one moves the offset with it.

use std::mem::offset_of;

use simconnect_types::{
    DWORD, SIMCONNECT_RECV, SIMCONNECT_RECV_EVENT, SIMCONNECT_RECV_EVENT_FILENAME,
    SIMCONNECT_RECV_EXCEPTION, SIMCONNECT_RECV_FLOW_EVENT, SIMCONNECT_RECV_ID_CLIENT_DATA,
    SIMCONNECT_RECV_ID_EVENT, SIMCONNECT_RECV_ID_EVENT_FILENAME, SIMCONNECT_RECV_ID_EXCEPTION,
    SIMCONNECT_RECV_ID_FLOW_EVENT, SIMCONNECT_RECV_ID_OPEN, SIMCONNECT_RECV_ID_QUIT,
    SIMCONNECT_RECV_ID_SIMOBJECT_DATA, SIMCONNECT_RECV_ID_SYSTEM_STATE, SIMCONNECT_RECV_OPEN,
    SIMCONNECT_RECV_SIMOBJECT_DATA, SIMCONNECT_RECV_SYSTEM_STATE,
};

/// The version in the header of each message the sim hands over: every one of the 312,702
/// records in p10's capture of a flight on MSFS 2024 carried 6 (read in
/// experiments/areas/architecture/results/p10-capture-2026-10-16-13-52-24.bin.zst).
const VERSION: DWORD = 6;

/// One of SimConnect's messages, read.
#[derive(Clone, Debug, PartialEq)]
pub enum Message {
    /// The sim's open reply, which names the sim and its SimConnect.
    Open {
        application: String,
        version: [u32; 4],
        simconnect: [u32; 4],
    },
    /// The sim's quit message, as the pilot closes the sim.
    Quit,
    /// A call failed after it returned. `send_id` is the failed call's packet ID, and
    /// `index` the argument at fault, such as a data definition's entry.
    Exception {
        exception: u32,
        send_id: u32,
        index: u32,
    },
    /// A client event or system event, such as `Pause_EX1` with its flags in `data`.
    Event { group: u32, event: u32, data: u32 },
    /// A system event that names a file, such as `AircraftLoaded` with the aircraft's
    /// `aircraft.cfg`.
    Filename { event: u32, file: String },
    /// Values of a sim object, which `SimConnect_RequestDataOnSimObject` asked for.
    ObjectData(Data),
    /// A client data area's bytes, which `SimConnect_RequestClientData` asked for.
    ClientData(Data),
    /// `SimConnect_RequestSystemState`'s answer.
    SystemState {
        request: u32,
        integer: u32,
        float: f32,
        text: String,
    },
    /// A flow event, such as `RTC_END` as the pilot presses Ready to fly.
    Flow { event: i32, path: String },
    /// A kind of message nothing of ours asks for yet.
    Other { id: u32 },
}

/// The values a request asked for, after the message's fixed fields.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Data {
    pub request: u32,
    pub object: u32,
    pub definition: u32,
    pub flags: u32,
    /// How many entries `bytes` holds: a tagged request's datums, or 1.
    pub count: u32,
    pub bytes: Vec<u8>,
}

impl Message {
    /// Reads a message, or `None` for bytes too short to hold the kind they claim.
    pub fn read(record: &[u8]) -> Option<Message> {
        let id = u32_at(record, offset_of!(SIMCONNECT_RECV, dwID))? as i32;
        Some(match id {
            SIMCONNECT_RECV_ID_OPEN => {
                type R = SIMCONNECT_RECV_OPEN;
                let at = |o| u32_at(record, o);
                Message::Open {
                    application: text_at(record, offset_of!(R, szApplicationName), 256)?,
                    version: [
                        at(offset_of!(R, dwApplicationVersionMajor))?,
                        at(offset_of!(R, dwApplicationVersionMinor))?,
                        at(offset_of!(R, dwApplicationBuildMajor))?,
                        at(offset_of!(R, dwApplicationBuildMinor))?,
                    ],
                    simconnect: [
                        at(offset_of!(R, dwSimConnectVersionMajor))?,
                        at(offset_of!(R, dwSimConnectVersionMinor))?,
                        at(offset_of!(R, dwSimConnectBuildMajor))?,
                        at(offset_of!(R, dwSimConnectBuildMinor))?,
                    ],
                }
            }
            SIMCONNECT_RECV_ID_QUIT => Message::Quit,
            SIMCONNECT_RECV_ID_EXCEPTION => {
                type R = SIMCONNECT_RECV_EXCEPTION;
                Message::Exception {
                    exception: u32_at(record, offset_of!(R, dwException))?,
                    send_id: u32_at(record, offset_of!(R, dwSendID))?,
                    index: u32_at(record, offset_of!(R, dwIndex))?,
                }
            }
            SIMCONNECT_RECV_ID_EVENT => {
                type R = SIMCONNECT_RECV_EVENT;
                Message::Event {
                    group: u32_at(record, offset_of!(R, uGroupID))?,
                    event: u32_at(record, offset_of!(R, uEventID))?,
                    data: u32_at(record, offset_of!(R, dwData))?,
                }
            }
            SIMCONNECT_RECV_ID_EVENT_FILENAME => Message::Filename {
                event: u32_at(record, offset_of!(SIMCONNECT_RECV_EVENT, uEventID))?,
                file: text_at(
                    record,
                    offset_of!(SIMCONNECT_RECV_EVENT_FILENAME, szFileName),
                    260,
                )?,
            },
            SIMCONNECT_RECV_ID_SIMOBJECT_DATA => Message::ObjectData(data(record)?),
            SIMCONNECT_RECV_ID_CLIENT_DATA => Message::ClientData(data(record)?),
            SIMCONNECT_RECV_ID_SYSTEM_STATE => {
                type R = SIMCONNECT_RECV_SYSTEM_STATE;
                Message::SystemState {
                    request: u32_at(record, offset_of!(R, dwRequestID))?,
                    integer: u32_at(record, offset_of!(R, dwInteger))?,
                    float: f32::from_bits(u32_at(record, offset_of!(R, fFloat))?),
                    text: text_at(record, offset_of!(R, szString), 260)?,
                }
            }
            SIMCONNECT_RECV_ID_FLOW_EVENT => {
                type R = SIMCONNECT_RECV_FLOW_EVENT;
                Message::Flow {
                    event: u32_at(record, offset_of!(R, FlowEvent))? as i32,
                    path: text_at(record, offset_of!(R, FltPath), 256)?,
                }
            }
            _ => Message::Other { id: id as u32 },
        })
    }

    /// The message in SimConnect's layout, as the sim would hand it over.
    pub fn record(&self) -> Vec<u8> {
        match self {
            Message::Open {
                application,
                version,
                simconnect,
            } => {
                type R = SIMCONNECT_RECV_OPEN;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_OPEN);
                put_text(&mut r, offset_of!(R, szApplicationName), 256, application);
                for (offset, value) in [
                    (offset_of!(R, dwApplicationVersionMajor), version[0]),
                    (offset_of!(R, dwApplicationVersionMinor), version[1]),
                    (offset_of!(R, dwApplicationBuildMajor), version[2]),
                    (offset_of!(R, dwApplicationBuildMinor), version[3]),
                    (offset_of!(R, dwSimConnectVersionMajor), simconnect[0]),
                    (offset_of!(R, dwSimConnectVersionMinor), simconnect[1]),
                    (offset_of!(R, dwSimConnectBuildMajor), simconnect[2]),
                    (offset_of!(R, dwSimConnectBuildMinor), simconnect[3]),
                ] {
                    put_u32(&mut r, offset, value);
                }
                r
            }
            Message::Quit => fixed::<SIMCONNECT_RECV>(SIMCONNECT_RECV_ID_QUIT),
            Message::Exception {
                exception,
                send_id,
                index,
            } => {
                type R = SIMCONNECT_RECV_EXCEPTION;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_EXCEPTION);
                put_u32(&mut r, offset_of!(R, dwException), *exception);
                put_u32(&mut r, offset_of!(R, dwSendID), *send_id);
                put_u32(&mut r, offset_of!(R, dwIndex), *index);
                r
            }
            Message::Event { group, event, data } => {
                type R = SIMCONNECT_RECV_EVENT;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_EVENT);
                put_u32(&mut r, offset_of!(R, uGroupID), *group);
                put_u32(&mut r, offset_of!(R, uEventID), *event);
                put_u32(&mut r, offset_of!(R, dwData), *data);
                r
            }
            Message::Filename { event, file } => {
                type R = SIMCONNECT_RECV_EVENT_FILENAME;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_EVENT_FILENAME);
                put_u32(&mut r, offset_of!(SIMCONNECT_RECV_EVENT, uEventID), *event);
                put_text(&mut r, offset_of!(R, szFileName), 260, file);
                r
            }
            Message::ObjectData(d) => data_record(SIMCONNECT_RECV_ID_SIMOBJECT_DATA, d),
            Message::ClientData(d) => data_record(SIMCONNECT_RECV_ID_CLIENT_DATA, d),
            Message::SystemState {
                request,
                integer,
                float,
                text,
            } => {
                type R = SIMCONNECT_RECV_SYSTEM_STATE;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_SYSTEM_STATE);
                put_u32(&mut r, offset_of!(R, dwRequestID), *request);
                put_u32(&mut r, offset_of!(R, dwInteger), *integer);
                put_u32(&mut r, offset_of!(R, fFloat), float.to_bits());
                put_text(&mut r, offset_of!(R, szString), 260, text);
                r
            }
            Message::Flow { event, path } => {
                type R = SIMCONNECT_RECV_FLOW_EVENT;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_FLOW_EVENT);
                put_u32(&mut r, offset_of!(R, FlowEvent), *event as u32);
                put_text(&mut r, offset_of!(R, FltPath), 256, path);
                r
            }
            Message::Other { id } => fixed::<SIMCONNECT_RECV>(*id as i32),
        }
    }
}

/// A data message's fixed fields, and the bytes from `dwData` on, which hold its values.
fn data(record: &[u8]) -> Option<Data> {
    type R = SIMCONNECT_RECV_SIMOBJECT_DATA;
    let start = offset_of!(R, dwData);
    Some(Data {
        request: u32_at(record, offset_of!(R, dwRequestID))?,
        object: u32_at(record, offset_of!(R, dwObjectID))?,
        definition: u32_at(record, offset_of!(R, dwDefineID))?,
        flags: u32_at(record, offset_of!(R, dwFlags))?,
        count: u32_at(record, offset_of!(R, dwDefineCount))?,
        bytes: record.get(start..)?.to_vec(),
    })
}

fn data_record(id: i32, d: &Data) -> Vec<u8> {
    type R = SIMCONNECT_RECV_SIMOBJECT_DATA;
    let mut r = fixed::<R>(id);
    r.truncate(offset_of!(R, dwData));
    r.extend_from_slice(&d.bytes);
    for (offset, value) in [
        (offset_of!(R, dwRequestID), d.request),
        (offset_of!(R, dwObjectID), d.object),
        (offset_of!(R, dwDefineID), d.definition),
        (offset_of!(R, dwFlags), d.flags),
        (offset_of!(R, dwentrynumber), 1),
        (offset_of!(R, dwoutof), 1),
        (offset_of!(R, dwDefineCount), d.count),
    ] {
        put_u32(&mut r, offset, value);
    }
    let size = r.len() as u32;
    put_u32(&mut r, offset_of!(SIMCONNECT_RECV, dwSize), size);
    r
}

/// A message of `T`'s size, all zero but its header.
fn fixed<T>(id: i32) -> Vec<u8> {
    let mut r = vec![0; size_of::<T>()];
    put_u32(
        &mut r,
        offset_of!(SIMCONNECT_RECV, dwSize),
        size_of::<T>() as u32,
    );
    put_u32(&mut r, offset_of!(SIMCONNECT_RECV, dwVersion), VERSION);
    put_u32(&mut r, offset_of!(SIMCONNECT_RECV, dwID), id as u32);
    r
}

fn u32_at(record: &[u8], offset: usize) -> Option<u32> {
    let bytes = record.get(offset..offset + 4)?;
    Some(u32::from_le_bytes(bytes.try_into().ok()?))
}

fn put_u32(record: &mut [u8], offset: usize, value: u32) {
    record[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

/// A field of `len` bytes holding text that ends at its first zero byte. SimConnect declares
/// its text as `char` arrays, so a path most likely comes in the PC's ANSI code page
/// (unverified), and a byte that isn't UTF-8, such as one in a pilot's name, reads as
/// U+FFFD, which no path of ours names.
fn text_at(record: &[u8], offset: usize, len: usize) -> Option<String> {
    let field = record.get(offset..(offset + len).min(record.len()))?;
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    Some(String::from_utf8_lossy(&field[..end]).into_owned())
}

fn put_text(record: &mut [u8], offset: usize, len: usize, text: &str) {
    let bytes = text.as_bytes();
    let n = bytes.len().min(len - 1);
    record[offset..offset + n].copy_from_slice(&bytes[..n]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_message_reads_as_it_was_written() {
        for message in [
            Message::Open {
                application: "SunRise".into(),
                version: [12, 2, 282_174, 999],
                simconnect: [12, 2, 0, 0],
            },
            Message::Quit,
            Message::Exception {
                exception: 7,
                send_id: 41,
                index: 2,
            },
            Message::Event {
                group: 1,
                event: 3,
                data: 8,
            },
            Message::Filename {
                event: 2,
                file: "SimObjects\\Airplanes\\pa24-250\\aircraft.cfg".into(),
            },
            Message::ObjectData(Data {
                request: 4,
                object: 0,
                definition: 1,
                flags: 2,
                count: 1,
                bytes: 1.5f64.to_le_bytes().to_vec(),
            }),
            Message::ClientData(Data {
                request: 5,
                object: 0,
                definition: 2,
                flags: 0,
                count: 1,
                bytes: vec![1, 2, 3, 4],
            }),
            Message::SystemState {
                request: 6,
                integer: 1,
                float: 0.5,
                text: "aircraft.cfg".into(),
            },
            Message::Flow {
                event: 11,
                path: String::new(),
            },
            Message::Other { id: 99 },
        ] {
            assert_eq!(Message::read(&message.record()), Some(message));
        }
    }

    #[test]
    fn a_record_too_short_for_its_kind_reads_as_none() {
        let mut record = Message::Exception {
            exception: 1,
            send_id: 2,
            index: 3,
        }
        .record();
        record.truncate(14);
        assert_eq!(Message::read(&record), None);
    }
}
