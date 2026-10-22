//! Two transports in one process, through a relay in the same process that serves plain HTTP
//! and admits only a client with its token, as the bench's `iroh-relay --dev` does
//! (record/areas/network/02-units.md, "Cases for the bench").

use std::net::Ipv4Addr;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use iroh_relay::server::{Access, AccessControl, ClientRequest, RelayConfig, Server, ServerConfig};
use messages::net::{Command, Event, Path, Relay, Wait};
use tokio::sync::mpsc;
use transport::Transport;

const TOKEN: &str = "bench-token";

fn now() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_micros() as u64
}

#[derive(Debug)]
struct Token;

impl AccessControl for Token {
    async fn on_connect(&self, request: &ClientRequest) -> Access {
        match request.auth_token().as_deref() {
            Some(TOKEN) => Access::Allow,
            _ => Access::Deny { reason: None },
        }
    }
}

async fn relay() -> (Server, String) {
    let mut relay = RelayConfig::new((Ipv4Addr::LOCALHOST, 0));
    relay.access = Arc::new(Token);
    let mut config = ServerConfig::default();
    config.relay = Some(relay);
    let server = Server::spawn(config)
        .await
        .expect("the test relay should start");
    let url = format!("http://{}", server.http_addr().expect("it serves HTTP"));
    (server, url)
}

struct Side {
    transport: Transport,
    events: mpsc::UnboundedReceiver<Event>,
}

impl Side {
    fn start() -> Side {
        let (tx, events) = mpsc::unbounded_channel();
        let transport = transport::start(&tokio::runtime::Handle::current(), now, move |e| {
            let _ = tx.send(e);
        });
        Side { transport, events }
    }

    /// The next event `want` picks, within 10s, skipping the rest.
    async fn next<T>(&mut self, mut want: impl FnMut(Event) -> Option<T>) -> T {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let event = self.events.recv().await.expect("the transport should run");
                if let Some(got) = want(event) {
                    return got;
                }
            }
        })
        .await
        .expect("the event should come within 10s")
    }

    /// Every event in the next `ms`.
    async fn during(&mut self, ms: u64) -> Vec<Event> {
        let mut events = Vec::new();
        let until = tokio::time::Instant::now() + Duration::from_millis(ms);
        while let Ok(Some(event)) = tokio::time::timeout_at(until, self.events.recv()).await {
            events.push(event);
        }
        events
    }

    async fn bind(&mut self, key: u8, url: &str) -> [u8; 32] {
        self.transport.send(Command::Bind {
            key: [key; 32],
            relays: vec![Relay {
                url: url.into(),
                token: TOKEN.into(),
                cap: 256 * 1024,
            }],
            ip: false,
        });
        self.next(|e| match e {
            Event::Bound(bound) => Some(bound),
            _ => None,
        })
        .await
        .expect("the endpoint should bind")
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_transports_link_through_a_relay_and_carry_both_deliveries() {
    let (_relay, url) = relay().await;
    let (mut a, mut b) = (Side::start(), Side::start());
    let a_id = a.bind(1, &url).await;
    let b_id = b.bind(2, &url).await;

    a.transport.send(Command::Dial { endpoint: b_id });
    let a_conn = a
        .next(|e| match e {
            Event::Connected {
                conn,
                endpoint,
                dialed,
            } if endpoint == b_id => {
                assert!(dialed);
                Some(conn)
            }
            _ => None,
        })
        .await;
    let b_conn = b
        .next(|e| match e {
            Event::Connected {
                conn,
                endpoint,
                dialed,
            } if endpoint == a_id => {
                assert!(!dialed);
                Some(conn)
            }
            _ => None,
        })
        .await;
    let path = a
        .next(|e| match e {
            Event::Path { conn, path } if conn == a_conn => Some(path),
            _ => None,
        })
        .await;
    assert!(
        matches!(&path, Path::Relay { url: through } if through.starts_with(&url)),
        "{path:?}"
    );

    for part in [&b"hello "[..], b"world"] {
        a.transport.send(Command::Stream {
            conn: a_conn,
            channel: 7,
            priority: 100,
            bytes: part.to_vec(),
        });
    }
    let mut got = Vec::new();
    while got.len() < 11 {
        got.extend(
            b.next(|e| match e {
                Event::Stream {
                    conn,
                    channel: 7,
                    bytes,
                } if conn == b_conn => Some(bytes),
                _ => None,
            })
            .await,
        );
    }
    assert_eq!(got, b"hello world");

    let before = now();
    a.transport.send(Command::OneOff {
        conn: a_conn,
        channel: 1,
        priority: 255,
        wait: Wait::Newest { key: 0 },
        bytes: vec![9, 9],
        stamp: true,
    });
    let bytes = b
        .next(|e| match e {
            Event::OneOff {
                conn,
                channel: 1,
                bytes,
            } if conn == b_conn => Some(bytes),
            _ => None,
        })
        .await;
    assert_eq!(bytes.len(), 10);
    assert_eq!(bytes[..2], [9, 9]);
    let stamp = u64::from_le_bytes(bytes[2..].try_into().unwrap());
    assert!((before..=now()).contains(&stamp), "stamp {stamp}");

    a.transport.send(Command::Close {
        conn: a_conn,
        code: 5,
    });
    let code = b
        .next(|e| match e {
            Event::Closed { conn, code } if conn == b_conn => Some(code),
            _ => None,
        })
        .await;
    assert_eq!(code, Ok(5));

    a.transport.finish(Duration::from_secs(1));
    b.transport.finish(Duration::from_secs(1));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_relay_url_that_doesnt_read_fails_the_bind() {
    let mut a = Side::start();
    a.transport.send(Command::Bind {
        key: [1; 32],
        relays: vec![Relay {
            url: "not a url".into(),
            token: String::new(),
            cap: 0,
        }],
        ip: false,
    });
    let bound = a
        .next(|e| match e {
            Event::Bound(bound) => Some(bound),
            _ => None,
        })
        .await;
    assert!(bound.is_err());
}

/// Two transports bound to one relay, with `a` dialed to `b`, and each side's connection.
async fn linked(url: &str) -> (Side, Side, u64, u64) {
    let (mut a, mut b) = (Side::start(), Side::start());
    a.bind(1, url).await;
    let b_id = b.bind(2, url).await;
    a.transport.send(Command::Dial { endpoint: b_id });
    let a_conn = a
        .next(|e| match e {
            Event::Connected { conn, .. } => Some(conn),
            _ => None,
        })
        .await;
    let b_conn = b
        .next(|e| match e {
            Event::Connected { conn, .. } => Some(conn),
            _ => None,
        })
        .await;
    (a, b, a_conn, b_conn)
}

/// A core runs one dial to a member at a time, the newest in place of any still running,
/// since every dial still running when a link returns would connect.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_dial_replaces_the_one_running_to_that_endpoint() {
    let (_relay, url) = relay().await;
    let (mut a, mut b) = (Side::start(), Side::start());
    a.bind(1, &url).await;
    let b_id = b.bind(2, &url).await;
    a.transport.send(Command::Dial { endpoint: b_id });
    a.transport.send(Command::Dial { endpoint: b_id });
    let connected = a
        .during(3_000)
        .await
        .into_iter()
        .filter(|e| matches!(e, Event::Connected { .. }))
        .count();
    assert_eq!(connected, 1);
}

/// An ATC frame whose turn to play has passed is dropped before it goes to QUIC.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_deadline_packet_whose_deadline_passed_is_dropped() {
    let (_relay, url) = relay().await;
    let (a, mut b, a_conn, b_conn) = linked(&url).await;
    for (byte, at) in [(1, now().saturating_sub(1)), (2, now() + 1_000_000)] {
        a.transport.send(Command::OneOff {
            conn: a_conn,
            channel: 6,
            priority: 150,
            wait: Wait::Deadline { at },
            bytes: vec![byte],
            stamp: false,
        });
    }
    let got: Vec<Vec<u8>> = b
        .during(1_500)
        .await
        .into_iter()
        .filter_map(|e| match e {
            Event::OneOff {
                conn,
                channel: 6,
                bytes,
            } if conn == b_conn => Some(bytes),
            _ => None,
        })
        .collect();
    assert_eq!(got, [vec![2]]);
}

