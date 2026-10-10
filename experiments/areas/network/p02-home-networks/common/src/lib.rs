//! What the tester, the peer, and the station share.

pub mod clock;
pub mod clocksync;
pub mod config;
pub mod ep;
pub mod proto;
pub mod rawlog;
pub mod stun;
pub mod sysmon;
pub mod tls;
pub mod traffic;
pub mod wire;

/// Makes ring the process's TLS provider. reqwest's `rustls-no-provider` feature, which iroh
/// picks, panics on building a client without one, and not every client here gets our
/// preconfigured TLS: the tester reads the router's UPnP description over plain HTTP.
pub fn install_crypto() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// A random 32-bit tag that both ends log a traffic run under.
pub fn new_tag() -> u32 {
    rand::random::<u32>()
}
