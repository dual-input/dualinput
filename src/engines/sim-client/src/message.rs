//! SimConnect's messages, which the edge copies whole from `SimConnect_GetNextDispatch` and
//! the loop reads here. `Message::record` writes one back into SimConnect's layout, as the
//! stand-in sim hands its messages up.
//!
//! A message is a packed struct that starts with `SIMCONNECT_RECV`, whose `dwID` says which
//! struct it is. Its fields are read by their offsets in the SDK's structs, which bindgen
//! generated, so a new SDK that moved one moves the offset with it.

use std::mem::offset_of;

use serde::{Deserialize, Serialize};
use simconnect_types::{
    DWORD, SIMCONNECT_DATA_CAMERA, SIMCONNECT_DATA_PBH, SIMCONNECT_DATA_XYZ,
    SIMCONNECT_INPUT_EVENT_DESCRIPTOR, SIMCONNECT_INPUT_EVENT_TYPE_DOUBLE,
    SIMCONNECT_INPUT_EVENT_TYPE_STRING, SIMCONNECT_RECV, SIMCONNECT_RECV_ASSIGNED_OBJECT_ID,
    SIMCONNECT_RECV_CAMERA_DATA, SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS, SIMCONNECT_RECV_EVENT,
    SIMCONNECT_RECV_EVENT_EX1, SIMCONNECT_RECV_EVENT_FILENAME, SIMCONNECT_RECV_EVENT_FRAME,
    SIMCONNECT_RECV_EXCEPTION, SIMCONNECT_RECV_FLOW_EVENT, SIMCONNECT_RECV_GET_INPUT_EVENT,
    SIMCONNECT_RECV_ID_ASSIGNED_OBJECT_ID, SIMCONNECT_RECV_ID_CAMERA_DATA,
    SIMCONNECT_RECV_ID_CLIENT_DATA, SIMCONNECT_RECV_ID_ENUMERATE_INPUT_EVENTS,
    SIMCONNECT_RECV_ID_EVENT, SIMCONNECT_RECV_ID_EVENT_EX1, SIMCONNECT_RECV_ID_EVENT_FILENAME,
    SIMCONNECT_RECV_ID_EVENT_FRAME, SIMCONNECT_RECV_ID_EXCEPTION, SIMCONNECT_RECV_ID_FLOW_EVENT,
    SIMCONNECT_RECV_ID_GET_INPUT_EVENT, SIMCONNECT_RECV_ID_OPEN, SIMCONNECT_RECV_ID_QUIT,
    SIMCONNECT_RECV_ID_SIMOBJECT_DATA, SIMCONNECT_RECV_ID_SIMOBJECT_DATA_BYTYPE,
    SIMCONNECT_RECV_ID_SUBSCRIBE_INPUT_EVENT, SIMCONNECT_RECV_ID_SYSTEM_STATE,
    SIMCONNECT_RECV_OPEN, SIMCONNECT_RECV_SIMOBJECT_DATA, SIMCONNECT_RECV_SUBSCRIBE_INPUT_EVENT,
    SIMCONNECT_RECV_SYSTEM_STATE,
};

use crate::Value;

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
    /// A client event sent with several values, as `SimConnect_TransmitClientEvent_EX1` sends one.
    EventEx1 {
        group: u32,
        event: u32,
        data: [u32; 5],
    },
    /// One page of `SimConnect_EnumerateInputEvents`' answer: send `entry` of `out_of`.
    InputEvents {
        request: u32,
        entry: u32,
        out_of: u32,
        events: Vec<InputEvent>,
    },
    /// `SimConnect_GetInputEvent`'s answer, which names only the request that asked.
    InputValue { request: u32, value: Value },
    /// A subscribed input event's new value.
    InputChanged { hash: u64, value: Value },
    /// A system event that names a file, such as `AircraftLoaded` with the aircraft's
    /// `aircraft.cfg`.
    Filename { event: u32, file: String },
    /// Values of a sim object, which `SimConnect_RequestDataOnSimObject` or
    /// `SimConnect_RequestDataOnSimObjectType` asked for.
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
    /// The system event `Frame`, once each frame the sim draws, with the frame rate in
    /// frames a second and the sim's rate, 1 at normal speed.
    Frame { event: u32, rate: f32, speed: f32 },
    /// The object ID the sim gave an object a create asked for, under the create's request.
    Assigned { request: u32, object: u32 },
    /// `SimConnect_CameraGet`'s answer, which names no request.
    Camera(Camera),
    /// A kind of message nothing of ours asks for.
    Other { id: u32 },
}

