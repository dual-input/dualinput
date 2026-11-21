//! Running the loop's jobs, each result coming back as an input: files on tokio's blocking
//! pool, and fetches as tasks on its runtime.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use kernel::{Entry, Fetch, Fetched, Gathered, JOBS, JobId, Method, StartJob, Work};

use crate::queue::Queue;

/// A fetch with no answer by then is the job's error, so a job never waits on a server that
/// stopped answering. The network keeps a shorter limit of its own for the backend's answer,
/// `ANSWER_WITHIN` in src/platform/network/src/backend.rs.
const FETCH_WITHIN: Duration = Duration::from_secs(30);

/// A gather whose `follow` still names new files after this many rounds of reads is the
/// job's error, so a follow that names files without end can't hold a thread of the pool.
const GATHER_ROUNDS: usize = 32;

/// What every job needs besides itself.
#[derive(Clone)]
pub struct Jobs {
    pub runtime: tokio::runtime::Handle,
    pub queue: Arc<Queue>,
    pub data: Arc<PathBuf>,
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
        Work::Read { path } => std::fs::read(resolve(&jobs.data, path))
            .map_err(|e| format!("couldn't read {path}: {e}")),
        Work::Write { path, bytes } => {
            replace(&resolve(&jobs.data, path), bytes, start.id)
                .map_err(|e| format!("couldn't write {path}: {e}"))?;
            Ok(Vec::new())
        }
        Work::List { path } => list(&resolve(&jobs.data, path))
            .map(|entries| Entry::encode(&entries))
            .map_err(|e| format!("couldn't list {path}: {e}")),
        Work::Delete { path } => {
            let target = resolve(&jobs.data, path);
            let deleted = if target.is_dir() {
                std::fs::remove_dir_all(&target)
            } else {
                std::fs::remove_file(&target)
            };
            deleted.map_err(|e| format!("couldn't delete {path}: {e}"))?;
            Ok(Vec::new())
        }
        Work::Find { roots, holding } => {
            let mut found = Vec::new();
            for (root, depth) in roots {
                find(
                    &resolve(&jobs.data, root),
                    *depth,
                    Path::new(holding),
                    &mut found,
                );
            }
            Ok(found.join("\n").into_bytes())
        }
        Work::InviteCode => {
            let text = clipboard::text().unwrap_or_default();
            Ok(messages::backend::invite_code(&text)
                .unwrap_or_default()
                .into_bytes())
        }
        Work::CopyText { text } => clipboard::set_text(text).map(|()| Vec::new()),
        Work::Username => Ok(std::env::var("USERNAME").unwrap_or_default().into_bytes()),
        // Explorer hands the folder to its running copy and exits, with an exit code that says
        // nothing, so only whether it started counts.
        Work::OpenFolder { path } => std::process::Command::new("explorer")
            .arg(resolve(&jobs.data, path))
            .spawn()
            .map(|_| Vec::new())
            .map_err(|e| format!("couldn't start Explorer on {path}: {e}")),
        // Explorer hands a link to the program Windows has for it, the same way. A scheme with no
        // program brings up Windows' dialog asking for one, over the sim, so the app's link goes
        // only where its program is on this PC.
        Work::OpenLink { url, app_url } => {
            let link = if link_program::installed(app_url) {
                app_url
            } else {
                url
            };
            std::process::Command::new("explorer")
                .arg(link)
                .spawn()
                .map(|_| Vec::new())
                .map_err(|e| format!("couldn't start Explorer on {link}: {e}"))
        }
        Work::Fetch(_) => unreachable!("a fetch runs as a task, not on the blocking pool"),
        Work::Gather { context } => {
            let follow = start.job.follow.ok_or("a gather came with no follow")?;
            gather(context, follow, |path| {
                std::fs::read(resolve(&jobs.data, path)).ok()
            })
        }
    }
}

