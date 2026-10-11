//! p07: how a connection comes back after everything between two endpoints stops for a while.
//!
//! Both endpoints list both relays and keep their IP transports, so the connection runs on a
//! direct path with the relay as backup. Both send the flight-model stream the whole time. When
//! the connection closes, the endpoint with the lower ID dials again, starting an attempt every
//! 2s until one connects; the other only accepts. Each endpoint logs its home relay's status
//! whenever it changes, its path events, every packet, and the wall clock each second, which
//! lines its stamps up with the outage script's.
//!
//!   p07 listen --key <seed hex> --deploy <deploy.json> --timers default|v1 --out <log>
//!   p07 dial   --key <seed hex> --deploy <deploy.json> --timers default|v1 --out <log>
//!              --peer <base64 AddrJson> --secs <how long to run>

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use iroh::endpoint::{Connection, QuicTransportConfig, presets};
use iroh::{Endpoint, RelayMap, RelayMode, RelayUrl, SecretKey, Watcher};
use p02_common::clock::{mono_us, wall_us};
use p02_common::config::Deploy;
use p02_common::ep::ALPN;
use p02_common::proto::AddrJson;
use p02_common::rawlog::RawLog;
use p02_common::traffic::{Link, attach, send_for};
use serde_json::json;

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}

fn hex32(s: &str) -> Result<[u8; 32]> {
    let v: Vec<u8> = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16)).collect::<Result<_, _>>()?;
    v.try_into().map_err(|_| anyhow!("key must be 32 bytes"))
}

fn b64_decode(s: &str) -> Result<Vec<u8>> {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut buf, mut bits) = (0u32, 0);
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

/// `default` keeps iroh's path timers, a 15s idle timeout and a 5s keep-alive; `v1` uses the 2s
/// idle timeout 2.3 accepted, with the keep-alive at a third of it.
async fn endpoint(deploy: &Deploy, key: [u8; 32], timers: &str) -> Result<Endpoint> {
    let urls = deploy.stations.iter().map(|s| s.relay_url().parse::<RelayUrl>()).collect::<Result<Vec<_>, _>>()?;
    let mut t = QuicTransportConfig::builder();
    if timers == "v1" {
        t = t.default_path_max_idle_timeout(Duration::from_secs(2)).default_path_keep_alive_interval(Duration::from_millis(667));
    }
    Ok(Endpoint::builder(presets::Minimal)
        .secret_key(SecretKey::from_bytes(&key))
        .relay_mode(RelayMode::Custom(RelayMap::from_iter(urls)))
        .ca_tls_config(iroh::tls::CaTlsConfig::custom_roots([deploy.ca_der()?]))
        .alpns(vec![ALPN.to_vec()])
        .transport_config(t.build())
        .bind()
        .await?)
}

