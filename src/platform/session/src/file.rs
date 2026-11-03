//! The session file, `session.json` in the data folder: what a core that restarts needs to
//! come back to its session, from the pilot's start or first join until the session ends for
//! them (record/areas/architecture/01-spine.md, "The session file, and a core that
//! restarts").
//!
//! It holds the session's endpoint key in plain text, which a recording's first input holds
//! too, and which lets whoever holds it act as the pilot's endpoint until the session ends
//! (record/areas/network/02-units.md, "The endpoint key").

use messages::net::{EndpointId, PilotId, Relay};
use messages::unhex;
use serde::{Deserialize, Serialize};

/// `SESSION_FILE` in src/apps/desktop/src/screens.rs names the same file, so change both together.
pub(crate) const NAME: &str = "session.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SessionFile {
    pub(crate) session: String,
    pub(crate) code: String,
    pub(crate) pilot: String,
    pub(crate) name: String,
    /// Raised by 1 each time the core starts while the file exists, and written before the
    /// core opens any link, since a core that sent under a count it hadn't saved would reuse
    /// it after a crash, and the others would drop its messages as copies.
    pub(crate) restart: u32,
    /// The run of the sim the pilot was last in: its process's ID and creation time.
    pub(crate) run: Option<(u32, u64)>,
    pub(crate) key: String,
    pub(crate) relays: Vec<Relay>,
    /// Each other member's pilot ID and endpoint ID.
    pub(crate) crew: Vec<(String, String)>,
}

impl SessionFile {
    pub(crate) fn encode(&self) -> Vec<u8> {
        serde_json::to_vec_pretty(self).expect("serde_json should write the session file")
    }

    pub(crate) fn decode(bytes: &[u8]) -> Option<SessionFile> {
        serde_json::from_slice(bytes).ok()
    }

    pub(crate) fn pilot(&self) -> Option<PilotId> {
        unhex(&self.pilot)
    }

    pub(crate) fn key(&self) -> Option<[u8; 32]> {
        unhex(&self.key)
    }

    pub(crate) fn crew(&self) -> Vec<(PilotId, EndpointId)> {
        self.crew
            .iter()
            .filter_map(|(pilot, endpoint)| Some((unhex(pilot)?, unhex(endpoint)?)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use messages::hex;

    #[test]
    fn a_session_file_reads_back_what_it_wrote() {
        let file = SessionFile {
            session: "3e7d1f2a-5b6c-4d8e-9f0a-1b2c3d4e5f6a".into(),
            code: "KX7P3M".into(),
            pilot: hex(&[7; 16]),
            name: "James".into(),
            restart: 2,
            run: Some((4242, 133_000_000_000_000_000)),
            key: hex(&[9; 32]),
            relays: vec![],
            crew: vec![(hex(&[8; 16]), hex(&[6; 32]))],
        };
        let read = SessionFile::decode(&file.encode()).unwrap();
        assert_eq!(read, file);
        assert_eq!(read.pilot(), Some([7; 16]));
        assert_eq!(read.key(), Some([9; 32]));
        assert_eq!(read.crew(), vec![([8; 16], [6; 32])]);
    }
}