/// Reads what `follow` names, round after round, through `read`, until it names nothing new.
fn gather(
    context: &[u8],
    follow: kernel::Follow,
    read: impl Fn(&str) -> Option<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let mut files: Vec<(String, Option<Vec<u8>>)> = Vec::new();
    for _ in 0..GATHER_ROUNDS {
        let new: Vec<String> = follow(context, &files)
            .into_iter()
            .filter(|path| !files.iter().any(|(read, _)| read == path))
            .collect();
        if new.is_empty() {
            return Ok(Gathered {
                context: context.to_vec(),
                files,
            }
            .encode());
        }
        for path in new {
            let bytes = read(&path);
            files.push((path, bytes));
        }
    }
    Err(format!(
        "a gather still named new files after {GATHER_ROUNDS} rounds of reads"
    ))
}

/// Each folder `depth` levels under `folder` that holds `holding`, by its path. A folder that
/// can't be listed, such as a Community entry whose junction's target is gone, holds none.
fn find(folder: &Path, depth: u8, holding: &Path, found: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if depth <= 1 {
            if path.join(holding).exists() {
                found.push(path.display().to_string());
            }
        } else {
            find(&path, depth - 1, holding, found);
        }
    }
}

/// Which program Windows runs for a link's scheme. The entry can outlive an uninstalled program,
/// so it counts only while the file it names is there.
mod link_program {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{HKEY_CLASSES_ROOT, RRF_RT_REG_SZ, RegGetValueW};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// The command Windows has for `scheme`, which it keeps in the registry under the scheme's name.
    fn command(scheme: &str) -> Option<String> {
        let key = wide(&format!(r"{scheme}\shell\open\command"));
        let mut text = [0u16; 1024];
        let mut bytes = u32::try_from(size_of_val(&text)).ok()?;
        // SAFETY: the key is a NUL-terminated string that outlives the call, a null value name
        // asks for the key's default value, and `bytes` is the length of the buffer it writes to.
        let read = unsafe {
            RegGetValueW(
                HKEY_CLASSES_ROOT,
                key.as_ptr(),
                std::ptr::null(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                text.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        if read != ERROR_SUCCESS {
            return None;
        }
        let end = text
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(text.len());
        Some(String::from_utf16_lossy(&text[..end]))
    }

    /// The program a command runs, which is quoted when its path holds a space, as in
    /// `"C:\Program Files\App\app.exe" --url -- "%1"`.
    pub(super) fn program_of(command: &str) -> Option<&str> {
        let command = command.trim_start();
        match command.strip_prefix('"') {
            Some(quoted) => quoted.split('"').next(),
            None => command.split_whitespace().next(),
        }
    }

    /// Whether the program for `url`'s scheme is on this PC.
    pub(super) fn installed(url: &str) -> bool {
        url.split(':')
            .next()
            .and_then(command)
            .as_deref()
            .and_then(program_of)
            .is_some_and(|program| std::path::Path::new(program).is_file())
    }
}

/// The clipboard's text, read and written through Windows' clipboard functions.
mod clipboard {
    use std::time::Duration;

    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
    };
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

    /// Replaces the clipboard's contents with `text`. Only one program holds the clipboard at a
    /// time, and a clipboard manager may be reading what the last program put there, so a pilot's
    /// Copy tries for a moment before it fails.
    pub(super) fn set_text(text: &str) -> Result<(), String> {
        let mut opened = false;
        for _ in 0..5 {
            // SAFETY: a null owner opens the clipboard for this thread, and it's closed below.
            opened = unsafe { OpenClipboard(std::ptr::null_mut()) } != 0;
            if opened {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !opened {
            return Err(format!(
                "another program holds the clipboard: {}",
                std::io::Error::last_os_error()
            ));
        }
        let set = write(text);
        // SAFETY: the clipboard is open on this thread.
        unsafe { CloseClipboard() };
        set
    }

    fn write(text: &str) -> Result<(), String> {
        let units: Vec<u16> = text.encode_utf16().chain([0]).collect();
        let failed = |what: &str| format!("{what}: {}", std::io::Error::last_os_error());
        // SAFETY: the clipboard is open on this thread, which `EmptyClipboard` needs.
        if unsafe { EmptyClipboard() } == 0 {
            return Err(failed("the clipboard couldn't be emptied"));
        }
        // SAFETY: a moveable block of this size, which the clipboard owns once it's set.
        let block = unsafe { GlobalAlloc(GMEM_MOVEABLE, units.len() * 2) };
        if block.is_null() {
            return Err(failed("no memory for the clipboard's text"));
        }
        // SAFETY: `block` is a moveable block, locked here and unlocked below.
        let data = unsafe { GlobalLock(block) } as *mut u16;
        if data.is_null() {
            let error = failed("the clipboard's text couldn't be locked");
            // SAFETY: the clipboard doesn't own the block yet.
            unsafe { GlobalFree(block) };
            return Err(error);
        }
        // SAFETY: the locked block holds `units.len()` UTF-16 units, and no other memory
        // overlaps a block just allocated.
        unsafe { std::ptr::copy_nonoverlapping(units.as_ptr(), data, units.len()) };
        // SAFETY: the block was locked above.
        unsafe { GlobalUnlock(block) };
        // SAFETY: the clipboard is open and empty, and the block holds UTF-16 ending at a 0.
        if unsafe { SetClipboardData(u32::from(CF_UNICODETEXT), block) }.is_null() {
            let error = failed("the clipboard refused the text");
            // SAFETY: a refused block stays this program's.
            unsafe { GlobalFree(block) };
            return Err(error);
        }
        Ok(())
    }

    pub(super) fn text() -> Option<String> {
        // SAFETY: a null owner opens the clipboard for this thread, and every path below
        // closes it again.
        if unsafe { OpenClipboard(std::ptr::null_mut()) } == 0 {
            return None;
        }
        let text = read();
        // SAFETY: the clipboard is open on this thread.
        unsafe { CloseClipboard() };
        text
    }

    fn read() -> Option<String> {
        // SAFETY: the clipboard is open, and the handle stays the clipboard's while it is.
        let handle = unsafe { GetClipboardData(u32::from(CF_UNICODETEXT)) };
        if handle.is_null() {
            return None;
        }
        // SAFETY: CF_UNICODETEXT's handle is global memory, locked here and unlocked below.
        let data = unsafe { GlobalLock(handle) } as *const u16;
        if data.is_null() {
            return None;
        }
        // SAFETY: the locked block holds GlobalSize's bytes, of UTF-16 text ending at a 0.
        let units = unsafe { GlobalSize(handle) } / 2;
        let slice = unsafe { std::slice::from_raw_parts(data, units) };
        let end = slice.iter().position(|&u| u == 0).unwrap_or(units);
        let text = String::from_utf16_lossy(&slice[..end]);
        // SAFETY: the block was locked above.
        unsafe { GlobalUnlock(handle) };
        Some(text)
    }
}

/// `folder`'s entries by name, each with its size, a folder's being the total of every file
/// inside it, and when it last changed.
fn list(folder: &Path) -> std::io::Result<Vec<Entry>> {
    let read = match std::fs::read_dir(folder) {
        Ok(read) => read,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut entries = read
        .map(|entry| {
            let entry = entry?;
            Ok(Entry {
                name: entry.file_name().to_string_lossy().into_owned(),
                size: size(&entry.path()),
                modified: modified(&entry.path()),
            })
        })
        .collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// When a file or folder last changed, in ms since the Unix epoch, or 0 when Windows can't say.
fn modified(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

/// A file's size, or a folder's total. One entry it can't read, such as a junction whose target is
/// gone, counts as nothing, so it can't blank a whole listing.
fn size(path: &Path) -> u64 {
    let Ok(metadata) = std::fs::metadata(path) else {
        return 0;
    };
    if !metadata.is_dir() {
        return metadata.len();
    }
    std::fs::read_dir(path).map_or(0, |entries| {
        entries.flatten().map(|entry| size(&entry.path())).sum()
    })
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

/// The file a job's path names: a relative path is in the data folder, and `%APPDATA%` or
/// `%LOCALAPPDATA%` at its start is the pilot's folder of that name.
fn resolve(data: &Path, path: &str) -> PathBuf {
    for var in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(rest) = path.strip_prefix(&format!("%{var}%"))
            && let Some(folder) = std::env::var_os(var)
        {
            return PathBuf::from(folder).join(rest.trim_start_matches(['\\', '/']));
        }
    }
    data.join(path)
}

/// Writes a file beside `path` and renames it over `path`, so a crash in the middle leaves
/// the old file whole. The rename replaces `path` if it exists. The file beside it is named
/// for the job, as `settings.json.3-12.new`, since the pool runs several jobs at once, and two
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

    #[test]
    fn a_links_program_is_read_from_its_command_quoted_or_not() {
        let quoted = r#""C:\Program Files\App\app.exe" --url -- "%1""#;
        assert_eq!(
            link_program::program_of(quoted),
            Some(r"C:\Program Files\App\app.exe")
        );
        assert_eq!(
            link_program::program_of(r"C:\App\app.exe %1"),
            Some(r"C:\App\app.exe")
        );
        assert_eq!(link_program::program_of(""), None);
    }

    #[test]
    fn a_scheme_windows_has_no_program_for_counts_as_not_installed() {
        assert!(!link_program::installed("dualinput-no-such-scheme:///x"));
    }

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

    /// It takes over the PC's clipboard for a moment, and puts back only text, so it runs by
    /// hand: cargo test -p dualinput-core -- --ignored text_written_to_the_clipboard
    #[test]
    #[ignore = "writes the PC's clipboard"]
    fn text_written_to_the_clipboard_reads_back() {
        let before = clipboard::text();
        clipboard::set_text("KX7P3M").expect("the clipboard should take the text");
        let read = clipboard::text();
        if let Some(before) = before {
            clipboard::set_text(&before).expect("the clipboard should take its text back");
        }
        assert_eq!(read.as_deref(), Some("KX7P3M"));
    }

    /// Names `a`, then whatever each file read names, one name to a file.
    fn chain(_: &[u8], read: &[(String, Option<Vec<u8>>)]) -> Vec<String> {
        let mut wanted = vec!["a".to_string()];
        for (_, bytes) in read {
            if let Some(next) = bytes.as_ref().filter(|b| !b.is_empty()) {
                wanted.push(String::from_utf8_lossy(next).into_owned());
            }
        }
        wanted
    }

    #[test]
    fn a_gather_reads_each_file_named_until_none_is_new_and_marks_a_missing_one() {
        let files = |path: &str| match path {
            "a" => Some(b"b".to_vec()),
            "b" => Some(b"c".to_vec()),
            "c" => None,
            _ => Some(Vec::new()),
        };
        let gathered = Gathered::decode(&gather(b"ctx", chain, files).unwrap()).unwrap();
        assert_eq!(gathered.context, b"ctx");
        assert_eq!(
            gathered.files,
            [
                ("a".to_string(), Some(b"b".to_vec())),
                ("b".to_string(), Some(b"c".to_vec())),
                ("c".to_string(), None),
            ]
        );
        let error = gather(b"", |_, read| vec![format!("{}", read.len())], |_| None).unwrap_err();
        assert!(error.contains("32 rounds"), "{error}");
    }

    #[test]
    fn a_relative_path_is_in_the_data_folder() {
        let data = Path::new(r"C:\Users\Pilot\AppData\Roaming\DualInput");
        assert_eq!(resolve(data, "settings.json"), data.join("settings.json"));
        assert_eq!(resolve(data, r"D:\x.flt"), PathBuf::from(r"D:\x.flt"));
    }
}
