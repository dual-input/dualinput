//! p06: v1's full traffic mix over iroh's relay, every packet relayed, under loss on the
//! sender's leg, with two ways of handing one-off datagrams to QUIC:
//!
//! - (a) every datagram goes to `send_datagram` as it's made, at iroh's defaults, where QUIC
//!   queues up to 1 MiB of them and drops the oldest past that;
//! - (b) QUIC's datagram send buffer holds a few packets, each one-off channel keeps only its
//!   newest datagram in a slot of its own, and a datagram goes to QUIC only when
//!   `datagram_send_buffer_space()` has room for it, oldest slot first.
//!
//! The dialer sends every channel; the listener sends avatar poses back and answers the session
//! stream. Each side logs every packet it hands to QUIC (`tx`), every one it replaced in a slot
//! (`sup`), and every one it receives (`rx`), so the analysis finds each channel's lateness and
//! loss and whether the streams starved.
//!
//!   p06 listen --deploy <deploy.json> --relay fra|nyc --variant a|b --out <log>
//!   p06 dial   --deploy <deploy.json> --relay fra|nyc --variant a|b --mix quiet|busy --secs 60
//!              --peer <base64 AddrJson> --out <log>

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use bytes::{BufMut, Bytes, BytesMut};
use iroh::endpoint::{Connection, QuicTransportConfig, RecvStream, SendStream, presets};
use iroh::{Endpoint, RelayMap, RelayMode, RelayUrl};
use p02_common::clock::{mono_us, wall_us};
use p02_common::config::Deploy;
use p02_common::ep::ALPN;
use p02_common::proto::AddrJson;
use p02_common::rawlog::RawLog;
use p02_common::traffic::{Link, attach};
use p02_common::wire::{self, MAGIC};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Notify;

const FLIGHT: u8 = 1;
const COCKPIT: u8 = 2;
const AUDIO: u8 = 3;
const CONTROLS: u8 = 4;
const AVATAR: u8 = 5;
const BATCH: u8 = 6;
const SESSION_REQ: u8 = 7;
const SESSION_REP: u8 = 8;

/// The variant (b) buffer: three full-size QUIC packets.
const SMALL_DGRAM_BUFFER: usize = 3 * 1200;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Start {
    tag: u32,
    secs: f64,
    mix: String,
    variant: String,
}

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
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

fn packet(chan: u8, size: usize, tag: u32, seq: u32, t: u64) -> Bytes {
    let mut b = BytesMut::with_capacity(size);
    b.put_slice(&MAGIC);
    b.put_u8(chan);
    b.put_u8(0);
    b.put_u32(tag);
    b.put_u32(seq);
    b.put_u64(t);
    b.resize(size.max(wire::HEADER), 0x5a);
    b.freeze()
}

async fn endpoint(deploy: &Deploy, relay: &str, variant: &str) -> Result<Endpoint> {
    let st = deploy.station(relay).context("no such station")?;
    let url: RelayUrl = st.relay_url().parse()?;
    let mut t = QuicTransportConfig::builder();
    if variant == "b" {
        t = t.datagram_send_buffer_size(SMALL_DGRAM_BUFFER);
    }
    Ok(Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Custom(RelayMap::from_iter([url])))
        .ca_tls_config(iroh::tls::CaTlsConfig::custom_roots([deploy.ca_der()?]))
        .alpns(vec![p02_common::ep::ALPN.to_vec()])
        .transport_config(t.build())
        .clear_ip_transports()
        .bind()
        .await?)
}

/// One side's one-off datagrams: straight to QUIC for (a), through newest-only slots and a
/// pump for (b).
struct Datagrams {
    conn: Connection,
    log: RawLog,
    cid: u32,
    variant_b: bool,
    slots: Mutex<HashMap<u8, (Bytes, u64, u32)>>,
    wake: Notify,
}

impl Datagrams {
    fn offer(&self, chan: u8, pkt: Bytes, t: u64, seq: u32) {
        if !self.variant_b {
            self.hand(chan, pkt, t, seq);
            return;
        }
        let replaced = self.slots.lock().unwrap().insert(chan, (pkt, t, seq));
        if let Some((_, _, old)) = replaced {
            self.log.raw(format!("{{\"t\":{},\"k\":\"sup\",\"c\":{},\"s\":{chan},\"n\":{old}}}", mono_us(), self.cid));
        }
        self.wake.notify_one();
    }

    fn hand(&self, chan: u8, pkt: Bytes, produced: u64, seq: u32) {
        let z = pkt.len();
        let now = mono_us();
        match self.conn.send_datagram(pkt) {
            Ok(()) => self.log.raw(format!(
                "{{\"t\":{now},\"k\":\"tx\",\"c\":{},\"s\":{chan},\"n\":{seq},\"z\":{z},\"p\":{produced}}}",
                self.cid
            )),
            Err(e) => self.log.rec("txerr", json!({"c": self.cid, "s": chan, "n": seq, "e": e.to_string()})),
        }
    }