/// An input event of the loaded aircraft, as `SimConnect_EnumerateInputEvents` lists it. The list
/// holds input events, not their presets (read in `record/learn/foundations/04-02-events.md`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputEvent {
    pub name: String,
    pub hash: u64,
}

/// Where the camera is and where it looks, as `SimConnect_CameraGet` gives it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Camera {
    /// In meters in `referential`'s frame: in `SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT`'s,
    /// from the aircraft's reference point, x left, y up, and z forward, and in `WORLD`'s,
    /// latitude and longitude in degrees and altitude in meters.
    pub position: [f64; 3],
    pub referential: u32,
    /// In degrees. `SIMCONNECT_DATA_PBH` names its fields Pitch, Bank, and Heading, but its
    /// Bank carries the yaw and its Heading the roll, so they're read here by what they
    /// carry (measured on MSFS 2024, 2026-10-03, record/areas/avatars/log.md,
    /// "SimConnect_CameraGet gives where the pilot looks, with ChasePlane driving the camera
    /// or not").
    pub pitch: f32,
    pub yaw: f32,
    pub roll: f32,
    /// The view's height, in radians (measured on MSFS 2024, 2026-10-03,
    /// record/areas/avatars/log.md, "The ray through the cursor needs no calibration").
    pub fov: f64,
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
    /// For a by-type request's answer, which object of how many this is, counted from 1, as
    /// FS Copilot's host found a poll complete once an answer's number reached its count; and
    /// an answer that found no object has a count of 0 (read in the FS Copilot fork,
    /// `FsCopilot/Simulation/TrafficHost.cs`, `OnByType`). Every other answer is 1 of 1.
    pub entry: u32,
    pub out_of: u32,
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
            SIMCONNECT_RECV_ID_EVENT_EX1 => {
                type R = SIMCONNECT_RECV_EVENT_EX1;
                Message::EventEx1 {
                    group: u32_at(record, offset_of!(R, uGroupID))?,
                    event: u32_at(record, offset_of!(R, uEventID))?,
                    data: [
                        u32_at(record, offset_of!(R, dwData0))?,
                        u32_at(record, offset_of!(R, dwData1))?,
                        u32_at(record, offset_of!(R, dwData2))?,
                        u32_at(record, offset_of!(R, dwData3))?,
                        u32_at(record, offset_of!(R, dwData4))?,
                    ],
                }
            }
            SIMCONNECT_RECV_ID_ENUMERATE_INPUT_EVENTS => {
                type R = SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS;
                type D = SIMCONNECT_INPUT_EVENT_DESCRIPTOR;
                let count = u32_at(record, offset_of!(R, _base.dwArraySize))? as usize;
                let first = offset_of!(R, rgData);
                let mut events = Vec::new();
                for i in 0..count {
                    let at = first + i * size_of::<D>();
                    events.push(InputEvent {
                        name: text_at(record, at + offset_of!(D, Name), 64)?,
                        hash: u64_at(record, at + offset_of!(D, Hash))?,
                    });
                }
                Message::InputEvents {
                    request: u32_at(record, offset_of!(R, _base.dwRequestID))?,
                    entry: u32_at(record, offset_of!(R, _base.dwEntryNumber))?,
                    out_of: u32_at(record, offset_of!(R, _base.dwOutOf))?,
                    events,
                }
            }
            SIMCONNECT_RECV_ID_GET_INPUT_EVENT => {
                type R = SIMCONNECT_RECV_GET_INPUT_EVENT;
                Message::InputValue {
                    request: u32_at(record, offset_of!(R, dwRequestID))?,
                    value: input_value(
                        record,
                        u32_at(record, offset_of!(R, eType))?,
                        offset_of!(R, Value),
                    )?,
                }
            }
            SIMCONNECT_RECV_ID_SUBSCRIBE_INPUT_EVENT => {
                type R = SIMCONNECT_RECV_SUBSCRIBE_INPUT_EVENT;
                Message::InputChanged {
                    hash: u64_at(record, offset_of!(R, Hash))?,
                    value: input_value(
                        record,
                        u32_at(record, offset_of!(R, eType))?,
                        offset_of!(R, Value),
                    )?,
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
            // A by-type answer's struct adds nothing to an object's data, and its object
            // field names which object it reads.
            SIMCONNECT_RECV_ID_SIMOBJECT_DATA | SIMCONNECT_RECV_ID_SIMOBJECT_DATA_BYTYPE => {
                Message::ObjectData(data(record)?)
            }
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
            SIMCONNECT_RECV_ID_EVENT_FRAME => {
                type R = SIMCONNECT_RECV_EVENT_FRAME;
                Message::Frame {
                    event: u32_at(record, offset_of!(SIMCONNECT_RECV_EVENT, uEventID))?,
                    rate: f32::from_bits(u32_at(record, offset_of!(R, fFrameRate))?),
                    speed: f32::from_bits(u32_at(record, offset_of!(R, fSimSpeed))?),
                }
            }
            SIMCONNECT_RECV_ID_ASSIGNED_OBJECT_ID => {
                type R = SIMCONNECT_RECV_ASSIGNED_OBJECT_ID;
                Message::Assigned {
                    request: u32_at(record, offset_of!(R, dwRequestID))?,
                    object: u32_at(record, offset_of!(R, dwObjectID))?,
                }
            }
            SIMCONNECT_RECV_ID_CAMERA_DATA => {
                let at = CameraFields::new();
                let angle = |o| u32_at(record, o).map(f32::from_bits);
                Message::Camera(Camera {
                    position: [
                        f64_at(record, at.position)?,
                        f64_at(record, at.position + 8)?,
                        f64_at(record, at.position + 16)?,
                    ],
                    referential: u32_at(record, at.referential)?,
                    pitch: angle(at.pbh)?,
                    yaw: angle(at.pbh + 4)?,
                    roll: angle(at.pbh + 8)?,
                    fov: f64_at(record, at.fov)?,
                })
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
            Message::EventEx1 { group, event, data } => {
                type R = SIMCONNECT_RECV_EVENT_EX1;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_EVENT_EX1);
                put_u32(&mut r, offset_of!(R, uGroupID), *group);
                put_u32(&mut r, offset_of!(R, uEventID), *event);
                put_u32(&mut r, offset_of!(R, dwData0), data[0]);
                put_u32(&mut r, offset_of!(R, dwData1), data[1]);
                put_u32(&mut r, offset_of!(R, dwData2), data[2]);
                put_u32(&mut r, offset_of!(R, dwData3), data[3]);
                put_u32(&mut r, offset_of!(R, dwData4), data[4]);
                r
            }
            Message::InputEvents {
                request,
                entry,
                out_of,
                events,
            } => {
                type R = SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS;
                type D = SIMCONNECT_INPUT_EVENT_DESCRIPTOR;
                let first = offset_of!(R, rgData);
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_ENUMERATE_INPUT_EVENTS);
                r.resize(first + events.len() * size_of::<D>(), 0);
                put_u32(&mut r, offset_of!(R, _base.dwRequestID), *request);
                put_u32(
                    &mut r,
                    offset_of!(R, _base.dwArraySize),
                    events.len() as u32,
                );
                put_u32(&mut r, offset_of!(R, _base.dwEntryNumber), *entry);
                put_u32(&mut r, offset_of!(R, _base.dwOutOf), *out_of);
                for (i, event) in events.iter().enumerate() {
                    let at = first + i * size_of::<D>();
                    put_text(&mut r, at + offset_of!(D, Name), 64, &event.name);
                    put_u64(&mut r, at + offset_of!(D, Hash), event.hash);
                    put_u32(
                        &mut r,
                        at + offset_of!(D, eType),
                        SIMCONNECT_INPUT_EVENT_TYPE_DOUBLE,
                    );
                }
                set_size(&mut r);
                r
            }
            Message::InputValue { request, value } => {
                type R = SIMCONNECT_RECV_GET_INPUT_EVENT;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_GET_INPUT_EVENT);
                put_u32(&mut r, offset_of!(R, dwRequestID), *request);
                put_input_value(&mut r, offset_of!(R, eType), offset_of!(R, Value), value);
                r
            }
            Message::InputChanged { hash, value } => {
                type R = SIMCONNECT_RECV_SUBSCRIBE_INPUT_EVENT;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_SUBSCRIBE_INPUT_EVENT);
                put_u64(&mut r, offset_of!(R, Hash), *hash);
                put_input_value(&mut r, offset_of!(R, eType), offset_of!(R, Value), value);
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
            Message::Frame { event, rate, speed } => {
                type R = SIMCONNECT_RECV_EVENT_FRAME;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_EVENT_FRAME);
                put_u32(&mut r, offset_of!(SIMCONNECT_RECV_EVENT, uEventID), *event);
                put_u32(&mut r, offset_of!(R, fFrameRate), rate.to_bits());
                put_u32(&mut r, offset_of!(R, fSimSpeed), speed.to_bits());
                r
            }
            Message::Assigned { request, object } => {
                type R = SIMCONNECT_RECV_ASSIGNED_OBJECT_ID;
                let mut r = fixed::<R>(SIMCONNECT_RECV_ID_ASSIGNED_OBJECT_ID);
                put_u32(&mut r, offset_of!(R, dwRequestID), *request);
                put_u32(&mut r, offset_of!(R, dwObjectID), *object);
                r
            }
            Message::Camera(c) => {
                let at = CameraFields::new();
                let mut r = fixed::<SIMCONNECT_RECV_CAMERA_DATA>(SIMCONNECT_RECV_ID_CAMERA_DATA);
                for (i, v) in c.position.iter().enumerate() {
                    put_f64(&mut r, at.position + 8 * i, *v);
                }
                put_u32(&mut r, at.referential, c.referential);
                for (i, v) in [c.pitch, c.yaw, c.roll].iter().enumerate() {
                    put_u32(&mut r, at.pbh + 4 * i, v.to_bits());
                }
                put_f64(&mut r, at.fov, c.fov);
                r
            }
            Message::Other { id } => fixed::<SIMCONNECT_RECV>(*id as i32),
        }
    }
}

