//! The PC's processes: walking them, which the window's figures need for this app's own and the jobs need to find the sim,
//! and holding one to wait for its exit, as the app does with the sim and the core.

use std::path::PathBuf;

use windows_sys::Win32::Foundation::{
    CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::ProcessStatus::EnumProcesses;
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessTimes, INFINITE, OpenProcess, PROCESS_NAME_FORMAT,
    PROCESS_NAME_NATIVE, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE, QueryFullProcessImageNameW, WaitForSingleObject,
};

/// The sim's program. `SIM` in src/engines/sim-edge/src/lib.rs names the same one, so change both together.
const SIM: &str = "FlightSimulator2024.exe";

/// A process as the snapshot lists it.
pub struct Running {
    pub id: u32,
    pub parent: u32,
    pub program: String,
}

/// A handle closed when this goes.
pub struct Object(pub HANDLE);

// SAFETY: a process handle may be waited on and closed from any thread.
unsafe impl Send for Object {}

impl Drop for Object {
    fn drop(&mut self) {
        // SAFETY: the handle came from the call that opened it, and nothing else closes it.
        unsafe { CloseHandle(self.0) };
    }
}

/// Every running process, which took 2.8ms at 291 processes (measured on our development machine, 2026-10-18,
/// record/areas/install/results/2026-10-18-windows-and-msfs-facts.txt).
pub fn running() -> Vec<Running> {
    let mut all = Vec::new();
    // SAFETY: a snapshot of every process takes no pointer.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return all;
    }
    let snapshot = Object(snapshot);
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    // SAFETY: the snapshot stays open through the walk, and `entry` names its own size, as both calls require.
    let mut listed = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while listed {
        let file = &entry.szExeFile;
        let end = file.iter().position(|&c| c == 0).unwrap_or(file.len());
        all.push(Running {
            id: entry.th32ProcessID,
            parent: entry.th32ParentProcessID,
            program: String::from_utf16_lossy(&file[..end]),
        });
        // SAFETY: as above.
        listed = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    all
}

/// The sim's process, if one runs, matched by its program's name without regard to case, as the core's edge matches it.
///
/// The jobs walk for it every `WALK_EVERY` in jobs.rs, which has to fit the app's 0.2% of one CPU core.
/// `NtQuerySystemInformation`'s process list names each process, and holds a record for each of its threads too, so it costs
/// more with every thread the PC runs: a walk took 4.0ms of CPU at 348 processes and 7,146 threads, which at one walk every
/// `WALK_EVERY` took the whole 0.2%, and Toolhelp's snapshot cost more. So the walk takes the process IDs alone, from
/// `EnumProcesses`, and opens each process for its program's name (measured on our development machine,
/// record/areas/install/log.md, 2026-11-16).
pub fn sim_id() -> Option<u32> {
    find_named(SIM)
}

fn find_named(program: &str) -> Option<u32> {
    let wanted: Vec<u16> = program.encode_utf16().collect();
    ids().into_iter().find(|&id| runs(id, &wanted))
}

/// Every running process's ID. `EnumProcesses` fills what fits and says how many bytes it wrote, so a full list may have left
/// some out, and the walk asks again with room for twice as many.
fn ids() -> Vec<u32> {
    let mut room = 1024;
    loop {
        let mut ids = vec![0u32; room];
        let size = u32::try_from(room * 4).unwrap_or(u32::MAX);
        let mut written = 0;
        // SAFETY: the list is `size` bytes long, and the call writes at most that many.
        if unsafe { EnumProcesses(ids.as_mut_ptr(), size, &mut written) } == 0 {
            return Vec::new();
        }
        let listed = written as usize / 4;
        if listed < room {
            ids.truncate(listed);
            return ids;
        }
        room *= 2;
    }
}

/// Whether the process `id` runs the program named `wanted`, matched by its image's file name without regard to case. A
/// process this user can't open, such as a service's or another account's, gives no name. `Held::open` and the core's edge
/// open the sim with this right too, so a sim this walk can't name is one neither could hold.
fn runs(id: u32, wanted: &[u16]) -> bool {
    // SAFETY: OpenProcess takes access rights, an inherit flag, and an ID.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id) };
    if handle.is_null() {
        return false;
    }
    let handle = Object(handle);
    let mut path = [0u16; 1024];
    // The native form skips turning the device path into a drive letter, which the name doesn't need.
    image_path(handle.0, PROCESS_NAME_NATIVE, &mut path).is_some_and(|path| {
        path.rsplit(|&unit| unit == u16::from(b'\\'))
            .next()
            .is_some_and(|file| same_name(file, wanted))
    })
}

