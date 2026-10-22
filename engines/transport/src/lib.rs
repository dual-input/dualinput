//! The transport, an engine at the core's edge: it runs iroh's endpoint, its connections, and
//! their streams, and keeps only what turns on real time and bytes, which the loop never
//! sees: the one-off packets waiting for room in QUIC's queue, pacing through a relay, and
//! the heartbeat's send stamp (record/areas/network/02-units.md, "The transport"). The network
//! crate makes every decision on the loop and hands its `Command`s down, and each `Event` goes
//! back up as one of its inputs.
//!
//! Every stream opens with its channel's number, and every one-off packet starts with it, 2
//! bytes little-endian each, so a receiver hands each message to its channel without asking
//! the sender. A packet the network asks to stamp ends with 8 more: µs on the sender's clock
//! as it went to QUIC.

mod conn;
mod one_offs;
mod pacer;

use std::collections::BTreeMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex, mpsc as std_mpsc};
use std::time::Duration;

use iroh::endpoint::{QuicTransportConfig, VarInt, presets};
use iroh::{
    Endpoint, EndpointAddr, EndpointId, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey,
    Watcher,
};
use messages::net::{Command, Event, Relay};
use tokio::runtime::Handle;
use tokio::sync::mpsc;
use tokio::task::AbortHandle;

use crate::conn::Pacers;
use crate::one_offs::Packet;
use crate::pacer::Pacer;

/// The protocol both sides name in QUIC's handshake. It stays the same in every release,
/// since a core of another release is refused at the first message, which tells it why
/// (record/areas/network/02-units.md, "The first message").
pub const ALPN: &[u8] = b"dualinput";

/// iroh 0.96.1's `bind` hung on about half of one game's players' PCs on Windows, which
/// nobody has checked on iroh 1.3, so the endpoint binds under this timeout and reports a
/// failure rather than hanging (record/areas/network/01-between-machines.md, "iroh as a
/// dependency").
const BIND_WITHIN: Duration = Duration::from_secs(5);

/// For 2s after a direct path dies, iroh keeps sending on it, then moves the connection to
/// the relay, and the keep-alive at a third of that also holds each home router's mapping
/// open, as p03 ran them (record/areas/network/01-between-machines.md, "Paths").
const PATH_IDLE: Duration = Duration::from_secs(2);
const PATH_KEEP_ALIVE: Duration = Duration::from_millis(667);

/// QUIC's queue of one-off packets holds three of 1,162 bytes, each one-off packet's size at
/// QUIC's starting packet size, and the rest wait in the transport's slots, so a newer
/// sample never waits behind stale ones (record/areas/network/01-between-machines.md,
/// "Sending").
const ONE_OFF_QUEUE: usize = 3 * 1_162;

/// The 750ms the core's edges get to finish once the core exits
/// (record/areas/core/01-loop-and-edge.md, "Exiting").
const CLOSE_WITHIN: Duration = Duration::from_millis(750);

const STATS_EVERY: Duration = Duration::from_secs(1);

/// What every task of the transport shares: the clock and where events go.
#[derive(Clone)]
pub(crate) struct Shared {
    pub(crate) now: fn() -> u64,
    pub(crate) events: Arc<dyn Fn(Event) + Send + Sync>,
}

/// The transport's handle: commands go in through it, and the core's edge waits on it as
/// the core exits.
#[derive(Clone)]
pub struct Transport {
    commands: mpsc::UnboundedSender<Command>,
    closed: Arc<Mutex<std_mpsc::Receiver<()>>>,
}

/// Starts the transport on `runtime`. `now` reads the clock every stamp in the program is
/// on, in µs, which the heartbeat's send stamp and ATC frames' deadlines use, and `events`
/// takes each event, as the core's edge pushes it into the loop's queue.
pub fn start(
    runtime: &Handle,
    now: fn() -> u64,
    events: impl Fn(Event) + Send + Sync + 'static,
) -> Transport {
    let (commands, commands_rx) = mpsc::unbounded_channel();
    let (ended, ended_rx) = mpsc::unbounded_channel();
    let (connected, connected_rx) = mpsc::unbounded_channel();
    let (closed, closed_rx) = std_mpsc::channel();
    let driver = Driver {
        shared: Shared {
            now,
            events: Arc::new(events),
        },
        endpoint: None,
        relays: Vec::new(),
        pacers: Arc::default(),
        accepting: None,
        dials: BTreeMap::new(),
        conns: BTreeMap::new(),
        next: 1,
        ended,
        connected,
        closed,
    };
    runtime.spawn(driver.run(commands_rx, connected_rx, ended_rx));
    Transport {
        commands,
        closed: Arc::new(Mutex::new(closed_rx)),
    }
}

impl Transport {
    pub fn send(&self, command: Command) {
        let _ = self.commands.send(command);
    }