/// `finish` closes the endpoint, which sends the other side each connection's close, before
/// the core's runtime stops.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn finish_closes_the_endpoint_and_its_connections() {
    let (_relay, url) = relay().await;
    let (a, mut b, _, b_conn) = linked(&url).await;
    let started = Instant::now();
    tokio::task::block_in_place(|| a.transport.finish(Duration::from_secs(1)));
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "finish took {:?}",
        started.elapsed()
    );
    b.next(|e| match e {
        Event::Closed { conn, .. } if conn == b_conn => Some(()),
        _ => None,
    })
    .await;
}

/// noq drops the oldest one-off packet to make room for a new one, so a burst handed to it
/// whole would lose packets. The transport hands a packet over only once QUIC's queue has room,
/// so a burst far past the queue's 3,486 bytes all arrives (record/areas/network/02-units.md,
/// "Cases for the bench").
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_burst_of_one_off_packets_loses_none_to_quics_queue() {
    let (_relay, url) = relay().await;
    let (a, mut b, a_conn, b_conn) = linked(&url).await;
    for n in 0..200u8 {
        a.transport.send(Command::OneOff {
            conn: a_conn,
            channel: 6,
            priority: 150,
            wait: Wait::Deadline {
                at: now() + 10_000_000,
            },
            bytes: vec![n; 1_000],
            stamp: false,
        });
    }
    let got: Vec<u8> = b
        .during(3_000)
        .await
        .into_iter()
        .filter_map(|e| match e {
            Event::OneOff {
                conn,
                channel: 6,
                bytes,
            } if conn == b_conn => Some(bytes[0]),
            _ => None,
        })
        .collect();
    assert_eq!(got.len(), 200, "{} of 200 arrived", got.len());
    assert!(
        got.windows(2).all(|w| w[0] < w[1]),
        "a deadline channel's packets should keep their order"
    );
}
