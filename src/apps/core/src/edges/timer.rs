//! The timer thread, which pushes each of the loop's timers as an input when it's due.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread::JoinHandle;

use kernel::{TIMERS, TimerId};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Threading::{
    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, CreateEventW, CreateWaitableTimerExW, INFINITE,
    SetEvent, SetWaitableTimer, TIMER_ALL_ACCESS, WaitForMultipleObjects,
};

use crate::clock;
use crate::queue::Queue;
use crate::run_context::{self, Context};

/// A handle to a Windows event or timer, which any thread may wait on, set, or close.
struct Object(HANDLE);

// SAFETY: Windows' synchronization objects may be used from any thread.
unsafe impl Send for Object {}
// SAFETY: as above.
unsafe impl Sync for Object {}

impl Drop for Object {
    fn drop(&mut self) {
        // SAFETY: the handle came from a Create function and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

enum Message {
    Set(TimerId, u64),
    Cancel(TimerId),
    Stop,
}

/// What the loop's sinks reach the timer thread through.
#[derive(Clone)]
pub struct Timers {
    to: mpsc::Sender<Message>,
    /// Wakes the thread to read its messages.
    wake: Arc<Object>,
}

impl Timers {
    pub fn start(
        queue: Arc<Queue>,
        context: Arc<Context>,
    ) -> std::io::Result<(Timers, JoinHandle<()>)> {
        // SAFETY: an auto-reset event with no name and no security attributes.
        let wake = Arc::new(Object(unsafe {
            CreateEventW(std::ptr::null(), 0, 0, std::ptr::null())
        }));
        if wake.0.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let (to, from) = mpsc::channel();
        let thread_wake = wake.clone();
        let thread = std::thread::Builder::new()
            .name("timers".into())
            .spawn(move || {
                run_context::enter(context);
                run(&queue, &from, &thread_wake);
            })?;
        Ok((Timers { to, wake }, thread))
    }

    pub fn set(&self, id: TimerId, due: u64) {
        self.send(Message::Set(id, due));
    }

    pub fn cancel(&self, id: TimerId) {
        self.send(Message::Cancel(id));
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

/// tokio's sleep woke up to 16.9ms late, and a high-resolution waitable timer at most
/// 1.46ms (measured on our development machine, 2026-10-15, record/areas/core/log.md, "A
/// high-resolution waitable timer wakes within 1.5ms where tokio's wake up to 17ms late, and
/// the core's math changes with the C runtime's FMA3 switch and with its version"), so this
/// thread waits on one for the nearest deadline, or on `wake` when a message comes.
fn run(queue: &Queue, from: &mpsc::Receiver<Message>, wake: &Object) {
    // SAFETY: a timer with no name and no security attributes.
    let timer = Object(unsafe {
        CreateWaitableTimerExW(
            std::ptr::null(),
            std::ptr::null(),
            CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
            TIMER_ALL_ACCESS,
        )
    });
    let timer = if timer.0.is_null() {
        tracing::warn!(
            "Windows refused a high-resolution timer, so timers may fire up to a scheduler tick late"
        );
        // SAFETY: as above, without the flag Windows refused.
        Object(unsafe {
            CreateWaitableTimerExW(std::ptr::null(), std::ptr::null(), 0, TIMER_ALL_ACCESS)
        })
    } else {
        timer
    };
    let mut due: BTreeSet<(u64, TimerId)> = BTreeSet::new();
    let mut by_id: BTreeMap<TimerId, u64> = BTreeMap::new();
    loop {
        while let Ok(message) = from.try_recv() {
            match message {
                Message::Set(id, at) => {
                    due.insert((at, id));
                    by_id.insert(id, at);
                }
                Message::Cancel(id) => {
                    if let Some(at) = by_id.remove(&id) {
                        due.remove(&(at, id));
                    }
                }
                Message::Stop => return,
            }
        }
        let now = clock::now();
        while let Some(&(at, id)) = due.first() {
            if at > now {
                break;
            }
            due.pop_first();
            by_id.remove(&id);
            queue.push(TIMERS, id.fired());
        }
        let handles = match due.first() {
            Some(&(at, _)) => {
                // A negative due time is relative, in units of 100ns.
                let relative = -i64::try_from((at - now).saturating_mul(10)).unwrap_or(i64::MAX);
                // SAFETY: the timer lives through the call, and `relative` is read once.
                unsafe { SetWaitableTimer(timer.0, &relative, 0, None, std::ptr::null(), 0) };
                vec![wake.0, timer.0]
            }
            None => vec![wake.0],
        };
        // SAFETY: both handles stay open through the wait.
        unsafe { WaitForMultipleObjects(handles.len() as u32, handles.as_ptr(), 0, INFINITE) };
    }
}