    /// Closes the endpoint, if the network hasn't, and waits up to `within` for it to have
    /// closed, so the other cores get each connection's close before the core's runtime
    /// stops.
    pub fn finish(&self, within: Duration) {
        let closed = self.closed.lock().unwrap_or_else(|p| p.into_inner());
        while closed.try_recv().is_ok() {}
        self.send(Command::Shutdown);
        let _ = closed.recv_timeout(within);
    }
}

/// A connection a dial or the endpoint's accepting made, and whether this side dialed.
struct Connected {
    conn: iroh::endpoint::Connection,
    dialed: bool,
}

struct Driver {
    shared: Shared,
    endpoint: Option<Endpoint>,
    /// The relays the endpoint bound with, which every dial goes through.
    relays: Vec<RelayUrl>,
    pacers: Pacers,
    accepting: Option<AbortHandle>,
    /// The dial running to each endpoint, which a new dial to it replaces.
    dials: BTreeMap<[u8; 32], AbortHandle>,
    conns: BTreeMap<u64, conn::Handle>,
    /// The next connection's number. A higher number is the newer connection, which the
    /// network's rule for two connections one side dialed asks for.
    next: u64,
    ended: mpsc::UnboundedSender<u64>,
    connected: mpsc::UnboundedSender<Connected>,
    closed: std_mpsc::Sender<()>,
}