    /// Hands slots to QUIC, oldest first, while its datagram buffer has room for the next one.
    async fn pump(self: Arc<Self>, until: tokio::time::Instant) {
        while tokio::time::Instant::now() < until {
            tokio::select! {
                _ = self.wake.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(2)) => {}
            }
            loop {
                let space = self.conn.datagram_send_buffer_space();
                let next = {
                    let mut s = self.slots.lock().unwrap();
                    let pick = s.iter().filter(|(_, (p, _, _))| p.len() <= space).min_by_key(|(_, (_, t, _))| *t).map(|(c, _)| *c);
                    pick.and_then(|c| s.remove(&c).map(|v| (c, v)))
                };
                match next {
                    Some((chan, (pkt, t, seq))) => self.hand(chan, pkt, t, seq),
                    None => break,
                }
            }
        }
    }
}

fn produce(d: Arc<Datagrams>, chan: u8, size: usize, per_s: f64, tag: u32, until: tokio::time::Instant) {
    tokio::spawn(async move {
        let mut iv = tokio::time::interval(Duration::from_secs_f64(1.0 / per_s));
        let mut seq = 0u32;
        loop {
            iv.tick().await;
            if tokio::time::Instant::now() >= until || d.conn.close_reason().is_some() {
                break;
            }
            let t = mono_us();
            d.offer(chan, packet(chan, size, tag, seq, t), t, seq);
            seq += 1;
        }
    });
}

async fn write_framed(s: &mut SendStream, pkt: &[u8]) -> Result<(), String> {
    let mut f = Vec::with_capacity(pkt.len() + 2);
    f.extend_from_slice(&(pkt.len() as u16).to_be_bytes());
    f.extend_from_slice(pkt);
    s.write_all(&f).await.map_err(|e| e.to_string())
}

async fn read_framed(r: &mut RecvStream) -> Option<Vec<u8>> {
    let mut len = [0u8; 2];
    r.read_exact(&mut len).await.ok()?;
    let mut b = vec![0u8; u16::from_be_bytes(len) as usize];
    r.read_exact(&mut b).await.ok()?;
    Some(b)
}