/// Where the camera's fields sit in `SIMCONNECT_RECV_CAMERA_DATA`, whose `CameraData` holds
/// structs of its own.
struct CameraFields {
    position: usize,
    referential: usize,
    pbh: usize,
    fov: usize,
}

impl CameraFields {
    fn new() -> CameraFields {
        type C = SIMCONNECT_DATA_CAMERA;
        let base = offset_of!(SIMCONNECT_RECV_CAMERA_DATA, CameraData);
        CameraFields {
            position: base + offset_of!(C, Position) + offset_of!(SIMCONNECT_DATA_XYZ, x),
            referential: base + offset_of!(C, PositionReferential),
            pbh: base + offset_of!(C, Pbh) + offset_of!(SIMCONNECT_DATA_PBH, Pitch),
            fov: base + offset_of!(C, Fov),
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
        entry: u32_at(record, offset_of!(R, dwentrynumber))?,
        out_of: u32_at(record, offset_of!(R, dwoutof))?,
        // An answer that found no object may end before its data, which then holds nothing.
        bytes: record.get(start..).map(<[u8]>::to_vec).unwrap_or_default(),
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
        (offset_of!(R, dwentrynumber), d.entry),
        (offset_of!(R, dwoutof), d.out_of),
        (offset_of!(R, dwDefineCount), d.count),
    ] {
        put_u32(&mut r, offset, value);
    }
    set_size(&mut r);
    r
}

/// Writes a message's length into its header, once its variable part is on it.
fn set_size(record: &mut [u8]) {
    let size = record.len() as u32;
    put_u32(record, offset_of!(SIMCONNECT_RECV, dwSize), size);
}

/// An input event's value at `offset`: a number, or else text to the message's end.
fn input_value(record: &[u8], kind: u32, offset: usize) -> Option<Value> {
    if kind == SIMCONNECT_INPUT_EVENT_TYPE_DOUBLE {
        Some(Value::Number(f64_at(record, offset)?))
    } else {
        let len = record.len().checked_sub(offset)?;
        Some(Value::Text(text_at(record, offset, len)?))
    }
}

/// Puts an input event's value at the end of `record`, whose fixed part may end before it.
fn put_input_value(record: &mut Vec<u8>, kind_at: usize, value_at: usize, value: &Value) {
    match value {
        Value::Number(n) => {
            put_u32(record, kind_at, SIMCONNECT_INPUT_EVENT_TYPE_DOUBLE);
            record.resize(value_at + 8, 0);
            put_f64(record, value_at, *n);
        }
        Value::Text(t) => {
            put_u32(record, kind_at, SIMCONNECT_INPUT_EVENT_TYPE_STRING);
            record.resize(value_at + t.len() + 1, 0);
            record[value_at..value_at + t.len()].copy_from_slice(t.as_bytes());
        }
    }
    set_size(record);
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

fn u64_at(record: &[u8], offset: usize) -> Option<u64> {
    let bytes = record.get(offset..offset + 8)?;
    Some(u64::from_le_bytes(bytes.try_into().ok()?))
}

fn put_u64(record: &mut [u8], offset: usize, value: u64) {
    record[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn f64_at(record: &[u8], offset: usize) -> Option<f64> {
    let bytes = record.get(offset..offset + 8)?;
    Some(f64::from_le_bytes(bytes.try_into().ok()?))
}

fn put_f64(record: &mut [u8], offset: usize, value: f64) {
    record[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
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
            Message::EventEx1 {
                group: 2,
                event: 3,
                data: [16_272, 2, 0, 0, 0],
            },
            Message::InputEvents {
                request: 7,
                entry: 0,
                out_of: 1,
                events: vec![
                    InputEvent {
                        name: "ELECTRICAL_Battery_1".into(),
                        hash: 0x1234_5678_9ABC_DEF0,
                    },
                    InputEvent {
                        name: "LIGHTING_BEACON_1".into(),
                        hash: 2,
                    },
                ],
            },
            Message::InputValue {
                request: 8,
                value: Value::Number(1.0),
            },
            Message::InputChanged {
                hash: 9,
                value: Value::Number(0.5),
            },
            Message::InputChanged {
                hash: 9,
                value: Value::Text("on".into()),
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
                entry: 1,
                out_of: 1,
                bytes: 1.5f64.to_le_bytes().to_vec(),
            }),
            Message::ClientData(Data {
                request: 5,
                object: 0,
                definition: 2,
                flags: 0,
                count: 1,
                entry: 1,
                out_of: 1,
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
            Message::Frame {
                event: 4,
                rate: 29.5,
                speed: 1.0,
            },
            Message::Assigned {
                request: 9,
                object: 0x0101,
            },
            Message::Camera(Camera {
                position: [0.22, 0.52, -2.21],
                referential: 1,
                pitch: -6.5,
                yaw: 40.0,
                roll: 0.1,
                fov: 0.9,
            }),
            Message::Other { id: 99 },
        ] {
            assert_eq!(Message::read(&message.record()), Some(message));
        }
    }

    #[test]
    fn a_by_type_answer_reads_as_its_objects_data() {
        let data = Data {
            request: 7,
            object: 0x0102,
            definition: 3,
            flags: 2,
            count: 1,
            entry: 1,
            out_of: 1,
            bytes: 2.5f64.to_le_bytes().to_vec(),
        };
        let mut record = Message::ObjectData(data.clone()).record();
        put_u32(
            &mut record,
            offset_of!(SIMCONNECT_RECV, dwID),
            SIMCONNECT_RECV_ID_SIMOBJECT_DATA_BYTYPE as u32,
        );
        assert_eq!(Message::read(&record), Some(Message::ObjectData(data)));
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
