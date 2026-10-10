//! Step 2 of 2.3: how the friend's router maps and filters UDP, whether it answers UPnP,
//! NAT-PMP, or PCP, whether the PC reaches the internet over IPv6, and how long the router
//! keeps an idle mapping. Every answer goes in the file as it came; nothing here concludes.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use p02_common::stun::{self, hex};
use p02_common::wire::{Ctl, ctl_decode, ctl_encode};
use serde_json::{Value, json};
use tokio::net::UdpSocket;

use crate::ctx::Ctx;

/// The idle gaps 2.3 names, 30s, 60s, 120s, and 180s, with 15s, 90s, 150s, and 240s added
/// because each costs only an idle socket, and our own router forgot a mapping between 120s and
/// 150s (network log, 2026-10-10).
pub const GAPS_S: [u64; 8] = [15, 30, 60, 90, 120, 150, 180, 240];

async fn resolve(host: &str) -> (Option<SocketAddr>, Option<SocketAddr>) {
    match tokio::net::lookup_host(host).await {
        Ok(it) => {
            let v: Vec<SocketAddr> = it.collect();
            (v.iter().find(|a| a.is_ipv4()).copied(), v.iter().find(|a| a.is_ipv6()).copied())
        }
        Err(_) => (None, None),
    }
}

async fn stun_query(ctx: &Ctx, sock: &UdpSocket, label: &str, server: &str, dest: SocketAddr) -> Option<SocketAddr> {
    let mut buf = [0u8; 1500];
    for attempt in 0..3 {
        let txid: [u8; 12] = rand::random();
        let req = stun::binding_request(txid);
        let t0 = Instant::now();
        if let Err(e) = sock.send_to(&req, dest).await {
            ctx.log.rec("stun", json!({"sock": label, "server": server, "dest": dest.to_string(), "err": e.to_string()}));
            return None;
        }
        let got = tokio::time::timeout(Duration::from_millis(800), async {
            loop {
                let (n, from) = sock.recv_from(&mut buf).await?;
                if let Some(r) = stun::parse_response(&buf[..n]) {
                    if r.txid == txid {
                        return Ok::<_, std::io::Error>((r, from, n));
                    }
                }
            }
        })
        .await;
        if let Ok(Ok((r, from, n))) = got {
            ctx.log.rec(
                "stun",
                json!({"sock": label, "local": sock.local_addr().ok().map(|a| a.to_string()), "server": server,
                       "dest": dest.to_string(), "from": from.to_string(), "attempt": attempt,
                       "rtt_us": t0.elapsed().as_micros() as u64, "mapped": r.mapped.map(|a| a.to_string()),
                       "software": r.software, "other": r.other_address.map(|a| a.to_string()), "raw": hex(&buf[..n])}),
            );
            return r.mapped;
        }
    }
    ctx.log.rec("stun", json!({"sock": label, "server": server, "dest": dest.to_string(), "err": "no answer to 3 requests"}));
    None
}

async fn ctl_echo(ctx: &Ctx, sock: &UdpSocket, label: &str, dest: SocketAddr) -> Option<String> {
    let mut buf = [0u8; 1500];
    for _ in 0..3 {
        let nonce: u64 = rand::random();
        let _ = sock.send_to(&ctl_encode(&Ctl::EchoReq { nonce }), dest).await;
        let got = tokio::time::timeout(Duration::from_millis(800), async {
            loop {
                let (n, _) = sock.recv_from(&mut buf).await?;
                if let Some(Ctl::EchoResp { nonce: rn, seen }) = ctl_decode(&buf[..n]) {
                    if rn == nonce {
                        return Ok::<_, std::io::Error>(seen);
                    }
                }
            }
        })
        .await;
        if let Ok(Ok(seen)) = got {
            ctx.log.rec("echo", json!({"sock": label, "dest": dest.to_string(), "seen": seen}));
            return Some(seen);
        }
    }
    ctx.log.rec("echo", json!({"sock": label, "dest": dest.to_string(), "err": "no answer"}));
    None
}

