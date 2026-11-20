//! Our WASM module: the edge between the routine host and the sim's APIs. The sim calls the
//! three functions it exports: `module_init` as it loads the module, `Update_StandAlone`
//! once a frame, and `module_deinit` as it unloads it. Each frame, the module hands the
//! routine host the core's writes to the routines' slots, runs the host's frame, which
//! carries out the routines' wants on the pilot's aircraft, and writes the routines' reports
//! and the status the host returns (record/areas/core/03-sim-seam-and-wasm-module.md, "Our
//! WASM module").

// A panic puts our module in the sim's `DIRTY` state, and the sim stops running it, so one
// mistake here would stop every routine, and the routine host with them, which then never
// undoes the freeze (record/areas/architecture/02-code-map.md, "When the module stops"). So
// the commonest panics fail Clippy, which tools/check.ts runs on the module, as in every
// crate built into it.
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

mod aircraft;
mod bindings;
mod connection;
mod vars;

use std::cell::RefCell;

use routine_host::Host;

use crate::aircraft::Aircraft;
use crate::connection::Connection;

/// What the module keeps from one of the sim's calls to the next.
struct Module {
    connection: Connection,
    host: Host,
    aircraft: Aircraft,
}

impl Module {
    /// Hands the routine host each slot the core wrote since the last call, and returns the
    /// time on the module's clock, read once they've all arrived.
    fn take_writes(&mut self) -> u64 {
        let written = self.connection.dispatch();
        let clock = clock_us();
        for (id, bytes) in written {
            self.host.written(id, &bytes, clock);
        }
        clock
    }

    /// One frame: the core's writes go to the routine host before its frame, so each routine
    /// runs on every feed that arrived since the last frame.
    fn frame(&mut self) {
        let clock = self.take_writes();
        let status = self.host.frame(clock, &mut self.aircraft);
        for (routine, report) in self.host.reports() {
            self.connection.write_report(routine, &report);
        }
        if let Some(status) = status {
            self.connection.write_status(&status);
        }
    }
}

thread_local! {
    // A module without WebAssembly's threads runs on one thread, so a thread's own slot
    // holds the module, and no call borrows it while another has it.
    static MODULE: RefCell<Option<Module>> = const { RefCell::new(None) };
}

/// Runs `f` on the module's slot. `try_borrow_mut` stands in for `borrow_mut`, which would
/// panic on a second borrow, where this skips the call.
fn with_module(f: impl FnOnce(&mut Option<Module>)) {
    MODULE.with(|module| {
        if let Ok(mut module) = module.try_borrow_mut() {
            f(&mut module);
        }
    });
}

/// The sim calls this as it loads the module. It opens the module's own SimConnect
/// connection, creates every slot, and starts listening for the sim's resets of its
/// variables.
#[unsafe(no_mangle)]
pub extern "C" fn module_init() {
    // `module_init` may run again in one run of the sim, after a sign-in, and whether the
    // module starts fresh then is unverified (record/areas/core/03-sim-seam-and-wasm-module.md,
    // "Left open"). So a second call stops the first's module, as `module_deinit` would,
    // rather than leave its connection open.
    module_deinit();
    let host = Host::new(routines::list(), messages::SLOTS_HASH, messages::VERSION);
    // Without a connection the module runs nothing and writes no status, so the core reports
    // it as missing.
    let Some(connection) = Connection::open(&host.slots(), &host.report_slots()) else {
        return;
    };
    aircraft::listen();
    let mut module = Module {
        connection,
        host,
        aircraft: Aircraft::default(),
    };
    module.take_writes();
    with_module(|slot| *slot = Some(module));
}

/// The sim calls this once a frame, with the frame's time in seconds, which the module
/// doesn't read, since the routine host times everything on the module's clock.
#[unsafe(no_mangle)]
#[allow(non_snake_case)]
pub extern "C" fn Update_StandAlone(_: f32) {
    with_module(|module| {
        if let Some(module) = module {
            module.frame();
        }
    });
}

/// The sim calls this as it unloads the module.
#[unsafe(no_mangle)]
pub extern "C" fn module_deinit() {
    with_module(|module| {
        if let Some(mut module) = module.take() {
            module.host.release(&mut module.aircraft);
            aircraft::stop_listening();
            module.connection.close();
        }
    });
}

#[link(wasm_import_module = "wasi_snapshot_preview1")]
unsafe extern "C" {
    /// WASI preview 1's clock, as wasi-libc declares it: a clock's ID, the precision asked
    /// for, and where to write the time, in ns. It returns an errno, 0 on success.
    fn clock_time_get(id: u32, precision: u64, time: *mut u64) -> u16;
}

/// WASI's monotonic clock, in µs. It counted `QueryPerformanceCounter`'s ticks in a flight,
/// and the core stamps each slot's header on that counter, so the routine host keeps its
/// estimate of the core's counter from this clock (measured on MSFS 2024, 2026-10-09,
/// record/areas/architecture/log.md, "In a flight, a Rust client on SimConnect.dll masks, creates
/// AI objects with liveries, sets input events, reads the camera, and follows the load; the Rust
/// module echoes; Raw Input gets a person's key and button; and the module's clock counts the
/// counter's ticks from near the sim's start"). It reads 0 if the sim refuses the call.
fn clock_us() -> u64 {
    const MONOTONIC: u32 = 1;
    let mut ns = 0;
    // SAFETY: the sim writes the time into `ns`, which outlives the call.
    unsafe { clock_time_get(MONOTONIC, 1, &mut ns) };
    ns / 1_000
}
