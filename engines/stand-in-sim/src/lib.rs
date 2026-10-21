//! The bench's sim. In a bench build of the core it takes the sim edge's place, below the
//! sim seam, and answers the loop's calls as the sim would, with SimConnect's own messages
//! (record/areas/build/02-testing.md, "The stand-in sim").
//!
//! It runs where the edge runs, off the loop on a thread of its own, and hands up what the
//! edge would, for the core to stamp and record, so a bench run's recording replays with no
//! stand-in, as a release's replays with no sim. A scenario acts on it the way things
//! happen to a sim: the bench names the process that stands for the sim's, kills that
//! process to crash it, and has it quit or lose a connection.

use std::collections::BTreeSet;
use std::os::raw::c_char;
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;

use sim_client::{Connection, SimCall, Up};
use simconnect_types::{
    DWORD, SIMCONNECT_RECV, SIMCONNECT_RECV_ID, SIMCONNECT_RECV_ID_OPEN, SIMCONNECT_RECV_ID_QUIT,
    SIMCONNECT_RECV_OPEN,
};
use windows_sys::Win32::Foundation::{
    CloseHandle, E_FAIL, FILETIME, HANDLE, S_OK, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::Threading::{
    CreateEventW, GetExitCodeProcess, GetProcessTimes, INFINITE, OpenProcess,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, SetEvent, WaitForMultipleObjects,
    WaitForSingleObject,
};

/// SimConnect's version in the header of each message it hands over: every one of the
/// 312,702 records in p10's capture of a flight on MSFS 2024 carried 6 (read in
/// experiments/areas/architecture/results/p10-capture-2026-10-16-13-52-24.bin.zst).
const VERSION: DWORD = 6;

/// What the sim's open message names, as MSFS 2024's did on three sim releases: SunRise
/// 12.2, build 282174.999, and SimConnect 12.2.0.0 (measured,
/// record/areas/build/results/2026-10-18-msfs-packages-and-sdk.txt).
const APPLICATION: &[u8] = b"SunRise";
const APPLICATION_VERSION: [DWORD; 4] = [12, 2, 282_174, 999];
const SIMCONNECT_VERSION: [DWORD; 4] = [12, 2, 0, 0];

/// What a scenario does to the sim, which no call of the core's asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Act {
    /// Takes the process with this ID as the sim's, as the bench's stub for it. The
    /// stand-in finds it once the core asks, as the edge finds the sim's.
    Watch { process: u32 },
    /// Loses a connection, as a failed call on it would.
    Lose { connection: Connection },
    /// Sends the quit message on every open connection. Whether a sim closing from its menu
    /// sends it before its process exits is unmeasured
    /// (record/areas/core/03-sim-seam-and-wasm-module.md, "Cases for the bench").
    Quit,
}

enum Message {
    Call(SimCall),
    Act(Act),
    Stop,
}

/// What the loop's sink for `SimCall` and the bench reach the stand-in's thread through.
#[derive(Clone)]
pub struct StandIn {
    to: mpsc::Sender<Message>,
    /// Wakes the thread to read its messages.
    wake: Arc<Object>,
}

impl StandIn {
    /// Starts the stand-in's thread, which hands each input up through `up`, as the edge
    /// hands its own to the core's queue.
    pub fn start(
        up: impl FnMut(Up) + Send + 'static,
    ) -> std::io::Result<(StandIn, JoinHandle<()>)> {
        // SAFETY: an auto-reset event with no name and no security attributes.
        let wake = Arc::new(Object(unsafe {
            CreateEventW(std::ptr::null(), 0, 0, std::ptr::null())
        }));
        if wake.0.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let (to, from) = mpsc::channel();
        let sim = Sim {
            up: Box::new(up),
            watched: None,
            process: None,
            quit: false,
            open: BTreeSet::new(),
        };
        let thread_wake = wake.clone();
        let thread = std::thread::Builder::new()
            .name("stand-in".into())
            .spawn(move || run(sim, &from, &thread_wake))?;
        Ok((StandIn { to, wake }, thread))
    }

