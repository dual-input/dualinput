//! The peer testers connect to: one on our PC behind a real home router, and one in each
//! droplet namespace behind a simulated NAT. It takes commands from the stations by long
//! poll, makes a fresh iroh endpoint or a forwarder session for each, and sends and logs
//! session traffic on whatever connects to it.
//!
//! Usage: `p02-peer <peer.json>`, where the file names the peer, the stations it polls, the
//! deploy file, its data folder, and for a namespace the port range its NAT forwards.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU16, AtomicU32, Ordering};
use std::time::Duration;

use p02_common::clock::wall_us;
use p02_common::config::Deploy;
use p02_common::ep::{IrohOpts, iroh_endpoint, noq_server_endpoint};
use p02_common::proto::*;
use p02_common::rawlog::RawLog;
use p02_common::traffic::{Link, attach, control_accept, send_for};
use p02_common::wire::REG_PREFIX;
use serde::Deserialize;
use serde_json::json;

#[derive(Clone, Debug, Deserialize)]
struct PeerFile {
    name: String,
    deploy: PathBuf,
    data_dir: PathBuf,
    /// Station names to poll; our PC's peer polls both, a namespace's only its own.
    stations: Vec<String>,
    /// Stations to sample the clock against.
    clock: Vec<String>,
    port_range: Option<(u16, u16)>,
}

struct Peer {
    cfg: PeerFile,
    deploy: Deploy,
    log: RawLog,
    next_cid: AtomicU32,
    next_port: AtomicU16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    p02_common::install_crypto();
    let path = std::env::args().nth(1).ok_or_else(|| anyhow::anyhow!("usage: p02-peer <peer.json>"))?;
    let cfg: PeerFile = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
    let deploy = Deploy::parse(&std::fs::read_to_string(&cfg.deploy)?)?;
    std::fs::create_dir_all(&cfg.data_dir)?;
    let file = cfg.data_dir.join(format!("peer-{}-{}.ndjson", cfg.name, wall_us()));
    let log = RawLog::create(&file)?;
    p02_common::rawlog::install_tracing(log.clone(), "warn,iroh=debug,iroh_relay=info,noq=info,portmapper=info");
    log.rec("peer_start", json!({"name": cfg.name, "build": deploy.build, "wall_us": wall_us(), "stations": cfg.stations}));
    p02_common::sysmon::tune_process();
    p02_common::sysmon::keep_awake(true);
    p02_common::sysmon::snapshot(&log);
    p02_common::sysmon::start_monitors(log.clone());
    println!("p02-peer {} logging to {}", cfg.name, file.display());

    let start_port = cfg.port_range.map(|r| r.0).unwrap_or(0);
    let peer = Arc::new(Peer { cfg, deploy, log, next_cid: AtomicU32::new(1), next_port: AtomicU16::new(start_port) });

