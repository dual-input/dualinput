//! Finding the sim's process among the running ones, and reading its creation time and its
//! exit code (record/areas/core/03-sim-seam-and-wasm-module.md, "The sim's process").

use windows_sys::Win32::Foundation::{FILETIME, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE,
};

use crate::Object;

/// A running process, with a handle the edge waits on until it ends.
pub(crate) struct Process {
    pub(crate) id: u32,
    pub(crate) handle: Object,
    /// When it started, as a `FILETIME`, in 100ns since 1601.
    pub(crate) created: u64,
}

/// The first running process whose program is named `program`, ignoring case, that the
/// edge can open.
pub(crate) fn find(program: &str) -> Option<Process> {
    // SAFETY: a snapshot of every process takes no pointer.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let snapshot = Object(snapshot);
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    // SAFETY: the snapshot stays open through the walk, and `entry` names its own size, as
    // Process32FirstW and Process32NextW require.
    let mut listed = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while listed {
        if program_of(&entry).eq_ignore_ascii_case(program)
            && let Some(process) = open(entry.th32ProcessID)
        {
            return Some(process);
        }
        // SAFETY: as above.
        listed = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    None
}

/// The process's exit code, once it has ended.
pub(crate) fn exit_code(process: &Object) -> u32 {
    let mut code = 0;
    // SAFETY: the handle stays open through the call, which writes the code.
    unsafe { GetExitCodeProcess(process.0, &mut code) };
    code
}

fn program_of(entry: &PROCESSENTRY32W) -> String {
    let file = &entry.szExeFile;
    let end = file.iter().position(|&c| c == 0).unwrap_or(file.len());
    String::from_utf16_lossy(&file[..end])
}

fn open(id: u32) -> Option<Process> {
    // SAFETY: OpenProcess takes access rights, an inherit flag, and an ID.
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            id,
        )
    };
    if handle.is_null() {
        return None;
    }
    let handle = Object(handle);
    let mut times = [FILETIME::default(); 4];
    let [created, exited, kernel, user] = &mut times;
    // SAFETY: the handle stays open through the call, which writes the four times.
    if unsafe { GetProcessTimes(handle.0, created, exited, kernel, user) } == 0 {
        return None;
    }
    let created = u64::from(times[0].dwHighDateTime) << 32 | u64::from(times[0].dwLowDateTime);
    Some(Process {
        id,
        handle,
        created,
    })
}
