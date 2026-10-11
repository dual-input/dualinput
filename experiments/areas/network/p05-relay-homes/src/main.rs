//! p05: which relay carries each direction when two endpoints home at different relays.
//!
//! Both endpoints list both relays and have no IP transports, so every packet is relayed, and
//! each picks the relay nearest it as home. The dialer sends flight-model traffic for a phase,
//! then asks the listener to send for a phase, and both log their paths each half second.
//!
//!   p05 listen --name B --deploy <deploy.json> --out <log>
//!   p05 dial   --name A --deploy <deploy.json> --out <log> --peer <base64 AddrJson> [--secs 10]

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use iroh::endpoint::{QuicTransportConfig, presets};
use iroh::{Endpoint, RelayMap, RelayMode, RelayUrl, Watcher};
use p02_common::clock::{mono_us, wall_us};
use p02_common::config::Deploy;
use p02_common::ep::ALPN;
use p02_common::proto::{AddrJson, TrafficStart};
use p02_common::rawlog::RawLog;
use p02_common::traffic::{Link, attach, control_accept, control_open, send_for};
use serde_json::json;

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}

fn b64_decode(s: &str) -> Result<Vec<u8>> {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes().filter(|c| *c != b'=') {
        let v = T.iter().position(|x| *x == c).ok_or_else(|| anyhow!("bad base64"))? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
}

async fn endpoint(deploy: &Deploy) -> Result<Endpoint> {
    let urls = deploy.stations.iter().map(|s| s.relay_url().parse::<RelayUrl>()).collect::<Result<Vec<_>, _>>()?;
    Ok(Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Custom(RelayMap::from_iter(urls)))
        .ca_tls_config(iroh::tls::CaTlsConfig::custom_roots([deploy.ca_der()?]))
        .alpns(vec![ALPN.to_vec()])
        .transport_config(QuicTransportConfig::builder().build())
        .clear_ip_transports()
        .bind()
        .await?)
}

/// Logs the home relay's status whenever it changes, and the paths of the connection each half
/// second, with the wall clock beside, so samples of the relays' sockets line up.
fn watch(ep: &Endpoint, log: &RawLog) {
    let (ep, log) = (ep.clone(), log.clone());
    tokio::spawn(async move {
        let mut w = ep.home_relay_status();
        let mut last = String::new();
        loop {
            let now: Vec<String> = w.get().iter().map(|s| format!("{} connected={}", s.url(), s.is_connected())).collect();
            let s = now.join("; ");
            if s != last {
                log.rec("home", json!({"w": wall_us(), "status": now}));
                last = s;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
}

fn watch_paths(conn: &iroh::endpoint::Connection, log: &RawLog, cid: u32) {
    let (conn, log) = (conn.clone(), log.clone());
    tokio::spawn(async move {
        loop {
            if conn.close_reason().is_some() {
                break;
            }
            let paths: Vec<serde_json::Value> = conn
                .paths()
                .iter()
                .map(|p| {
                    let s = p.stats();
                    json!({"id": format!("{:?}", p.id()), "remote": format!("{:?}", p.remote_addr()), "sel": p.is_selected(),
                           "tx_b": s.udp_tx.bytes, "rx_b": s.udp_rx.bytes, "rtt_us": s.rtt.as_micros() as u64})
                })
                .collect();
            log.rec("paths", json!({"c": cid, "w": wall_us(), "paths": paths}));
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    });
}

#[tokio::main]
async fn main() -> Result<()> {
    p02_common::install_crypto();
    let mode = std::env::args().nth(1).context("listen or dial")?;
    let name = arg("--name").unwrap_or_else(|| "?".into());
    let deploy = Deploy::parse(&std::fs::read_to_string(arg("--deploy").context("--deploy")?)?)?;
    let log = RawLog::create(std::path::Path::new(&arg("--out").context("--out")?))?;
    let secs: f64 = arg("--secs").map(|s| s.parse().unwrap_or(10.0)).unwrap_or(10.0);

    let ep = endpoint(&deploy).await?;
    watch(&ep, &log);
    let online = tokio::time::timeout(Duration::from_secs(15), ep.online()).await.is_ok();
    let addr = AddrJson::from_addr(&ep.addr());
    log.rec("start", json!({"name": name, "mode": mode, "w": wall_us(), "online": online, "addr": addr}));
    let cid = Arc::new(std::sync::atomic::AtomicU32::new(1));

    if mode == "listen" {
        println!("ADDR {}", serde_json::to_string(&addr)?);
        while let Some(inc) = ep.accept().await {
            let conn = inc.accept()?.await?;
            let c = cid.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            log.rec("accepted", json!({"c": c, "w": wall_us(), "remote": conn.remote_id().to_string()}));
            let link = Link::Iroh(conn.clone());
            attach(&link, &log, c, "p05-listen");
            watch_paths(&conn, &log, c);
            let (l, g) = (link.clone(), log.clone());
            tokio::spawn(async move {
                while let Ok(start) = control_accept(&l).await {
                    g.rec("phase", json!({"c": c, "w": wall_us(), "what": "listener sends", "secs": start.secs}));
                    send_for(&l, &g, c, start.tag, &start.profile, start.secs, None).await;
                }
            });
        }
        return Ok(());
    }

    let peer: AddrJson = serde_json::from_slice(&b64_decode(&arg("--peer").context("--peer")?)?)?;
    let t0 = mono_us();
    let conn = ep.connect(peer.to_addr()?, ALPN).await?;
    log.rec("connected", json!({"c": 1, "w": wall_us(), "connect_us": mono_us() - t0, "remote": peer}));
    let link = Link::Iroh(conn.clone());
    attach(&link, &log, 1, "p05-dial");
    watch_paths(&conn, &log, 1);
    tokio::time::sleep(Duration::from_secs(3)).await;

    let tag = p02_common::new_tag();
    log.rec("phase", json!({"c": 1, "w": wall_us(), "what": "dialer sends", "secs": secs, "g": tag}));
    send_for(&link, &log, 1, tag, "flight", secs, None).await;
    log.rec("phase", json!({"c": 1, "w": wall_us(), "what": "quiet"}));
    tokio::time::sleep(Duration::from_secs(3)).await;

    let tag = p02_common::new_tag();
    log.rec("phase", json!({"c": 1, "w": wall_us(), "what": "dialer asks listener to send", "secs": secs, "g": tag}));
    control_open(&link, &TrafficStart { tag, secs, profile: "flight".into(), label: "p05".into() })
        .await
        .map_err(|e| anyhow!(e))?;
    tokio::time::sleep(Duration::from_secs_f64(secs + 3.0)).await;
    log.rec("phase", json!({"c": 1, "w": wall_us(), "what": "end"}));
    conn.close(0u32.into(), b"done");
    ep.close().await;
    log.flush();
    Ok(())
}
