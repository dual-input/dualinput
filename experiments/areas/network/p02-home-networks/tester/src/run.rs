//! The run from launch to exit: resend an earlier run's file if one is waiting, open the
//! sockets that bring up Windows Firewall's prompt, wait for consent, run the steps, upload,
//! and serve as a peer for other testers until the friend closes the window or 3 hours pass.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use p02_common::clock::{qpc_raw, wall_us};
use p02_common::config::{Deploy, StationCfg};
use p02_common::ep::{IrohOpts, iroh_endpoint};
use p02_common::proto::{HelloReq, HelloResp};
use p02_common::rawlog::RawLog;
use serde_json::json;
use tokio::sync::{mpsc, watch};

use crate::ctx::Ctx;
use crate::ui::{Click, Screen, UiHandle, Upload};
use crate::upload::{self, Pending};
use crate::{checks, steps};

pub const DEPLOY_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/deploy.json"));
const SERVE_FOR: Duration = Duration::from_secs(3 * 3600);

async fn next_click(rx: &mut mpsc::UnboundedReceiver<Click>) -> Click {
    rx.recv().await.unwrap_or(Click::Quit)
}

pub async fn app_main(ui: UiHandle, mut clicks: mpsc::UnboundedReceiver<Click>, exit: Arc<AtomicBool>) {
    let deploy = match Deploy::parse(DEPLOY_JSON) {
        Ok(d) => d,
        Err(e) => return fatal(&ui, format!("This build is missing its settings ({e})."), &exit, &mut clicks).await,
    };
    let ca = deploy.ca_der().expect("CA in deploy.json");
    let http = p02_common::tls::http_client(ca.clone(), Duration::from_secs(30)).expect("HTTP client");
    let dir = upload::data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::remove_file(dir.join("discarded.tmp"));

    // An earlier run's file that never reached our server goes first.
    let waiting = upload::pending(&dir);
    if !waiting.is_empty() {
        ui.screen(Screen::Resending);
        let mut all_sent = true;
        for p in &waiting {
            let bytes = std::fs::metadata(&p.gz).map(|m| m.len()).unwrap_or(0);
            ui.with(|u| u.upload = Upload::Sending { bytes });
            match upload::send(&http, &deploy, p).await {
                Ok(()) => upload::clear_pending(&dir, p),
                Err(_) => {
                    all_sent = false;
                    ui.with(|u| u.upload = Upload::Failed { file: p.gz.clone() });
                    break;
                }
            }
        }
        if all_sent {
            ui.with(|u| u.upload = Upload::Sent);
        }
        loop {
            match next_click(&mut clicks).await {
                Click::RunAgain => break,
                Click::Quit | Click::CloseNow => {
                    exit.store(true, Ordering::Relaxed);
                    return;
                }
                _ => {}
            }
        }
        ui.with(|u| u.upload = Upload::NotYet);
    }

    ui.screen(Screen::Launching);
    let run_id = format!("{:010x}{:06x}", wall_us() / 1_000_000, rand::random::<u32>() & 0xff_ffff);
    let part1 = dir.join(format!("run-{run_id}-part1.ndjson"));
    let log = match RawLog::create(&part1) {
        Ok(l) => l,
        Err(e) => return fatal(&ui, format!("This program couldn't write its results file ({e})."), &exit, &mut clicks).await,
    };
    p02_common::rawlog::install_tracing(log.clone(), "warn,iroh=debug,iroh_relay=info,noq=info,portmapper=debug");
    let (qpc, qpf) = qpc_raw();
    log.rec("run_start", json!({"run_id": run_id, "build": deploy.build, "wall_us": wall_us(), "qpc": qpc, "qpf": qpf, "version": env!("CARGO_PKG_VERSION")}));
    p02_common::sysmon::snapshot(&log);
    p02_common::sysmon::start_monitors(log.clone());

    // Binding these sockets is what makes Windows Firewall ask, so the friend sees the prompt
    // now rather than in an empty room later; the TCP listener covers TCP's prompt.
    ui.with(|u| u.launch_line = "Opening network connections…".into());
    let side = match iroh_endpoint(&ca, &IrohOpts { relays: vec![], ip: true, portmapper: true, ..Default::default() }).await {
        Ok(e) => e,
        Err(e) => return fatal(&ui, format!("This program couldn't open its network connections ({e})."), &exit, &mut clicks).await,
    };
    let listener = std::net::TcpListener::bind("0.0.0.0:0").ok();
    log.rec("launch_sockets", json!({"side_bound": side.bound_sockets().iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                                      "tcp": listener.as_ref().and_then(|l| l.local_addr().ok()).map(|a| a.to_string())}));
    let pm_log = log.clone();
    let portmap = tokio::spawn(async move { checks::portmap_probe(pm_log).await });
    {
        let log = log.clone();
        tokio::task::spawn_blocking(move || {
            log.rec("firewall", p02_common::sysmon::firewall());
            log.rec("timesvc", p02_common::sysmon::time_service());
        });
    }
    ui.screen(Screen::Consent);

    loop {
        if crate::ctx::flag("--yes") {
            tokio::time::sleep(Duration::from_secs(3)).await;
            break;
        }
        match next_click(&mut clicks).await {
            Click::Start => break,
            Click::Quit | Click::CloseNow => {
                // The friend declined, so nothing they'd have consented to stays on disk.
                let _ = log.rotate(&dir.join("discarded.tmp"));
                let _ = std::fs::remove_file(&part1);
                exit.store(true, Ordering::Relaxed);
                return;
            }
            _ => {}
        }
    }
    log.rec("consent", json!({"wall_us": wall_us()}));
    p02_common::sysmon::keep_awake(true);
    ui.screen(Screen::Running);
    ui.step(0);
    ui.action("Finding the nearest of our servers");

    let (stop_tx, stop_rx) = watch::channel(false);
    let (near, far) = match pick_near(&http, &deploy, &run_id, &log).await {
        Some(x) => x,
        None => {
            log.rec("run_end", json!({"why": "no station answered"}));
            ui.note("This PC couldn't reach our servers, so there was nothing to measure.");
            return finish(&ui, &http, &deploy, &log, &run_id, &dir, &exit, &mut clicks, None, false, stop_tx).await;
        }
    };
    if far.is_none() {
        ui.note("Our second server didn't answer, so the test skips the runs through it.");
    }
    if let Ok(url) = near.relay_url().parse::<iroh::RelayUrl>() {
        side.insert_relay(url.clone(), Arc::new(iroh::RelayConfig::from(url))).await;
    }
    let ctx = Arc::new(Ctx {
        deploy: deploy.clone(),
        ca: ca.clone(),
        http: http.clone(),
        log: log.clone(),
        ui: ui.clone(),
        run_id: run_id.clone(),
        near: near.clone(),
        far: far.clone(),
        stop: stop_rx.clone(),
        next_cid: AtomicU32::new(1),
        side,
        quick: crate::ctx::flag("--quick"),
    });
    log.rec("flags", json!({"quick": ctx.quick, "yes": crate::ctx::flag("--yes")}));
    tokio::spawn(p02_common::clocksync::clock_loop(log.clone(), near.name.clone(), near.ctl(), Duration::from_secs(10), stop_rx.clone()));
    if let Some(f) = &far {
        tokio::spawn(p02_common::clocksync::clock_loop(log.clone(), f.name.clone(), f.ctl(), Duration::from_secs(30), stop_rx.clone()));
    }
    let phase = Arc::new(std::sync::Mutex::new("checks".to_string()));
    tokio::spawn(steps::side_manager(ctx.clone(), phase.clone()));

    let runner = {
        let ctx = ctx.clone();
        let phase = phase.clone();
        tokio::spawn(async move { run_steps(ctx, phase).await })
    };
    let mut runner = runner;
    let summary = loop {
        tokio::select! {
            r = &mut runner => break r.ok(),
            c = clicks.recv() => match c {
                Some(Click::StopConfirmed) | None => {
                    log.rec("stop", json!({"by": "friend"}));
                    let _ = stop_tx.send(true);
                    ui.screen(Screen::Stopping);
                }
                _ => {}
            }
        }
    };
    if let Ok(Some(pm)) = portmap.await {
        pm.deactivate();
    }
    let stopped = *stop_rx.borrow();
    *phase.lock().unwrap() = "serving".into();
    drop(listener);
    // Our short runs (`--quick`) close after the upload rather than serve.
    let serve = !stopped && !crate::ctx::flag("--quick");
    finish(&ui, &http, &deploy, &log, &run_id, &dir, &exit, &mut clicks, summary, serve, stop_tx).await;
}

