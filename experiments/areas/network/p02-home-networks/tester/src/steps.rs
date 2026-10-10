//! Steps 3 to 6 and 8 of 2.3. Each connection gets its own number (`c`) in the file, a `conn`
//! record saying what it was for, and the traffic, path, and event records the traffic module
//! writes; each step adds one summary record per attempt or run.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use iroh::endpoint::Connection;
use p02_common::config::StationCfg;
use p02_common::ep::{ALPN, IrohOpts, iroh_endpoint, noq_client_endpoint};
use p02_common::proto::*;
use p02_common::traffic::{Link, attach, control_open, send_for};
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;

use crate::ctx::Ctx;

/// What the window calls each target.
fn target_words(t: &str) -> &'static str {
    match t {
        "eim" => "a copy behind a simulated router that keeps one public port and lets anyone in",
        "apdf" => "a copy behind a simulated router that keeps one public port and lets in only addresses it has sent to",
        "sym" => "a copy behind a simulated router that picks a new public port for each destination",
        _ => "the copy on another tester's computer",
    }
}

async fn peer_endpoint(ctx: &Ctx, api: &StationCfg, target: &str, relay: &StationCfg, ip: bool, idle_ms: Option<u64>, keepalive_ms: Option<u64>, label: &str) -> Result<iroh::EndpointAddr, String> {
    let req = EndpointReq { target: target.into(), relay: relay.name.clone(), ip, idle_ms, keepalive_ms, label: label.into() };
    let r: EndpointResp = ctx.post(api, "/v1/peer/endpoint", &req).await?;
    r.addr.to_addr().map_err(|e| e.to_string())
}

async fn own_endpoint(ctx: &Ctx, relays: &[&StationCfg], ip: bool, idle: Option<Duration>, keepalive: Option<Duration>) -> Result<iroh::Endpoint, String> {
    let opts = IrohOpts {
        relays: relays.iter().map(|s| s.relay_url()).collect(),
        ip,
        idle,
        keepalive,
        bind_v4: None,
        portmapper: true,
    };
    iroh_endpoint(&ctx.ca, &opts).await.map_err(|e| e.to_string())
}

