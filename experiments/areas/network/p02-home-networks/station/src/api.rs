//! The HTTPS API on port 4443, behind our own certificate authority.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use hyper_util::rt::{TokioExecutor, TokioIo};
use p02_common::clock::wall_us;
use p02_common::config::API_PORT;
use p02_common::proto::*;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use serde_json::{Value, json};
use tower_service::Service;

use crate::Station;

type S = State<Arc<Station>>;
type Caller = ConnectInfo<SocketAddr>;

fn err(code: StatusCode, msg: impl Into<String>) -> Response {
    (code, msg.into()).into_response()
}

fn caller_v4(c: &Caller) -> Result<Ipv4Addr, Response> {
    match c.0.ip().to_canonical() {
        IpAddr::V4(v4) => Ok(v4),
        IpAddr::V6(_) => Err(err(StatusCode::BAD_REQUEST, "this needs the caller's IPv4 address")),
    }
}

pub async fn serve(st: Arc<Station>) -> anyhow::Result<()> {
    let certs: Vec<CertificateDer<'static>> =
        CertificateDer::pem_file_iter(&st.cfg.cert)?.collect::<Result<_, _>>()?;
    let key = PrivateKeyDer::from_pem_file(&st.cfg.key)?;
    let tls = rustls::ServerConfig::builder_with_provider(p02_common::tls::provider())
        .with_safe_default_protocol_versions()?
        .with_no_client_auth()
        .with_single_cert(certs, key)?;
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));

    let app = Router::new()
        .route("/v1/hello", post(hello))
        .route("/v1/register", post(register))
        .route("/v1/testers", get(testers))
        .route("/v1/peer/endpoint", post(peer_endpoint))
        .route("/v1/forward/open", post(forward_open))
        .route("/v1/netem", post(netem))
        .route("/v1/firewall", post(firewall))
        .route("/v1/capture", post(capture))
        .route("/v1/burst", post(burst))
        .route("/v1/udp-send", post(udp_send))
        .route("/v1/upload", post(upload))
        .route("/v1/peer/poll", get(peer_poll))
        .route("/v1/peer/reply", post(peer_reply))
        .route("/v1/status", get(status))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .with_state(st.clone());

    let listener = tokio::net::TcpListener::bind(("::", API_PORT)).await?;
    st.log.rec("api_listen", json!({"port": API_PORT}));
    loop {
        let Ok((tcp, addr)) = listener.accept().await else { continue };
        let (acceptor, app) = (acceptor.clone(), app.clone());
        tokio::spawn(async move {
            let Ok(Ok(tls)) = tokio::time::timeout(Duration::from_secs(20), acceptor.accept(tcp)).await else { return };
            let svc = hyper::service::service_fn(move |mut req: hyper::Request<hyper::body::Incoming>| {
                req.extensions_mut().insert(ConnectInfo(addr));
                app.clone().call(req)
            });
            let _ = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new())
                .serve_connection_with_upgrades(TokioIo::new(tls), svc)
                .await;
        });
    }
}

async fn hello(State(st): S, c: Caller, Json(r): Json<HelloReq>) -> Json<HelloResp> {
    st.log.rec("hello", json!({"run_id": r.run_id, "build": r.build, "from": c.0.to_string()}));
    Json(HelloResp {
        station: st.cfg.name.clone(),
        your_addr: SocketAddr::new(c.0.ip().to_canonical(), c.0.port()).to_string(),
        wall_us: wall_us(),
        build: st.deploy.build.clone(),
    })
}

async fn register(State(st): S, c: Caller, Json(r): Json<RegisterReq>) -> Json<Value> {
    let info = TesterInfo { run_id: r.run_id.clone(), side: r.side, near: r.near, phase: r.phase, since_s: 0 };
    let fresh = {
        let mut m = st.intro.lock().unwrap();
        let fresh = !m.contains_key(&r.run_id);
        m.insert(r.run_id.clone(), (info.clone(), Instant::now()));
        fresh
    };
    st.log.rec("register", json!({"run_id": r.run_id, "phase": info.phase, "fresh": fresh, "from": c.0.to_string(), "side": info.side}));
    Json(json!({"ok": true}))
}

async fn testers(State(st): S, Query(q): Query<HashMap<String, String>>) -> Json<TestersResp> {
    let me = q.get("run_id").cloned().unwrap_or_default();
    let m = st.intro.lock().unwrap();
    let list = m
        .iter()
        .filter(|(id, (_, seen))| **id != me && seen.elapsed() < Duration::from_secs(60))
        .map(|(_, (i, seen))| TesterInfo { since_s: seen.elapsed().as_secs(), ..i.clone() })
        .collect();
    Json(TestersResp { testers: list })
}

async fn peer_endpoint(State(st): S, c: Caller, Json(r): Json<EndpointReq>) -> Response {
    let Some(relay) = st.deploy.station(&r.relay) else {
        return err(StatusCode::BAD_REQUEST, format!("no station {}", r.relay));
    };
    let args = PeerEndpointArgs {
        relay_url: relay.relay_url(),
        ip: r.ip,
        idle_ms: r.idle_ms,
        keepalive_ms: r.keepalive_ms,
        label: r.label.clone(),
    };
    st.log.rec("peer_endpoint", json!({"target": r.target, "from": c.0.to_string(), "args": args}));
    match st.broker.request(&r.target, "endpoint", json!(args), Duration::from_secs(25)).await {
        Ok(rep) if rep.ok => match serde_json::from_value::<EndpointResp>(rep.result) {
            Ok(e) => Json(e).into_response(),
            Err(e) => err(StatusCode::BAD_GATEWAY, e.to_string()),
        },
        Ok(rep) => err(StatusCode::BAD_GATEWAY, rep.result.to_string()),
        Err(e) => err(StatusCode::GATEWAY_TIMEOUT, e),
    }
}