async fn run_steps(ctx: Arc<Ctx>, phase: Arc<std::sync::Mutex<String>>) -> String {
    let set_phase = |p: &str| *phase.lock().unwrap() = p.to_string();
    let holds = tokio::spawn(checks::holds(ctx.clone()));
    checks::router_checks(&ctx).await;
    ctx.ui.finish_step(0, false);

    set_phase("burst");
    ctx.ui.step(1);
    if let Err(e) = steps::burst(&ctx).await {
        ctx.log.rec("burst_err", json!({"e": e}));
        ctx.ui.note("The full-speed upload minute couldn't run, so the test skips it.");
        ctx.ui.finish_step(1, true);
    } else {
        ctx.ui.finish_step(1, false);
    }

    set_phase("connect");
    ctx.ui.step(2);
    let (made, direct) = steps::connect(&ctx).await;
    ctx.ui.finish_step(2, made == 0);

    set_phase("switch");
    ctx.ui.step(3);
    steps::switch(&ctx).await;
    ctx.ui.finish_step(3, false);

    set_phase("relay");
    ctx.ui.step(4);
    let runs = steps::relay(&ctx).await;
    ctx.ui.finish_step(4, runs == 0);

    let _ = tokio::time::timeout(Duration::from_secs(60), holds).await;
    let s = format!(
        "This PC made {made} connections, {direct} of them direct, and finished {runs} of {} runs through the relay servers.",
        4 * ctx.stations().len()
    );
    ctx.log.rec("run_end", json!({"made": made, "direct": direct, "relay_runs": runs, "stopped": ctx.stopped()}));
    s
}

