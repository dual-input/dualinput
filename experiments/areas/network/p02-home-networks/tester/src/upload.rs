//! Compressing and uploading the results file, and remembering an upload that failed, so the
//! next launch sends it before anything else.

use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::time::Duration;

use p02_common::config::Deploy;
use serde::{Deserialize, Serialize};

pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("Crosscheck").join("network-test")
}

pub fn gzip(src: &Path) -> std::io::Result<PathBuf> {
    let dst = PathBuf::from(format!("{}.gz", src.display()));
    let mut r = BufReader::new(std::fs::File::open(src)?);
    let w = BufWriter::new(std::fs::File::create(&dst)?);
    let mut gz = flate2::write::GzEncoder::new(w, flate2::Compression::new(6));
    std::io::copy(&mut r, &mut gz)?;
    gz.finish()?;
    Ok(dst)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Pending {
    pub run_id: String,
    pub part: u32,
    pub gz: PathBuf,
}

fn marker(dir: &Path, p: &Pending) -> PathBuf {
    dir.join(format!("{}-part{}.pending.json", p.run_id, p.part))
}

pub fn mark_pending(dir: &Path, p: &Pending) {
    let _ = std::fs::write(marker(dir, p), serde_json::to_vec(p).unwrap_or_default());
}

pub fn clear_pending(dir: &Path, p: &Pending) {
    let _ = std::fs::remove_file(marker(dir, p));
}

pub fn pending(dir: &Path) -> Vec<Pending> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().ends_with(".pending.json") {
                if let Ok(b) = std::fs::read(e.path()) {
                    if let Ok(p) = serde_json::from_slice::<Pending>(&b) {
                        if p.gz.exists() {
                            out.push(p);
                        } else {
                            let _ = std::fs::remove_file(e.path());
                        }
                    }
                }
            }
        }
    }
    out
}

/// Tries the intro station, then each other station, three rounds, 5s, 15s, then 45s apart.
pub async fn send(http: &reqwest::Client, deploy: &Deploy, p: &Pending) -> Result<(), String> {
    let body = tokio::fs::read(&p.gz).await.map_err(|e| e.to_string())?;
    let mut order = vec![deploy.intro().clone()];
    order.extend(deploy.stations.iter().filter(|s| !s.intro).cloned());
    let mut last = String::new();
    for (round, wait) in [5u64, 15, 45].iter().enumerate() {
        for st in &order {
            let url = format!("{}/v1/upload?run_id={}&part={}", st.api_url(), p.run_id, p.part);
            match http.post(&url).timeout(Duration::from_secs(300)).body(body.clone()).send().await {
                Ok(r) if r.status().is_success() => return Ok(()),
                Ok(r) => last = format!("{}: HTTP {}", st.name, r.status().as_u16()),
                Err(e) => last = format!("{}: {e}", st.name),
            }
        }
        if round < 2 {
            tokio::time::sleep(Duration::from_secs(*wait)).await;
        }
    }
    Err(last)
}
