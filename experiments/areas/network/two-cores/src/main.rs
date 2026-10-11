//! p04: whether two iroh endpoints in two processes on one PC, each with its own key and its
//! own port, connect to each other over the PC's own addresses with no relay, as two cores on
//! a developer's PC would (architecture plan, node 2).
//!
//!   p04-two-cores listen            prints its address as one JSON line, then echoes
//!   p04-two-cores dial <json>       connects to that address and times 20 round trips

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::str::FromStr;
use std::time::{Duration, Instant};

use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode};
use serde_json::{Value, json};

const ALPN: &[u8] = b"crosscheck-p04";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let ep = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await?;
    match args.get(1).map(String::as_str) {
        Some("listen") => listen(ep).await,
        Some("dial") => dial(ep, args.get(2).map(String::as_str).unwrap_or("")).await,
        _ => anyhow::bail!("usage: p04-two-cores listen | dial <json>"),
    }
}

/// The endpoint's direct addresses, waiting up to 2s for iroh to list its interfaces, plus
/// the loopback address of each socket it bound to every interface.
async fn own_addrs(ep: &Endpoint) -> Vec<SocketAddr> {
    let t0 = Instant::now();
    let mut addrs: Vec<SocketAddr> = ep.addr().ip_addrs().copied().collect();
    while addrs.is_empty() && t0.elapsed() < Duration::from_secs(2) {
        tokio::time::sleep(Duration::from_millis(50)).await;
        addrs = ep.addr().ip_addrs().copied().collect();
    }
    for s in ep.bound_sockets() {
        let lo = match s.ip() {
            IpAddr::V4(ip) if ip.is_unspecified() => Some(IpAddr::V4(Ipv4Addr::LOCALHOST)),
            IpAddr::V6(ip) if ip.is_unspecified() => Some(IpAddr::V6(Ipv6Addr::LOCALHOST)),
            _ => None,
        };
        if let Some(lo) = lo {
            addrs.push(SocketAddr::new(lo, s.port()));
        }
    }
    addrs
}

fn paths_json(conn: &iroh::endpoint::Connection) -> Value {
    Value::Array(
        conn.paths()
            .iter()
            .map(|p| json!({"remote": format!("{:?}", p.remote_addr()), "ip": p.is_ip(), "selected": p.is_selected(), "rtt_us": p.rtt().as_micros() as u64}))
            .collect(),
    )
}

async fn listen(ep: Endpoint) -> anyhow::Result<()> {
    let addrs = own_addrs(&ep).await;
    println!(
        "{}",
        json!({"role": "listen", "pid": std::process::id(), "id": ep.id().to_string(),
               "addrs": addrs.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
               "bound": ep.bound_sockets().iter().map(|s| s.to_string()).collect::<Vec<_>>()})
    );
    let inc = tokio::time::timeout(Duration::from_secs(30), ep.accept())
        .await?
        .ok_or_else(|| anyhow::anyhow!("endpoint closed before a connection came"))?;
    let conn = inc.accept()?.await?;
    let (mut send, mut recv) = conn.accept_bi().await?;
    let mut buf = [0u8; 8];
    let mut echoed = 0u32;
    while recv.read_exact(&mut buf).await.is_ok() {
        send.write_all(&buf).await?;
        echoed += 1;
    }
    println!(
        "{}",
        json!({"role": "listen", "accepted_from": conn.remote_id().to_string(), "echoed": echoed, "paths": paths_json(&conn)})
    );
    let _ = tokio::time::timeout(Duration::from_secs(5), conn.closed()).await;
    ep.close().await;
    Ok(())
}

async fn dial(ep: Endpoint, arg: &str) -> anyhow::Result<()> {
    let l: Value = serde_json::from_str(arg)?;
    let listener_id = EndpointId::from_str(l["id"].as_str().unwrap_or(""))?;
    let mut addr = EndpointAddr::new(listener_id);
    for a in l["addrs"].as_array().into_iter().flatten() {
        addr = addr.with_ip_addr(a.as_str().unwrap_or("").parse()?);
    }
    let t0 = Instant::now();
    let conn = tokio::time::timeout(Duration::from_secs(10), ep.connect(addr, ALPN)).await??;
    let connect_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let (mut send, mut recv) = conn.open_bi().await?;
    let mut rtts_us = Vec::new();
    let mut buf = [0u8; 8];
    for i in 0u64..20 {
        let t = Instant::now();
        send.write_all(&i.to_le_bytes()).await?;
        recv.read_exact(&mut buf).await?;
        anyhow::ensure!(u64::from_le_bytes(buf) == i, "echo {i} came back wrong");
        rtts_us.push(t.elapsed().as_micros() as u64);
    }
    let mut sorted = rtts_us.clone();
    sorted.sort_unstable();
    println!(
        "{}",
        json!({"role": "dial", "pid": std::process::id(), "id": ep.id().to_string(),
               "bound": ep.bound_sockets().iter().map(|s| s.to_string()).collect::<Vec<_>>(),
               "remote_id_matches": conn.remote_id() == listener_id,
               "connect_ms": connect_ms, "round_trips": rtts_us.len(),
               "rtt_us_min": sorted[0], "rtt_us_median": sorted[sorted.len() / 2], "rtt_us_max": sorted[sorted.len() - 1],
               "paths": paths_json(&conn)})
    );
    send.finish()?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    conn.close(0u32.into(), b"done");
    ep.close().await;
    Ok(())
}
