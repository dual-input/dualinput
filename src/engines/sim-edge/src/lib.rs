//! The sim edge: the one thread in the core that holds every SimConnect connection, below
//! the sim seam, the line where the core's code meets SimConnect's own calls and messages
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "The edge").
//!
//! It makes each `SimCall` the loop puts out, and hands up what comes back as the seam's
//! inputs, for the core to stamp and record: each message copied whole, with the tag of the
//! call that caused it when it's an exception, each open's result, a connection's loss, and
//! the sim's process found and ended. It parses nothing else, since what makes sense of a
//! message runs on the loop, where a replay runs it again, and the edge runs only live.
//!
//! It's the one crate that declares SimConnect's functions, so the crate graph shows that
//! only the edge can call SimConnect.dll (record/areas/architecture/02-code-map.md, "The
//! sim seam").

mod process;
mod sent;
mod simconnect;
mod stats;

use std::collections::BTreeMap;
use std::mem::offset_of;
use std::ptr::null_mut;
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::Instant;

use sim_client::{Connection, Op, SimCall, Tag, Up};
use simconnect_types::{
    DWORD, SIMCONNECT_RECV, SIMCONNECT_RECV_EXCEPTION, SIMCONNECT_RECV_EXCEPTION_UNKNOWN_SENDID,
    SIMCONNECT_RECV_ID_EXCEPTION,
};
use windows_sys::Win32::Foundation::{CloseHandle, E_FAIL, HANDLE, S_OK, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{
    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, CreateEventW, CreateWaitableTimerExW, INFINITE,
    SetEvent, SetWaitableTimer, TIMER_ALL_ACCESS, WaitForMultipleObjects,
};

use crate::sent::Sent;
use crate::simconnect::{
    SimConnect_Close, SimConnect_GetLastSentPacketID, SimConnect_GetNextDispatch, SimConnect_Open,
};
use crate::stats::{Stats, Woke};

/// The program the edge looks for among the running processes: the name Windows'
/// Application log gave the sim's process on the Steam edition, and a pilot's crash report
/// on a forum gave it on the Microsoft Store's
/// (record/areas/core/03-sim-seam-and-wasm-module.md, "The sim's process").
const SIM: &str = "FlightSimulator2024.exe";

/// The longest the edge waits before reading its connections again, while one is open, so
/// it still reads a connection whose event never fires: the SDK doesn't say when the sim
/// sets one (record/areas/core/03-sim-seam-and-wasm-module.md, "Its thread"). It's in
/// 100ns units, negative for a time from now, as `SetWaitableTimer` takes it.
const POLL: i64 = -20_000;

enum Message {
    Call(SimCall),
    Stop,
}

/// What the loop's sink for `SimCall` reaches the sim thread through.
#[derive(Clone)]
pub struct SimEdge {
    to: mpsc::Sender<Message>,
    /// Wakes the thread to read its messages.
    wake: Arc<Object>,
}

impl SimEdge {
    /// Starts the sim thread. `enter` runs first on it, so the core can make it one of its
    /// run's threads, for the log and the panic hook, and `up` hands up each input, as the
    /// core puts it on its queue.
    pub fn start(
        enter: impl FnOnce() + Send + 'static,
        up: impl FnMut(Up) + Send + 'static,
    ) -> std::io::Result<(SimEdge, JoinHandle<()>)> {
        SimEdge::start_finding(SIM.into(), enter, up)
    }

    /// Starts the sim thread as `start` does, with `program` taken for the sim's, so a test
    /// can find a process of its own.
    fn start_finding(
        program: String,
        enter: impl FnOnce() + Send + 'static,
        up: impl FnMut(Up) + Send + 'static,
    ) -> std::io::Result<(SimEdge, JoinHandle<()>)> {
        let wake = Arc::new(Object::event().ok_or_else(std::io::Error::last_os_error)?);
        let poll = poll_timer().ok_or_else(std::io::Error::last_os_error)?;
        let (to, from) = mpsc::channel();
        let thread_wake = wake.clone();
        let thread = std::thread::Builder::new()
            .name("sim".into())
            .spawn(move || {
                enter();
                let edge = Edge {
                    up: Box::new(up),
                    program,
                    process: None,
                    links: BTreeMap::new(),
                    woke: (Woke::Other, Instant::now()),
                    stats: Stats::new(),
                };
                edge.run(&from, &thread_wake, &poll);
            })?;
        Ok((SimEdge { to, wake }, thread))
    }

    /// Queues one of the loop's calls, which the thread makes at its next wake, in order.
    pub fn call(&self, call: SimCall) {
        self.send(Message::Call(call));
    }

    /// Ends the thread, which closes each connection it holds.
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

/// A handle to a Windows event, timer, process, or snapshot, which any thread may wait on or
/// close.
struct Object(HANDLE);

// SAFETY: Windows' synchronization objects and process handles may be used from any thread.
unsafe impl Send for Object {}
// SAFETY: as above.
unsafe impl Sync for Object {}

impl Object {
    /// An auto-reset event with no name, or `None` when Windows refuses one.
    fn event() -> Option<Object> {
        // SAFETY: an auto-reset event with no name and no security attributes.
        let handle = unsafe { CreateEventW(std::ptr::null(), 0, 0, std::ptr::null()) };
        (!handle.is_null()).then_some(Object(handle))
    }
}

impl Drop for Object {
    fn drop(&mut self) {
        // SAFETY: the handle came from a Create or Open function and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

/// The timer for the 2ms wait, since a wait's own timeout can end a clock tick late: at
/// Windows' default resolution tokio's sleeps woke up to 16.9ms late, while a
/// high-resolution waitable timer woke at most 1.46ms late (measured on our development
/// machine, 2026-10-15, record/areas/core/log.md, "A high-resolution waitable timer wakes
/// within 1.5ms where tokio's wake up to 17ms late, and the core's math changes with the C
/// runtime's FMA3 switch and with its version").
fn poll_timer() -> Option<Object> {
    // SAFETY: a timer with no name and no security attributes.
    let timer = unsafe {
        CreateWaitableTimerExW(
            std::ptr::null(),
            std::ptr::null(),
            CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
            TIMER_ALL_ACCESS,
        )
    };
    if !timer.is_null() {
        return Some(Object(timer));
    }
    tracing::warn!(
        "Windows refused a high-resolution timer, so the sim edge may read a connection whose event never fires up to a clock tick late"
    );
    // SAFETY: as above, without the flag Windows refused.
    let timer =
        unsafe { CreateWaitableTimerExW(std::ptr::null(), std::ptr::null(), 0, TIMER_ALL_ACCESS) };
    (!timer.is_null()).then_some(Object(timer))
}

/// One open connection.
struct Link {
    /// SimConnect's handle for it.
    handle: HANDLE,
    /// The event passed to `SimConnect_Open`, which the edge waits on.
    event: Object,
    sent: Sent,
}

impl Link {
    /// Hands up each message waiting on the connection, in order, until
    /// `SimConnect_GetNextDispatch` returns anything but S_OK, which p08's client took to
    /// mean none was left. Whether a failed dispatch returns anything else is unverified, so
    /// a failure raises nothing (record/areas/core/03-sim-seam-and-wasm-module.md, "Its
    /// inputs").
    fn drain(
        &mut self,
        connection: Connection,
        up: &mut dyn FnMut(Up),
        stats: &mut Stats,
        (how, woke): (Woke, Instant),
    ) {
        loop {
            let mut record: *mut SIMCONNECT_RECV = null_mut();
            let mut size: DWORD = 0;
            // SAFETY: the handle is open, and SimConnect writes the two values.
            let result = unsafe { SimConnect_GetNextDispatch(self.handle, &mut record, &mut size) };
            if result != S_OK || record.is_null() {
                return;
            }
            // SAFETY: SimConnect hands over a record `size` bytes long, which the edge copies
            // before its next call on the connection.
            let record =
                unsafe { std::slice::from_raw_parts(record.cast::<u8>(), size as usize) }.to_vec();
            let call = sent_by(&record).and_then(|packet| self.sent.tag_of(packet));
            up(Up::Message {
                connection,
                record,
                call,
            });
            stats.handed_up(how, woke.elapsed());
        }
    }
}

impl Drop for Link {
    // SimConnect holds the connection's event while the connection is open, and Rust drops
    // the fields, the event among them, after this runs, so the connection closes first.
    fn drop(&mut self) {
        // SAFETY: the handle came from SimConnect_Open and is closed once.
        unsafe { SimConnect_Close(self.handle) };
    }
}

/// The packet ID an exception names as the call that caused it, or `None` for any other
/// message and for an exception that names none, with `UNKNOWN_SENDID`.
fn sent_by(record: &[u8]) -> Option<u32> {
    let word = |at: usize| Some(u32::from_le_bytes(record.get(at..at + 4)?.try_into().ok()?));
    if word(offset_of!(SIMCONNECT_RECV, dwID))? != SIMCONNECT_RECV_ID_EXCEPTION as DWORD {
        return None;
    }
    let sent = word(offset_of!(SIMCONNECT_RECV_EXCEPTION, dwSendID))?;
    (sent != SIMCONNECT_RECV_EXCEPTION_UNKNOWN_SENDID).then_some(sent)
}

/// The sim thread's state, which only it touches.
struct Edge {
    up: Box<dyn FnMut(Up) + Send>,
    /// The sim's program, as the edge looks for it among the processes.
    program: String,
    /// The sim's process, once found, until it ends.
    process: Option<Object>,
    links: BTreeMap<Connection, Link>,
    /// What ended the last wait, and when.
    woke: (Woke, Instant),
    stats: Stats,
}

impl Edge {
    /// Waits on each open connection's event, the sim's process, and `wake`, and with a
    /// connection open, for at most 2ms; then makes the queued calls in order, and hands up
    /// each connection's messages (record/areas/core/03-sim-seam-and-wasm-module.md, "Its
    /// thread").
    fn run(mut self, from: &mpsc::Receiver<Message>, wake: &Object, poll: &Object) {
        loop {
            // WaitForMultipleObjects names the first of the handles that's set, so the
            // connections' events go first, and the stats count a wake as the event's even
            // when a call came at the same time.
            let mut handles: Vec<HANDLE> = self.links.values().map(|link| link.event.0).collect();
            let events = handles.len();
            let process = self.process.as_ref().map(|process| {
                handles.push(process.0);
                handles.len() - 1
            });
            handles.push(wake.0);
            // With no connection open there's nothing to read, so the edge waits for a call
            // or the sim's process alone.
            let timer = (events > 0).then(|| {
                // SAFETY: the timer lives through the call, and `POLL` is read once.
                unsafe { SetWaitableTimer(poll.0, &POLL, 0, None, std::ptr::null(), 0) };
                handles.push(poll.0);
                handles.len() - 1
            });
            // SAFETY: each handle stays open through the wait.
            let woke = unsafe {
                WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, INFINITE)
            };
            let index = woke.wrapping_sub(WAIT_OBJECT_0) as usize;
            let how = if index < events {
                Woke::Event
            } else if timer == Some(index) {
                Woke::Timeout
            } else {
                Woke::Other
            };
            self.woke = (how, Instant::now());
            self.stats.woke(how);

            while let Ok(message) = from.try_recv() {
                match message {
                    Message::Call(call) => self.call(call),
                    Message::Stop => {
                        self.stats.finish();
                        return;
                    }
                }
            }
            for (&connection, link) in &mut self.links {
                link.drain(connection, &mut *self.up, &mut self.stats, self.woke);
            }
            // The sim service tells a close from a crash by the quit message before the
            // process's end, so the end goes up after the messages the sim sent before it
            // (record/areas/core/03-sim-seam-and-wasm-module.md, "A crash and a close").
            if process == Some(index) {
                self.ended();
            }
            self.stats.tick();
        }
    }

    fn call(&mut self, call: SimCall) {
        match call {
            SimCall::FindProcess => self.find(),
            SimCall::Open { connection, name } => self.open(connection, &name),
            SimCall::Close { connection } => {
                self.links.remove(&connection);
            }
            SimCall::On {
                connection,
                tag,
                op,
            } => self.on(connection, tag, op),
        }
    }

    /// Looks for the sim's process while the edge holds none, and holds the one it finds.
    fn find(&mut self) {
        if self.process.is_some() {
            return;
        }
        let Some(found) = process::find(&self.program) else {
            return;
        };
        (self.up)(Up::Found {
            process: found.id,
            created: found.created,
        });
        self.process = Some(found.handle);
    }

    fn ended(&mut self) {
        if let Some(process) = self.process.take() {
            (self.up)(Up::Exited {
                code: process::exit_code(&process),
            });
        }
    }

    fn open(&mut self, connection: Connection, name: &str) {
        let Some(event) = Object::event() else {
            tracing::warn!(
                error = %std::io::Error::last_os_error(),
                "Windows refused the sim edge an event for a SimConnect connection"
            );
            (self.up)(Up::Opened {
                connection,
                result: E_FAIL,
            });
            return;
        };
        let name = simconnect::c_string(name);
        let mut handle = null_mut();
        // SAFETY: SimConnect writes the handle, and reads the name and keeps the event,
        // which live as long as the connection does.
        let result =
            unsafe { SimConnect_Open(&mut handle, name.as_ptr(), null_mut(), 0, event.0, 0) };
        if result >= 0 {
            let link = Link {
                handle,
                event,
                sent: Sent::new(),
            };
            self.links.insert(connection, link);
        }
        (self.up)(Up::Opened { connection, result });
    }

    /// Makes one call on a connection the edge holds, and keeps its packet ID. A call for a
    /// connection the edge closed or lost does nothing.
    fn on(&mut self, connection: Connection, tag: Tag, op: Op) {
        let Some(link) = self.links.get_mut(&connection) else {
            return;
        };
        // SAFETY: the handle stays open until the connection leaves `links`.
        let result = unsafe { simconnect::make(link.handle, op) };
        if result < 0 {
            // Closing the connection discards the messages still waiting on it, the sim's
            // quit message among them, so the edge hands them up first, as `run` hands them
            // up before the process's end.
            link.drain(connection, &mut *self.up, &mut self.stats, self.woke);
            (self.up)(Up::Lost { connection });
            self.links.remove(&connection);
            return;
        }
        let mut packet = 0;
        // SAFETY: as above, and SimConnect writes the ID.
        if unsafe { SimConnect_GetLastSentPacketID(link.handle, &mut packet) } >= 0 {
            link.sent.add(packet, tag);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    use simconnect_types::SIMCONNECT_RECV_ID_QUIT;

    use super::*;

    fn next(from: &mpsc::Receiver<Up>) -> Up {
        from.recv_timeout(Duration::from_secs(5))
            .expect("the edge should hand up an input")
    }

    fn quiet(from: &mpsc::Receiver<Up>) {
        if let Ok(up) = from.recv_timeout(Duration::from_millis(200)) {
            panic!("the edge handed up {up:?}");
        }
    }

    fn started(program: String) -> (SimEdge, JoinHandle<()>, mpsc::Receiver<Up>) {
        let (to, from) = mpsc::channel();
        let (edge, thread) = SimEdge::start_finding(
            program,
            || {},
            move |up| {
                let _ = to.send(up);
            },
        )
        .unwrap();
        (edge, thread, from)
    }

    /// A program name no other process has.
    fn unique() -> String {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        format!("dualinput-sim-edge-test-{}-{n}.exe", std::process::id())
    }

    /// A copy of Windows' ping under a name of its own, which stands for the sim's process,
    /// as the bench's stub does, and ends when the test does.
    struct Stub {
        ping: Child,
        copy: PathBuf,
    }

    impl Stub {
        fn start(program: &str) -> Stub {
            let windows = PathBuf::from(
                std::env::var_os("SystemRoot").expect("Windows should set SystemRoot"),
            );
            let copy = std::env::temp_dir().join(program);
            std::fs::copy(windows.join("System32").join("PING.EXE"), &copy)
                .expect("ping should copy to the temporary folder");
            let ping = Command::new(&copy)
                .args(["-n", "30", "127.0.0.1"])
                .stdout(Stdio::null())
                .spawn()
                .expect("the copy of ping should start");
            Stub { ping, copy }
        }

        /// Ends the process with 1, as a crash ends the sim with a code of its own.
        fn kill(&mut self) {
            self.ping.kill().unwrap();
            self.ping.wait().unwrap();
        }
    }

    impl Drop for Stub {
        fn drop(&mut self) {
            let _ = self.ping.kill();
            let _ = self.ping.wait();
            let _ = std::fs::remove_file(&self.copy);
        }
    }

    #[test]
    fn runs_enter_first_on_a_thread_named_sim_and_ends_when_stopped() {
        let (to, from) = mpsc::channel();
        let (edge, thread) = SimEdge::start(
            move || {
                let _ = to.send(std::thread::current().name().map(String::from));
            },
            |_| {},
        )
        .unwrap();
        let name = from.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(name.as_deref(), Some("sim"));
        edge.stop();
        thread.join().unwrap();
    }

    #[test]
    fn finds_a_process_by_name_ignoring_case_once_and_hands_up_its_exit_code() {
        let program = unique();
        let (edge, thread, from) = started(program.to_uppercase());
        edge.call(SimCall::FindProcess);
        quiet(&from);

        let mut stub = Stub::start(&program);
        edge.call(SimCall::FindProcess);
        match next(&from) {
            Up::Found { process, created } => {
                assert_eq!(process, stub.ping.id());
                assert!(created > 0);
            }
            up => panic!("the edge should find the process, not hand up {up:?}"),
        }
        edge.call(SimCall::FindProcess);
        quiet(&from);

        stub.kill();
        assert_eq!(next(&from), Up::Exited { code: 1 });
        edge.call(SimCall::FindProcess);
        quiet(&from);
        edge.stop();
        thread.join().unwrap();
    }

    #[test]
    fn ignores_calls_on_a_connection_it_doesnt_hold() {
        let (edge, thread, from) = started(unique());
        let connection = Connection { unit: 1, open: 1 };
        edge.call(SimCall::On {
            connection,
            tag: Tag(1),
            op: Op::SubscribeToFlowEvent,
        });
        edge.call(SimCall::Close { connection });
        quiet(&from);
        edge.stop();
        thread.join().unwrap();
    }

    /// A message's bytes, as SimConnect hands them over.
    fn bytes_of<T: Copy>(record: &T) -> Vec<u8> {
        // SAFETY: SimConnect's messages are `repr(C, packed)` structs of integers, so every
        // byte of one is initialized, and `record` outlives the slice.
        unsafe { std::slice::from_raw_parts((record as *const T).cast::<u8>(), size_of::<T>()) }
            .to_vec()
    }

    fn exception(sent: u32) -> Vec<u8> {
        bytes_of(&SIMCONNECT_RECV_EXCEPTION {
            _base: SIMCONNECT_RECV {
                dwSize: size_of::<SIMCONNECT_RECV_EXCEPTION>() as DWORD,
                dwVersion: 6,
                dwID: SIMCONNECT_RECV_ID_EXCEPTION as DWORD,
            },
            dwException: 1,
            dwSendID: sent,
            dwIndex: 2,
        })
    }

    #[test]
    fn reads_the_packet_id_an_exception_names() {
        assert_eq!(sent_by(&exception(4_321)), Some(4_321));
        assert_eq!(
            sent_by(&exception(SIMCONNECT_RECV_EXCEPTION_UNKNOWN_SENDID)),
            None
        );
        assert_eq!(sent_by(&exception(4_321)[..12]), None);
        let quit = SIMCONNECT_RECV {
            dwSize: size_of::<SIMCONNECT_RECV>() as DWORD,
            dwVersion: 6,
            dwID: SIMCONNECT_RECV_ID_QUIT as DWORD,
        };
        assert_eq!(sent_by(&bytes_of(&quit)), None);
    }
}
