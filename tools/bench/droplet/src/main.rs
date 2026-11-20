//! The droplet run's program, a small core for Linux: the kernel's loop with the clients crate,
//! the network crate, and a test unit that sends v1's busy mix, with the transport at an edge of
//! its own, since the core runs only on Windows (record/areas/network/02-units.md, "Cases for
//! the bench"). tools/bench/droplet/run.ts runs a listener and a dialer between our droplets
//! under `tc netem`, and each writes what it sent and what came, and when, into its folder.
//!
//!   bench-droplet listen <folder> <public IPv4> <secs>
//!   bench-droplet dial <folder> <pilot> <endpoint> <relay URL> <token> <secs>
//!
//! The listener runs a relay of its own in the process, then prints
//! `peer <pilot> <endpoint> <relay URL> <token>`, whose last four words the dialer takes. The
//! relay only introduces the two ends, as our relays introduce two pilots, so the run needs
//! no DNS and no deployed relay; once iroh finds the direct path, the connection leaves it.

mod edge;
mod mix;

use std::any::TypeId;
use std::io::{Read, Write};
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ed25519_dalek::SigningKey;
use iroh_relay::server::{Access, AccessControl, ClientRequest, RelayConfig, Server, ServerConfig};
use kernel::{CancelTimer, Exit, Kernel, Registry, SetTimer, StartJob};
use messages::net::{Command, Event};
use serde_json::json;

use crate::edge::{Queue, Sinks, Timers};
use crate::mix::{Config, Mix, Role};

const USAGE: &str = "usage: bench-droplet listen <folder> <public IPv4> <secs>
       bench-droplet dial <folder> <pilot> <endpoint> <relay URL> <token> <secs>";

/// The port the listener's relay serves plain HTTP on, the one iroh-relay's dev mode serves
/// on (read in iroh-relay 1.3.0, `src/main.rs`, `DEV_MODE_HTTP_PORT`). The usage in
/// tools/bench/droplet/run.ts names it as a port to open, so change both together.
const RELAY_PORT: u16 = 3340;

/// The 750ms the core's edges get to finish once it exits, as `GRACE` in
/// src/apps/core/src/run.rs gives them, so change both together.
const GRACE: Duration = Duration::from_millis(750);

/// Every unit, in the core's order, with the test unit last.
const UNITS: &[fn(&mut Registry)] = &[clients::register, network::register, Mix::register];

fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("tokio's runtime should start");
    let (folder, config, relay) = match args[..] {
        ["listen", folder, ip, secs] => {
            let (Ok(ip), Ok(secs)) = (ip.parse::<Ipv4Addr>(), secs.parse()) else {
                return usage();
            };
            let (key, pilot, token) = (random::<32>(), random::<16>(), hex(&random::<16>()));
            let relay = match runtime.block_on(start_relay(token.clone())) {
                Ok(relay) => relay,
                Err(error) => {
                    eprintln!("the relay didn't start on port {RELAY_PORT}: {error}");
                    return ExitCode::FAILURE;
                }
            };
            let url = format!("http://{ip}:{RELAY_PORT}");
            let endpoint = SigningKey::from_bytes(&key).verifying_key().to_bytes();
            println!("peer {} {} {url} {token}", hex(&pilot), hex(&endpoint));
            let _ = std::io::stdout().flush();
            let config = Config {
                role: Role::Listen,
                pilot,
                key,
                relay_url: url,
                relay_token: token,
                peer: None,
                secs,
            };
            (folder, config, Some(relay))
        }
        ["dial", folder, pilot, endpoint, url, token, secs] => {
            let (Some(peer_pilot), Some(endpoint), Ok(secs)) =
                (unhex(pilot), unhex(endpoint), secs.parse())
            else {
                return usage();
            };
            let config = Config {
                role: Role::Dial,
                pilot: random(),
                key: random(),
                relay_url: url.into(),
                relay_token: token.into(),
                peer: Some((peer_pilot, endpoint)),
                secs,
            };
            (folder, config, None)
        }
        _ => return usage(),
    };
    let folder = PathBuf::from(folder);
    if let Err(error) = std::fs::create_dir_all(&folder) {
        eprintln!("couldn't make {}: {error}", folder.display());
        return ExitCode::FAILURE;
    }
    run(&runtime, &folder, &config);
    if let Some(relay) = relay {
        // tokio's timeout reads the runtime's clock as it's made, so it's made inside.
        let _ = runtime.block_on(async { tokio::time::timeout(GRACE, relay.shutdown()).await });
    }
    runtime.shutdown_timeout(GRACE);
    ExitCode::SUCCESS
}

