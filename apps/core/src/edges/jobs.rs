//! Running the loop's jobs on tokio's blocking pool, each result coming back as an input.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use kernel::{JOBS, JobId, StartJob, Work};

use crate::home::Home;
use crate::queue::Queue;

/// What every job needs besides itself.
#[derive(Clone)]
pub struct Jobs {
    pub runtime: tokio::runtime::Handle,
    pub queue: Arc<Queue>,
    pub data: Arc<PathBuf>,
    pub home: Arc<Home>,
}

impl Jobs {
    pub fn start(&self, start: StartJob) {
        let jobs = self.clone();
        self.runtime.spawn_blocking(move || {
            let result = run(&jobs, &start);
            jobs.queue
                .push(JOBS, start.id.finished(result), start.recorded);
        });
    }
}

fn run(jobs: &Jobs, start: &StartJob) -> Result<Vec<u8>, String> {
    let bytes = match &start.job.work {
        Work::Read { path } => std::fs::read(resolve(&jobs.data, &jobs.home, path))
            .map_err(|e| format!("couldn't read {path}: {e}"))?,
        Work::Write { path, bytes } => {
            replace(&resolve(&jobs.data, &jobs.home, path), bytes, start.id)
                .map_err(|e| format!("couldn't write {path}: {e}"))?;
            Vec::new()
        }
    };
    match start.job.then {
        Some(then) => then(bytes),
        None => Ok(bytes),
    }
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
    use super::*;

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
