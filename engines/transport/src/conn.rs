//! One connection's tasks: a writer for each stream this core opened on it, the one-off
//! packets waiting for room in QUIC's queue, readers for what comes in, and watchers of its
//! path and its end.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use futures_util::StreamExt;
use iroh::endpoint::{Connection, ConnectionError, RecvStream, SendDatagramError};
use iroh::{RelayUrl, TransportAddr};
use messages::net::{Event, Path};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use crate::Shared;
use crate::one_offs::{Packet, Waiting};
use crate::pacer::Pacer;

/// Stream data goes to QUIC in writes of at most this many bytes while a relay paces it, so
/// a long write, such as a replay, can't hold a waiting stream of higher priority back.
const PACED_WRITE: usize = 4_096;

/// What a relay counts beyond the bytes a packet carries, which the pacer adds to each
/// packet, so what reaches the relay stays under its cap: QUIC's and the relay's headers,
/// about 130 to 150 bytes a relayed packet, which no run has measured
/// (record/areas/network/02-units.md, "Who hosts them").
const RELAYED_OVERHEAD: usize = 150;

/// Each relay's pacer, by its URL.
pub(crate) type Pacers = Arc<BTreeMap<RelayUrl, Pacer>>;

/// The relay the connection's chosen path runs through, or `None` while it's direct.
type Through = Arc<Mutex<Option<RelayUrl>>>;

