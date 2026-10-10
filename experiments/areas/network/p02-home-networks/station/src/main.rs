//! The station on each droplet: the HTTPS API testers and peers talk to, the UDP services that
//! answer STUN, clock, and router checks, the UDP forwarder, the upload sink, and the controls
//! for `tc netem`, the firewall, and packet captures. It logs everything it does to
//! `<data>/station.ndjson`, stamped like every other record.

mod api;
mod broker;
mod shaping;
mod udp;

use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use p02_common::config::Deploy;
use p02_common::rawlog::RawLog;
use serde::Deserialize;
use serde_json::json;

#[derive(Clone, Debug, Deserialize)]
pub struct StationFile {
    pub name: String,
    pub data_dir: PathBuf,
    pub cert: PathBuf,
    pub key: PathBuf,
    pub wan_if: String,
    pub deploy: PathBuf,
    /// Each namespace's peer address, which the firewall rules name.
    pub namespaces: Vec<NsCfg>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct NsCfg {
    pub name: String,
    pub ip: Ipv4Addr,
}

pub struct Station {
    pub cfg: StationFile,
    pub deploy: Deploy,
    pub public_v4: Ipv4Addr,
    pub public_v6: Option<Ipv6Addr>,
    pub log: RawLog,
    pub broker: broker::Broker,
    pub shaping: Arc<shaping::Shaping>,
    pub intro: std::sync::Mutex<std::collections::HashMap<String, (p02_common::proto::TesterInfo, std::time::Instant)>>,
    pub burst: std::sync::Mutex<Option<(String, std::time::Instant)>>,
    pub ctl_v4: tokio::sync::OnceCell<Arc<tokio::net::UdpSocket>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    p02_common::install_crypto();
    let path = std::env::args().nth(1).unwrap_or_else(|| "/etc/p02/station.json".into());
    let cfg: StationFile = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
    let deploy = Deploy::parse(&std::fs::read_to_string(&cfg.deploy)?)?;
    std::fs::create_dir_all(cfg.data_dir.join("uploads"))?;
    std::fs::create_dir_all(cfg.data_dir.join("cap"))?;
    let log = RawLog::create(&cfg.data_dir.join("station.ndjson"))?;
    let me = deploy
        .station(&cfg.name)
        .ok_or_else(|| anyhow::anyhow!("{} isn't in deploy.json", cfg.name))?
        .clone();
    log.rec(
        "station_start",
        json!({"name": cfg.name, "build": deploy.build, "ipv4": me.ipv4.to_string(),
               "ipv6": me.ipv6.map(|a| a.to_string()), "wall_us": p02_common::clock::wall_us()}),
    );
    let st = Arc::new(Station {
        shaping: Arc::new(shaping::Shaping::new(cfg.wan_if.clone(), log.clone())),
        cfg,
        deploy,
        public_v4: me.ipv4,
        public_v6: me.ipv6,
        log: log.clone(),
        broker: broker::Broker::default(),
        intro: Default::default(),
        burst: Default::default(),
        ctl_v4: Default::default(),
    });
    st.shaping.init().await;

    tokio::spawn(udp::stun_service(st.clone()));
    tokio::spawn(udp::ctl_service(st.clone()));
    tokio::spawn(udp::sink_service(st.clone()));
    tokio::spawn(samplers(st.clone()));
    api::serve(st).await
}

/// Each second: the station's monotonic and system clocks side by side, so our analysis can put
/// the forwarder's stamps on the droplet's clock, and the CPU and memory load. Each minute:
/// chrony's view of the clock, and the firewall and queueing rules in force.
async fn samplers(st: Arc<Station>) {
    let mut iv = tokio::time::interval(Duration::from_secs(1));
    let mut prev: Option<(u64, u64)> = None;
    let mut n: u64 = 0;
    loop {
        iv.tick().await;
        st.log.rec("clk", json!({"w": p02_common::clock::wall_us()}));
        if let Ok(s) = std::fs::read_to_string("/proc/stat") {
            if let Some(line) = s.lines().next() {
                let v: Vec<u64> = line.split_whitespace().skip(1).filter_map(|x| x.parse().ok()).collect();
                let idle = v.get(3).copied().unwrap_or(0) + v.get(4).copied().unwrap_or(0);
                let total: u64 = v.iter().sum();
                if let Some((pi, pt)) = prev {
                    let dt = total.saturating_sub(pt) as f64;
                    let di = idle.saturating_sub(pi) as f64;
                    let mem = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
                    let avail = mem
                        .lines()
                        .find(|l| l.starts_with("MemAvailable"))
                        .and_then(|l| l.split_whitespace().nth(1))
                        .and_then(|x| x.parse::<u64>().ok());
                    if dt > 0.0 {
                        st.log.rec("load", json!({"cpu_pct": (1000.0 * (dt - di) / dt).round() / 10.0, "mem_avail_kb": avail}));
                    }
                }
                prev = Some((idle, total));
            }
        }
        if n % 60 == 0 {
            let chrony = shaping::run("chronyc", &["-c", "tracking"]).await;
            st.log.rec("chrony", json!({"out": chrony}));
            st.shaping.log_rules("periodic").await;
        }
        n += 1;
    }
}