/// Mapping: two sockets, each asking five destinations which public address they see, so our
/// analysis can tell a router that keeps one port for every destination from one that doesn't.
async fn mapping(ctx: &Ctx) {
    let (g4, g6) = resolve("stun.l.google.com:19302").await;
    let (c4, c6) = resolve("stun.cloudflare.com:3478").await;
    ctx.log.rec("resolve", json!({"google": [g4.map(|a| a.to_string()), g6.map(|a| a.to_string())], "cloudflare": [c4.map(|a| a.to_string()), c6.map(|a| a.to_string())]}));
    for label in ["map-a", "map-b"] {
        let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else { continue };
        if let Some(a) = g4 {
            stun_query(ctx, &sock, label, "google", a).await;
        }
        if let Some(a) = c4 {
            stun_query(ctx, &sock, label, "cloudflare", a).await;
        }
        stun_query(ctx, &sock, label, &ctx.near.name, ctx.near.stun()).await;
        ctl_echo(ctx, &sock, label, ctx.near.ctl()).await;
        if let Some(f) = &ctx.far {
            stun_query(ctx, &sock, label, &f.name, f.stun()).await;
        }
    }
    // IPv6: the same questions over a v6 socket, which a PC without a public v6 address
    // fails to send from at all.
    match UdpSocket::bind("[::]:0").await {
        Ok(sock) => {
            if let Some(a) = g6 {
                stun_query(ctx, &sock, "v6", "google", a).await;
            }
            if let Some(a) = c6 {
                stun_query(ctx, &sock, "v6", "cloudflare", a).await;
            }
            for st in ctx.stations() {
                if let Some(a) = st.stun_v6() {
                    stun_query(ctx, &sock, "v6", &st.name, a).await;
                }
            }
        }
        Err(e) => ctx.log.rec("stun", json!({"sock": "v6", "err": e.to_string()})),
    }
}

/// Filtering: a fresh socket asks the near station for two replies, one from the port it asked
/// and one from the station's other port, and asks the far station, over HTTPS, to send from
/// its own address, which this socket never sent to.
async fn filtering(ctx: &Ctx) {
    for round in 0..3 {
        let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else { continue };
        let nonce: u64 = rand::random();
        let mut buf = [0u8; 1500];
        let mut got_main = false;
        let mut got_alt = false;
        let mut got_other = false;
        let mut seen: Option<String> = None;
        for _ in 0..3 {
            let _ = sock.send_to(&ctl_encode(&Ctl::FilterReq { nonce }), ctx.near.ctl()).await;
            let deadline = tokio::time::Instant::now() + Duration::from_millis(700);
            while let Ok(Ok((n, from))) = tokio::time::timeout_at(deadline, sock.recv_from(&mut buf)).await {
                if let Some(Ctl::FilterResp { nonce: rn, from_alt, seen: s }) = ctl_decode(&buf[..n]) {
                    if rn == nonce {
                        seen = Some(s);
                        if from_alt {
                            got_alt = true;
                        } else {
                            got_main = true;
                        }
                        ctx.log.rec("filter_rx", json!({"round": round, "from": from.to_string(), "alt": from_alt}));
                    }
                }
            }
            if got_main {
                break;
            }
        }
        if let (Some(s), Some(far)) = (&seen, &ctx.far) {
            let r: Result<Value, String> = ctx.post(far, "/v1/udp-send", &json!({"to": s, "nonce": nonce})).await;
            if r.is_ok() {
                let deadline = tokio::time::Instant::now() + Duration::from_millis(2500);
                while let Ok(Ok((n, from))) = tokio::time::timeout_at(deadline, sock.recv_from(&mut buf)).await {
                    if let Some(Ctl::Unsolicited { nonce: rn, .. }) = ctl_decode(&buf[..n]) {
                        if rn == nonce {
                            got_other = true;
                            ctx.log.rec("filter_rx", json!({"round": round, "from": from.to_string(), "other_ip": true}));
                        }
                    }
                }
            }
        }
        ctx.log.rec("filter", json!({"round": round, "seen": seen, "same_port": got_main, "other_port": got_alt, "other_ip": got_other}));
    }
}

fn private_v4(ip: &IpAddr) -> bool {
    matches!(ip, IpAddr::V4(v) if v.is_private() || v.is_link_local())
}

/// NAT-PMP's external-address request and PCP's ANNOUNCE, sent to each gateway by hand, and
/// the answers logged byte for byte.
async fn nat_pmp_pcp(ctx: &Ctx, gw: IpAddr) {
    let dest = SocketAddr::new(gw, 5351);
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else { return };
    let _ = sock.connect(dest).await;
    let local = sock.local_addr().ok();
    let mut buf = [0u8; 1100];
    for (proto, req) in [("nat_pmp", vec![0u8, 0]), ("pcp", pcp_announce(local.map(|a| a.ip())))] {
        let mut answered = false;
        for wait in [250u64, 500, 1000] {
            let t0 = Instant::now();
            let _ = sock.send(&req).await;
            if let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(wait), sock.recv(&mut buf)).await {
                ctx.log.rec(proto, json!({"gateway": gw.to_string(), "rtt_us": t0.elapsed().as_micros() as u64, "raw": hex(&buf[..n])}));
                answered = true;
                break;
            }
        }
        if !answered {
            ctx.log.rec(proto, json!({"gateway": gw.to_string(), "err": "no answer"}));
        }
    }
}