/// Runs the loop until the test unit puts out the exit, then gives the transport the core's
/// grace to close its connections.
fn run(runtime: &tokio::runtime::Runtime, folder: &std::path::Path, config: &Config) {
    let mut registry = Registry::new();
    for register in UNITS {
        register(&mut registry);
    }
    let mut kernel = Kernel::new(registry);
    let queue = Arc::new(Queue::default());
    let timers = Timers::start(queue.clone());
    let config = serde_json::to_vec(config).expect("serde_json should write the config");
    let files = kernel
        .start_files()
        .into_iter()
        .map(|name| match name {
            mix::CONFIG => (name.to_string(), Some(config.clone())),
            _ => (name.to_string(), std::fs::read(folder.join(name)).ok()),
        })
        .collect();
    queue.push(kernel::FIRST, kernel::first_input(random(), files));

    let mut sinks = Sinks::default();
    let set = timers.clone();
    sinks.on(move |s: SetTimer| set.set(s.id, s.due));
    let cancel = timers.clone();
    sinks.on(move |c: CancelTimer| cancel.cancel(c.id));
    let (handle, jobs_queue, jobs_folder) = (
        runtime.handle().clone(),
        queue.clone(),
        Arc::new(folder.to_path_buf()),
    );
    sinks.on(move |s: StartJob| {
        edge::start_job(&handle, jobs_queue.clone(), jobs_folder.clone(), s);
    });
    let source = kernel
        .source::<network::Transport>()
        .expect("the network crate should be registered");
    let log = transport_log(folder);
    let events = queue.clone();
    let transport = transport::start(runtime.handle(), edge::now, move |event| {
        log_event(&log, &event);
        events.push(source, network::encode_event(&event));
    });
    let commands = transport.clone();
    sinks.on(move |command: Command| commands.send(command));

    loop {
        let input = queue.pop();
        let mut exit = false;
        for output in kernel.handle(&input) {
            if output.value_type() == TypeId::of::<Exit>() {
                exit = true;
            } else {
                sinks.carry(output);
            }
        }
        if exit {
            break;
        }
    }
    transport.finish(GRACE);
    timers.stop();
}

/// `transport.ndjson` in the folder, a line for each path a connection took and each second's
/// stats, which the report reads to refuse a run that wasn't direct throughout, and to show
/// what QUIC saw.
fn transport_log(folder: &std::path::Path) -> Arc<Mutex<Option<std::fs::File>>> {
    let file = std::fs::File::create(folder.join("transport.ndjson"))
        .map_err(|error| eprintln!("couldn't write transport.ndjson: {error}"))
        .ok();
    Arc::new(Mutex::new(file))
}

fn log_event(log: &Mutex<Option<std::fs::File>>, event: &Event) {
    let line = match event {
        Event::Path { conn, path } => json!({ "t": edge::now(), "conn": conn, "path": path }),
        Event::Stats {
            conn,
            sent,
            lost,
            rtt_us,
            cwnd,
        } => json!({
            "t": edge::now(), "conn": conn, "sent": sent, "lost": lost, "rtt_us": rtt_us, "cwnd": cwnd,
        }),
        _ => return,
    };
    if let Some(file) = log.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        let _ = writeln!(file, "{line}");
    }
}

/// The listener's relay: iroh-relay's own server over plain HTTP on every interface, admitting
/// only a client with the run's token, so it relays for nobody else while it runs.
async fn start_relay(token: String) -> Result<Server, String> {
    let mut relay = RelayConfig::new((Ipv4Addr::UNSPECIFIED, RELAY_PORT));
    relay.access = Arc::new(Token(token));
    let mut config = ServerConfig::default();
    config.relay = Some(relay);
    Server::spawn(config).await.map_err(|e| e.to_string())
}

#[derive(Debug)]
struct Token(String);

impl AccessControl for Token {
    async fn on_connect(&self, request: &ClientRequest) -> Access {
        if request.auth_token().as_deref() == Some(self.0.as_str()) {
            Access::Allow
        } else {
            Access::Deny { reason: None }
        }
    }
}

/// Random bytes from the operating system, for the keys, the pilot IDs, the token, and the
/// kernel's seed.
fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .expect("the droplet run runs on Linux, which has /dev/urandom");
    bytes
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex<const N: usize>(text: &str) -> Option<[u8; N]> {
    if text.len() != N * 2 {
        return None;
    }
    let mut bytes = [0; N];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(bytes)
}

fn usage() -> ExitCode {
    eprintln!("{USAGE}");
    ExitCode::from(2)
}
