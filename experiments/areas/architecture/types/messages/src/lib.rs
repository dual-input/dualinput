//! p07's messages: shapes like the ones Crosscheck's core trades with the sim's
//! pages, the desktop app, and plugins. Every type derives for all three
//! generators at once, so ts-rs, specta, and typeshare read one definition.
//!
//! The shapes cover what a generator can get wrong: an internally tagged enum
//! with struct variants and `rename_all_fields`, an adjacently tagged enum with
//! newtype variants, a unit enum, an `Option` that serializes as `null`, one
//! that's skipped when empty, a `Vec`, a map, a UUID carried as text, and a time
//! in µs as a `u64`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use uuid::Uuid;

/// One pilot in the session.
#[derive(Serialize, Deserialize, ts_rs::TS, specta::Type, Debug, Clone, PartialEq)]
#[typeshare]
#[serde(rename_all = "camelCase")]
pub struct Pilot {
    pub id: Uuid,
    pub name: String,
    pub ready: bool,
    pub restart_count: u32,
}

/// How serious a notice is.
#[derive(Serialize, Deserialize, ts_rs::TS, specta::Type, Debug, Clone, PartialEq)]
#[typeshare]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Warning,
    Error,
}

/// The session as the core holds it.
#[derive(Serialize, Deserialize, ts_rs::TS, specta::Type, Debug, Clone, PartialEq)]
#[typeshare]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub session: Uuid,
    pub pilots: Vec<Pilot>,
    /// `null` while nobody flies.
    pub flying: Option<Uuid>,
    /// µs on the core's monotonic clock.
    #[cfg_attr(feature = "specta-number", specta(type = specta_typescript::Number))]
    pub sent_at_us: u64,
}

/// A notice for the banner.
#[derive(Serialize, Deserialize, ts_rs::TS, specta::Type, Debug, Clone, PartialEq)]
#[typeshare]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub text: String,
    pub level: Level,
    /// Left out of the JSON, not sent as `null`, when there's no entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
}

/// Values a plugin exported, by name.
#[derive(Serialize, Deserialize, ts_rs::TS, specta::Type, Debug, Clone, PartialEq)]
#[typeshare]
#[serde(rename_all = "camelCase")]
pub struct Exports {
    pub values: BTreeMap<String, f64>,
}

/// What the core sends a page or a plugin: adjacently tagged, so each message is
/// `{ "kind": ..., "body": ... }`.
#[derive(Serialize, Deserialize, ts_rs::TS, specta::Type, Debug, Clone, PartialEq)]
#[typeshare]
#[serde(tag = "kind", content = "body", rename_all = "camelCase")]
pub enum FromCore {
    Session(SessionState),
    Notice(Notice),
    Exports(Exports),
}

/// What a page or a plugin sends the core: internally tagged, so each message is
/// one flat object with a `kind` field.
#[derive(Serialize, Deserialize, ts_rs::TS, specta::Type, Debug, Clone, PartialEq)]
#[typeshare]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ToCore {
    Hello { component: String, version: String, schema: String },
    Heartbeat,
    PointerPress {
        instrument: String,
        x: f32,
        y: f32,
        #[cfg_attr(feature = "specta-number", specta(type = specta_typescript::Number))]
        sent_at_us: u64,
    },
    HEvent { name: String },
}

/// Sample values for the probe, with the `ToCore` each one's plugin reply should
/// equal. The last session's time is 2^53 + 1µs, the first integer a JavaScript
/// number can't hold.
pub fn samples() -> Vec<(FromCore, ToCore)> {
    let a = Uuid::parse_str("6f1c2a4e-8b3d-4c5e-9a7f-1b2c3d4e5f60").unwrap();
    let b = Uuid::parse_str("0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d").unwrap();
    let s = Uuid::parse_str("3e7d1f2a-5b6c-4d8e-9f0a-1b2c3d4e5f6a").unwrap();
    let pilots = vec![
        Pilot { id: a, name: "James".into(), ready: true, restart_count: 0 },
        Pilot { id: b, name: "Adam".into(), ready: false, restart_count: 2 },
    ];
    let session = |flying, sent_at_us| FromCore::Session(SessionState { session: s, pilots: pilots.clone(), flying, sent_at_us });
    vec![
        (
            session(Some(a), 1_234_567_890_123),
            ToCore::PointerPress { instrument: "James".into(), x: 0.5, y: 0.25, sent_at_us: 1_234_567_890_124 },
        ),
        (
            session(None, 9_007_199_254_740_993),
            ToCore::PointerPress { instrument: "James".into(), x: 0.5, y: 0.25, sent_at_us: 9_007_199_254_740_994 },
        ),
        (
            FromCore::Notice(Notice { text: "Couldn't sync the beacon.".into(), level: Level::Warning, entry: Some("beacon".into()) }),
            ToCore::HEvent { name: "beacon".into() },
        ),
        (
            FromCore::Notice(Notice { text: "Catching up...".into(), level: Level::Error, entry: None }),
            ToCore::Heartbeat,
        ),
        (
            FromCore::Exports(Exports { values: BTreeMap::from([("radarRange".into(), 40.0), ("wxMode".into(), 2.0)]) }),
            ToCore::Hello { component: "plugin".into(), version: "0.1.0".into(), schema: "42".into() },
        ),
    ]
}
