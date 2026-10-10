//! The station's UDP and TCP services: STUN on 3478, control datagrams on 3479 with a second
//! port, 3480, for filtering checks, the upload sink on TCP 9000, and the UDP forwarder.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use p02_common::clock::{mono_us, wall_ns};
use p02_common::config::{ALT_PORT, CTL_PORT, SINK_PORT, STUN_PORT};
use p02_common::stun;
use p02_common::wire::{Ctl, REG_PREFIX, ctl_decode, ctl_encode};
use serde_json::json;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, UdpSocket};

use crate::Station;

/// A dual-stack socket reports an IPv4 sender as `::ffff:a.b.c.d`; testers compare addresses
/// as IPv4, so this undoes the mapping.
fn canon(a: SocketAddr) -> SocketAddr {
    SocketAddr::new(a.ip().to_canonical(), a.port())
}

pub async fn stun_service(st: Arc<Station>) {
    let sock = match UdpSocket::bind(("::", STUN_PORT)).await {
        Ok(s) => s,
        Err(e) => {
            st.log.rec("stun_err", json!({"e": e.to_string()}));
            return;
        }
    };
    let mut buf = [0u8; 1500];
    loop {
        let Ok((n, from)) = sock.recv_from(&mut buf).await else { continue };
        let from_c = canon(from);
        if let Some(resp) = stun::binding_response(&buf[..n], from_c) {
            let _ = sock.send_to(&resp, from).await;
            st.log.rec("stun", json!({"from": from_c.to_string()}));
        }
    }
}

pub async fn ctl_service(st: Arc<Station>) {
    let main = match UdpSocket::bind(("::", CTL_PORT)).await {
        Ok(s) => Arc::new(s),
        Err(e) => {
            st.log.rec("ctl_err", json!({"e": e.to_string()}));
            return;
        }
    };
    let alt = Arc::new(UdpSocket::bind(("::", ALT_PORT)).await.expect("alt port"));
    let _ = st.ctl_v4.set(main.clone());
    // Where each hold's socket was seen, so an AfterReq can say whether the port changed.
    let mut seen: HashMap<u64, SocketAddr> = HashMap::new();
    let mut buf = [0u8; 1500];
    loop {
        let Ok((n, from)) = main.recv_from(&mut buf).await else { continue };
        let rx_ns = wall_ns();
        let fc = canon(from);
        let Some(msg) = ctl_decode(&buf[..n]) else { continue };
        match msg {
            Ctl::ClockReq { nonce, t1 } => {
                let resp = Ctl::ClockResp { nonce, t1, rx_ns, tx_ns: wall_ns() };
                let _ = main.send_to(&ctl_encode(&resp), from).await;
            }
            Ctl::EchoReq { nonce } => {
                let _ = main.send_to(&ctl_encode(&Ctl::EchoResp { nonce, seen: fc.to_string() }), from).await;
                st.log.rec("ctl", json!({"op": "echo", "from": fc.to_string(), "nonce": nonce}));
            }
            Ctl::FilterReq { nonce } => {
                let r = ctl_encode(&Ctl::FilterResp { nonce, from_alt: false, seen: fc.to_string() });
                let _ = main.send_to(&r, from).await;
                let r = ctl_encode(&Ctl::FilterResp { nonce, from_alt: true, seen: fc.to_string() });
                let _ = alt.send_to(&r, from).await;
                st.log.rec("ctl", json!({"op": "filter", "from": fc.to_string(), "nonce": nonce}));
            }
            Ctl::HoldReq { nonce, gap_ms } => {
                seen.insert(nonce, fc);
                let _ = main.send_to(&ctl_encode(&Ctl::HoldAck { nonce, seen: fc.to_string() }), from).await;
                st.log.rec("ctl", json!({"op": "hold", "from": fc.to_string(), "nonce": nonce, "gap_ms": gap_ms}));
                let (m, log) = (main.clone(), st.log.clone());
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(gap_ms)).await;
                    let r = m.send_to(&ctl_encode(&Ctl::HoldWake { nonce, seen: fc.to_string() }), from).await;
                    log.rec("ctl", json!({"op": "wake", "to": fc.to_string(), "nonce": nonce, "ok": r.is_ok()}));
                });
            }
            Ctl::AfterReq { nonce } => {
                let before = seen.get(&nonce).map(|a| a.to_string());
                let _ = main.send_to(&ctl_encode(&Ctl::AfterResp { nonce, seen: fc.to_string(), before: before.clone() }), from).await;
                st.log.rec("ctl", json!({"op": "after", "from": fc.to_string(), "before": before, "nonce": nonce}));
            }
            _ => {}
        }
        if seen.len() > 10_000 {
            seen.clear();
        }
    }
}

