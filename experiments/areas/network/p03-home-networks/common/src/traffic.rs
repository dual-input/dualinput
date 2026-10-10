//! Session-shaped traffic over one connection, and the records it leaves.
//!
//! Each side logs every packet it sends (`tx`) and every one it receives (`rx`), the receiver
//! with its own arrival stamp and the sender's stamp from the header, and each second the
//! connection's paths (`path`). A one-off packet goes as a QUIC datagram; the cockpit stream
//! goes on a QUIC stream, framed by a 2-byte length, so its records show head-of-line waits.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use bytes::Bytes;
use iroh::endpoint::{RecvStream, SendStream};
use n0_future::StreamExt;
use serde_json::json;
use tokio::io::AsyncWriteExt;
use tokio::time::{Instant, MissedTickBehavior};

use crate::clock::mono_us;
use crate::proto::TrafficStart;
use crate::rawlog::RawLog;
use crate::wire::{self, Stream};

#[derive(Clone)]
pub enum Link {
    Iroh(iroh::endpoint::Connection),
    Noq(noq::Connection),
}

impl Link {
    pub fn kind(&self) -> &'static str {
        match self {
            Link::Iroh(_) => "iroh",
            Link::Noq(_) => "noq",
        }
    }

    pub fn send_datagram(&self, b: Bytes) -> Result<(), String> {
        match self {
            Link::Iroh(c) => c.send_datagram(b).map_err(|e| e.to_string()),
            Link::Noq(c) => c.send_datagram(b).map_err(|e| e.to_string()),
        }
    }

    pub async fn read_datagram(&self) -> Result<Bytes, String> {
        match self {
            Link::Iroh(c) => c.read_datagram().await.map_err(|e| e.to_string()),
            Link::Noq(c) => c.read_datagram().await.map_err(|e| e.to_string()),
        }
    }

    pub async fn open_uni(&self) -> Result<SendStream, String> {
        match self {
            Link::Iroh(c) => c.open_uni().await.map_err(|e| e.to_string()),
            Link::Noq(c) => c.open_uni().await.map_err(|e| e.to_string()),
        }
    }

    pub async fn accept_uni(&self) -> Result<RecvStream, String> {
        match self {
            Link::Iroh(c) => c.accept_uni().await.map_err(|e| e.to_string()),
            Link::Noq(c) => c.accept_uni().await.map_err(|e| e.to_string()),
        }
    }

    pub async fn open_bi(&self) -> Result<(SendStream, RecvStream), String> {
        match self {
            Link::Iroh(c) => c.open_bi().await.map_err(|e| e.to_string()),
            Link::Noq(c) => c.open_bi().await.map_err(|e| e.to_string()),
        }
    }

    pub async fn accept_bi(&self) -> Result<(SendStream, RecvStream), String> {
        match self {
            Link::Iroh(c) => c.accept_bi().await.map_err(|e| e.to_string()),
            Link::Noq(c) => c.accept_bi().await.map_err(|e| e.to_string()),
        }
    }

    pub fn close(&self, reason: &str) {
        match self {
            Link::Iroh(c) => c.close(0u32.into(), reason.as_bytes()),
            Link::Noq(c) => c.close(0u32.into(), reason.as_bytes()),
        }
    }

    pub async fn closed(&self) -> String {
        match self {
            Link::Iroh(c) => c.closed().await.to_string(),
            Link::Noq(c) => c.closed().await.to_string(),
        }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            Link::Iroh(c) => c.close_reason().is_some(),
            Link::Noq(c) => c.close_reason().is_some(),
        }
    }
}

/// Starts the receivers, the per-second path statistics, and, on iroh, the path events, for
/// as long as the connection lives. `cid` is this run's number for the connection.
pub fn attach(link: &Link, log: &RawLog, cid: u32, label: &str) {
    log.rec("conn", json!({"c": cid, "kind": link.kind(), "label": label}));

    let (l, g) = (link.clone(), log.clone());
    tokio::spawn(async move {
        loop {
            match l.read_datagram().await {
                Ok(b) => {
                    let t = mono_us();
                    if let Some(h) = wire::parse(&b) {
                        g.raw(format!(
                            "{{\"t\":{t},\"k\":\"rx\",\"c\":{cid},\"s\":{},\"n\":{},\"z\":{},\"g\":{},\"ts\":{}}}",
                            h.stream,
                            h.seq,
                            b.len(),
                            h.tag,
                            h.sent_us
                        ));
                    }
                }
                Err(e) => {
                    g.rec("closed", json!({"c": cid, "reason": e}));
                    break;
                }
            }
        }
    });

    let (l, g) = (link.clone(), log.clone());
    tokio::spawn(async move {
        while let Ok(rs) = l.accept_uni().await {
            let g = g.clone();
            tokio::spawn(read_framed(rs, g, cid));
        }
    });

    let (l, g) = (link.clone(), log.clone());
    tokio::spawn(async move {
        let mut iv = tokio::time::interval(Duration::from_secs(1));
        iv.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            iv.tick().await;
            if l.is_closed() {
                break;
            }
            path_stats(&l, &g, cid);
        }
    });

    if let Link::Iroh(c) = link {
        let (c, g) = (c.clone(), log.clone());
        tokio::spawn(async move {
            let mut ev = c.path_events();
            while let Some(e) = ev.next().await {
                g.rec("pev", path_event_json(cid, &e));
            }
        });
    }
}