    let (_stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    for name in &peer.cfg.clock {
        if let Some(s) = peer.deploy.station(name) {
            tokio::spawn(p02_common::clocksync::clock_loop(peer.log.clone(), s.name.clone(), s.ctl(), Duration::from_secs(10), stop_rx.clone()));
        }
    }
    let mut polls = tokio::task::JoinSet::new();
    for name in peer.cfg.stations.clone() {
        let p = peer.clone();
        polls.spawn(async move { poll_loop(p, name).await });
    }
    while polls.join_next().await.is_some() {}
    Ok(())
}

async fn poll_loop(peer: Arc<Peer>, station: String) {
    let Some(st) = peer.deploy.station(&station).cloned() else { return };
    let ca = peer.deploy.ca_der().expect("CA");
    let http = p02_common::tls::http_client(ca, Duration::from_secs(40)).expect("http client");
    let url = format!("{}/v1/peer/poll?name={}", st.api_url(), peer.cfg.name);
    let mut fails = 0u32;
    loop {
        match http.get(&url).send().await {
            Ok(r) if r.status() == reqwest::StatusCode::NO_CONTENT => fails = 0,
            Ok(r) if r.status().is_success() => {
                fails = 0;
                match r.json::<PeerCmd>().await {
                    Ok(cmd) => {
                        let (p, h, base) = (peer.clone(), http.clone(), st.api_url());
                        tokio::spawn(async move {
                            let reply = handle(&p, &cmd).await;
                            p.log.rec("cmd_done", json!({"station": station_name(&base), "id": cmd.id, "op": cmd.op, "ok": reply.ok, "result": reply.result}));
                            let _ = h.post(format!("{base}/v1/peer/reply")).json(&reply).send().await;
                        });
                    }
                    Err(e) => peer.log.rec("poll_err", json!({"station": station, "e": e.to_string()})),
                }
            }
            Ok(r) => {
                fails += 1;
                peer.log.rec("poll_err", json!({"station": station, "status": r.status().as_u16()}));
            }
            Err(e) => {
                fails += 1;
                peer.log.rec("poll_err", json!({"station": station, "e": e.to_string()}));
            }
        }
        if fails > 0 {
            tokio::time::sleep(Duration::from_secs(fails.min(10) as u64)).await;
        }
    }
}

fn station_name(base: &str) -> String {
    base.to_string()
}

async fn handle(peer: &Arc<Peer>, cmd: &PeerCmd) -> PeerReply {
    let r = match cmd.op.as_str() {
        "endpoint" => match serde_json::from_value::<PeerEndpointArgs>(cmd.args.clone()) {
            Ok(a) => new_endpoint(peer, a).await,
            Err(e) => Err(e.to_string()),
        },
        "forward" => match serde_json::from_value::<PeerForwardArgs>(cmd.args.clone()) {
            Ok(a) => new_forward(peer, a).await,
            Err(e) => Err(e.to_string()),
        },
        other => Err(format!("unknown op {other}")),
    };
    match r {
        Ok(v) => PeerReply { id: cmd.id, ok: true, result: v },
        Err(e) => PeerReply { id: cmd.id, ok: false, result: json!(e) },
    }
}

fn next_bind(peer: &Peer) -> Option<SocketAddr> {
    let (lo, hi) = peer.cfg.port_range?;
    let p = peer.next_port.fetch_add(1, Ordering::Relaxed);
    let port = if p < lo || p > hi {
        peer.next_port.store(lo + 1, Ordering::Relaxed);
        lo
    } else {
        p
    };
    Some(SocketAddr::from(([0, 0, 0, 0], port)))
}

async fn new_endpoint(peer: &Arc<Peer>, a: PeerEndpointArgs) -> Result<serde_json::Value, String> {
    let ca = peer.deploy.ca_der().map_err(|e| e.to_string())?;
    let mut last_err = String::new();
    // A namespace's port may still be held by an endpoint that's closing, so try a few.
    for _ in 0..5 {
        let opts = IrohOpts {
            relays: vec![a.relay_url.clone()],
            ip: a.ip,
            idle: a.idle_ms.map(Duration::from_millis),
            keepalive: a.keepalive_ms.map(Duration::from_millis),
            bind_v4: next_bind(peer),
            portmapper: true,
        };
        let t0 = p02_common::clock::mono_us();
        let ep = match iroh_endpoint(&ca, &opts).await {
            Ok(ep) => ep,
            Err(e) => {
                last_err = e.to_string();
                continue;
            }
        };
        let online = tokio::time::timeout(Duration::from_secs(10), ep.online()).await.is_ok();
        let addr = ep.addr();
        let aj = AddrJson::from_addr(&addr);
        peer.log.rec(
            "endpoint",
            json!({"label": a.label, "id": aj.id, "addr": aj, "online": online, "bound": ep.bound_sockets().iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                   "ip": a.ip, "idle_ms": a.idle_ms, "keepalive_ms": a.keepalive_ms, "setup_us": p02_common::clock::mono_us() - t0}),
        );
        let p = peer.clone();
        let label = a.label.clone();
        tokio::spawn(async move { serve_endpoint(p, ep, label).await });
        return Ok(json!(EndpointResp { addr: aj }));
    }
    Err(last_err)
}

/// Accepts connections on a fresh endpoint until none has come or lived for 2 minutes, and
/// closes it after at most 30 minutes.
async fn serve_endpoint(peer: Arc<Peer>, ep: iroh::Endpoint, label: String) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(1800);
    loop {
        let inc = tokio::select! {
            i = ep.accept() => i,
            _ = tokio::time::sleep(Duration::from_secs(120)) => None,
            _ = tokio::time::sleep_until(deadline) => None,
        };
        let Some(inc) = inc else { break };
        let t0 = p02_common::clock::mono_us();
        let conn = match inc.accept() {
            Ok(a) => match a.await {
                Ok(c) => c,
                Err(e) => {
                    peer.log.rec("accept_err", json!({"label": label, "e": e.to_string()}));
                    continue;
                }
            },
            Err(e) => {
                peer.log.rec("accept_err", json!({"label": label, "e": e.to_string()}));
                continue;
            }
        };
        let cid = peer.next_cid.fetch_add(1, Ordering::Relaxed);
        peer.log.rec("accepted", json!({"c": cid, "label": label, "remote_id": conn.remote_id().to_string(), "handshake_us": p02_common::clock::mono_us() - t0}));
        let link = Link::Iroh(conn);
        attach(&link, &peer.log, cid, &label);
        serve_link(peer.clone(), link, cid).await;
    }
    ep.close().await;
    peer.log.rec("endpoint_closed", json!({"label": label}));
}

