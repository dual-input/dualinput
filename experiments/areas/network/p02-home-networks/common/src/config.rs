//! Where the stations are and the certificate authority every TLS link trusts.
//!
//! `deploy/` writes this as `deploy/generated/deploy.json` once the droplets exist, and the
//! tester builds it in, so a friend's copy needs no settings.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};

use serde::{Deserialize, Serialize};

pub const API_PORT: u16 = 4443;
pub const STUN_PORT: u16 = 3478;
pub const CTL_PORT: u16 = 3479;
pub const ALT_PORT: u16 = 3480;
pub const SINK_PORT: u16 = 9000;
pub const RELAY_QAD_PORT: u16 = 7842;

/// The namespaces each station runs a peer in, one per simulated NAT.
pub const NAT_TARGETS: [&str; 3] = ["eim", "apdf", "sym"];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Deploy {
    /// Changes with each build sent to friends, so an upload says which build made it.
    pub build: String,
    pub ca_pem: String,
    pub stations: Vec<StationCfg>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StationCfg {
    /// `fra` or `nyc`.
    pub name: String,
    pub ipv4: Ipv4Addr,
    pub ipv6: Option<Ipv6Addr>,
    /// The station that introduces testers to each other and takes uploads first.
    pub intro: bool,
}

impl StationCfg {
    pub fn api_url(&self) -> String {
        format!("https://{}:{}", self.ipv4, API_PORT)
    }
    pub fn relay_url(&self) -> String {
        format!("https://{}/", self.ipv4)
    }
    pub fn stun(&self) -> SocketAddr {
        SocketAddr::new(self.ipv4.into(), STUN_PORT)
    }
    pub fn stun_v6(&self) -> Option<SocketAddr> {
        self.ipv6.map(|a| SocketAddr::new(a.into(), STUN_PORT))
    }
    pub fn ctl(&self) -> SocketAddr {
        SocketAddr::new(self.ipv4.into(), CTL_PORT)
    }
    pub fn sink(&self) -> SocketAddr {
        SocketAddr::new(self.ipv4.into(), SINK_PORT)
    }
}

impl Deploy {
    pub fn parse(json: &str) -> anyhow::Result<Deploy> {
        Ok(serde_json::from_str(json)?)
    }
    pub fn station(&self, name: &str) -> Option<&StationCfg> {
        self.stations.iter().find(|s| s.name == name)
    }
    pub fn intro(&self) -> &StationCfg {
        self.stations.iter().find(|s| s.intro).unwrap_or(&self.stations[0])
    }
    pub fn ca_der(&self) -> anyhow::Result<rustls::pki_types::CertificateDer<'static>> {
        use rustls::pki_types::pem::PemObject;
        Ok(rustls::pki_types::CertificateDer::from_pem_slice(self.ca_pem.as_bytes())?)
    }
}
