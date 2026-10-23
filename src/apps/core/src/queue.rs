//! The one queue every input reaches the loop through.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex, MutexGuard};

use kernel::{Input, SourceId};

use crate::clock;

/// A replay compares what a run did input by input, so the inputs' stamps have to rise in
/// the order the loop takes them, or a handler that compares two stamps would decide one
/// way live and another in the replay. `push` reads the clock and numbers the input under
/// the same lock that appends it, so no two threads can stamp in one order and append in
/// the other, as the history of FS Copilot, the shared-cockpit app we worked on before Dual
/// Input, did with presses and drags from two threads (record/areas/core/01-loop-and-edge.md,
/// "The queue").
///
/// The queue is unbounded: the sim thread has to go on taking SimConnect's messages, and
/// tokio's tasks must never wait on the loop.
#[derive(Default)]
pub struct Queue {
    state: Mutex<State>,
    /// The loop sleeps on this while the queue is empty.
    ready: Condvar,
}

#[derive(Default)]
struct State {
    inputs: VecDeque<Input>,
    next: u64,
}

impl Queue {
    /// Stamps and numbers an input and appends it.
    pub fn push(&self, source: SourceId, bytes: Vec<u8>) {
        let mut state = self.lock();
        let seq = state.next;
        state.next += 1;
        let stamp = clock::now();
        state.inputs.push_back(Input {
            seq,
            stamp,
            source,
            bytes,
        });
        drop(state);
        self.ready.notify_one();
    }

    /// The oldest input, once there is one.
    pub fn pop(&self) -> Input {
        let mut state = self.lock();
        loop {
            if let Some(input) = state.inputs.pop_front() {
                return input;
            }
            state = self
                .ready
                .wait(state)
                .expect("no thread should panic while it holds the queue's lock");
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // Holding the lock, a thread reads the clock and appends, neither of which panics,
        // and a panic elsewhere ends the core, so nobody sees a poisoned lock.
        self.state
            .lock()
            .expect("no thread should panic while it holds the queue's lock")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two edges push at once, and every stamp rises with its sequence number
    /// (record/areas/core/01-loop-and-edge.md, "Cases for the bench"). This runs 200,000
    /// pushes on each of two threads; the bench's loop under load runs the case for an hour
    /// on three, through the recording's writer, which refuses a stamp that falls.
    #[test]
    fn stamps_rise_with_sequence_numbers_while_two_threads_push() {
        let queue = Queue::default();
        std::thread::scope(|s| {
            for source in [10, 11] {
                let queue = &queue;
                s.spawn(move || {
                    for _ in 0..200_000 {
                        queue.push(SourceId(source), vec![]);
                    }
                });
            }
        });
        let mut last = (0, 0);
        for expected in 0..400_000 {
            let input = queue.pop();
            assert_eq!(input.seq, expected);
            assert!(
                input.stamp >= last.1,
                "input {} at {}µs came after input {} at {}µs",
                input.seq,
                input.stamp,
                last.0,
                last.1
            );
            last = (input.seq, input.stamp);
        }
    }
}
