//! Loss injection with `tc netem`, firewall drops with iptables, and packet captures, each for
//! one tester's IPv4 address at a time, and each undone by the station itself when its time is
//! up, so a tester that vanishes mid-run leaves nothing in force.
//!
//! Loss goes both ways. Packets to the tester pass a netem qdisc under an HTB class on the WAN
//! interface; packets from the tester are redirected to `ifb0`, which has the same tree, since
//! netem only shapes what a device sends. netem reports a dropped packet to the sender as
//! sent, so TCP on the relay's leg to the tester finds the loss the way it would on a network.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::Mutex;
use std::time::Duration;

use p02_common::clock::wall_us;
use p02_common::rawlog::RawLog;
use serde_json::json;

pub async fn run(cmd: &str, args: &[&str]) -> String {
    match tokio::process::Command::new(cmd).args(args).output().await {
        Ok(o) => {
            let mut s = String::from_utf8_lossy(&o.stdout).into_owned();
            if !o.status.success() {
                s.push_str(&format!(" [exit {:?}] {}", o.status.code(), String::from_utf8_lossy(&o.stderr)));
            }
            s
        }
        Err(e) => format!("[spawn error] {e}"),
    }
}

/// Runs one `tc -batch` so both directions change in one process, and logs the lines with the
/// clock before and after.
async fn tc_batch(log: &RawLog, why: &str, lines: &[String]) {
    use tokio::io::AsyncWriteExt;
    let w0 = wall_us();
    let mut child = match tokio::process::Command::new("tc")
        .args(["-force", "-batch", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            log.rec("tc", json!({"why": why, "err": e.to_string()}));
            return;
        }
    };
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(lines.join("\n").as_bytes()).await;
        let _ = si.write_all(b"\n").await;
    }
    let out = child.wait_with_output().await;
    let w1 = wall_us();
    let err = out.as_ref().map(|o| String::from_utf8_lossy(&o.stderr).into_owned()).unwrap_or_default();
    log.rec("tc", json!({"why": why, "lines": lines, "w0": w0, "w1": w1, "stderr": err}));
}

async fn undrop(a: &str, b: &str) {
    let _ = run("iptables", &["-D", "FORWARD", "-s", a, "-d", b, "-j", "DROP"]).await;
    let _ = run("iptables", &["-D", "FORWARD", "-s", b, "-d", a, "-j", "DROP"]).await;
}

struct Class {
    id: u16,
    // Bumped by every new request, so an older request's timer doesn't undo a newer one.
    epoch: u64,
}

pub struct Shaping {
    wan: String,
    log: RawLog,
    classes: Mutex<HashMap<Ipv4Addr, Class>>,
    fw_epoch: Mutex<HashMap<(Ipv4Addr, Ipv4Addr), u64>>,
}

impl Shaping {
    pub fn new(wan: String, log: RawLog) -> Shaping {
        Shaping { wan, log, classes: Default::default(), fw_epoch: Default::default() }
    }

    /// Builds the two HTB trees, each with a default class that leaves traffic alone.
    pub async fn init(&self) {
        let w = &self.wan;
        let _ = run("modprobe", &["ifb", "numifbs=1"]).await;
        let _ = run("modprobe", &["sch_netem"]).await;
        let _ = run("ip", &["link", "add", "ifb0", "type", "ifb"]).await;
        let _ = run("ip", &["link", "set", "ifb0", "up"]).await;
        let _ = run("tc", &["qdisc", "del", "dev", w, "root"]).await;
        let _ = run("tc", &["qdisc", "del", "dev", w, "ingress"]).await;
        let _ = run("tc", &["qdisc", "del", "dev", "ifb0", "root"]).await;
        let lines = vec![
            format!("qdisc add dev {w} root handle 1: htb default 1"),
            format!("class add dev {w} parent 1: classid 1:1 htb rate 10gbit ceil 10gbit"),
            format!("qdisc add dev {w} handle ffff: ingress"),
            format!("filter add dev {w} parent ffff: protocol all u32 match u32 0 0 action mirred egress redirect dev ifb0"),
            "qdisc add dev ifb0 root handle 1: htb default 1".to_string(),
            "class add dev ifb0 parent 1: classid 1:1 htb rate 10gbit ceil 10gbit".to_string(),
        ];
        tc_batch(&self.log, "init", &lines).await;
        self.log_rules("init").await;
    }

