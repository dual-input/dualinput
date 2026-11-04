//! Walking the PC's running processes, which the window's figures need for this app's own, and Quit's ask for whether the sim runs.

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
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

pub fn sim_running(all: &[Running]) -> bool {
    all.iter().any(|one| one.program.eq_ignore_ascii_case(SIM))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program(name: &str) -> Running {
        Running {
            id: 1,
            parent: 0,
            program: name.into(),
        }
    }

    #[test]
    fn the_sim_is_found_whatever_its_case() {
        assert!(sim_running(&[program("flightsimulator2024.EXE")]));
        assert!(!sim_running(&[program("FlightSimulator.exe")]));
    }
}