    /// Carries out one of the loop's calls.
    pub fn call(&self, call: SimCall) {
        self.send(Message::Call(call));
    }

    pub fn act(&self, act: Act) {
        self.send(Message::Act(act));
    }

    pub fn stop(&self) {
        self.send(Message::Stop);
    }

    fn send(&self, message: Message) {
        if self.to.send(message).is_ok() {
            // SAFETY: the event lives as long as `self.wake`.
            unsafe { SetEvent(self.wake.0) };
        }
    }
}

/// A handle to a Windows event or process, which any thread may wait on or close.
struct Object(HANDLE);

// SAFETY: Windows' synchronization objects and process handles may be used from any thread.
unsafe impl Send for Object {}
// SAFETY: as above.
unsafe impl Sync for Object {}

impl Drop for Object {
    fn drop(&mut self) {
        // SAFETY: the handle came from a Create or Open function and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

/// The stand-in's sim, which only its thread touches.
struct Sim {
    up: Box<dyn FnMut(Up) + Send>,
    /// The process the bench named as the sim's, until it's found and has exited.
    watched: Option<u32>,
    /// The sim's process, by its ID and a handle to it, once found, until it exits.
    process: Option<(u32, Object)>,
    /// Whether the quit message went out, after which the sim answers no new connection.
    quit: bool,
    open: BTreeSet<Connection>,
}

/// Waits on its messages and on the sim's process, as the edge waits on its connections
/// and the sim's process (record/areas/core/03-sim-seam-and-wasm-module.md, "Its thread").
fn run(mut sim: Sim, from: &mpsc::Receiver<Message>, wake: &Object) {
    loop {
        while let Ok(message) = from.try_recv() {
            match message {
                Message::Call(call) => sim.call(call),
                Message::Act(act) => sim.act(act),
                Message::Stop => return,
            }
        }
        let mut handles = vec![wake.0];
        handles.extend(sim.process.as_ref().map(|(_, process)| process.0));
        // SAFETY: each handle stays open through the wait.
        let woke =
            unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, INFINITE) };
        if woke == WAIT_OBJECT_0 + 1 {
            sim.exited();
        }
    }
}

impl Sim {
    fn call(&mut self, call: SimCall) {
        match call {
            SimCall::FindProcess => self.find(),
            SimCall::Open { connection, .. } => {
                // SimConnect_Open returned E_FAIL until the sim took connections, 109s into
                // its boot (measured on MSFS 2024, 2026-10-09,
                // record/areas/architecture/log.md, "Connecting as the sim boots").
                if self.process.is_none() {
                    (self.up)(Up::Opened {
                        connection,
                        result: E_FAIL,
                    });
                    return;
                }
                // A sim that is shutting down may still return S_OK, which is unverified
                // (record/areas/core/03-sim-seam-and-wasm-module.md, "Connections"). The
                // stand-in plays that case, a connection that never answers, so a bench
                // case shows the core opening nothing after the quit message.
                if self.quit {
                    (self.up)(Up::Opened {
                        connection,
                        result: S_OK,
                    });
                    return;
                }
                self.open.insert(connection);
                (self.up)(Up::Opened {
                    connection,
                    result: S_OK,
                });
                (self.up)(Up::Message {
                    connection,
                    record: open_message(),
                });
            }
            SimCall::Close { connection } => {
                self.open.remove(&connection);
            }
        }
    }

    fn act(&mut self, act: Act) {
        match act {
            Act::Watch { process } => self.watched = Some(process),
            Act::Lose { connection } => {
                if self.open.remove(&connection) {
                    (self.up)(Up::Lost { connection });
                }
            }
            Act::Quit => {
                self.quit = true;
                for &connection in &self.open {
                    (self.up)(Up::Message {
                        connection,
                        record: bytes_of(&header::<SIMCONNECT_RECV>(SIMCONNECT_RECV_ID_QUIT)),
                    });
                }
            }
        }
    }