fn path_event_json(cid: u32, e: &iroh::endpoint::PathEvent) -> serde_json::Value {
    use iroh::endpoint::PathEvent as E;
    match e {
        E::Opened { id, remote_addr, local_addr, .. } => json!({
            "c": cid, "ev": "opened", "id": format!("{id:?}"),
            "remote": format!("{remote_addr:?}"), "local": format!("{local_addr:?}")}),
        E::Closed { id, remote_addr, last_stats, .. } => json!({
            "c": cid, "ev": "closed", "id": format!("{id:?}"),
            "remote": format!("{remote_addr:?}"), "last": format!("{last_stats:?}")}),
        E::Selected { id, remote_addr, local_addr, .. } => json!({
            "c": cid, "ev": "selected", "id": format!("{id:?}"),
            "remote": format!("{remote_addr:?}"), "local": format!("{local_addr:?}")}),
        E::Lagged { missed, .. } => json!({"c": cid, "ev": "lagged", "missed": missed}),
        other => json!({"c": cid, "ev": "other", "debug": format!("{other:?}")}),
    }
}

fn stats_json(s: &iroh::endpoint::PathStats) -> serde_json::Value {
    json!({
        "rtt_us": s.rtt.as_micros() as u64,
        "cwnd": s.cwnd,
        "lost": s.lost_packets,
        "lost_b": s.lost_bytes,
        "cong": s.congestion_events,
        "scong": s.spurious_congestion_events,
        "mtu": s.current_mtu,
        "bh": s.black_holes_detected,
        "tx_dg": s.udp_tx.datagrams,
        "tx_b": s.udp_tx.bytes,
        "rx_dg": s.udp_rx.datagrams,
        "rx_b": s.udp_rx.bytes,
    })
}

fn path_stats(l: &Link, g: &RawLog, cid: u32) {
    match l {
        Link::Iroh(c) => {
            for p in c.paths().iter() {
                let mut v = stats_json(&p.stats());
                let o = v.as_object_mut().unwrap();
                o.insert("c".into(), json!(cid));
                o.insert("id".into(), json!(format!("{:?}", p.id())));
                o.insert("remote".into(), json!(format!("{:?}", p.remote_addr())));
                o.insert("relay".into(), json!(p.is_relay()));
                o.insert("sel".into(), json!(p.is_selected()));
                o.insert("dgbuf".into(), json!(c.datagram_send_buffer_space()));
                g.rec("path", v);
            }
        }
        Link::Noq(c) => {
            if let Some(p) = c.path(noq::PathId::ZERO) {
                let mut v = stats_json(&p.stats());
                let o = v.as_object_mut().unwrap();
                o.insert("c".into(), json!(cid));
                o.insert("id".into(), json!("PathId(0)"));
                o.insert(
                    "remote".into(),
                    json!(p.remote_address().map(|a| a.to_string()).unwrap_or_default()),
                );
                o.insert("relay".into(), json!(false));
                o.insert("sel".into(), json!(true));
                o.insert("dgbuf".into(), json!(c.datagram_send_buffer_space()));
                g.rec("path", v);
            }
        }
    }
}

async fn read_framed(mut rs: RecvStream, g: RawLog, cid: u32) {
    let mut len = [0u8; 2];
    let mut buf = vec![0u8; 2048];
    loop {
        if rs.read_exact(&mut len).await.is_err() {
            return;
        }
        let n = u16::from_be_bytes(len) as usize;
        if n > buf.len() || rs.read_exact(&mut buf[..n]).await.is_err() {
            return;
        }
        let t = mono_us();
        if let Some(h) = wire::parse(&buf[..n]) {
            g.raw(format!(
                "{{\"t\":{t},\"k\":\"rx\",\"c\":{cid},\"s\":{},\"n\":{},\"z\":{n},\"g\":{},\"ts\":{}}}",
                h.stream, h.seq, h.tag, h.sent_us
            ));
        }
    }
}