/// Sends one control datagram from 3479 to an address that never sent to this station, for a
/// tester checking whether its router lets in packets from a stranger.
pub async fn send_unsolicited(st: &Station, to: SocketAddr, nonce: u64) -> Result<(), String> {
    let s = st.ctl_v4.get().ok_or("control socket not ready")?;
    let to6 = match to.ip() {
        IpAddr::V4(v4) => SocketAddr::new(IpAddr::V6(v4.to_ipv6_mapped()), to.port()),
        _ => to,
    };
    let msg = ctl_encode(&Ctl::Unsolicited { nonce, from: st.cfg.name.clone() });
    s.send_to(&msg, to6).await.map_err(|e| e.to_string())?;
    st.log.rec("ctl", json!({"op": "unsolicited", "to": to.to_string(), "nonce": nonce}));
    Ok(())
}

/// Reads and discards what a tester's upload burst sends, logging bytes per 100ms per
/// connection.
pub async fn sink_service(st: Arc<Station>) {
    let l = match TcpListener::bind(("0.0.0.0", SINK_PORT)).await {
        Ok(l) => l,
        Err(e) => {
            st.log.rec("sink_err", json!({"e": e.to_string()}));
            return;
        }
    };
    loop {
        let Ok((mut s, from)) = l.accept().await else { continue };
        let log = st.log.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 256 * 1024];
            let mut total: u64 = 0;
            let mut window: u64 = 0;
            let mut tick = mono_us();
            log.rec("sink_open", json!({"from": from.to_string()}));
            loop {
                match tokio::time::timeout(Duration::from_secs(30), s.read(&mut buf)).await {
                    Ok(Ok(0)) | Ok(Err(_)) | Err(_) => break,
                    Ok(Ok(n)) => {
                        total += n as u64;
                        window += n as u64;
                        let now = mono_us();
                        if now - tick >= 100_000 {
                            log.rec_at(now, "sink", json!({"from": from.to_string(), "bytes": window, "us": now - tick}));
                            window = 0;
                            tick = now;
                        }
                    }
                }
            }
            log.rec("sink_close", json!({"from": from.to_string(), "total": total}));
        });
    }
}

/// One forwarder session: side A faces the tester and side B the peer. B learns the peer's
/// address from its registration; A learns the tester's from its first packet. Every packet
/// either way is logged with the station's monotonic stamp at receipt and at send.
pub async fn open_forward(st: Arc<Station>, token: String, label: String) -> anyhow::Result<(u16, u16)> {
    let a = UdpSocket::bind("0.0.0.0:0").await?;
    let b = UdpSocket::bind("0.0.0.0:0").await?;
    let (pa, pb) = (a.local_addr()?.port(), b.local_addr()?.port());
    let sid = format!("{pa}-{pb}");
    st.log.rec("fwd_open", json!({"sid": sid, "port_a": pa, "port_b": pb, "label": label}));
    let log = st.log.clone();
    tokio::spawn(async move {
        let mut peer: Option<SocketAddr> = None;
        let mut tester: Option<SocketAddr> = None;
        let mut ba = vec![0u8; 2048];
        let mut bb = vec![0u8; 2048];
        loop {
            tokio::select! {
                r = a.recv_from(&mut ba) => {
                    let Ok((n, from)) = r else { continue };
                    let t0 = mono_us();
                    if tester != Some(from) {
                        log.rec("fwd_addr", json!({"sid": sid, "side": "tester", "addr": from.to_string()}));
                        tester = Some(from);
                    }
                    if let Some(p) = peer {
                        let ok = b.send_to(&ba[..n], p).await.is_ok();
                        log.raw(format!("{{\"t\":{t0},\"k\":\"fwd\",\"sid\":\"{sid}\",\"d\":\"t2p\",\"z\":{n},\"t1\":{},\"ok\":{ok}}}", mono_us()));
                    } else {
                        log.raw(format!("{{\"t\":{t0},\"k\":\"fwd\",\"sid\":\"{sid}\",\"d\":\"t2p\",\"z\":{n},\"ok\":false,\"why\":\"no peer\"}}"));
                    }
                }
                r = b.recv_from(&mut bb) => {
                    let Ok((n, from)) = r else { continue };
                    let t0 = mono_us();
                    if n >= REG_PREFIX.len() + token.len() && &bb[..REG_PREFIX.len()] == REG_PREFIX && &bb[REG_PREFIX.len()..n] == token.as_bytes() {
                        if peer != Some(from) {
                            log.rec("fwd_addr", json!({"sid": sid, "side": "peer", "addr": from.to_string()}));
                            peer = Some(from);
                        }
                        continue;
                    }
                    if peer != Some(from) {
                        continue;
                    }
                    if let Some(t) = tester {
                        let ok = a.send_to(&bb[..n], t).await.is_ok();
                        log.raw(format!("{{\"t\":{t0},\"k\":\"fwd\",\"sid\":\"{sid}\",\"d\":\"p2t\",\"z\":{n},\"t1\":{},\"ok\":{ok}}}", mono_us()));
                    }
                }
                _ = tokio::time::sleep(Duration::from_secs(300)) => {
                    log.rec("fwd_close", json!({"sid": sid, "why": "idle 300s"}));
                    return;
                }
            }
        }
    });
    Ok((pa, pb))
}