    pub async fn log_rules(&self, why: &str) {
        let w = self.wan.clone();
        let qd = run("tc", &["-s", "qdisc", "show", "dev", &w]).await;
        let qi = run("tc", &["-s", "qdisc", "show", "dev", "ifb0"]).await;
        let fl = run("tc", &["filter", "show", "dev", &w]).await;
        let fi = run("tc", &["filter", "show", "dev", "ifb0"]).await;
        let ipt = run("iptables-save", &[]).await;
        self.log.rec("rules", json!({"why": why, "qdisc_wan": qd, "qdisc_ifb": qi, "filter_wan": fl, "filter_ifb": fi, "iptables": ipt}));
    }

    async fn class_for(&self, ip: Ipv4Addr) -> (u16, u64) {
        let (id, fresh, epoch) = {
            let mut c = self.classes.lock().unwrap();
            let next = 0x10 + c.len() as u16;
            let fresh = !c.contains_key(&ip);
            let e = c.entry(ip).or_insert(Class { id: next, epoch: 0 });
            e.epoch += 1;
            (e.id, fresh, e.epoch)
        };
        if fresh {
            let w = &self.wan;
            let h = format!("{id:x}");
            let lines = vec![
                format!("class add dev {w} parent 1: classid 1:{h} htb rate 10gbit ceil 10gbit"),
                format!("qdisc add dev {w} parent 1:{h} handle {h}: netem loss 0%"),
                format!("filter add dev {w} parent 1: protocol ip prio 1 u32 match ip dst {ip}/32 flowid 1:{h}"),
                format!("class add dev ifb0 parent 1: classid 1:{h} htb rate 10gbit ceil 10gbit"),
                format!("qdisc add dev ifb0 parent 1:{h} handle {h}: netem loss 0%"),
                format!("filter add dev ifb0 parent 1: protocol ip prio 1 u32 match ip src {ip}/32 flowid 1:{h}"),
            ];
            tc_batch(&self.log, &format!("class {ip}"), &lines).await;
        }
        (id, epoch)
    }

    fn current(&self, ip: Ipv4Addr, epoch: u64) -> bool {
        self.classes.lock().unwrap().get(&ip).is_some_and(|c| c.epoch == epoch)
    }

    async fn set_loss(&self, ip: Ipv4Addr, id: u16, pct: f64, why: &str) {
        let w = &self.wan;
        let h = format!("{id:x}");
        let lines = vec![
            format!("qdisc change dev {w} parent 1:{h} handle {h}: netem loss {pct}%"),
            format!("qdisc change dev ifb0 parent 1:{h} handle {h}: netem loss {pct}%"),
        ];
        tc_batch(&self.log, &format!("{why} {ip}"), &lines).await;
    }

