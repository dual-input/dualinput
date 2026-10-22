//! Programs: finding the one a capture names, watching it, its level in the Windows mixer,
//! and the programs that own an audio session, which the desktop app offers as the ATC app
//! (record/areas/core/04-core-helper.md, "Capturing a program").

use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_TIMEOUT};
use windows::Win32::Media::Audio::{
    IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
    MMDeviceEnumerator, eConsole, eRender,
};
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    WaitForSingleObject,
};
use windows::core::Interface;

/// A running process by its ID and its program's name, the file's without `.exe`.
pub struct Found {
    pub process: u32,
    pub name: String,
}

/// Every running process, by its ID and its program's name.
fn processes() -> Vec<(u32, String)> {
    let mut found = Vec::new();
    // SAFETY: a snapshot of the processes, closed below.
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return found;
    };
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    // SAFETY: `entry` has its size set, as the walk asks.
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
    while more {
        let length = entry
            .szExeFile
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(entry.szExeFile.len());
        let file = String::from_utf16_lossy(&entry.szExeFile[..length]);
        let name = match file.len().checked_sub(4) {
            Some(cut) if file[cut..].eq_ignore_ascii_case(".exe") => file[..cut].to_string(),
            _ => file,
        };
        found.push((entry.th32ProcessID, name));
        // SAFETY: as above.
        more = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
    }
    // SAFETY: the snapshot came from CreateToolhelp32Snapshot above.
    let _ = unsafe { CloseHandle(snapshot) };
    found
}

/// When a process started, which orders a program's processes oldest first.
fn started(process: u32) -> Option<u64> {
    // SAFETY: a handle that reads the process's times, closed below.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process) }.ok()?;
    let (mut created, mut exited, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    // SAFETY: GetProcessTimes writes the four FILETIMEs it's given.
    let read =
        unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) };
    // SAFETY: the handle came from OpenProcess above.
    let _ = unsafe { CloseHandle(handle) };
    read.ok()?;
    Some((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
}

/// The first program of `names` that's running, by its oldest process, since a program's
/// later processes are its children, which a capture of the process tree takes with it.
pub fn find_first(names: &[String]) -> Option<Found> {
    let running = processes();
    names.iter().find_map(|wanted| {
        running
            .iter()
            .filter(|(_, name)| name.eq_ignore_ascii_case(wanted))
            .filter_map(|(process, name)| Some((started(*process)?, *process, name)))
            .min()
            .map(|(_, process, name)| Found {
                process,
                name: name.clone(),
            })
    })
}

/// A handle on a process that tells when it has exited.
pub struct Watched(HANDLE);

impl Watched {
    pub fn open(process: u32) -> Option<Watched> {
        // SAFETY: a handle that waits on the process, closed on drop.
        unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, process) }
            .ok()
            .map(Watched)
    }

    pub fn running(&self) -> bool {
        // SAFETY: the handle is open until drop.
        unsafe { WaitForSingleObject(self.0, 0) == WAIT_TIMEOUT }
    }
}

impl Drop for Watched {
    fn drop(&mut self) {
        // SAFETY: the handle came from OpenProcess.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

/// Each audio session on the default output device, with the process that owns it. COM must
/// be set up on the calling thread.
fn sessions() -> Vec<(u32, ISimpleAudioVolume)> {
    let walk = || -> windows::core::Result<Vec<(u32, ISimpleAudioVolume)>> {
        // SAFETY: COM calls on interfaces Windows gave us, each released when dropped.
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let sessions = manager.GetSessionEnumerator()?;
            let mut found = Vec::new();
            for i in 0..sessions.GetCount()? {
                let control = sessions.GetSession(i)?;
                let process = control
                    .cast::<IAudioSessionControl2>()?
                    .GetProcessId()
                    .unwrap_or(0);
                if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                    found.push((process, volume));
                }
            }
            Ok(found)
        }
    };
    walk().unwrap_or_default()
}

/// A process's level in the Windows mixer, from 0 to 1, which Windows applies before the
/// capture. It keeps the session's volume once found, since walking the sessions makes a
/// device and its session manager anew, and looks again every 2s while it has none, as for a
/// program that hasn't played yet. COM must be set up on the thread that reads it.
pub struct MixerLevel {
    process: u32,
    volume: Option<ISimpleAudioVolume>,
    looked: Option<Instant>,
}

impl MixerLevel {
    pub fn new(process: u32) -> MixerLevel {
        MixerLevel {
            process,
            volume: None,
            looked: None,
        }
    }

    /// The level now, or `None` while the process owns no session on the default output
    /// device.
    pub fn read(&mut self) -> Option<f32> {
        if self.volume.is_none() && self.looked.is_none_or(|t| t.elapsed() >= LOOK_AGAIN) {
            self.looked = Some(Instant::now());
            self.volume = sessions()
                .into_iter()
                .find(|(p, _)| *p == self.process)
                .map(|(_, volume)| volume);
        }
        // SAFETY: a COM call on a session's volume, which Windows gave us.
        let level = unsafe { self.volume.as_ref()?.GetMasterVolume() };
        if level.is_err() {
            self.volume = None;
        }
        level.ok()
    }
}

/// How often a mixer level with no session looks for one again.
const LOOK_AGAIN: Duration = Duration::from_secs(2);

/// The programs that own an audio session on the default output device, each named once,
/// Windows' own system sounds left out.
pub fn with_sessions() -> Vec<String> {
    let owners: Vec<u32> = sessions()
        .into_iter()
        .map(|(p, _)| p)
        .filter(|&p| p != 0)
        .collect();
    let mut names: Vec<String> = processes()
        .into_iter()
        .filter(|(p, _)| owners.contains(p))
        .map(|(_, name)| name)
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names
}