    /// Finds the watched process, as the edge finds the sim's, while it holds none: a
    /// process that has already exited isn't found, as the edge's list of running
    /// processes wouldn't hold it.
    fn find(&mut self) {
        let Some(id) = self.watched.filter(|_| self.process.is_none()) else {
            return;
        };
        // SAFETY: OpenProcess takes access rights, an inherit flag, and an ID.
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                id,
            )
        };
        if handle.is_null() {
            return;
        }
        let process = Object(handle);
        // SAFETY: the handle stays open through the call, and a 0ms wait only polls.
        if unsafe { WaitForSingleObject(process.0, 0) } != WAIT_TIMEOUT {
            return;
        }
        let mut times = [FILETIME::default(); 4];
        let [created, exited, kernel, user] = &mut times;
        // SAFETY: the handle stays open through the call, which writes the four times.
        if unsafe { GetProcessTimes(process.0, created, exited, kernel, user) } == 0 {
            return;
        }
        let created = u64::from(times[0].dwHighDateTime) << 32 | u64::from(times[0].dwLowDateTime);
        self.process = Some((id, process));
        self.quit = false;
        (self.up)(Up::Found {
            process: id,
            created,
        });
    }

    /// Hands up the exit code of the sim's process. How a crash reaches a SimConnect
    /// connection, as a failed call or as nothing until the process is gone, is unmeasured
    /// (record/areas/core/03-sim-seam-and-wasm-module.md, "Its inputs"), so the stand-in
    /// hands up nothing more for the connections it drops.
    fn exited(&mut self) {
        let Some((id, process)) = self.process.take() else {
            return;
        };
        let mut code = 0;
        // SAFETY: the handle stays open through the call, which writes the code.
        unsafe { GetExitCodeProcess(process.0, &mut code) };
        // The bench may already have named the next sim's stub, which stays watched.
        if self.watched == Some(id) {
            self.watched = None;
        }
        self.open.clear();
        (self.up)(Up::Exited { code });
    }
}

/// The sim's open message, which the sim hands over on a connection after
/// `SimConnect_Open` returns `S_OK`.
fn open_message() -> Vec<u8> {
    let mut open = SIMCONNECT_RECV_OPEN {
        _base: header::<SIMCONNECT_RECV_OPEN>(SIMCONNECT_RECV_ID_OPEN),
        ..Default::default()
    };
    for (to, from) in open.szApplicationName.iter_mut().zip(APPLICATION) {
        *to = *from as c_char;
    }
    [
        open.dwApplicationVersionMajor,
        open.dwApplicationVersionMinor,
        open.dwApplicationBuildMajor,
        open.dwApplicationBuildMinor,
    ] = APPLICATION_VERSION;
    [
        open.dwSimConnectVersionMajor,
        open.dwSimConnectVersionMinor,
        open.dwSimConnectBuildMajor,
        open.dwSimConnectBuildMinor,
    ] = SIMCONNECT_VERSION;
    bytes_of(&open)
}

/// The header that starts each message, for a message of type `T`.
fn header<T>(id: SIMCONNECT_RECV_ID) -> SIMCONNECT_RECV {
    SIMCONNECT_RECV {
        dwSize: size_of::<T>() as DWORD,
        dwVersion: VERSION,
        dwID: id as DWORD,
    }
}

/// A message's bytes, as SimConnect hands them over.
fn bytes_of<T: Copy>(record: &T) -> Vec<u8> {
    // SAFETY: SimConnect's messages are `repr(C, packed)` structs of integers and arrays of
    // them, so every byte of one is initialized, and `record` outlives the slice.
    unsafe { std::slice::from_raw_parts((record as *const T).cast::<u8>(), size_of::<T>()) }
        .to_vec()
}
