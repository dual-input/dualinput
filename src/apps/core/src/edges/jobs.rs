//! Running the loop's jobs, each result coming back as an input: files on tokio's blocking
//! pool, and fetches as tasks on its runtime.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use kernel::{Fetch, Fetched, JOBS, JobId, Method, StartJob, Work};

use crate::home::Home;
use crate::queue::Queue;

/// A fetch with no answer by then is the job's error, so a job never waits on a server that
/// stopped answering. The network keeps its own 10s for the backend's answer.
const FETCH_WITHIN: Duration = Duration::from_secs(30);

/// What every job needs besides itself.
#[derive(Clone)]
pub struct Jobs {
    pub runtime: tokio::runtime::Handle,
    pub queue: Arc<Queue>,
    pub data: Arc<PathBuf>,
    pub home: Arc<Home>,
    pub http: reqwest::Client,
}

/// The client every fetch shares, which keeps its connections to a server open between
/// fetches. It reaches HTTPS through reqwest 0.13 with rustls, which iroh already brings into
/// the core, and checks certificates against Windows' own store
/// (record/areas/core/01-loop-and-edge.md, "Timers, jobs, and IDs"). rustls needs a crypto
/// provider installed before the first client, and the core installs ring's, which iroh
/// already builds; an install that finds one there already changes nothing.
pub fn http() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(FETCH_WITHIN)
        .build()
        .expect("reqwest should build a client once rustls has a crypto provider")
}

impl Jobs {
    pub fn start(&self, start: StartJob) {
        let jobs = self.clone();
        match start.job.work {
            Work::Fetch(ref fetch) => {
                let fetch = fetch.clone();
                self.runtime.spawn(async move {
                    let result = fetch_one(&jobs.http, fetch)
                        .await
                        .and_then(|bytes| then(&start, bytes));
                    jobs.queue.push(JOBS, start.id.finished(result));
                });
            }
            _ => {
                self.runtime.spawn_blocking(move || {
                    let result = run(&jobs, &start).and_then(|bytes| then(&start, bytes));
                    jobs.queue.push(JOBS, start.id.finished(result));
                });
            }
        }
    }
}

fn then(start: &StartJob, bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    match start.job.then {
        Some(then) => then(bytes),
        None => Ok(bytes),
    }
}

fn run(jobs: &Jobs, start: &StartJob) -> Result<Vec<u8>, String> {
    match &start.job.work {
        Work::Read { path } => std::fs::read(resolve(&jobs.data, &jobs.home, path))
            .map_err(|e| format!("couldn't read {path}: {e}")),
        Work::Write { path, bytes } => {
            replace(&resolve(&jobs.data, &jobs.home, path), bytes, start.id)
                .map_err(|e| format!("couldn't write {path}: {e}"))?;
            Ok(Vec::new())
        }
        Work::Fetch(_) => unreachable!("a fetch runs as a task, not on the blocking pool"),
    }
}

async fn fetch_one(http: &reqwest::Client, fetch: Fetch) -> Result<Vec<u8>, String> {
    let method = match fetch.method {
        Method::Get => reqwest::Method::GET,
        Method::Post => reqwest::Method::POST,
    };
    let mut request = http.request(method, &fetch.url).body(fetch.body);
    for (name, value) in &fetch.headers {
        request = request.header(name, value);
    }
    let answer = request
        .send()
        .await
        .map_err(|e| format!("{} got no answer: {e}", fetch.url))?;
    let status = answer.status().as_u16();
    let headers = fetch
        .keep
        .iter()
        .filter_map(|name| {
            let value = answer.headers().get(name)?.to_str().ok()?;
            Some((name.clone(), value.to_string()))
        })
        .collect();
    let body = answer
        .bytes()
        .await
        .map_err(|e| format!("{}'s answer broke off: {e}", fetch.url))?;
    Ok(Fetched {
        status,
        headers,
        body: body.to_vec(),
    }
    .encode())
}

