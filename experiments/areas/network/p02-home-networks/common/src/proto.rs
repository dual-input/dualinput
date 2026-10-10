//! The stations' HTTPS API, as JSON bodies.

use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// An iroh `EndpointAddr` as JSON: the endpoint's ID, its home relay, and its direct addresses.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AddrJson {
    pub id: String,
    pub relay: Option<String>,
    pub ips: Vec<String>,
}

impl AddrJson {
    pub fn from_addr(a: &iroh::EndpointAddr) -> AddrJson {
        AddrJson {
            id: a.id.to_string(),
            relay: a.relay_urls().next().map(|u| u.to_string()),
            ips: a.ip_addrs().map(|s| s.to_string()).collect(),
        }
    }

    pub fn to_addr(&self) -> anyhow::Result<iroh::EndpointAddr> {
        let id = iroh::EndpointId::from_str(&self.id)?;
        let mut a = iroh::EndpointAddr::new(id);
        if let Some(r) = &self.relay {
            a = a.with_relay_url(iroh::RelayUrl::from_str(r)?);
        }
        for ip in &self.ips {
            a = a.with_ip_addr(ip.parse()?);
        }
        Ok(a)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HelloReq {
    pub run_id: String,
    pub build: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HelloResp {
    pub station: String,
    /// The address the request came from, as the station saw it.
    pub your_addr: String,
    pub wall_us: i64,
    pub build: String,
}

/// A tester's registration with the intro station, sent every 20s while it runs or serves.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegisterReq {
    pub run_id: String,
    pub side: AddrJson,
    pub near: String,
    pub phase: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TesterInfo {
    pub run_id: String,
    pub side: AddrJson,
    pub near: String,
    pub phase: String,
    pub since_s: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TestersResp {
    pub testers: Vec<TesterInfo>,
}

/// Asks a peer for a fresh iroh endpoint: `target` is `home` or a namespace, and `relay` names
/// the station whose relay the endpoint uses.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EndpointReq {
    pub target: String,
    pub relay: String,
    pub ip: bool,
    pub idle_ms: Option<u64>,
    pub keepalive_ms: Option<u64>,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EndpointResp {
    pub addr: AddrJson,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ForwardReq {
    pub target: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ForwardResp {
    pub port_a: u16,
    pub server_name: String,
}

/// Loss on the caller's IPv4 address, both ways, for `secs`, after which the station clears
/// it by itself. `mode` is `clear`, `loss`, or `burst`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetemReq {
    pub mode: String,
    pub loss_pct: f64,
    pub burst_ms: u64,
    pub burst_every_ms: u64,
    pub secs: u64,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NetemResp {
    pub ip: String,
    pub wall_us: i64,
}

/// Drops everything between the caller's IPv4 address and a namespace's peer, for `secs` at
/// most.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FirewallReq {
    pub target: String,
    pub drop: bool,
    pub secs: u64,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CaptureReq {
    pub secs: u64,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BurstReq {
    pub run_id: String,
    pub begin: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BurstResp {
    pub granted: bool,
}

/// Asks a station to send one control datagram to an address that never sent to it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UdpSendReq {
    pub to: String,
    pub nonce: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WallResp {
    pub wall_us: i64,
}

/// A command the station hands a peer through its long poll.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeerCmd {
    pub id: u64,
    pub op: String,
    pub args: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeerReply {
    pub id: u64,
    pub ok: bool,
    pub result: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeerEndpointArgs {
    pub relay_url: String,
    pub ip: bool,
    pub idle_ms: Option<u64>,
    pub keepalive_ms: Option<u64>,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PeerForwardArgs {
    /// The forwarder's peer-side address, which the peer registers with.
    pub fwd: String,
    pub token: String,
    pub label: String,
}

/// The first line on a connection's control stream, from the side that opened it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrafficStart {
    pub tag: u32,
    pub secs: f64,
    /// `session` sends all three streams; `flight` sends only the flight model.
    pub profile: String,
    pub label: String,
}
