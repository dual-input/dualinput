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

/// An invite code is this many characters from this alphabet, which leaves out I, L, O, U, 0,
/// and 1, since a pilot reads a code aloud and types it while looking at a sim
/// (record/areas/product/03-v1-scope.md, "Invite code"). `ALPHABET` and `LENGTH` in
/// src/backend/src/codes.ts hold the same two values, so change both together.
pub const CODE_ALPHABET: &str = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
pub const CODE_LENGTH: usize = 6;

/// The invite code `text` holds, as a pilot copied it, with the spaces around it and any
/// lowercase forgiven; `None` for any other text.
pub fn invite_code(text: &str) -> Option<String> {
    let code = text.trim().to_ascii_uppercase();
    (code.len() == CODE_LENGTH && code.chars().all(|c| CODE_ALPHABET.contains(c))).then_some(code)
}

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
    /// The session's host runs another version of Dual Input, `theirs`, and `older` says whose
    /// is older, so the pilot knows who should update.
    OtherVersion { older: Older, theirs: String },
    /// The same version, built from other messages, as two development builds can be.
    OtherHash,
    /// This address got 20 codes wrong this hour, and `until` is when the next begins, in UTC, as
    /// `2026-10-20T15:00:00.000Z`.
    TooManyWrongCodes { until: String },
}

/// Whose version is older, as the core that looked the code up sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "backend/")]
pub enum Older {
    Mine,
    Theirs,
}

/// Whose version is older, `mine` or `theirs`: each version's numbers compared in turn, a
/// missing one as 0, with a pre-release or build part, as in `1.0.0-dev`, left out. `older` in
/// src/backend/src/index.ts reads x.y.z versions the same way, so change both together.
pub fn older(mine: &str, theirs: &str) -> Older {
    let numbers = |version: &str| -> Vec<u64> {
        version
            .split(['-', '+'])
            .next()
            .unwrap_or(version)
            .split('.')
            .map(|number| number.parse().unwrap_or(0))
            .collect()
    };
    let (mine, theirs) = (numbers(mine), numbers(theirs));
    for at in 0..mine.len().max(theirs.len()) {
        let (a, b) = (
            mine.get(at).copied().unwrap_or(0),
            theirs.get(at).copied().unwrap_or(0),
        );
        if a != b {
            return if a < b { Older::Mine } else { Older::Theirs };
        }
    }
    Older::Theirs
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

#[cfg(test)]
mod tests {
    use super::{Older, older};

    #[test]
    fn a_version_reads_by_its_numbers_with_its_suffix_left_out() {
        assert_eq!(older("0.9.0", "0.10.0"), Older::Mine);
        assert_eq!(older("1.0.0", "0.10.0"), Older::Theirs);
        assert_eq!(older("1.0.0-dev", "1.0.1"), Older::Mine);
        assert_eq!(older("1.0.1+build.5", "1.0.0"), Older::Theirs);
        assert_eq!(
            older("1.0", "1.0.1"),
            Older::Mine,
            "a missing number reads as 0"
        );
    }
}