/// The file a job's path names. A path from an input has the home folder's path hidden at
/// its start, which leaves it looking relative, as `~~~~~~~~~~~~~~\AppData\x.flt` does, so
/// the home folder's path goes back first, and only a path still relative after that is in
/// the data folder.
fn resolve(data: &Path, home: &Home, path: &str) -> PathBuf {
    let path = home.reveal(path);
    if path.is_relative() {
        data.join(path)
    } else {
        path
    }
}

/// Writes a file beside `path` and renames it over `path`, so a crash in the middle leaves
/// the old file whole. The rename replaces `path` if it exists. The file beside it is named
/// for the job, as `settings.json.3-12.new`, since the pool runs up to 4 jobs at once, and two
/// writes of one path sharing one file beside it could rename a mix of both into place.
fn replace(path: &Path, bytes: &[u8], id: JobId) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut new = path.as_os_str().to_owned();
    new.push(format!(".{}-{}.new", id.handle().unit(), id.handle().n()));
    std::fs::write(&new, bytes)?;
    std::fs::rename(&new, path)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};

    use super::*;

    /// One answer from a server on 127.0.0.1, which hands back the request it got.
    fn serve(answer: &'static [u8]) -> (u16, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port should bind");
        let port = listener
            .local_addr()
            .expect("a listener has an address")
            .port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("the fetch should connect");
            let mut request = Vec::new();
            let mut buf = [0; 4096];
            while !request.ends_with(b"{}") {
                let n = stream.read(&mut buf).expect("the request should read");
                if n == 0 {
                    break;
                }
                request.extend(&buf[..n]);
            }
            stream.write_all(answer).expect("the answer should write");
            String::from_utf8_lossy(&request).to_lowercase()
        });
        (port, server)
    }

    fn fetch(url: String) -> Result<Vec<u8>, String> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime should build");
        runtime.block_on(fetch_one(
            &http(),
            Fetch {
                method: Method::Post,
                url,
                headers: vec![("x-bench".into(), "1".into())],
                body: b"{}".to_vec(),
                keep: vec!["etag".into()],
            },
        ))
    }

    /// Whatever its status, a fetch's answer is the job's result, with only the headers its
    /// request keeps, so the recording holds only what a unit reads.
    #[test]
    fn a_fetch_hands_up_its_status_the_headers_it_keeps_and_its_body() {
        let (port, server) = serve(
            b"HTTP/1.1 404 Not Found\r\nETag: \"v1\"\r\nX-Other: no\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno",
        );
        let fetched = fetch(format!("http://127.0.0.1:{port}/v1/lookup"))
            .expect("the fetch should get an answer");
        assert_eq!(
            Fetched::decode(&fetched),
            Some(Fetched {
                status: 404,
                headers: vec![("etag".into(), "\"v1\"".into())],
                body: b"no".to_vec(),
            })
        );
        let request = server.join().expect("the server should end");
        assert!(request.starts_with("post /v1/lookup"), "{request}");
        assert!(request.contains("x-bench: 1"), "{request}");
    }

    #[test]
    fn a_fetch_that_gets_no_answer_is_the_jobs_error() {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .expect("a port should bind")
            .port();
        let error =
            fetch(format!("http://127.0.0.1:{port}/v1/lookup")).expect_err("nothing listens there");
        assert!(error.contains("got no answer"), "{error}");
    }

    #[test]
    fn a_path_whose_home_folder_was_hidden_gets_it_back() {
        let home = Home::new(r"C:\Users\Pilot");
        let data = Path::new(r"C:\Users\Pilot\AppData\Roaming\DualInput");
        assert_eq!(
            resolve(data, &home, r"~~~~~~~~~~~~~~\AppData\Roaming\x.flt"),
            PathBuf::from(r"C:\Users\Pilot\AppData\Roaming\x.flt")
        );
        assert_eq!(
            resolve(data, &home, "settings.json"),
            data.join("settings.json")
        );
        assert_eq!(
            resolve(data, &home, r"D:\x.flt"),
            PathBuf::from(r"D:\x.flt")
        );
    }
}