async fn forward_open(State(st): S, c: Caller, Json(r): Json<ForwardReq>) -> Response {
    let token = format!("{:016x}", rand::random::<u64>());
    let (pa, pb) = match crate::udp::open_forward(st.clone(), token.clone(), r.label.clone()).await {
        Ok(p) => p,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    let args = PeerForwardArgs { fwd: SocketAddr::new(st.public_v4.into(), pb).to_string(), token, label: r.label.clone() };
    st.log.rec("forward_open", json!({"target": r.target, "from": c.0.to_string(), "port_a": pa, "args": args}));
    match st.broker.request(&r.target, "forward", json!(args), Duration::from_secs(25)).await {
        Ok(rep) if rep.ok => {
            let name = rep.result["server_name"].as_str().unwrap_or("p02-peer").to_string();
            Json(ForwardResp { port_a: pa, server_name: name }).into_response()
        }
        Ok(rep) => err(StatusCode::BAD_GATEWAY, rep.result.to_string()),
        Err(e) => err(StatusCode::GATEWAY_TIMEOUT, e),
    }
}

async fn netem(State(st): S, c: Caller, Json(r): Json<NetemReq>) -> Response {
    let ip = match caller_v4(&c) {
        Ok(ip) => ip,
        Err(e) => return e,
    };
    let secs = r.secs.min(600);
    st.shaping.netem(ip, &r.mode, r.loss_pct, r.burst_ms, r.burst_every_ms, secs, &r.label).await;
    Json(NetemResp { ip: ip.to_string(), wall_us: wall_us() }).into_response()
}

async fn firewall(State(st): S, c: Caller, Json(r): Json<FirewallReq>) -> Response {
    let ip = match caller_v4(&c) {
        Ok(ip) => ip,
        Err(e) => return e,
    };
    let Some(ns) = st.cfg.namespaces.iter().find(|n| n.name == r.target) else {
        return err(StatusCode::BAD_REQUEST, format!("no namespace {}", r.target));
    };
    st.shaping.firewall(ip, ns.ip, r.drop, r.secs.min(300), &r.label).await;
    Json(json!({"ok": true, "wall_us": wall_us()})).into_response()
}

async fn capture(State(st): S, c: Caller, Json(r): Json<CaptureReq>) -> Response {
    let ip = match caller_v4(&c) {
        Ok(ip) => ip,
        Err(e) => return e,
    };
    st.shaping.capture(ip, r.secs.min(1800), &r.label, st.cfg.data_dir.join("cap")).await;
    Json(json!({"ok": true})).into_response()
}

async fn burst(State(st): S, c: Caller, Json(r): Json<BurstReq>) -> Json<BurstResp> {
    let mut b = st.burst.lock().unwrap();
    let granted = if r.begin {
        match &*b {
            Some((holder, since)) if holder != &r.run_id && since.elapsed() < Duration::from_secs(180) => false,
            _ => {
                *b = Some((r.run_id.clone(), Instant::now()));
                true
            }
        }
    } else {
        if b.as_ref().is_some_and(|(h, _)| h == &r.run_id) {
            *b = None;
        }
        true
    };
    st.log.rec("burst", json!({"run_id": r.run_id, "begin": r.begin, "granted": granted, "from": c.0.to_string()}));
    Json(BurstResp { granted })
}

async fn udp_send(State(st): S, Json(r): Json<UdpSendReq>) -> Response {
    let to: SocketAddr = match r.to.parse() {
        Ok(a) => a,
        Err(e) => return err(StatusCode::BAD_REQUEST, format!("{e}")),
    };
    match crate::udp::send_unsolicited(&st, to, r.nonce).await {
        Ok(()) => Json(json!({"ok": true, "wall_us": wall_us()})).into_response(),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

async fn upload(State(st): S, c: Caller, Query(q): Query<HashMap<String, String>>, body: Bytes) -> Response {
    let clean = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect::<String>();
    let run = clean(q.get("run_id").map(String::as_str).unwrap_or("unknown"));
    let part = clean(q.get("part").map(String::as_str).unwrap_or("1"));
    let file = st.cfg.data_dir.join("uploads").join(format!("{run}-part{part}-{}.ndjson.gz", wall_us()));
    match tokio::fs::write(&file, &body).await {
        Ok(()) => {
            st.log.rec("upload", json!({"run_id": run, "part": part, "bytes": body.len(), "from": c.0.to_string(), "file": file.display().to_string()}));
            Json(json!({"ok": true, "bytes": body.len()})).into_response()
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

async fn peer_poll(State(st): S, Query(q): Query<HashMap<String, String>>) -> Response {
    let name = q.get("name").cloned().unwrap_or_default();
    match st.broker.poll(&name, Duration::from_secs(25)).await {
        Some(cmd) => {
            st.log.rec("peer_cmd", json!({"peer": name, "id": cmd.id, "op": cmd.op}));
            Json(cmd).into_response()
        }
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

async fn peer_reply(State(st): S, Json(r): Json<PeerReply>) -> Json<Value> {
    st.log.rec("peer_reply", json!({"id": r.id, "ok": r.ok, "result": r.result}));
    st.broker.reply(r);
    Json(json!({"ok": true}))
}

async fn status(State(st): S) -> Json<Value> {
    let testers: Vec<Value> = st
        .intro
        .lock()
        .unwrap()
        .iter()
        .map(|(id, (i, seen))| json!({"run_id": id, "phase": i.phase, "near": i.near, "seen_s": seen.elapsed().as_secs()}))
        .collect();
    Json(json!({"station": st.cfg.name, "peers": st.broker.peers(), "testers": testers, "wall_us": wall_us()}))
}