/// Asks each station hello three times and takes the one with the shortest round trip as near.
async fn pick_near(http: &reqwest::Client, deploy: &Deploy, run_id: &str, log: &RawLog) -> Option<(StationCfg, Option<StationCfg>)> {
    let mut best: Vec<(u128, StationCfg)> = Vec::new();
    for st in &deploy.stations {
        let mut rtts = Vec::new();
        for _ in 0..3 {
            let t0 = Instant::now();
            let r = http
                .post(format!("{}/v1/hello", st.api_url()))
                .json(&HelloReq { run_id: run_id.into(), build: deploy.build.clone() })
                .send()
                .await;
            match r {
                Ok(r) if r.status().is_success() => {
                    let rtt = t0.elapsed().as_micros();
                    if let Ok(h) = r.json::<HelloResp>().await {
                        log.rec("hello", json!({"st": st.name, "rtt_us": rtt as u64, "seen": h.your_addr, "station_wall_us": h.wall_us}));
                    }
                    rtts.push(rtt);
                }
                Ok(r) => log.rec("hello", json!({"st": st.name, "err": format!("HTTP {}", r.status())})),
                Err(e) => log.rec("hello", json!({"st": st.name, "err": e.to_string()})),
            }
        }
        // The first request carries the TLS handshake, so the best of three is the round trip.
        if let Some(m) = rtts.iter().min() {
            best.push((*m, st.clone()));
        }
    }
    best.sort_by_key(|(r, _)| *r);
    let near = best.first()?.1.clone();
    let far = best.get(1).map(|(_, s)| s.clone());
    log.rec("stations", json!({"near": near.name, "far": far.as_ref().map(|f| f.name.clone()), "rtts_us": best.iter().map(|(r, s)| json!({"st": s.name, "rtt_us": *r as u64})).collect::<Vec<_>>()}));
    Some((near, far))
}