fn watch_endpoint(ep: &Endpoint, log: &RawLog) {
    let (ep, log) = (ep.clone(), log.clone());
    tokio::spawn(async move {
        let mut w = ep.home_relay_status();
        let mut last = String::new();
        let mut tick = 0u32;
        loop {
            let now: Vec<String> = w.get().iter().map(|s| format!("{} connected={}", s.url(), s.is_connected())).collect();
            let s = now.join("; ");
            if s != last {
                log.rec("home", json!({"w": wall_us(), "status": now}));
                last = s;
            }
            if tick % 10 == 0 {
                log.rec("clk", json!({"w": wall_us()}));
            }
            tick += 1;
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
}

/// Runs one connection: logs it, sends the flight-model stream on it until it closes, and returns
/// when it closes.
async fn run_conn(conn: Connection, log: RawLog, cid: u32, label: &str) {
    log.rec("connected", json!({"c": cid, "w": wall_us(), "label": label, "remote": conn.remote_id().to_string()}));
    let link = Link::Iroh(conn.clone());
    attach(&link, &log, cid, label);
    let (l, g) = (link.clone(), log.clone());
    let tag = p02_common::new_tag();
    tokio::spawn(async move { send_for(&l, &g, cid, tag, "flight", 86_400.0, None).await });
    let reason = conn.closed().await;
    log.rec("conn_closed", json!({"c": cid, "w": wall_us(), "reason": reason.to_string()}));
}

#[tokio::main]
async fn main() -> Result<()> {
    p02_common::install_crypto();
    let mode = std::env::args().nth(1).context("listen or dial")?;
    let deploy = Deploy::parse(&std::fs::read_to_string(arg("--deploy").context("--deploy")?)?)?;
    let timers = arg("--timers").unwrap_or_else(|| "default".into());
    let key = hex32(&arg("--key").context("--key")?)?;
    let log = RawLog::create(std::path::Path::new(&arg("--out").context("--out")?))?;
    let ep = endpoint(&deploy, key, &timers).await?;
    watch_endpoint(&ep, &log);
    let online = tokio::time::timeout(Duration::from_secs(15), ep.online()).await.is_ok();
    let addr = AddrJson::from_addr(&ep.addr());
    log.rec("start", json!({"mode": mode, "timers": timers, "w": wall_us(), "online": online, "id": addr.id}));
    let next = Arc::new(AtomicU32::new(1));

    if mode == "listen" {
        println!("ADDR {}", serde_json::to_string(&addr)?);
        while let Some(inc) = ep.accept().await {
            let (log, next) = (log.clone(), next.clone());
            tokio::spawn(async move {
                match inc.accept() {
                    Ok(a) => match a.await {
                        Ok(conn) => run_conn(conn, log, next.fetch_add(1, Ordering::Relaxed), "accepted").await,
                        Err(e) => log.rec("accept_err", json!({"w": wall_us(), "e": e.to_string()})),
                    },
                    Err(e) => log.rec("accept_err", json!({"w": wall_us(), "e": e.to_string()})),
                }
            });
        }
        return Ok(());
    }

    let peer = serde_json::from_slice::<AddrJson>(&b64_decode(&arg("--peer").context("--peer")?)?)?.to_addr()?;
    let secs: u64 = arg("--secs").map(|s| s.parse().unwrap_or(700)).unwrap_or(700);
    let end = tokio::time::Instant::now() + Duration::from_secs(secs);
    let mut attempt = 0u32;
    while tokio::time::Instant::now() < end {
        // An attempt every 2s, each left to run, until the first connects.
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Connection>(4);
        let conn = loop {
            attempt += 1;
            let (ep, peer, tx, log) = (ep.clone(), peer.clone(), tx.clone(), log.clone());
            let n = attempt;
            tokio::spawn(async move {
                let t0 = mono_us();
                log.rec("dial", json!({"attempt": n, "w": wall_us()}));
                match tokio::time::timeout(Duration::from_secs(30), ep.connect(peer, ALPN)).await {
                    Ok(Ok(c)) => {
                        log.rec("dial_ok", json!({"attempt": n, "w": wall_us(), "us": mono_us() - t0}));
                        let _ = tx.send(c).await;
                    }
                    Ok(Err(e)) => log.rec("dial_err", json!({"attempt": n, "w": wall_us(), "us": mono_us() - t0, "e": e.to_string()})),
                    Err(_) => log.rec("dial_err", json!({"attempt": n, "w": wall_us(), "e": "no answer in 30s"})),
                }
            });
            tokio::select! {
                Some(c) = rx.recv() => break Some(c),
                _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                _ = tokio::time::sleep_until(end) => break None,
            }
        };
        let Some(conn) = conn else { break };
        // Any later attempt that also connects gets closed, so one connection carries the traffic.
        tokio::spawn(async move {
            while let Some(extra) = rx.recv().await {
                extra.close(0u32.into(), b"duplicate");
            }
        });
        let cid = next.fetch_add(1, Ordering::Relaxed);
        tokio::select! {
            _ = run_conn(conn.clone(), log.clone(), cid, "dialed") => {}
            _ = tokio::time::sleep_until(end) => { conn.close(0u32.into(), b"done"); }
        }
    }
    log.rec("end", json!({"w": wall_us()}));
    ep.close().await;
    log.flush();
    Ok(())
}