/// Sends the profile's streams for `secs`, each at its own rate, and returns when all stop.
/// `pause`, when set, holds every stream silent without ending the run.
pub async fn send_for(
    link: &Link,
    log: &RawLog,
    cid: u32,
    tag: u32,
    profile: &str,
    secs: f64,
    pause: Option<Arc<AtomicBool>>,
) {
    let streams: &[Stream] = if profile == "flight" {
        &[Stream::Flight]
    } else {
        &[Stream::Flight, Stream::Cockpit, Stream::Audio]
    };
    let deadline = Instant::now() + Duration::from_secs_f64(secs);
    log.rec("send_start", json!({"c": cid, "g": tag, "profile": profile, "secs": secs}));
    let mut set = tokio::task::JoinSet::new();
    for &s in streams {
        let (l, g, pause) = (link.clone(), log.clone(), pause.clone());
        set.spawn(async move {
            let (_, rate) = s.shape();
            let mut iv = tokio::time::interval(Duration::from_secs(1) / rate);
            let mut uni = None;
            if s == Stream::Cockpit {
                match l.open_uni().await {
                    Ok(u) => uni = Some(u),
                    Err(e) => {
                        g.rec("txerr", json!({"c": cid, "s": s as u8, "e": e}));
                        return;
                    }
                }
            }
            let mut seq: u32 = 0;
            loop {
                iv.tick().await;
                if Instant::now() >= deadline || l.is_closed() {
                    break;
                }
                if pause.as_ref().is_some_and(|p| p.load(Ordering::Relaxed)) {
                    continue;
                }
                let t = mono_us();
                let pkt = wire::packet(s, tag, seq, t);
                let z = pkt.len();
                let r = match uni.as_mut() {
                    Some(u) => {
                        let mut framed = Vec::with_capacity(z + 2);
                        framed.extend_from_slice(&(z as u16).to_be_bytes());
                        framed.extend_from_slice(&pkt);
                        u.write_all(&framed).await.map_err(|e| e.to_string())
                    }
                    None => l.send_datagram(pkt),
                };
                match r {
                    Ok(()) => g.raw(format!(
                        "{{\"t\":{t},\"k\":\"tx\",\"c\":{cid},\"s\":{},\"n\":{seq},\"z\":{z},\"g\":{tag}}}",
                        s as u8
                    )),
                    Err(e) => g.rec_at(t, "txerr", json!({"c": cid, "s": s as u8, "n": seq, "e": e})),
                }
                seq = seq.wrapping_add(1);
            }
            if let Some(mut u) = uni {
                let _ = u.finish();
                let _ = u.flush().await;
            }
        });
    }
    while set.join_next().await.is_some() {}
    log.rec("send_end", json!({"c": cid, "g": tag}));
}

/// The opening side's half of a traffic run: sends `start` on a new control stream and waits
/// for the other side's line saying it began.
pub async fn control_open(link: &Link, start: &TrafficStart) -> Result<(), String> {
    let (mut s, mut r) = link.open_bi().await?;
    let mut line = serde_json::to_vec(start).map_err(|e| e.to_string())?;
    line.push(b'\n');
    s.write_all(&line).await.map_err(|e| e.to_string())?;
    let reply = read_line(&mut r, Duration::from_secs(15)).await?;
    if reply.contains("\"ok\":true") {
        Ok(())
    } else {
        Err(format!("peer refused: {reply}"))
    }
}

/// The answering side: waits for a control stream and acknowledges its start line.
pub async fn control_accept(link: &Link) -> Result<TrafficStart, String> {
    let (mut s, mut r) = link.accept_bi().await?;
    let line = read_line(&mut r, Duration::from_secs(60)).await?;
    let start: TrafficStart = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    let _ = s.write_all(b"{\"ok\":true}\n").await;
    Ok(start)
}

async fn read_line(r: &mut RecvStream, timeout: Duration) -> Result<String, String> {
    let mut out = Vec::new();
    let mut b = [0u8; 1];
    let fut = async {
        loop {
            match r.read(&mut b).await {
                Ok(Some(1)) => {
                    if b[0] == b'\n' {
                        break Ok(());
                    }
                    out.push(b[0]);
                }
                Ok(_) => break Err("stream ended".to_string()),
                Err(e) => break Err(e.to_string()),
            }
        }
    };
    tokio::time::timeout(timeout, fut).await.map_err(|_| "timed out".to_string())??;
    Ok(String::from_utf8_lossy(&out).into_owned())
}
