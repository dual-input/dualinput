//! What every step shares: the deployment, the HTTPS client, the raw file, the window's
//! state, and the stop signal.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use p02_common::config::{Deploy, StationCfg};
use p02_common::rawlog::RawLog;
use rustls::pki_types::CertificateDer;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::json;
use tokio::sync::watch;

use crate::ui::UiHandle;

pub struct Ctx {
    pub deploy: Deploy,
    pub ca: CertificateDer<'static>,
    pub http: reqwest::Client,
    pub log: RawLog,
    pub ui: UiHandle,
    pub run_id: String,
    pub near: StationCfg,
    pub far: Option<StationCfg>,
    pub stop: watch::Receiver<bool>,
    pub next_cid: AtomicU32,
    pub side: iroh::Endpoint,
    /// `--quick`, for our own runs: every step shortened to a few attempts and seconds.
    pub quick: bool,
}

pub fn flag(name: &str) -> bool {
    std::env::args().any(|a| a == name)
}

impl Ctx {
    pub fn cid(&self) -> u32 {
        self.next_cid.fetch_add(1, Ordering::Relaxed)
    }

    pub fn stopped(&self) -> bool {
        *self.stop.borrow()
    }

    /// Sleeps, or returns early with `true` when the friend stops the test.
    pub async fn sleep(&self, d: Duration) -> bool {
        let mut s = self.stop.clone();
        tokio::select! {
            _ = tokio::time::sleep(d) => self.stopped(),
            _ = s.wait_for(|v| *v) => true,
        }
    }

    /// A station API call, logged with how long it took and how it ended.
    pub async fn post<B: Serialize, R: DeserializeOwned>(&self, st: &StationCfg, path: &str, body: &B) -> Result<R, String> {
        let t0 = Instant::now();
        let r = self.http.post(format!("{}{}", st.api_url(), path)).json(body).send().await;
        let out = match r {
            Ok(r) if r.status().is_success() => r.json::<R>().await.map_err(|e| e.to_string()),
            Ok(r) => {
                let code = r.status().as_u16();
                Err(format!("HTTP {code}: {}", r.text().await.unwrap_or_default()))
            }
            Err(e) => Err(e.to_string()),
        };
        self.log.rec(
            "api",
            json!({"st": st.name, "path": path, "ms": t0.elapsed().as_millis() as u64, "ok": out.is_ok(),
                   "err": out.as_ref().err()}),
        );
        out
    }

    pub async fn get<R: DeserializeOwned>(&self, st: &StationCfg, path: &str) -> Result<R, String> {
        let r = self.http.get(format!("{}{}", st.api_url(), path)).send().await;
        match r {
            Ok(r) if r.status().is_success() => r.json::<R>().await.map_err(|e| e.to_string()),
            Ok(r) => Err(format!("HTTP {}", r.status().as_u16())),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn stations(&self) -> Vec<StationCfg> {
        let mut v = vec![self.near.clone()];
        if let Some(f) = &self.far {
            v.push(f.clone());
        }
        v
    }
}