fn pcp_announce(client: Option<IpAddr>) -> Vec<u8> {
    let mut b = vec![2u8, 0, 0, 0, 0, 0, 0, 0];
    let ip6 = match client {
        Some(IpAddr::V4(v)) => v.to_ipv6_mapped(),
        Some(IpAddr::V6(v)) => v,
        None => std::net::Ipv6Addr::UNSPECIFIED,
    };
    b.extend_from_slice(&ip6.octets());
    b
}

fn xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let s = xml.find(&open)? + open.len();
    let e = xml[s..].find(&format!("</{tag}>"))? + s;
    Some(xml[s..e].trim().to_string())
}

/// UPnP: an SSDP search for an Internet Gateway Device, and, from each answer's description,
/// only what says what kind of router it is. It drops each device's unique ID, serial number,
/// and friendly name, which a person may have set.
async fn upnp(ctx: &Ctx) {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else { return };
    let dest: SocketAddr = "239.255.255.250:1900".parse().unwrap();
    for st in ["urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:device:InternetGatewayDevice:2"] {
        let msg = format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: {st}\r\n\r\n");
        let _ = sock.send_to(msg.as_bytes(), dest).await;
    }
    let mut buf = [0u8; 2048];
    let mut locations = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    let mut answers = 0;
    while let Ok(Ok((n, from))) = tokio::time::timeout_at(deadline, sock.recv_from(&mut buf)).await {
        answers += 1;
        let text = String::from_utf8_lossy(&buf[..n]).into_owned();
        let mut kept = serde_json::Map::new();
        for line in text.lines() {
            if let Some((k, v)) = line.split_once(':') {
                let k = k.trim().to_ascii_uppercase();
                if ["LOCATION", "SERVER", "ST", "CACHE-CONTROL", "EXT"].contains(&k.as_str()) {
                    kept.insert(k.clone(), json!(v.trim()));
                    if k == "LOCATION" {
                        locations.push(v.trim().to_string());
                    }
                }
            }
        }
        ctx.log.rec("ssdp", json!({"from": from.to_string(), "headers": kept}));
    }
    ctx.log.rec("ssdp_done", json!({"answers": answers}));
    locations.sort();
    locations.dedup();
    let plain = reqwest::Client::builder().timeout(Duration::from_secs(4)).no_proxy().build();
    let Ok(plain) = plain else { return };
    for loc in locations.into_iter().take(3) {
        let host_ok = reqwest::Url::parse(&loc)
            .ok()
            .and_then(|u| u.host_str().and_then(|h| h.parse::<IpAddr>().ok()))
            .is_some_and(|ip| private_v4(&ip));
        if !host_ok || !loc.starts_with("http://") {
            ctx.log.rec("upnp_desc", json!({"location": loc, "err": "not a plain-HTTP private address"}));
            continue;
        }
        match plain.get(&loc).send().await {
            Ok(r) => {
                let xml = r.text().await.unwrap_or_default();
                let services: Vec<String> = xml
                    .match_indices("<serviceType>")
                    .filter_map(|(i, _)| xml_tag(&xml[i..], "serviceType"))
                    .collect();
                ctx.log.rec(
                    "upnp_desc",
                    json!({"location": loc, "device_type": xml_tag(&xml, "deviceType"), "manufacturer": xml_tag(&xml, "manufacturer"),
                           "model_name": xml_tag(&xml, "modelName"), "model_number": xml_tag(&xml, "modelNumber"),
                           "model_description": xml_tag(&xml, "modelDescription"), "services": services}),
                );
            }
            Err(e) => ctx.log.rec("upnp_desc", json!({"location": loc, "err": e.to_string()})),
        }
    }
}

