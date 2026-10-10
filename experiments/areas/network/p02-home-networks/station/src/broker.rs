//! Hands commands to peers, which reach the station by long-polling it over HTTPS: the peer on
//! our PC sits behind a home router that the station can't connect through, so the peer asks
//! for its next command, and the station holds the request open until one comes.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use p02_common::proto::{PeerCmd, PeerReply};
use tokio::sync::{Notify, oneshot};

#[derive(Default)]
pub struct Broker {
    queues: Mutex<HashMap<String, VecDeque<PeerCmd>>>,
    notify: Mutex<HashMap<String, std::sync::Arc<Notify>>>,
    waiting: Mutex<HashMap<u64, oneshot::Sender<PeerReply>>>,
    seen: Mutex<HashMap<String, Instant>>,
    next: AtomicU64,
}

impl Broker {
    fn notifier(&self, peer: &str) -> std::sync::Arc<Notify> {
        self.notify.lock().unwrap().entry(peer.to_string()).or_default().clone()
    }

    /// Whether the peer polled within the last 60s.
    pub fn alive(&self, peer: &str) -> bool {
        self.seen.lock().unwrap().get(peer).is_some_and(|t| t.elapsed() < Duration::from_secs(60))
    }

    pub fn peers(&self) -> Vec<(String, u64)> {
        self.seen.lock().unwrap().iter().map(|(k, v)| (k.clone(), v.elapsed().as_secs())).collect()
    }

    pub async fn request(&self, peer: &str, op: &str, args: serde_json::Value, timeout: Duration) -> Result<PeerReply, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        self.waiting.lock().unwrap().insert(id, tx);
        self.queues
            .lock()
            .unwrap()
            .entry(peer.to_string())
            .or_default()
            .push_back(PeerCmd { id, op: op.to_string(), args });
        self.notifier(peer).notify_one();
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(r)) => Ok(r),
            _ => {
                self.waiting.lock().unwrap().remove(&id);
                self.queues.lock().unwrap().entry(peer.to_string()).or_default().retain(|c| c.id != id);
                Err(format!("peer {peer} didn't answer within {}s", timeout.as_secs()))
            }
        }
    }

    pub async fn poll(&self, peer: &str, wait: Duration) -> Option<PeerCmd> {
        self.seen.lock().unwrap().insert(peer.to_string(), Instant::now());
        let n = self.notifier(peer);
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            if let Some(c) = self.queues.lock().unwrap().entry(peer.to_string()).or_default().pop_front() {
                return Some(c);
            }
            if tokio::time::timeout_at(deadline, n.notified()).await.is_err() {
                return None;
            }
        }
    }

    pub fn reply(&self, r: PeerReply) {
        if let Some(tx) = self.waiting.lock().unwrap().remove(&r.id) {
            let _ = tx.send(r);
        }
    }
}
