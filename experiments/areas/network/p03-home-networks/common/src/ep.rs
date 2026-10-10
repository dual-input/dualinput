//! Endpoint builders: iroh for every path iroh chooses, and plain noq, the QUIC library iroh
//! runs on, for the copy that goes through the UDP forwarder, so the two relayed paths differ
//! only in the relay.

use std::net::SocketAddr;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use iroh::endpoint::{PortmapperConfig, QuicTransportConfig, presets};
use iroh::{Endpoint, RelayMap, RelayMode, RelayUrl};
use rustls::pki_types::CertificateDer;

pub const ALPN: &[u8] = b"crosscheck-p02";

#[derive(Clone, Debug, Default)]
pub struct IrohOpts {
    /// Relay URLs; the endpoint picks its home relay among them.
    pub relays: Vec<String>,
    /// False removes iroh's IP transports, so every packet goes through a relay.
    pub ip: bool,
    pub idle: Option<Duration>,
    pub keepalive: Option<Duration>,
    /// A fixed IPv4 socket, which the namespaces' peers need so their port falls in the range
    /// their simulated NAT forwards.
    pub bind_v4: Option<SocketAddr>,
    pub portmapper: bool,
}

pub async fn iroh_endpoint(ca: &CertificateDer<'static>, o: &IrohOpts) -> anyhow::Result<Endpoint> {
    let mut t = QuicTransportConfig::builder();
    if let Some(i) = o.idle {
        t = t.default_path_max_idle_timeout(i);
    }
    if let Some(k) = o.keepalive {
        t = t.default_path_keep_alive_interval(k);
    }
    let relay_mode = if o.relays.is_empty() {
        RelayMode::Disabled
    } else {
        let urls = o
            .relays
            .iter()
            .map(|u| RelayUrl::from_str(u))
            .collect::<Result<Vec<_>, _>>()?;
        RelayMode::Custom(RelayMap::from_iter(urls))
    };
    let mut b = Endpoint::builder(presets::Minimal)
        .relay_mode(relay_mode)
        .ca_tls_config(iroh::tls::CaTlsConfig::custom_roots([ca.clone()]))
        .alpns(vec![ALPN.to_vec()])
        .transport_config(t.build());
    if !o.ip {
        b = b.clear_ip_transports();
    } else if let Some(a) = o.bind_v4 {
        b = b.bind_addr(a)?;
    }
    if !o.portmapper {
        b = b.portmapper_config(PortmapperConfig::Disabled);
    }
    Ok(b.bind().await?)
}

/// noq's transport settings for the forwarder path, matched to iroh's: a 5s keepalive and a
/// 30s idle timeout.
pub fn noq_transport() -> Arc<noq::TransportConfig> {
    let mut t = noq::TransportConfig::default();
    t.keep_alive_interval(Some(Duration::from_secs(5)));
    t.max_idle_timeout(Some(noq::IdleTimeout::try_from(Duration::from_secs(30)).unwrap()));
    Arc::new(t)
}

pub fn noq_client_endpoint() -> anyhow::Result<noq::Endpoint> {
    let ep = noq::Endpoint::client("0.0.0.0:0".parse()?)?;
    ep.set_default_client_config(crate::tls::noq_client(ALPN, noq_transport())?);
    Ok(ep)
}

/// A server endpoint on a socket the caller keeps a second handle to, so it can send the
/// forwarder its registration from the same port QUIC answers on.
pub fn noq_server_endpoint(sock: std::net::UdpSocket) -> anyhow::Result<noq::Endpoint> {
    let cfg = crate::tls::noq_server(ALPN, noq_transport())?;
    Ok(noq::Endpoint::new(
        noq::EndpointConfig::default(),
        Some(cfg),
        sock,
        Arc::new(noq::TokioRuntime),
    )?)
}