pub async fn router_checks(ctx: &Ctx) {
    ctx.ui.action("Asking STUN servers which address and port your router gives this PC");
    mapping(ctx).await;
    ctx.ui.action("Checking which senders your router lets in");
    filtering(ctx).await;
    ctx.ui.action("Asking your router whether it opens ports on request");
    let gws: Vec<IpAddr> = p02_common::sysmon::gateways().into_iter().filter(|g| g.is_ipv4()).collect();
    ctx.log.rec("gateways", json!({"v4": gws.iter().map(|g| g.to_string()).collect::<Vec<_>>()}));
    for gw in gws {
        nat_pmp_pcp(ctx, gw).await;
    }
    upnp(ctx).await;
}

/// The idle-mapping holds, one socket per gap, all at once: each asks the near station to wait
/// out its gap in silence and then send once to the address it saw, then asks which address
/// it sees now.
pub async fn holds(ctx: Arc<Ctx>) {
    let mut set = tokio::task::JoinSet::new();
    for gap in GAPS_S {
        let ctx = ctx.clone();
        set.spawn(async move {
            let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else { return };
            let nonce: u64 = rand::random();
            let mut buf = [0u8; 1500];
            let mut acked: Option<String> = None;
            for _ in 0..3 {
                let _ = sock.send_to(&ctl_encode(&Ctl::HoldReq { nonce, gap_ms: gap * 1000 }), ctx.near.ctl()).await;
                if let Ok(Ok((n, _))) = tokio::time::timeout(Duration::from_millis(800), sock.recv_from(&mut buf)).await {
                    if let Some(Ctl::HoldAck { nonce: rn, seen }) = ctl_decode(&buf[..n]) {
                        if rn == nonce {
                            acked = Some(seen);
                            break;
                        }
                    }
                }
            }
            let Some(seen) = acked else {
                ctx.log.rec("hold", json!({"gap_s": gap, "err": "no acknowledgment"}));
                return;
            };
            let t0 = Instant::now();
            let mut woke = None;
            let deadline = tokio::time::Instant::now() + Duration::from_secs(gap + 6);
            while let Ok(Ok((n, _))) = tokio::time::timeout_at(deadline, sock.recv_from(&mut buf)).await {
                if let Some(Ctl::HoldWake { nonce: rn, .. }) = ctl_decode(&buf[..n]) {
                    if rn == nonce {
                        woke = Some(t0.elapsed().as_millis() as u64);
                        break;
                    }
                }
            }
            let mut after = Value::Null;
            for _ in 0..3 {
                let _ = sock.send_to(&ctl_encode(&Ctl::AfterReq { nonce }), ctx.near.ctl()).await;
                if let Ok(Ok((n, _))) = tokio::time::timeout(Duration::from_millis(800), sock.recv_from(&mut buf)).await {
                    if let Some(Ctl::AfterResp { nonce: rn, seen, before }) = ctl_decode(&buf[..n]) {
                        if rn == nonce {
                            after = json!({"seen": seen, "before": before});
                            break;
                        }
                    }
                }
            }
            ctx.log.rec("hold", json!({"gap_s": gap, "seen": seen, "woke_after_ms": woke, "after": after}));
        });
    }
    while set.join_next().await.is_some() {}
}

/// The portmapper iroh itself uses: which protocols the router answers, and whether it grants
/// a mapping for a socket of ours. It runs at launch, on the local network only, before the
/// consent screen.
pub async fn portmap_probe(log: p02_common::rawlog::RawLog) -> Option<portmapper::Client> {
    let client = portmapper::Client::default();
    let t0 = Instant::now();
    let probe = tokio::time::timeout(Duration::from_secs(6), client.probe()).await;
    let p = match probe {
        Ok(Ok(Ok(o))) => json!({"upnp": o.upnp, "pcp": o.pcp, "nat_pmp": o.nat_pmp}),
        Ok(Ok(Err(e))) => json!({"err": e.to_string()}),
        _ => json!({"err": "timed out"}),
    };
    log.rec("portmap_probe", json!({"result": p, "ms": t0.elapsed().as_millis() as u64}));
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    let port = sock.local_addr().ok()?.port();
    client.update_local_port(std::num::NonZeroU16::new(port)?);
    let mut w = client.watch_external_address();
    let t0 = Instant::now();
    let got = tokio::time::timeout(Duration::from_secs(8), w.wait_for(|a| a.is_some())).await;
    let ext = got.ok().and_then(|r| r.ok().map(|a| a.map(|x| x.to_string())));
    log.rec("portmap_mapping", json!({"local_port": port, "external": ext, "ms": t0.elapsed().as_millis() as u64}));
    std::mem::forget(sock);
    Some(client)
}