#[allow(clippy::too_many_arguments)]
async fn finish(
    ui: &UiHandle,
    http: &reqwest::Client,
    deploy: &Deploy,
    log: &RawLog,
    run_id: &str,
    dir: &std::path::Path,
    exit: &Arc<AtomicBool>,
    clicks: &mut mpsc::UnboundedReceiver<Click>,
    summary: Option<String>,
    serve: bool,
    stop_tx: watch::Sender<bool>,
) {
    let last = ui.with(|u| u.steps.len() - 1);
    ui.step(last);
    ui.action("Compressing the results file");
    log.rec("part_end", json!({"part": 1}));
    let part2 = dir.join(format!("run-{run_id}-part2.ndjson"));
    let closed = match log.rotate(&part2) {
        Ok(p) => p,
        Err(_) => {
            log.flush();
            log.path()
        }
    };
    let sent = send_part(ui, http, deploy, run_id, 1, &closed, dir).await;
    ui.finish_step(last, false);
    ui.with(|u| {
        u.summary = summary;
        u.screen = Screen::Done;
        if serve {
            u.serving_until = Some(Instant::now() + SERVE_FOR);
        }
    });
    log.rec("serving", json!({"serve": serve, "sent": sent}));
    if serve {
        let until = tokio::time::Instant::now() + SERVE_FOR;
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(until) => break,
                c = clicks.recv() => match c {
                    Some(Click::CloseNow) | Some(Click::Quit) | Some(Click::StopConfirmed) | None => break,
                    Some(Click::ShowFile(_)) | Some(_) => {}
                }
            }
        }
        let _ = stop_tx.send(true);
        log.rec("part_end", json!({"part": 2}));
        let part3 = dir.join(format!("run-{run_id}-part3.ndjson"));
        if let Ok(p2) = log.rotate(&part3) {
            ui.with(|u| u.serving_until = None);
            let _ = tokio::time::timeout(Duration::from_secs(60), send_part(ui, http, deploy, run_id, 2, &p2, dir)).await;
        }
    } else {
        let _ = stop_tx.send(true);
        if !sent {
            // The file is on screen for the friend to send; the window stays until they close it.
            loop {
                if matches!(next_click(clicks).await, Click::Quit | Click::CloseNow | Click::StopConfirmed) {
                    break;
                }
            }
        } else {
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    }
    p02_common::sysmon::keep_awake(false);
    exit.store(true, Ordering::Relaxed);
}

async fn send_part(ui: &UiHandle, http: &reqwest::Client, deploy: &Deploy, run_id: &str, part: u32, file: &std::path::Path, dir: &std::path::Path) -> bool {
    let gz = match upload::gzip(file) {
        Ok(g) => g,
        Err(_) => file.to_path_buf(),
    };
    let p = Pending { run_id: run_id.into(), part, gz: gz.clone() };
    upload::mark_pending(dir, &p);
    let bytes = std::fs::metadata(&gz).map(|m| m.len()).unwrap_or(0);
    if part == 1 {
        ui.action("Uploading the results file to our server");
        ui.with(|u| u.upload = Upload::Sending { bytes });
    }
    match upload::send(http, deploy, &p).await {
        Ok(()) => {
            upload::clear_pending(dir, &p);
            if gz != file {
                let _ = std::fs::remove_file(file);
            }
            if part == 1 {
                ui.with(|u| u.upload = Upload::Sent);
            }
            true
        }
        Err(_) => {
            if part == 1 {
                ui.with(|u| u.upload = Upload::Failed { file: gz });
            }
            false
        }
    }
}

async fn fatal(ui: &UiHandle, msg: String, exit: &Arc<AtomicBool>, clicks: &mut mpsc::UnboundedReceiver<Click>) {
    ui.with(|u| {
        u.fatal = Some(msg);
        u.screen = Screen::Fatal;
    });
    let _ = next_click(clicks).await;
    exit.store(true, Ordering::Relaxed);
}
