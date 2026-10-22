//! One of the bench's local relays: iroh-relay's own server over plain HTTP on 127.0.0.1,
//! admitting only a client with the test token and capping what each sends, behind a TCP proxy
//! that holds back or cuts each core's connection on its own
//! (record/areas/network/02-units.md, "Cases for the bench").
//!
//!   bench-relay <token> <cap in bytes a second>
//!
//! It prints `ready <port>`, the proxy's port, which the cores' relay list names as
//! `http://127.0.0.1:<port>`, then takes one command a line on standard input, as JSON, and
//! answers each with a line of its own. A `pid` names a core's process, and 0 every process:
//!
//!   {"cut":{"pid":4120,"ms":10000}}               closes its connections, and refuses new ones for 10s
//!   {"loss":{"pid":4120,"rate":0.01,"hold_ms":28}} holds a read back, and every byte behind it, for 28ms, at a 1% rate
//!   {"delay":{"pid":0,"ms":11}}                    delays every byte by 11ms each way
//!   {"down":true}                                  stops the relay and closes every connection, until {"down":false}
//!   {"rates":{}}                                   answers `rates {...}`: each process's bytes sent and its busiest second
//!
//! On iroh's relay a lost packet only holds back the packets behind it until TCP resends it,
//! and QUIC sees no loss, so holding a read back stands in for a lost packet.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use iroh_relay::server::{
    Access, AccessControl, ClientRateLimit, ClientRequest, RelayConfig, Server, ServerConfig,
};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::AbortHandle;
use tokio::time::Instant;

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Command {
    Cut { pid: u32, ms: u64 },
    Loss { pid: u32, rate: f64, hold_ms: u64 },
    Delay { pid: u32, ms: u64 },
    Down(bool),
    Rates {},
}

/// What the proxy does to one process's bytes, or to every process's under pid 0.
#[derive(Clone, Copy, Default)]
struct Rule {
    cut_until: Option<Instant>,
    loss: Option<(f64, Duration)>,
    delay: Option<Duration>,
}

#[derive(Default)]
struct Counted {
    bytes: u64,
    second: u64,
    peak: u64,
}

struct State {
    rules: HashMap<u32, Rule>,
    relay: Option<SocketAddr>,
    conns: Vec<(u32, AbortHandle)>,
    sent: HashMap<u32, Counted>,
    /// xorshift64, so the bench needs no crate for a coin flip.
    random: u64,
}

impl State {
    /// The process's own rule, with every process's filling what it leaves unset.
    fn rule(&self, pid: u32) -> Rule {
        let all = self.rules.get(&0).copied().unwrap_or_default();
        let own = self.rules.get(&pid).copied().unwrap_or_default();
        Rule {
            cut_until: own.cut_until.max(all.cut_until),
            loss: own.loss.or(all.loss),
            delay: own.delay.or(all.delay),
        }
    }

    fn coin(&mut self) -> f64 {
        self.random ^= self.random << 13;
        self.random ^= self.random >> 7;
        self.random ^= self.random << 17;
        (self.random >> 11) as f64 / (1u64 << 53) as f64
    }
}

type Shared = Arc<Mutex<State>>;

fn lock(shared: &Shared) -> std::sync::MutexGuard<'_, State> {
    shared.lock().unwrap_or_else(|p| p.into_inner())
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

async fn relay(token: &str, cap: NonZeroU32) -> Server {
    let mut relay = RelayConfig::new((Ipv4Addr::LOCALHOST, 0));
    relay.access = Arc::new(Token(token.to_string()));
    relay.limits.client_rx = Some(ClientRateLimit::new(cap));
    let mut config = ServerConfig::default();
    config.relay = Some(relay);
    Server::spawn(config)
        .await
        .expect("the relay should start on 127.0.0.1")
}

