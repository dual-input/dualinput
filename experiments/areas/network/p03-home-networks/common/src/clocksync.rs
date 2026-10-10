//! Clock samples against a station: every `every`, eight exchanges 50ms apart, each logged
//! with the asker's counter and system clock at send and at receipt, and the station's system
//! clock at receipt and at reply. Our analysis keeps the exchanges with the shortest round
//! trips, which bound the offset most tightly, and fits the counter's drift through them.

use std::net::SocketAddr;
use std::time::Duration;

use serde_json::json;
use tokio::net::UdpSocket;
use tokio::sync::watch;

use crate::clock::{mono_us, qpc_raw, wall_us};
use crate::rawlog::RawLog;
use crate::wire::{Ctl, ctl_decode, ctl_encode};

pub async fn clock_loop(log: RawLog, station: String, ctl: SocketAddr, every: Duration, mut stop: watch::Receiver<bool>) {
    let sock = match UdpSocket::bind("0.0.0.0:0").await {
        Ok(s) => s,
        Err(e) => {
            log.rec("clock_err", json!({"st": station, "e": e.to_string()}));
            return;
        }
    };
    let mut nonce: u64 = rand::random::<u32>() as u64;
    let mut buf = [0u8; 1500];
    loop {
        for _ in 0..8 {
            nonce += 1;
            let (qpc, freq) = qpc_raw();
            let t1 = mono_us();
            let w1 = wall_us();
            let req = ctl_encode(&Ctl::ClockReq { nonce, t1 });
            if let Err(e) = sock.send_to(&req, ctl).await {
                log.rec("clock_err", json!({"st": station, "e": e.to_string()}));
                break;
            }
            let got = tokio::time::timeout(Duration::from_millis(1000), async {
                loop {
                    let (n, _) = sock.recv_from(&mut buf).await?;
                    if let Some(Ctl::ClockResp { nonce: rn, rx_ns, tx_ns, .. }) = ctl_decode(&buf[..n]) {
                        if rn == nonce {
                            return Ok::<_, std::io::Error>((rx_ns, tx_ns));
                        }
                    }
                }
            })
            .await;
            let t4 = mono_us();
            let w4 = wall_us();
            match got {
                Ok(Ok((rx_ns, tx_ns))) => log.rec_at(
                    t4,
                    "clock",
                    json!({"st": station, "n": nonce, "t1": t1, "w1": w1, "rx_ns": rx_ns,
                           "tx_ns": tx_ns, "t4": t4, "w4": w4, "qpc": qpc, "qpf": freq}),
                ),
                _ => log.rec_at(t4, "clock_lost", json!({"st": station, "n": nonce, "t1": t1})),
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tokio::select! {
            _ = tokio::time::sleep(every) => {}
            _ = stop.changed() => return,
        }
        if *stop.borrow() {
            return;
        }
    }
}