/// Answers each control stream the tester opens with traffic of the same shape, until the
/// connection closes.
async fn serve_link(peer: Arc<Peer>, link: Link, cid: u32) {
    loop {
        tokio::select! {
            r = control_accept(&link) => match r {
                Ok(start) => {
                    peer.log.rec("traffic_start", json!({"c": cid, "start": start}));
                    let (l, g) = (link.clone(), peer.log.clone());
                    tokio::spawn(async move { send_for(&l, &g, cid, start.tag, &start.profile, start.secs, None).await });
                }
                Err(_) => break,
            },
            reason = link.closed() => {
                peer.log.rec("closed", json!({"c": cid, "reason": reason}));
                break;
            }
        }
    }
}

async fn new_forward(peer: &Arc<Peer>, a: PeerForwardArgs) -> Result<serde_json::Value, String> {
    let fwd: SocketAddr = a.fwd.parse().map_err(|e| format!("{e}"))?;
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let reg = sock.try_clone().map_err(|e| e.to_string())?;
    let local = sock.local_addr().map_err(|e| e.to_string())?;
    let ep = noq_server_endpoint(sock).map_err(|e| e.to_string())?;
    let mut msg = REG_PREFIX.to_vec();
    msg.extend_from_slice(a.token.as_bytes());
    let _ = reg.send_to(&msg, fwd);
    peer.log.rec("forward", json!({"label": a.label, "fwd": a.fwd, "local": local.to_string()}));

    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let done = done.clone();
        std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let _ = reg.send_to(&msg, fwd);
                std::thread::sleep(Duration::from_secs(2));
            }
        });
    }
    let p = peer.clone();
    let label = a.label.clone();
    tokio::spawn(async move {
        let inc = tokio::time::timeout(Duration::from_secs(60), ep.accept()).await;
        if let Ok(Some(inc)) = inc {
            match inc.await {
                Ok(conn) => {
                    let cid = p.next_cid.fetch_add(1, Ordering::Relaxed);
                    p.log.rec("accepted", json!({"c": cid, "label": label, "kind": "noq",
                        "remote": conn.path(noq::PathId::ZERO).and_then(|p| p.remote_address().ok()).map(|a| a.to_string())}));
                    let link = Link::Noq(conn);
                    attach(&link, &p.log, cid, &label);
                    serve_link(p.clone(), link, cid).await;
                }
                Err(e) => p.log.rec("accept_err", json!({"label": label, "e": e.to_string()})),
            }
        } else {
            p.log.rec("accept_err", json!({"label": label, "e": "no connection within 60s"}));
        }
        done.store(true, Ordering::Relaxed);
        ep.close(0u32.into(), b"done");
        p.log.rec("forward_closed", json!({"label": label}));
    });
    Ok(json!({"server_name": "p02-peer", "local": local.to_string()}))
}