/// The path of the program the process `handle` runs, in `form`, written into `path`. A path longer than `path` gives none.
fn image_path(handle: HANDLE, form: PROCESS_NAME_FORMAT, path: &mut [u16]) -> Option<&[u16]> {
    let mut length = u32::try_from(path.len()).unwrap_or(u32::MAX);
    // SAFETY: the caller keeps the handle open through the call, and `length` is no more than the buffer's length, which the
    // call writes back.
    let read = unsafe { QueryFullProcessImageNameW(handle, form, path.as_mut_ptr(), &mut length) };
    (read != 0).then(|| &path[..length as usize])
}

/// Whether two names in UTF-16 are equal without regard to the case of their ASCII letters.
fn same_name(a: &[u16], b: &[u16]) -> bool {
    let lower = |c: u16| {
        if (u16::from(b'A')..=u16::from(b'Z')).contains(&c) {
            c + 32
        } else {
            c
        }
    };
    a.len() == b.len() && a.iter().zip(b).all(|(&x, &y)| lower(x) == lower(y))
}

/// Whether the sim runs, from one walk.
pub fn sim_runs() -> bool {
    sim_id().is_some()
}

/// A process held open, so its ID can't pass to another while the app waits on it.
pub struct Held {
    handle: Object,
    pub id: u32,
    /// Its creation time, the `FILETIME` `GetProcessTimes` gives, in 100ns since 1601, which with the ID tells it from a
    /// later process given the same ID.
    pub created: u64,
}

impl Held {
    /// Opens the process `id` to wait on, which a program with no administrator could do to another of the pilot's
    /// processes (measured on our development machine, 2026-10-18, record/areas/install/results/
    /// 2026-10-18-windows-and-msfs-facts.txt).
    pub fn open(id: u32) -> Option<Self> {
        // SAFETY: OpenProcess takes access rights, an inherit flag, and an ID.
        let handle = unsafe {
            OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                id,
            )
        };
        if handle.is_null() {
            return None;
        }
        let handle = Object(handle);
        let created = created(handle.0)?;
        Some(Self {
            handle,
            id,
            created,
        })
    }

    /// Takes a process this app started, whose handle the spawn gave.
    pub fn adopt(handle: HANDLE, id: u32) -> Option<Self> {
        let handle = Object(handle);
        let created = created(handle.0)?;
        Some(Self {
            handle,
            id,
            created,
        })
    }

    /// The program the process runs, by its whole path.
    pub fn program(&self) -> Option<PathBuf> {
        let mut path = [0u16; 1024];
        image_path(self.handle.0, PROCESS_NAME_WIN32, &mut path)
            .map(|path| PathBuf::from(String::from_utf16_lossy(path)))
    }

    /// Waits until the process exits, and gives its exit code. It blocks the thread, so it runs on one of its own.
    pub fn wait(self) -> Option<u32> {
        // SAFETY: the handle stays open through the wait.
        if unsafe { WaitForSingleObject(self.handle.0, INFINITE) } != WAIT_OBJECT_0 {
            return None;
        }
        let mut code = 0;
        // SAFETY: as above, and the call writes the code it's given.
        (unsafe { GetExitCodeProcess(self.handle.0, &mut code) } != 0).then_some(code)
    }
}

/// A process's creation time, as `Held` keeps it.
fn created(handle: HANDLE) -> Option<u64> {
    let mut times = [FILETIME::default(); 4];
    let [created, exited, kernel, user] = &mut times;
    // SAFETY: the handle stays open through the call, which writes the four times.
    if unsafe { GetProcessTimes(handle, created, exited, kernel, user) } == 0 {
        return None;
    }
    Some(u64::from(times[0].dwHighDateTime) << 32 | u64::from(times[0].dwLowDateTime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sim_is_found_whatever_its_case() {
        let wide = |text: &str| text.encode_utf16().collect::<Vec<_>>();
        assert!(same_name(&wide("flightsimulator2024.EXE"), &wide(SIM)));
        assert!(!same_name(&wide("FlightSimulator.exe"), &wide(SIM)));
    }

    #[test]
    fn a_walk_finds_a_process_by_its_program() {
        let me = std::env::current_exe().expect("the test should know its program");
        let name = me
            .file_name()
            .expect("a program has a name")
            .to_string_lossy()
            .to_uppercase();
        assert_eq!(find_named(&name), Some(std::process::id()));
    }

    #[test]
    fn a_held_process_gives_its_exit_code() {
        let child = std::process::Command::new("cmd")
            .args(["/c", "exit 7"])
            .spawn()
            .expect("cmd should start");
        let held = Held::open(child.id()).expect("the child should open");
        assert!(held.created > 0);
        assert!(
            held.program()
                .is_some_and(|path| path.to_string_lossy().to_lowercase().ends_with("cmd.exe"))
        );
        assert_eq!(held.wait(), Some(7));
        let mut child = child;
        assert!(child.wait().is_ok_and(|status| status.code() == Some(7)));
    }
}