#[tokio::main]
async fn main() {
    // Windows ticks a process's timers every 15.6ms unless it asks for finer, which would add up
    // to that to each delay and hold, unevenly each way.
    // SAFETY: timeBeginPeriod takes a resolution in ms and touches no memory of ours.
    unsafe { windows_sys::Win32::Media::timeBeginPeriod(1) };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [token, cap] = &args[..] else {
        eprintln!("usage: bench-relay <token> <cap in bytes a second>");
        std::process::exit(2);
    };
    let cap: NonZeroU32 = cap.parse().expect("the cap should be a number above 0");
    let mut server = Some(relay(token, cap).await);
    let shared: Shared = Arc::new(Mutex::new(State {
        rules: HashMap::new(),
        relay: server.as_ref().and_then(Server::http_addr),
        conns: Vec::new(),
        sent: HashMap::new(),
        random: 0x2545_f491_4f6c_dd1d,
    }));
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("the proxy should listen on 127.0.0.1");
    let proxy = listener.local_addr().expect("a listener has an address");
    println!("ready {}", proxy.port());

    tokio::spawn(accept(listener, proxy, shared.clone()));
    tokio::spawn(count_seconds(shared.clone()));

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let command = match serde_json::from_str::<Command>(&line) {
            Ok(command) => command,
            Err(error) => {
                println!("error {error}");
                continue;
            }
        };
        match command {
            Command::Cut { pid, ms } => {
                let mut state = lock(&shared);
                state.rules.entry(pid).or_default().cut_until =
                    Some(Instant::now() + Duration::from_millis(ms));
                state.conns.retain(|(owner, task)| {
                    let cut = pid == 0 || *owner == pid;
                    if cut {
                        task.abort();
                    }
                    !cut
                });
            }
            Command::Loss { pid, rate, hold_ms } => {
                lock(&shared).rules.entry(pid).or_default().loss =
                    Some((rate, Duration::from_millis(hold_ms)));
            }
            Command::Delay { pid, ms } => {
                lock(&shared).rules.entry(pid).or_default().delay = Some(Duration::from_millis(ms));
            }
            Command::Down(true) => {
                {
                    let mut state = lock(&shared);
                    state.relay = None;
                    for (_, task) in state.conns.drain(..) {
                        task.abort();
                    }
                }
                if let Some(server) = server.take() {
                    let _ = server.shutdown().await;
                }
            }
            Command::Down(false) => {
                if server.is_none() {
                    let started = relay(token, cap).await;
                    lock(&shared).relay = started.http_addr();
                    server = Some(started);
                }
            }
            Command::Rates {} => {
                let state = lock(&shared);
                let rates: HashMap<String, (u64, u64)> = state
                    .sent
                    .iter()
                    .map(|(pid, c)| (pid.to_string(), (c.bytes, c.peak)))
                    .collect();
                println!(
                    "rates {}",
                    serde_json::to_string(&rates).expect("rates should write")
                );
                continue;
            }
        }
        println!("ok");
    }
}

async fn accept(listener: TcpListener, proxy: SocketAddr, shared: Shared) {
    while let Ok((client, from)) = listener.accept().await {
        let pid = owner(from, proxy).unwrap_or_else(|| {
            eprintln!(
                "no process owns the connection from {from}, so no core's rule applies to it"
            );
            u32::MAX
        });
        let (relay, cut) = {
            let state = lock(&shared);
            let cut = state
                .rule(pid)
                .cut_until
                .is_some_and(|until| until > Instant::now());
            (state.relay, cut)
        };
        let Some(relay) = relay.filter(|_| !cut) else {
            continue;
        };
        let task = tokio::spawn(carry(client, relay, pid, shared.clone()));
        lock(&shared).conns.push((pid, task.abort_handle()));
    }
}

/// Carries one connection both ways until either side closes it or a cut aborts it.
async fn carry(client: TcpStream, relay: SocketAddr, pid: u32, shared: Shared) {
    let Ok(server) = TcpStream::connect(relay).await else {
        return;
    };
    let _ = client.set_nodelay(true);
    let _ = server.set_nodelay(true);
    let (client_read, client_write) = client.into_split();
    let (server_read, server_write) = server.into_split();
    tokio::join!(
        pump(client_read, server_write, pid, true, shared.clone()),
        pump(server_read, client_write, pid, false, shared),
    );
}