    /// `mode` is `clear`, `loss` at `pct`, or `burst`: everything to and from the tester
    /// dropped for `burst_ms` every `every_ms`, give or take a random 2s, so bursts don't fall
    /// in step with the traffic's own timers.
    pub async fn netem(self: &std::sync::Arc<Self>, ip: Ipv4Addr, mode: &str, pct: f64, burst_ms: u64, every_ms: u64, secs: u64, label: &str) {
        let (id, epoch) = self.class_for(ip).await;
        self.log.rec("netem", json!({"ip": ip.to_string(), "mode": mode, "pct": pct, "burst_ms": burst_ms, "every_ms": every_ms, "secs": secs, "label": label}));
        match mode {
            "loss" => self.set_loss(ip, id, pct, &format!("loss {label}")).await,
            "burst" => {
                self.set_loss(ip, id, 0.0, &format!("burst-base {label}")).await;
                let me = self.clone();
                let label = label.to_string();
                tokio::spawn(async move {
                    let end = tokio::time::Instant::now() + Duration::from_secs(secs);
                    loop {
                        let jitter = rand::random::<u64>() % 4000;
                        let wait = Duration::from_millis(every_ms.saturating_sub(2000) + jitter);
                        if tokio::time::Instant::now() + wait >= end {
                            break;
                        }
                        tokio::time::sleep(wait).await;
                        if !me.current(ip, epoch) {
                            return;
                        }
                        me.set_loss(ip, id, 100.0, &format!("burst-on {label}")).await;
                        tokio::time::sleep(Duration::from_millis(burst_ms)).await;
                        me.set_loss(ip, id, 0.0, &format!("burst-off {label}")).await;
                    }
                });
            }
            _ => self.set_loss(ip, id, 0.0, &format!("clear {label}")).await,
        }
        if mode != "clear" {
            let me = self.clone();
            let label = label.to_string();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(secs)).await;
                if me.current(ip, epoch) {
                    me.set_loss(ip, id, 0.0, &format!("expire {label}")).await;
                    me.log_rules("netem-expired").await;
                }
            });
        }
        self.log_rules(&format!("netem {mode} {label}")).await;
    }

    /// Drops all packets between the tester and a namespace's peer, both ways, in the
    /// FORWARD chain the namespace's traffic crosses; the relay, on the host, is untouched.
    pub async fn firewall(self: &std::sync::Arc<Self>, ip: Ipv4Addr, ns_ip: Ipv4Addr, drop: bool, secs: u64, label: &str) {
        let epoch = {
            let mut g = self.fw_epoch.lock().unwrap();
            let e = g.entry((ip, ns_ip)).or_insert(0);
            *e += 1;
            *e
        };
        let (a, b) = (ip.to_string(), ns_ip.to_string());
        let w0 = wall_us();
        // Delete first, so the rules are in at most once.
        undrop(&a, &b).await;
        if drop {
            let r1 = run("iptables", &["-I", "FORWARD", "-s", &a, "-d", &b, "-j", "DROP"]).await;
            let r2 = run("iptables", &["-I", "FORWARD", "-s", &b, "-d", &a, "-j", "DROP"]).await;
            self.log.rec("firewall", json!({"ip": a, "ns_ip": b, "drop": true, "w0": w0, "w1": wall_us(), "out": [r1, r2], "label": label}));
            let me = self.clone();
            let label = label.to_string();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(secs)).await;
                let still = me.fw_epoch.lock().unwrap().get(&(ip, ns_ip)).copied() == Some(epoch);
                if still {
                    let w0 = wall_us();
                    undrop(&a, &b).await;
                    me.log.rec("firewall", json!({"ip": a, "ns_ip": b, "drop": false, "w0": w0, "w1": wall_us(), "label": format!("expire {label}")}));
                }
            });
        } else {
            self.log.rec("firewall", json!({"ip": a, "ns_ip": b, "drop": false, "w0": w0, "w1": wall_us(), "label": label}));
        }
    }

    /// Captures the headers of every packet to and from the tester, on the WAN interface,
    /// where incoming packets show before netem drops them and outgoing ones after, and on
    /// `ifb0`, where incoming ones show after; and samples the kernel's view of each TCP
    /// connection to the tester every second, its round trip, window, and resends.
    pub async fn capture(self: &std::sync::Arc<Self>, ip: Ipv4Addr, secs: u64, label: &str, dir: std::path::PathBuf) {
        let ts = wall_us();
        for dev in [self.wan.as_str(), "ifb0"] {
            let file = dir.join(format!("{ip}-{dev}-{ts}.pcap"));
            let filter = format!("host {ip} and not port 9000");
            let args = vec![
                secs.to_string(),
                "tcpdump".into(),
                "-i".into(),
                dev.to_string(),
                "-s".into(),
                "128".into(),
                "-n".into(),
                "-U".into(),
                "-w".into(),
                file.display().to_string(),
                filter,
            ];
            let child = tokio::process::Command::new("timeout")
                .args(&args)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
            self.log.rec("capture", json!({"ip": ip.to_string(), "dev": dev, "file": file.display().to_string(), "secs": secs, "label": label, "ok": child.is_ok()}));
        }
        let log = self.log.clone();
        let label = label.to_string();
        tokio::spawn(async move {
            let end = tokio::time::Instant::now() + Duration::from_secs(secs);
            let mut iv = tokio::time::interval(Duration::from_secs(1));
            while tokio::time::Instant::now() < end {
                iv.tick().await;
                let out = run("ss", &["-tinH", "dst", &ip.to_string()]).await;
                log.rec("ss", json!({"ip": ip.to_string(), "label": label, "w": wall_us(), "out": out}));
            }
        });
    }
}