impl Driver {
    async fn run(
        mut self,
        mut commands: mpsc::UnboundedReceiver<Command>,
        mut connected: mpsc::UnboundedReceiver<Connected>,
        mut ended: mpsc::UnboundedReceiver<u64>,
    ) {
        let mut stats = tokio::time::interval(STATS_EVERY);
        stats.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                command = commands.recv() => match command {
                    Some(command) => self.command(command).await,
                    None => return self.shut().await,
                },
                Some(c) = connected.recv() => self.connected(c),
                Some(number) = ended.recv() => {
                    self.conns.remove(&number);
                }
                _ = stats.tick() => {
                    for conn in self.conns.values() {
                        (self.shared.events)(conn.stats());
                    }
                }
            }
        }
    }

    async fn command(&mut self, command: Command) {
        match command {
            Command::Bind { key, relays, ip } => self.bind(key, relays, ip).await,
            Command::Dial { endpoint } => self.dial(endpoint),
            Command::Close { conn, code } => {
                if let Some(c) = self.conns.get(&conn) {
                    c.conn.close(VarInt::from_u32(code), b"");
                }
            }
            Command::Stream {
                conn,
                channel,
                priority,
                bytes,
            } => {
                if let Some(c) = self.conns.get_mut(&conn) {
                    c.stream(channel, priority, bytes);
                }
            }
            Command::OneOff {
                conn,
                channel,
                priority,
                wait,
                bytes,
                stamp,
            } => {
                if let Some(c) = self.conns.get(&conn) {
                    c.one_off(Packet {
                        channel,
                        priority,
                        wait,
                        bytes,
                        stamp,
                    });
                }
            }
            Command::Shutdown => {
                self.shut().await;
                let _ = self.closed.send(());
            }
        }
    }

    async fn bind(&mut self, key: [u8; 32], relays: Vec<Relay>, ip: bool) {
        self.shut().await;
        let bound = match self.build(key, &relays, ip) {
            Ok(builder) => match tokio::time::timeout(BIND_WITHIN, builder.bind()).await {
                Ok(Ok(endpoint)) => Ok(endpoint),
                Ok(Err(error)) => Err(error.to_string()),
                Err(_) => Err(format!(
                    "binding took longer than {}s",
                    BIND_WITHIN.as_secs()
                )),
            },
            Err(error) => Err(error),
        };
        match bound {
            Ok(endpoint) => {
                let id = *endpoint.id().as_bytes();
                tracing::info!(
                    relays = relays.len(),
                    ip,
                    "the transport bound its endpoint"
                );
                tokio::spawn(log_home(endpoint.clone()));
                self.accepting = Some(
                    tokio::spawn(accept(endpoint.clone(), self.connected.clone())).abort_handle(),
                );
                self.endpoint = Some(endpoint);
                (self.shared.events)(Event::Bound(Ok(id)));
            }
            Err(error) => {
                tracing::warn!(error, "the transport's endpoint didn't bind");
                (self.shared.events)(Event::Bound(Err(error)));
            }
        }
    }

    /// The endpoint, from iroh's `presets::Minimal`, which publishes nothing about the pilot
    /// to n0's DNS, with the session's relays and their tokens
    /// (record/areas/network/01-between-machines.md, "The relays").
    fn build(
        &mut self,
        key: [u8; 32],
        relays: &[Relay],
        ip: bool,
    ) -> Result<iroh::endpoint::Builder, String> {
        let mut configs = Vec::new();
        let mut pacers = BTreeMap::new();
        for relay in relays {
            let url = RelayUrl::from_str(&relay.url)
                .map_err(|e| format!("the relay URL {} didn't read: {e}", relay.url))?;
            // A relay over plain HTTP, as `iroh-relay --dev` and the bench's serve one, runs no
            // QUIC address discovery, which needs TLS, and iroh waited 3s for its probe there
            // before it picked a home relay (measured on the bench, 2026-10-22,
            // record/areas/network/log.md). Our relays serve it over HTTPS.
            let mut config = match url.scheme() {
                "https" => RelayConfig::from(url.clone()),
                _ => RelayConfig::new(url.clone(), None),
            };
            if !relay.token.is_empty() {
                config = config.with_auth_token(&relay.token);
            }
            configs.push(config);
            if relay.cap > 0 {
                pacers.insert(url, Pacer::new(relay.cap));
            }
        }
        self.relays = configs.iter().map(|c| c.url.clone()).collect();
        self.pacers = Arc::new(pacers);
        let transport = QuicTransportConfig::builder()
            .default_path_max_idle_timeout(PATH_IDLE)
            .default_path_keep_alive_interval(PATH_KEEP_ALIVE)
            .datagram_send_buffer_size(ONE_OFF_QUEUE)
            .build();
        let mut builder = Endpoint::builder(presets::Minimal)
            .secret_key(SecretKey::from_bytes(&key))
            .relay_mode(RelayMode::Custom(RelayMap::from_iter(configs)))
            .alpns(vec![ALPN.to_vec()])
            .transport_config(transport);
        // Two cores on one PC would otherwise link directly, and their tests would never
        // cross the relay (record/areas/network/01-between-machines.md, "Two cores on one
        // PC").
        if !ip {
            builder = builder.clear_ip_transports();
        }
        Ok(builder)
    }

    /// Dials through every relay the endpoint bound with, in place of any dial still
    /// running to that endpoint.
    fn dial(&mut self, endpoint: [u8; 32]) {
        let Some(me) = &self.endpoint else {
            return tracing::warn!("the network asked for a dial before the endpoint bound");
        };
        let Ok(id) = EndpointId::from_bytes(&endpoint) else {
            return tracing::warn!("the network asked to dial an endpoint ID that isn't one");
        };
        let mut addr = EndpointAddr::new(id);
        for url in &self.relays {
            addr = addr.with_relay_url(url.clone());
        }
        let (me, connected) = (me.clone(), self.connected.clone());
        let dial = tokio::spawn(async move {
            match me.connect(addr, ALPN).await {
                Ok(conn) => {
                    let _ = connected.send(Connected { conn, dialed: true });
                }
                Err(error) => tracing::debug!(%error, "a dial failed"),
            }
        });
        if let Some(running) = self.dials.insert(endpoint, dial.abort_handle()) {
            running.abort();
        }
    }

    fn connected(&mut self, c: Connected) {
        if self.endpoint.is_none() {
            return c.conn.close(VarInt::from_u32(0), b"");
        }
        let number = self.next;
        self.next += 1;
        (self.shared.events)(Event::Connected {
            conn: number,
            endpoint: *c.conn.remote_id().as_bytes(),
            dialed: c.dialed,
        });
        let handle = conn::Handle::start(
            number,
            c.conn,
            &self.shared,
            self.pacers.clone(),
            self.ended.clone(),
        );
        self.conns.insert(number, handle);
    }

    /// Closes the endpoint, which sends each connection still open its close, within the
    /// 750ms the core's edges get.
    async fn shut(&mut self) {
        for (_, dial) in std::mem::take(&mut self.dials) {
            dial.abort();
        }
        if let Some(accepting) = self.accepting.take() {
            accepting.abort();
        }
        if let Some(endpoint) = self.endpoint.take() {
            if tokio::time::timeout(CLOSE_WITHIN, endpoint.close())
                .await
                .is_err()
            {
                tracing::warn!("the transport's endpoint took longer than 750ms to close");
            }
            tracing::info!("the transport closed its endpoint");
        }
        self.conns.clear();
    }
}

async fn accept(endpoint: Endpoint, connected: mpsc::UnboundedSender<Connected>) {
    while let Some(incoming) = endpoint.accept().await {
        let connected = connected.clone();
        tokio::spawn(async move {
            let Ok(accepting) = incoming.accept() else {
                return;
            };
            match accepting.await {
                Ok(conn) => {
                    let _ = connected.send(Connected {
                        conn,
                        dialed: false,
                    });
                }
                Err(error) => tracing::debug!(%error, "an incoming connection failed"),
            }
        });
    }
}

/// Logs each home relay the endpoint takes, which iroh picks by latency and keeps private, so
/// a log shows which relay a relayed pair crossed (record/areas/network/01-between-machines.md,
/// "The relays"). It ends with the endpoint.
async fn log_home(endpoint: Endpoint) {
    let mut status = endpoint.home_relay_status();
    let mut last = None;
    loop {
        let home = status
            .get()
            .into_iter()
            .find(|s| s.is_connected())
            .map(|s| s.url().to_string());
        if home.is_some() && home != last {
            tracing::info!(
                "the endpoint's home relay is {}",
                home.as_deref().unwrap_or("")
            );
            last = home;
        }
        if status.updated().await.is_err() {
            return;
        }
    }
}