/// Each read leaves at its time, which a delay or a hold sets, and never before the read
/// ahead of it, so a held read holds back every byte behind it, as TCP does with a lost
/// packet until it resends it.
async fn pump(
    mut from: tokio::net::tcp::OwnedReadHalf,
    mut to: tokio::net::tcp::OwnedWriteHalf,
    pid: u32,
    up: bool,
    shared: Shared,
) {
    let (tx, mut rx) = mpsc::unbounded_channel::<(Instant, Vec<u8>)>();
    let reader = async move {
        let mut buf = vec![0; 16 * 1024];
        let mut last = Instant::now();
        while let Ok(n) = from.read(&mut buf).await {
            if n == 0 {
                break;
            }
            let at = {
                let mut state = lock(&shared);
                if up {
                    state.sent.entry(pid).or_default().second += n as u64;
                }
                let rule = state.rule(pid);
                let mut at = Instant::now() + rule.delay.unwrap_or_default();
                if let Some((rate, hold)) = rule.loss
                    && state.coin() < rate
                {
                    at += hold;
                }
                at
            };
            last = last.max(at);
            if tx.send((last, buf[..n].to_vec())).is_err() {
                break;
            }
        }
    };
    let writer = async move {
        while let Some((at, bytes)) = rx.recv().await {
            // A sleep until a time already reached still waits for the timer's next tick.
            if at > Instant::now() {
                tokio::time::sleep_until(at).await;
            }
            if to.write_all(&bytes).await.is_err() {
                return;
            }
        }
        let _ = to.shutdown().await;
    };
    tokio::join!(reader, writer);
}

/// Once a second, adds each process's bytes of the second to its total and keeps its busiest.
async fn count_seconds(shared: Shared) {
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        for counted in lock(&shared).sent.values_mut() {
            counted.bytes += counted.second;
            counted.peak = counted.peak.max(counted.second);
            counted.second = 0;
        }
    }
}

/// The process that owns the client's end of a connection to the proxy, from Windows' table
/// of IPv4 TCP connections, where that end's local port is the client's and its remote port
/// the proxy's.
fn owner(client: SocketAddr, proxy: SocketAddr) -> Option<u32> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
        TCP_TABLE_OWNER_PID_CONNECTIONS,
    };
    const AF_INET: u32 = 2;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    // The table can grow between the call that sizes it and the one that fills it, so a fill
    // that finds it too small sizes it again.
    let mut buf: Vec<u64> = Vec::new();
    let mut filled = false;
    for _ in 0..4 {
        let mut size = u32::try_from(buf.len() * 8).ok()?;
        // SAFETY: `buf` holds `size` bytes, which GetExtendedTcpTable fills with the table, or
        // with a null table of size 0 it only writes the size it needs.
        let status = unsafe {
            GetExtendedTcpTable(
                if buf.is_empty() {
                    std::ptr::null_mut()
                } else {
                    buf.as_mut_ptr().cast()
                },
                &mut size,
                0,
                AF_INET,
                TCP_TABLE_OWNER_PID_CONNECTIONS,
                0,
            )
        };
        match status {
            0 if !buf.is_empty() => {
                filled = true;
                break;
            }
            0 | ERROR_INSUFFICIENT_BUFFER => buf = vec![0u64; (size as usize).div_ceil(8) + 64],
            _ => return None,
        }
    }
    if !filled {
        return None;
    }
    let table = buf.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>();
    // SAFETY: the table holds `dwNumEntries` rows from its `table` field on, inside `buf`.
    let rows: &[MIB_TCPROW_OWNER_PID] = unsafe {
        std::slice::from_raw_parts(
            std::ptr::addr_of!((*table).table).cast(),
            (*table).dwNumEntries as usize,
        )
    };
    let port = |p: u32| u16::from_be(p as u16);
    rows.iter()
        .find(|r| port(r.dwLocalPort) == client.port() && port(r.dwRemotePort) == proxy.port())
        .map(|r| r.dwOwningPid)
}