fn log_rx(log: &RawLog, cid: u32, b: &[u8]) {
    let t = mono_us();
    if let Some(h) = wire::parse(b) {
        log.raw(format!(
            "{{\"t\":{t},\"k\":\"rx\",\"c\":{cid},\"s\":{},\"n\":{},\"z\":{},\"g\":{},\"ts\":{}}}",
            h.stream,
            h.seq,
            b.len(),
            h.tag,
            h.sent_us
        ));
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    p02_common::install_crypto();
    let mode = std::env::args().nth(1).context("listen or dial")?;
    let deploy = Deploy::parse(&std::fs::read_to_string(arg("--deploy").context("--deploy")?)?)?;
    let relay = arg("--relay").context("--relay")?;
    let variant = arg("--variant").unwrap_or_else(|| "a".into());
    let log = RawLog::create(std::path::Path::new(&arg("--out").context("--out")?))?;
    let ep = endpoint(&deploy, &relay, &variant).await?;
    let online = tokio::time::timeout(Duration::from_secs(15), ep.online()).await.is_ok();
    let addr = AddrJson::from_addr(&ep.addr());
    log.rec("start", json!({"mode": mode, "relay": relay, "variant": variant, "w": wall_us(), "online": online,
                            "dgram_buffer": if variant == "b" { SMALL_DGRAM_BUFFER } else { 1 << 20 }}));

    if mode == "listen" {
        println!("ADDR {}", serde_json::to_string(&addr)?);
        let inc = ep.accept().await.context("endpoint closed")?;
        let conn = inc.accept()?.await?;
        let link = Link::Iroh(conn.clone());
        attach(&link, &log, 1, "p06-listen");
        let (mut cs, mut cr) = conn.accept_bi().await?;
        let mut line = Vec::new();
        let mut b = [0u8; 1];
        while cr.read(&mut b).await?.is_some_and(|n| n == 1) && b[0] != b'\n' {
            line.push(b[0]);
        }
        let start: Start = serde_json::from_slice(&line)?;
        cs.write_all(b"{\"ok\":true}\n").await?;
        log.rec("traffic", json!({"w": wall_us(), "start": start}));
        let until = tokio::time::Instant::now() + Duration::from_secs_f64(start.secs);
        let d = Arc::new(Datagrams { conn: conn.clone(), log: log.clone(), cid: 1, variant_b: variant == "b", slots: Default::default(), wake: Notify::new() });
        if d.variant_b {
            tokio::spawn(d.clone().pump(until + Duration::from_secs(1)));
        }
        produce(d.clone(), AVATAR, 121, 20.0, start.tag, until);
        // The session stream: answer each request at once with a reply of our own.
        let (mut ss, mut sr) = conn.accept_bi().await?;
        let (g, tag) = (log.clone(), start.tag);
        tokio::spawn(async move {
            while let Some(req) = read_framed(&mut sr).await {
                log_rx(&g, 1, &req);
                let Some(h) = wire::parse(&req) else { continue };
                let t = mono_us();
                let rep = packet(SESSION_REP, 64, tag, h.seq, t);
                if write_framed(&mut ss, &rep).await.is_ok() {
                    g.raw(format!("{{\"t\":{t},\"k\":\"tx\",\"c\":1,\"s\":{SESSION_REP},\"n\":{},\"z\":64}}", h.seq));
                }
            }
        });
        tokio::time::sleep(Duration::from_secs_f64(start.secs + 8.0)).await;
        conn.close(0u32.into(), b"done");
        ep.close().await;
        log.flush();
        return Ok(());
    }

    let mix = arg("--mix").unwrap_or_else(|| "quiet".into());
    let secs: f64 = arg("--secs").map(|s| s.parse().unwrap_or(60.0)).unwrap_or(60.0);
    let peer: AddrJson = serde_json::from_slice(&b64_decode(&arg("--peer").context("--peer")?)?)?;
    let conn = ep.connect(peer.to_addr()?, ALPN).await?;
    let link = Link::Iroh(conn.clone());
    attach(&link, &log, 1, "p06-dial");
    let tag = p02_common::new_tag();
    let start = Start { tag, secs, mix: mix.clone(), variant: variant.clone() };
    let (mut cs, mut cr) = conn.open_bi().await?;
    cs.write_all(format!("{}\n", serde_json::to_string(&start)?).as_bytes()).await?;
    let mut b = [0u8; 1];
    while cr.read(&mut b).await?.is_some_and(|n| n == 1) && b[0] != b'\n' {}
    log.rec("traffic", json!({"w": wall_us(), "start": start}));

    let (batch_per_s, cockpit_per_s) = if mix == "busy" { (11.0, 20.0) } else { (2.4, 5.0) };
    let until = tokio::time::Instant::now() + Duration::from_secs_f64(secs);
    let d = Arc::new(Datagrams { conn: conn.clone(), log: log.clone(), cid: 1, variant_b: variant == "b", slots: Default::default(), wake: Notify::new() });
    if d.variant_b {
        tokio::spawn(d.clone().pump(until + Duration::from_secs(1)));
    }
    produce(d.clone(), FLIGHT, 130, 20.0, tag, until);
    produce(d.clone(), CONTROLS, 40, 20.0, tag, until);
    produce(d.clone(), AVATAR, 121, 20.0, tag, until);
    produce(d.clone(), BATCH, 945, batch_per_s, tag, until);
    produce(d.clone(), AUDIO, 70, 50.0, tag, until);

    // The cockpit stream: one stream, messages at the mix's rate.
    let mut cockpit = conn.open_uni().await?;
    let g = log.clone();
    tokio::spawn(async move {
        let mut iv = tokio::time::interval(Duration::from_secs_f64(1.0 / cockpit_per_s));
        let mut seq = 0u32;
        while tokio::time::Instant::now() < until {
            iv.tick().await;
            let t = mono_us();
            if write_framed(&mut cockpit, &packet(COCKPIT, 84, tag, seq, t)).await.is_ok() {
                g.raw(format!("{{\"t\":{t},\"k\":\"tx\",\"c\":1,\"s\":{COCKPIT},\"n\":{seq},\"z\":84}}"));
            }
            seq += 1;
        }
        let _ = cockpit.finish();
    });

    // The session stream: a request each second, answered on the same stream.
    let (mut ss, mut sr) = conn.open_bi().await?;
    let g = log.clone();
    tokio::spawn(async move {
        while let Some(rep) = read_framed(&mut sr).await {
            log_rx(&g, 1, &rep);
        }
    });
    let g = log.clone();
    tokio::spawn(async move {
        let mut iv = tokio::time::interval(Duration::from_secs(1));
        let mut seq = 0u32;
        while tokio::time::Instant::now() < until {
            iv.tick().await;
            let t = mono_us();
            if write_framed(&mut ss, &packet(SESSION_REQ, 64, tag, seq, t)).await.is_ok() {
                g.raw(format!("{{\"t\":{t},\"k\":\"tx\",\"c\":1,\"s\":{SESSION_REQ},\"n\":{seq},\"z\":64}}"));
            }
            seq += 1;
        }
    });

    tokio::time::sleep(Duration::from_secs_f64(secs + 5.0)).await;
    log.rec("end", json!({"w": wall_us()}));
    conn.close(0u32.into(), b"done");
    ep.close().await;
    log.flush();
    Ok(())
}
