//! The PC's processes: walking them, which the window's figures need for this app's own and the jobs need to find the sim,
//! and holding one to wait for its exit, as the app does with the sim and the core.

use std::path::PathBuf;

use windows_sys::Wdk::System::SystemInformation::{
    NtQuerySystemInformation, SystemProcessInformation,
};
use windows_sys::Win32::Foundation::{
    CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE, STATUS_INFO_LENGTH_MISMATCH, WAIT_OBJECT_0,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessTimes, INFINITE, OpenProcess, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, QueryFullProcessImageNameW,
    WaitForSingleObject,
};
use windows_sys::Win32::System::WindowsProgramming::SYSTEM_PROCESS_INFORMATION;

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

/// The walk for the sim's process every 2s, which asks Windows for the process list itself. Toolhelp's snapshot copies the
/// list into a section and out again, which took 2.7ms of CPU a walk at 288 processes, where this took 1.0ms, and the app's
/// 0.2% of one CPU core couldn't hold 30 of Toolhelp's walks a minute beside its other work (measured on our development
/// machine, 2026-11-10, record/areas/install/log.md).
///
/// The list runs to hundreds of KB, which the walk frees after each read rather than keeping, since a kept buffer held about
/// 1 MB of the app's 5 MB all day; it remembers only how large the list had to be.
#[derive(Default)]
pub struct SimWalk {
    /// The size in bytes the largest list needed.
    needed: usize,
}

impl SimWalk {
    /// The sim's process, if one runs, matched by its program's name without regard to case, as the core's edge matches it.
    pub fn find(&mut self) -> Option<u32> {
        self.find_named(SIM)
    }

    fn find_named(&mut self, program: &str) -> Option<u32> {
        for _ in 0..3 {
            // Processes can start between one answer and the next call, so it asks for room to spare, in `u64`s, so each
            // record is aligned as Windows writes it.
            let mut buffer = vec![0u64; (self.needed + 64 * 1024) / 8];
            let length = u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX);
            let mut needed = 0;
            // SAFETY: the buffer is `length` bytes long, and the call writes at most that many.
            let status = unsafe {
                NtQuerySystemInformation(
                    SystemProcessInformation,
                    buffer.as_mut_ptr().cast(),
                    length,
                    &mut needed,
                )
            };
            self.needed = self.needed.max(needed as usize);
            if status == STATUS_INFO_LENGTH_MISMATCH {
                continue;
            }
            return if status >= 0 {
                read(&buffer, program)
            } else {
                None
            };
        }
        None
    }
}

/// The process whose program is `program`, in a list Windows wrote into `buffer`.
fn read(buffer: &[u64], program: &str) -> Option<u32> {
    let wanted: Vec<u16> = program.encode_utf16().collect();
    let mut at = 0usize;
    loop {
        // SAFETY: Windows wrote a chain of records into the buffer, each at the offset the one before gives, and the first
        // at its start; each name points into the same buffer.
        let record = unsafe {
            &*(buffer.as_ptr().cast::<u8>().add(at)).cast::<SYSTEM_PROCESS_INFORMATION>()
        };
        let name = record.ImageName;
        if !name.Buffer.is_null() {
            // SAFETY: as above, `Length` is the name's length in bytes.
            let name =
                unsafe { std::slice::from_raw_parts(name.Buffer, usize::from(name.Length) / 2) };
            if same_name(name, &wanted) {
                return u32::try_from(record.UniqueProcessId as usize).ok();
            }
        }
        if record.NextEntryOffset == 0 {
            return None;
        }
        at += record.NextEntryOffset as usize;
    }
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
    SimWalk::default().find().is_some()
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
        let mut length = path.len() as u32;
        // SAFETY: the handle stays open through the call, and `length` is the buffer's length, which the call writes back.
        let read = unsafe {
            QueryFullProcessImageNameW(
                self.handle.0,
                PROCESS_NAME_WIN32,
                path.as_mut_ptr(),
                &mut length,
            )
        };
        (read != 0).then(|| PathBuf::from(String::from_utf16_lossy(&path[..length as usize])))
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
        assert_eq!(
            SimWalk::default().find_named(&name),
            Some(std::process::id())
        );
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