fn relay_of(cell: &Through) -> Option<RelayUrl> {
    cell.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

pub(crate) struct Handle {
    pub(crate) number: u64,
    pub(crate) conn: Connection,
    one_offs: mpsc::UnboundedSender<Packet>,
    streams: BTreeMap<u16, mpsc::UnboundedSender<Vec<u8>>>,
    through: Through,
    pacers: Pacers,
    /// Every task but the one that waits for the connection's end, which drops the handle
    /// and with it these.
    tasks: JoinSet<()>,
}

impl Handle {
    /// Starts the connection's tasks. The driver has put out its `Connected` first, so every
    /// event of the connection comes after it.
    pub(crate) fn start(
        number: u64,
        conn: Connection,
        shared: &Shared,
        pacers: Pacers,
        ended: mpsc::UnboundedSender<u64>,
    ) -> Handle {
        let through: Through = Arc::default();
        let mut tasks = JoinSet::new();
        let (one_offs, waiting) = mpsc::unbounded_channel();
        tasks.spawn(send_one_offs(
            conn.clone(),
            waiting,
            shared.clone(),
            through.clone(),
            pacers.clone(),
        ));
        tasks.spawn(read_one_offs(number, conn.clone(), shared.clone()));
        tasks.spawn(accept_streams(number, conn.clone(), shared.clone()));
        tasks.spawn(watch_path(
            number,
            conn.clone(),
            shared.clone(),
            through.clone(),
        ));
        tokio::spawn(watch_end(number, conn.clone(), shared.clone(), ended));
        Handle {
            number,
            conn,
            one_offs,
            streams: BTreeMap::new(),
            through,
            pacers,
            tasks,
        }
    }

    /// Writes to the channel's stream, opening it on first use.
    pub(crate) fn stream(&mut self, channel: u16, priority: u8, bytes: Vec<u8>) {
        let writer = self.streams.entry(channel).or_insert_with(|| {
            let (tx, rx) = mpsc::unbounded_channel();
            self.tasks.spawn(write_stream(
                self.conn.clone(),
                channel,
                priority,
                rx,
                self.through.clone(),
                self.pacers.clone(),
            ));
            tx
        });
        let _ = writer.send(bytes);
    }

    pub(crate) fn one_off(&self, packet: Packet) {
        let _ = self.one_offs.send(packet);
    }

    /// The connection's counts for the once-a-second `Stats`: what it sent and lost over
    /// its life, and its chosen path's round trip and congestion window.
    pub(crate) fn stats(&self) -> Event {
        let stats = self.conn.stats();
        let chosen = self
            .conn
            .paths()
            .iter()
            .find(|p| p.is_selected())
            .map(|p| p.stats());
        Event::Stats {
            conn: self.number,
            sent: stats.udp_tx.datagrams,
            lost: stats.lost_packets,
            rtt_us: chosen
                .as_ref()
                .map_or(0, |s| u64::try_from(s.rtt.as_micros()).unwrap_or(u64::MAX)),
            cwnd: chosen.map_or(0, |s| s.cwnd),
        }
    }
}

/// A stream opens with its channel's number, so the receiver hands its bytes to the channel
/// without asking, then carries every write in order.
async fn write_stream(
    conn: Connection,
    channel: u16,
    priority: u8,
    mut writes: mpsc::UnboundedReceiver<Vec<u8>>,
    through: Through,
    pacers: Pacers,
) {
    let Ok(mut send) = conn.open_uni().await else {
        return;
    };
    let _ = send.set_priority(i32::from(priority));
    if send.write_all(&channel.to_le_bytes()).await.is_err() {
        return;
    }
    while let Some(bytes) = writes.recv().await {
        let mut rest = &bytes[..];
        while !rest.is_empty() {
            let relay = relay_of(&through);
            let pacer = relay.as_ref().and_then(|url| pacers.get(url));
            let take = match pacer {
                Some(_) => rest.len().min(PACED_WRITE),
                None => rest.len(),
            };
            if let Some(pacer) = pacer {
                let packets = take.div_ceil(crate::PACKET);
                pacer
                    .take(priority, take + packets * RELAYED_OVERHEAD)
                    .await;
            }
            if send.write_all(&rest[..take]).await.is_err() {
                return;
            }
            rest = &rest[take..];
        }
    }
}

/// Hands the waiting one-off packets to QUIC, highest priority first, each only once QUIC's
/// queue has room for it, so the queue never drops one to make room.
async fn send_one_offs(
    conn: Connection,
    mut incoming: mpsc::UnboundedReceiver<Packet>,
    shared: Shared,
    through: Through,
    pacers: Pacers,
) {
    let mut waiting = Waiting::default();
    loop {
        let soonest = waiting.expire((shared.now)());
        let next = waiting.next().map(|(slot, packet)| {
            let mut bytes = Vec::with_capacity(packet.bytes.len() + 10);
            bytes.extend(packet.channel.to_le_bytes());
            bytes.extend(&packet.bytes);
            // Taken as the packet goes to QUIC, so the loop's own delay stays out of the
            // time on the path. A packet that then waits for room carries an early stamp,
            // and the longer round trip that gives keeps the exchange out of the clock
            // offset, which takes the shortest of the last 8.
            if packet.stamp {
                bytes.extend((shared.now)().to_le_bytes());
            }
            (slot, Bytes::from(bytes))
        });
        let until_soonest =
            soonest.map(|at| Duration::from_micros(at.saturating_sub((shared.now)())));
        tokio::select! {
            biased;
            packet = incoming.recv() => match packet {
                Some(packet) => waiting.put(packet),
                None => return,
            },
            sent = async {
                let (_, bytes) = next.as_ref().expect("the branch runs only with a packet");
                conn.send_datagram_wait(bytes.clone()).await
            }, if next.is_some() => {
                let (slot, bytes) = next.expect("the branch runs only with a packet");
                match sent {
                    Ok(()) => {
                        if let Some(url) = relay_of(&through)
                            && let Some(pacer) = pacers.get(&url)
                        {
                            pacer.spend(bytes.len() + RELAYED_OVERHEAD);
                        }
                        waiting.sent(slot);
                    }
                    Err(SendDatagramError::TooLarge) => {
                        tracing::warn!(bytes = bytes.len(), "a one-off packet was larger than the path takes, so it was dropped");
                        waiting.sent(slot);
                    }
                    Err(_) => return,
                }
            },
            _ = tokio::time::sleep(until_soonest.unwrap_or_default()), if until_soonest.is_some() => {}
        }
    }
}

async fn read_one_offs(number: u64, conn: Connection, shared: Shared) {
    while let Ok(bytes) = conn.read_datagram().await {
        let Some((channel, rest)) = bytes.split_first_chunk::<2>() else {
            continue;
        };
        (shared.events)(Event::OneOff {
            conn: number,
            channel: u16::from_le_bytes(*channel),
            bytes: rest.to_vec(),
        });
    }
}

async fn accept_streams(number: u64, conn: Connection, shared: Shared) {
    while let Ok(recv) = conn.accept_uni().await {
        tokio::spawn(read_stream(number, recv, shared.clone()));
    }
}

/// Hands up a stream's bytes as they come, after the channel number it opens with; the
/// network crate finds its messages in them.
async fn read_stream(number: u64, mut recv: RecvStream, shared: Shared) {
    let mut channel = [0; 2];
    if recv.read_exact(&mut channel).await.is_err() {
        return;
    }
    let channel = u16::from_le_bytes(channel);
    while let Ok(Some(bytes)) = recv.read_chunk(64 * 1024).await {
        (shared.events)(Event::Stream {
            conn: number,
            channel,
            bytes: bytes.to_vec(),
        });
    }
}

/// Puts out the chosen path each time it changes, and keeps the relay it runs through for
/// the pacer.
async fn watch_path(number: u64, conn: Connection, shared: Shared, through: Through) {
    let mut paths = std::pin::pin!(conn.paths_stream());
    let mut last = None;
    while let Some(list) = paths.next().await {
        let Some(chosen) = list
            .iter()
            .find(|p| p.is_selected())
            .map(|p| p.remote_addr().clone())
        else {
            continue;
        };
        let (path, relay) = match chosen {
            TransportAddr::Relay(url) => (
                Path::Relay {
                    url: url.to_string(),
                },
                Some(url),
            ),
            _ => (Path::Direct, None),
        };
        *through.lock().unwrap_or_else(|p| p.into_inner()) = relay;
        if last.as_ref() != Some(&path) {
            (shared.events)(Event::Path {
                conn: number,
                path: path.clone(),
            });
            last = Some(path);
        }
    }
}

/// Puts out the connection's end, with the application code it closed with, and tells the
/// driver to drop it.
async fn watch_end(
    number: u64,
    conn: Connection,
    shared: Shared,
    ended: mpsc::UnboundedSender<u64>,
) {
    let code = match conn.closed().await {
        ConnectionError::ApplicationClosed(close) => {
            u32::try_from(u64::from(close.error_code)).map_err(|_| close.to_string())
        }
        other => Err(other.to_string()),
    };
    (shared.events)(Event::Closed { conn: number, code });
    let _ = ended.send(number);
}
