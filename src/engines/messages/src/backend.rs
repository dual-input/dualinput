//! The backend's request and answer bodies, as JSON, which ts-rs writes the Worker's
//! TypeScript types from (record/areas/network/02-units.md, "Its requests").
//!
//! The backend running is always the newest release's, and answers older releases' cores
//! too, so a released path's bodies never change: a change to one takes a new path beside
//! it, as `/v2/lookup` beside `/v1/lookup`, and each path's literal-JSON tests in src/backend/
//! are never edited after its release (record/areas/build/01-the-build.md, "The backend").
//!
//! Every request but a lookup carries the member's endpoint ID in `ENDPOINT_HEADER` and an
//! Ed25519 signature over the body's bytes by the endpoint key in `SIGNATURE_HEADER`, each as
//! lowercase hex. src/backend/src/index.ts names the same paths and headers, so change both
//! together.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::net::Relay;

pub const SESSIONS: &str = "/v1/sessions";
pub const LOOKUP: &str = "/v1/lookup";
pub const MEMBERS: &str = "/v1/members";
pub const LEAVE: &str = "/v1/members/leave";

pub const ENDPOINT_HEADER: &str = "DualInput-Endpoint";
pub const SIGNATURE_HEADER: &str = "DualInput-Signature";

/// A member's entry, which each member writes about itself
/// (record/areas/session/01-roles-and-members.md, "The member list").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "backend/")]
pub struct Entry {
    /// The pilot's ID, as 32 hex digits.
    pub pilot: String,
    pub name: String,
    pub kind: Kind,
    /// The member's endpoint ID, as 64 hex digits.
    pub endpoint: String,
}

/// Crew in v1, and passenger once join modes come, so a passenger's entry needs no new path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "backend/")]
pub enum Kind {
    Crew,
    Passenger,
}

/// `POST /v1/sessions`: a host asks for a code. The answer is `Created`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "backend/")]
pub struct NewSession {
    /// The session's ID, a UUID.
    pub session: String,
    pub relays: Vec<Relay>,
    pub host: Entry,
    pub version: String,
    pub hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "backend/")]
pub struct Created {
    pub code: String,
}

/// `POST /v1/lookup`: a joiner, or a core back from a restart, looks a code up. The answer
/// is `LookedUp`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "backend/")]
pub struct Lookup {
    pub code: String,
    pub version: String,
    pub hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "answer", rename_all = "kebab-case")]
#[ts(export, export_to = "backend/")]
pub enum LookedUp {
    /// The session, with every member renewed within the last 30 minutes.
    Found {
        session: String,
        relays: Vec<Relay>,
        crew: Vec<Entry>,
    },
    /// No session has the code, or none of its members renewed within 30 minutes.
    NoSuchCode,
    /// The session's host runs another version of Dual Input, and `older` says whose is
    /// older, so the pilot knows who should update.
    OtherVersion { older: Older },
    /// The same version, built from other messages, as two development builds can be.
    OtherHash,
    /// This address got 20 codes wrong this hour.
    TooManyWrongCodes,
}

/// Whose version is older, as the core that looked the code up sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "backend/")]
pub enum Older {
    Mine,
    Theirs,
}

/// `POST /v1/members`: a member lists itself, or renews its entry, every 10 minutes. The
/// answer is `Taken`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "backend/")]
pub struct Renew {
    pub code: String,
    pub member: Entry,
}

/// `POST /v1/members/leave`: a member leaves. The answer is `Taken`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "backend/")]
pub struct Leave {
    pub code: String,
    /// The leaving member's endpoint ID, as 64 hex digits.
    pub endpoint: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "backend/")]
pub struct Taken {}

/// The body of every answer whose status isn't 200: a request that didn't read, a
/// signature that didn't match, or a code no session holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "backend/")]
pub struct Refused {
    pub error: String,
}