/// Polls the connection's paths every 20ms until one that matches is selected.
async fn wait_selected(conn: &Connection, direct: bool, timeout: Duration) -> Option<Duration> {
    let t0 = Instant::now();
    while t0.elapsed() < timeout {
        if conn.paths().iter().any(|p| p.is_selected() && p.is_ip() == direct) {
            return Some(t0.elapsed());
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    None
}

fn paths_json(conn: &Connection) -> Value {
    Value::Array(
        conn.paths()
            .iter()
            .map(|p| json!({"id": format!("{:?}", p.id()), "remote": format!("{:?}", p.remote_addr()), "relay": p.is_relay(), "sel": p.is_selected(), "rtt_us": p.rtt().as_micros() as u64}))
            .collect(),
    )
}

/// Step 6 of 2.3, run first: 30s of session traffic on a direct link to the near station's
/// easiest NAT, then 60s of it beside four TCP streams filling the upload toward the near
/// station, then 30s more.
pub async fn burst(ctx: &Ctx) -> Result<(), String> {
    let near = ctx.near.clone();
    ctx.ui.action("Connecting to a copy of this program on our server");
    let addr = peer_endpoint(ctx, &near, "eim", &near, true, None, None, "burst").await?;
    let ep = own_endpoint(ctx, &[&near], true, None, None).await?;
    let conn = ep.connect(addr, ALPN).await.map_err(|e| e.to_string())?;
    let cid = ctx.cid();
    let link = Link::Iroh(conn.clone());
    attach(&link, &ctx.log, cid, "burst");
    let direct = wait_selected(&conn, true, Duration::from_secs(15)).await;
    ctx.log.rec("burst_link", json!({"c": cid, "direct_ms": direct.map(|d| d.as_millis() as u64), "paths": paths_json(&conn)}));
    let tag = p02_common::new_tag();
    let (before, during) = if ctx.quick { (10, 20) } else { (30, 60) };
    let total = (2 * before + during) as f64 + 5.0;
    control_open(&link, &TrafficStart { tag, secs: total, profile: "session".into(), label: "burst".into() }).await?;
    let (l, g) = (link.clone(), ctx.log.clone());
    let sender = tokio::spawn(async move { send_for(&l, &g, cid, tag, "session", total, None).await });

    ctx.ui.action("Measuring delays before the upload");
    if ctx.sleep(Duration::from_secs(before)).await {
        conn.close(0u32.into(), b"stopped");
        return Ok(());
    }
    let mut granted = false;
    let wait0 = Instant::now();
    while wait0.elapsed() < Duration::from_secs(60) {
        let r: Result<BurstResp, String> = ctx.post(&near, "/v1/burst", &BurstReq { run_id: ctx.run_id.clone(), begin: true }).await;
        if r.is_ok_and(|b| b.granted) {
            granted = true;
            break;
        }
        ctx.ui.action("Waiting for another tester's upload to finish");
        if ctx.sleep(Duration::from_secs(5)).await {
            break;
        }
    }
    if granted {
        ctx.ui.action("Uploading at full speed to our server");
        upload_streams(ctx, near.sink(), Duration::from_secs(during)).await;
        let _: Result<BurstResp, String> = ctx.post(&near, "/v1/burst", &BurstReq { run_id: ctx.run_id.clone(), begin: false }).await;
    } else {
        ctx.log.rec("burst_skipped", json!({"why": "another tester held the upload slot for 60s"}));
        ctx.ui.note("Another tester was using our server's upload slot, so the full-speed minute was skipped.");
    }
    ctx.ui.action("Measuring delays after the upload");
    let _ = sender.await;
    conn.close(0u32.into(), b"done");
    ep.close().await;
    Ok(())
}

async fn upload_streams(ctx: &Ctx, sink: SocketAddr, dur: Duration) {
    let buf: Arc<Vec<u8>> = Arc::new((0..64 * 1024).map(|_| rand::random::<u8>()).collect());
    let mut set = tokio::task::JoinSet::new();
    let t_end = tokio::time::Instant::now() + dur;
    for i in 0..4u32 {
        let (log, buf) = (ctx.log.clone(), buf.clone());
        set.spawn(async move {
            let t0 = Instant::now();
            let mut s = match tokio::time::timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(sink)).await {
                Ok(Ok(s)) => s,
                Ok(Err(e)) => {
                    log.rec("upload_stream", json!({"i": i, "err": e.to_string()}));
                    return;
                }
                Err(_) => {
                    log.rec("upload_stream", json!({"i": i, "err": "connect timed out"}));
                    return;
                }
            };
            log.rec("upload_stream", json!({"i": i, "connect_ms": t0.elapsed().as_millis() as u64}));
            let mut window: u64 = 0;
            let mut total: u64 = 0;
            let mut tick = p02_common::clock::mono_us();
            while tokio::time::Instant::now() < t_end {
                match tokio::time::timeout_at(t_end, s.write_all(&buf)).await {
                    Ok(Ok(())) => {
                        window += buf.len() as u64;
                        total += buf.len() as u64;
                    }
                    _ => break,
                }
                let now = p02_common::clock::mono_us();
                if now - tick >= 100_000 {
                    log.rec_at(now, "upload_tx", json!({"i": i, "bytes": window, "us": now - tick}));
                    window = 0;
                    tick = now;
                }
            }
            let _ = s.shutdown().await;
            log.rec("upload_stream_end", json!({"i": i, "total": total}));
        });
    }
    while set.join_next().await.is_some() {}
}

/// Step 3: about 10 fresh connections to each target, taken in turn, each with fresh endpoints
/// on both sides, each lasting until 3s after a direct link is selected, or 20s.
pub async fn connect(ctx: &Ctx) -> (u32, u32) {
    let near = ctx.near.clone();
    let mut targets: Vec<&str> = vec!["eim", "apdf", "sym", "home"];
    let mut made = 0u32;
    let mut direct_n = 0u32;
    let rounds = if ctx.quick { 2 } else { 10 };
    let total = rounds * targets.len();
    let mut n = 0;
    for round in 0..rounds {
        for t in targets.clone() {
            if ctx.stopped() {
                return (made, direct_n);
            }
            n += 1;
            ctx.ui.action(format!("Connection {n} of {total}: {}", target_words(t)));
            let label = format!("connect-{t}-{round}");
            let t0 = Instant::now();
            let addr = match peer_endpoint(ctx, &near, t, &near, true, None, None, &label).await {
                Ok(a) => a,
                Err(e) => {
                    ctx.log.rec("attempt", json!({"target": t, "round": round, "err": format!("peer endpoint: {e}")}));
                    if t == "home" {
                        targets.retain(|x| *x != "home");
                        ctx.ui.note("The copy on another tester's computer isn't answering, so connections to it are skipped.");
                    }
                    continue;
                }
            };
            let peer_ms = t0.elapsed().as_millis() as u64;
            let t1 = Instant::now();
            let ep = match own_endpoint(ctx, &[&near], true, None, None).await {
                Ok(e) => e,
                Err(e) => {
                    ctx.log.rec("attempt", json!({"target": t, "round": round, "err": format!("own endpoint: {e}")}));
                    continue;
                }
            };
            let online = tokio::time::timeout(Duration::from_secs(10), ep.online()).await.is_ok();
            let online_ms = t1.elapsed().as_millis() as u64;
            let t2 = Instant::now();
            let conn = match tokio::time::timeout(Duration::from_secs(15), ep.connect(addr.clone(), ALPN)).await {
                Ok(Ok(c)) => c,
                other => {
                    let e = match other {
                        Ok(Err(e)) => e.to_string(),
                        _ => "timed out after 15s".into(),
                    };
                    ctx.log.rec("attempt", json!({"target": t, "round": round, "peer_ms": peer_ms, "online": online, "online_ms": online_ms, "err": format!("connect: {e}"), "addr": AddrJson::from_addr(&addr)}));
                    ep.close().await;
                    continue;
                }
            };
            let connect_ms = t2.elapsed().as_millis() as u64;
            made += 1;
            let cid = ctx.cid();
            let link = Link::Iroh(conn.clone());
            attach(&link, &ctx.log, cid, &label);
            let tag = p02_common::new_tag();
            let _ = control_open(&link, &TrafficStart { tag, secs: 23.0, profile: "flight".into(), label: label.clone() }).await;
            let (l, g) = (link.clone(), ctx.log.clone());
            tokio::spawn(async move { send_for(&l, &g, cid, tag, "flight", 23.0, None).await });
            let direct = wait_selected(&conn, true, Duration::from_secs(20)).await;
            if direct.is_some() {
                direct_n += 1;
                ctx.sleep(Duration::from_secs(3)).await;
            }
            ctx.log.rec(
                "attempt",
                json!({"c": cid, "target": t, "round": round, "peer_ms": peer_ms, "online": online, "online_ms": online_ms,
                       "connect_ms": connect_ms, "direct_ms": direct.map(|d| d.as_millis() as u64), "paths": paths_json(&conn),
                       "addr": AddrJson::from_addr(&addr), "own": AddrJson::from_addr(&ep.addr())}),
            );
            conn.close(0u32.into(), b"done");
            ep.close().await;
        }
    }
    (made, direct_n)
}

/// Step 4: against the near station's easiest NAT, at path idle timeouts of 15s, 5s, and 2s,
/// twice each: the firewall drops the direct link mid-session, and we time the move to the
/// relay and, once the drop lifts, the move back.
pub async fn switch(ctx: &Ctx) {
    let near = ctx.near.clone();
    let mut n = 0;
    let (idles, reps): (&[u64], u32) = if ctx.quick { (&[5, 2], 1) } else { (&[15, 5, 2], 2) };
    for &idle_s in idles {
        for rep in 0..reps {
            if ctx.stopped() {
                return;
            }
            n += 1;
            let idle = Duration::from_secs(idle_s);
            let keepalive = idle / 3;
            let label = format!("switch-{idle_s}s-{rep}");
            ctx.ui.action(format!("Run {n} of {}: a connection that gives up on a silent path after {idle_s} seconds", idles.len() as u32 * reps));
            let r = switch_once(ctx, &near, idle, keepalive, &label).await;
            if let Err(e) = r {
                ctx.log.rec("switch", json!({"label": label, "err": e}));
            }
        }
    }
}

async fn switch_once(ctx: &Ctx, near: &StationCfg, idle: Duration, keepalive: Duration, label: &str) -> Result<(), String> {
    let addr = peer_endpoint(ctx, near, "eim", near, true, Some(idle.as_millis() as u64), Some(keepalive.as_millis() as u64), label).await?;
    let ep = own_endpoint(ctx, &[near], true, Some(idle), Some(keepalive)).await?;
    let conn = tokio::time::timeout(Duration::from_secs(15), ep.connect(addr, ALPN))
        .await
        .map_err(|_| "connect timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let cid = ctx.cid();
    let link = Link::Iroh(conn.clone());
    attach(&link, &ctx.log, cid, label);
    let tag = p02_common::new_tag();
    control_open(&link, &TrafficStart { tag, secs: 150.0, profile: "session".into(), label: label.into() }).await?;
    let (l, g) = (link.clone(), ctx.log.clone());
    tokio::spawn(async move { send_for(&l, &g, cid, tag, "session", 150.0, None).await });

    let direct = wait_selected(&conn, true, Duration::from_secs(15)).await;
    let mut rec = json!({"c": cid, "label": label, "idle_ms": idle.as_millis() as u64, "keepalive_ms": keepalive.as_millis() as u64,
                         "direct_ms": direct.map(|d| d.as_millis() as u64)});
    if direct.is_none() {
        rec["err"] = json!("never went direct");
        ctx.log.rec("switch", rec);
        conn.close(0u32.into(), b"done");
        ep.close().await;
        return Ok(());
    }
    ctx.sleep(Duration::from_secs(5)).await;
    let drop_t = p02_common::clock::mono_us();
    let _: Value = ctx.post(near, "/v1/firewall", &FirewallReq { target: "eim".into(), drop: true, secs: 90, label: label.into() }).await?;
    let to_relay = wait_selected(&conn, false, idle + Duration::from_secs(25)).await;
    rec["drop_t"] = json!(drop_t);
    rec["to_relay_ms"] = json!(to_relay.map(|d| d.as_millis() as u64));
    ctx.sleep(Duration::from_secs(10)).await;
    let lift_t = p02_common::clock::mono_us();
    let _: Value = ctx.post(near, "/v1/firewall", &FirewallReq { target: "eim".into(), drop: false, secs: 0, label: label.into() }).await?;
    let back = wait_selected(&conn, true, Duration::from_secs(60)).await;
    rec["lift_t"] = json!(lift_t);
    rec["back_ms"] = json!(back.map(|d| d.as_millis() as u64));
    rec["paths"] = paths_json(&conn);
    ctx.log.rec("switch", rec);
    ctx.sleep(Duration::from_secs(3)).await;
    conn.close(0u32.into(), b"done");
    ep.close().await;
    Ok(())
}

/// Step 5: eight runs of 150s, alternating the near and far stations, at no loss, 1%, 3%, and
/// bursts, each sending the same session traffic at once through the station's iroh relay,
/// with direct addresses off, and through its UDP forwarder.
pub async fn relay(ctx: &Ctx) -> u32 {
    let modes: [(&str, f64); 4] = [("clear", 0.0), ("loss", 1.0), ("loss", 3.0), ("burst", 0.0)];
    let stations = ctx.stations();
    let total = modes.len() * stations.len();
    let mut n = 0;
    let mut done = 0;
    let mut target = "home".to_string();
    for (mode, pct) in modes {
        for st in &stations {
            if ctx.stopped() {
                return done;
            }
            n += 1;
            let what = match mode {
                "clear" => "no packets dropped".to_string(),
                "loss" => format!("{pct}% of packets dropped"),
                _ => "a 70 ms outage every 10 seconds".to_string(),
            };
            let city = if st.name == "fra" { "Frankfurt" } else if st.name == "nyc" { "New York" } else { st.name.as_str() };
            ctx.ui.action(format!("Run {n} of {total}: through {city}, {what}"));
            let label = format!("relay-{}-{}-{}", st.name, mode, pct);
            match relay_once(ctx, st, &target, mode, pct, &label).await {
                Ok(()) => done += 1,
                Err(e) => {
                    ctx.log.rec("relay_run", json!({"label": label, "target": target, "err": e}));
                    if target == "home" && e.contains("peer home") {
                        target = "eim".into();
                        ctx.ui.note("The copy on another tester's computer isn't answering, so the relay runs use a copy on our server instead.");
                        if relay_once(ctx, st, &target, mode, pct, &label).await.is_ok() {
                            done += 1;
                        }
                    }
                }
            }
        }
    }
    done
}

async fn relay_once(ctx: &Ctx, st: &StationCfg, target: &str, mode: &str, pct: f64, label: &str) -> Result<(), String> {
    #[allow(non_snake_case)]
    let RUN_S: f64 = if ctx.quick { 20.0 } else { 150.0 };
    let addr = peer_endpoint(ctx, st, target, st, false, None, None, label).await?;
    let ep = own_endpoint(ctx, &[st], false, None, None).await?;
    let conn = tokio::time::timeout(Duration::from_secs(20), ep.connect(addr, ALPN))
        .await
        .map_err(|_| "iroh connect timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let fwd: ForwardResp = ctx.post(st, "/v1/forward/open", &ForwardReq { target: target.into(), label: label.into() }).await?;
    let qep = noq_client_endpoint().map_err(|e| e.to_string())?;
    let qaddr = SocketAddr::new(st.ipv4.into(), fwd.port_a);
    let qconn = tokio::time::timeout(Duration::from_secs(15), qep.connect(qaddr, &fwd.server_name).map_err(|e| e.to_string())?)
        .await
        .map_err(|_| "forwarder connect timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let (ci, cq) = (ctx.cid(), ctx.cid());
    let (li, lq) = (Link::Iroh(conn.clone()), Link::Noq(qconn.clone()));
    attach(&li, &ctx.log, ci, &format!("{label}-iroh"));
    attach(&lq, &ctx.log, cq, &format!("{label}-udp"));
    let (ti, tq) = (p02_common::new_tag(), p02_common::new_tag());
    control_open(&li, &TrafficStart { tag: ti, secs: RUN_S, profile: "session".into(), label: format!("{label}-iroh") }).await?;
    control_open(&lq, &TrafficStart { tag: tq, secs: RUN_S, profile: "session".into(), label: format!("{label}-udp") }).await?;
    let _: Result<Value, String> = ctx.post(st, "/v1/capture", &CaptureReq { secs: RUN_S as u64 + 10, label: label.into() }).await;
    let netem = NetemReq { mode: mode.into(), loss_pct: pct, burst_ms: 70, burst_every_ms: 10_000, secs: RUN_S as u64 + 5, label: label.into() };
    let applied: Result<NetemResp, String> = ctx.post(st, "/v1/netem", &netem).await;
    ctx.log.rec("relay_run", json!({"label": label, "target": target, "iroh_c": ci, "udp_c": cq, "iroh_tag": ti, "udp_tag": tq,
                                     "mode": mode, "pct": pct, "netem": applied.as_ref().map(|a| json!(a)).unwrap_or_else(|e| json!({"err": e})),
                                     "iroh_paths": paths_json(&conn)}));
    let (g1, g2) = (ctx.log.clone(), ctx.log.clone());
    let (a, b) = (li.clone(), lq.clone());
    let s1 = tokio::spawn(async move { send_for(&a, &g1, ci, ti, "session", RUN_S, None).await });
    let s2 = tokio::spawn(async move { send_for(&b, &g2, cq, tq, "session", RUN_S, None).await });
    let _ = s1.await;
    let _ = s2.await;
    let _: Result<NetemResp, String> =
        ctx.post(st, "/v1/netem", &NetemReq { mode: "clear".into(), loss_pct: 0.0, burst_ms: 0, burst_every_ms: 0, secs: 0, label: label.into() }).await;
    // Let the last packets land before closing.
    tokio::time::sleep(Duration::from_secs(2)).await;
    conn.close(0u32.into(), b"done");
    qconn.close(0u32.into(), b"done");
    ep.close().await;
    qep.close(0u32.into(), b"done");
    Ok(())
}

/// Step 8: whenever the intro station lists another tester, the one with the lower run ID
/// dials the other's side endpoint, times the link as step 3 does, and both send session
/// traffic for 5 minutes. It runs beside every other step, and on after the run while the
/// program serves as a peer.
pub async fn side_manager(ctx: Arc<Ctx>, phase: Arc<std::sync::Mutex<String>>) {
    let intro = ctx.deploy.intro().clone();
    let tried: Arc<std::sync::Mutex<HashSet<String>>> = Default::default();
    {
        let ctx = ctx.clone();
        let tried = tried.clone();
        tokio::spawn(async move { side_accept(ctx, tried).await });
    }
    loop {
        let reg = RegisterReq {
            run_id: ctx.run_id.clone(),
            side: AddrJson::from_addr(&ctx.side.addr()),
            near: ctx.near.name.clone(),
            phase: phase.lock().unwrap().clone(),
        };
        let _: Result<Value, String> = ctx.post(&intro, "/v1/register", &reg).await;
        if let Ok(list) = ctx.get::<TestersResp>(&intro, &format!("/v1/testers?run_id={}", ctx.run_id)).await {
            for t in list.testers {
                let fresh = tried.lock().unwrap().insert(t.run_id.clone());
                if fresh && ctx.run_id < t.run_id {
                    let ctx = ctx.clone();
                    tokio::spawn(async move { side_dial(ctx, t).await });
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(20)).await;
    }
}

async fn side_dial(ctx: Arc<Ctx>, t: TesterInfo) {
    let Ok(addr) = t.side.to_addr() else { return };
    let t0 = Instant::now();
    let conn = match tokio::time::timeout(Duration::from_secs(20), ctx.side.connect(addr, ALPN)).await {
        Ok(Ok(c)) => c,
        other => {
            let e = match other {
                Ok(Err(e)) => e.to_string(),
                _ => "timed out".into(),
            };
            ctx.log.rec("side", json!({"other": t.run_id, "role": "dial", "err": e}));
            return;
        }
    };
    let connect_ms = t0.elapsed().as_millis() as u64;
    let cid = ctx.cid();
    let link = Link::Iroh(conn.clone());
    attach(&link, &ctx.log, cid, &format!("side-{}", t.run_id));
    let tag = p02_common::new_tag();
    let secs = 300.0;
    if let Err(e) = control_open(&link, &TrafficStart { tag, secs, profile: "session".into(), label: format!("side-{}", ctx.run_id) }).await {
        ctx.log.rec("side", json!({"other": t.run_id, "role": "dial", "err": e}));
        return;
    }
    let (l, g) = (link.clone(), ctx.log.clone());
    let sender = tokio::spawn(async move { send_for(&l, &g, cid, tag, "session", secs, None).await });
    let direct = wait_selected(&conn, true, Duration::from_secs(20)).await;
    ctx.log.rec("side", json!({"c": cid, "other": t.run_id, "role": "dial", "connect_ms": connect_ms, "direct_ms": direct.map(|d| d.as_millis() as u64), "paths": paths_json(&conn)}));
    let _ = sender.await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    conn.close(0u32.into(), b"done");
}

async fn side_accept(ctx: Arc<Ctx>, tried: Arc<std::sync::Mutex<HashSet<String>>>) {
    let paused = Arc::new(AtomicBool::new(false));
    while let Some(inc) = ctx.side.accept().await {
        let ctx = ctx.clone();
        let paused = paused.clone();
        let tried = tried.clone();
        tokio::spawn(async move {
            let Ok(acc) = inc.accept() else { return };
            let Ok(conn) = acc.await else { return };
            let cid = ctx.cid();
            let link = Link::Iroh(conn.clone());
            attach(&link, &ctx.log, cid, "side-accepted");
            ctx.log.rec("side", json!({"c": cid, "role": "accept", "remote_id": conn.remote_id().to_string()}));
            while let Ok(start) = p02_common::traffic::control_accept(&link).await {
                tried.lock().unwrap().insert(start.label.trim_start_matches("side-").to_string());
                let (l, g, p) = (link.clone(), ctx.log.clone(), paused.clone());
                tokio::spawn(async move { send_for(&l, &g, cid, start.tag, &start.profile, start.secs, Some(p)).await });
            }
            paused.store(false, Ordering::Relaxed);
        });
    }
}
