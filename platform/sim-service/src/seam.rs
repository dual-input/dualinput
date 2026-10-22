//! What the sim's side of the seam hands up, read on the loop: the sim's process, each
//! connection's open and loss, and each message SimConnect handed over
//! (record/areas/core/03-sim-seam-and-wasm-module.md, "Its inputs").

use kernel::{Cx, Input};
use sim_awareness::{Flow, Process};
use sim_client::message::Message;
use sim_client::{Connection, SimCall, Tag, Up};

use crate::awareness::Step;
use crate::{SimEvent, SimService};

/// What SimConnect_Open returns when it opened, an HRESULT.
const S_OK: i32 = 0;

impl SimService {
    pub(crate) fn seam(me: &mut SimService, input: &Input, cx: &mut Cx) {
        let Some(up) = Up::decode(&input.bytes) else {
            tracing::warn!(
                seq = input.seq,
                "an input from the sim's seam didn't decode"
            );
            return;
        };
        match up {
            Up::Found { process, created } => me.found(process, created, cx),
            Up::Exited { code } => me.exited(code, cx),
            Up::Opened { connection, result } => me.on_opened(connection, result, cx),
            Up::Lost { connection } => me.lost(connection, cx),
            Up::Message {
                connection,
                record,
                call,
            } => me.message(connection, &record, call, cx),
        }
    }

    fn found(&mut self, process: u32, created: u64, cx: &Cx) {
        tracing::info!(process, created, "the sim's process was found");
        self.process = Some(process);
        self.quit = false;
        Step::signal(cx, Step::Process(Process::Found { process, created }));
        self.open(self.me(), cx);
    }

    /// The sim's process ended. Every connection went with it, and each unit hears so; the
    /// platform's keeps its setup for the sim's next run, and a feature's next call opens an
    /// empty one, as it would after its profile unloaded.
    fn exited(&mut self, code: u32, cx: &Cx) {
        tracing::info!(code = format!("{code:#x}"), "the sim's process exited");
        self.process = None;
        self.module.sim_exited();
        let units: Vec<_> = self.holders.values().map(|h| h.unit).collect();
        for unit in units {
            let connection = self
                .holders
                .get(&unit.place())
                .and_then(|h| h.current.as_ref())
                .map(|c| c.connection);
            self.gone(unit, cx);
            if let Some(connection) = connection {
                cx.out(SimCall::Close { connection });
            }
            if unit != self.me() {
                self.forget(unit);
            }
        }
        Step::signal(cx, Step::Process(Process::Exited { code }));
    }

    fn on_opened(&mut self, connection: Connection, result: i32, cx: &Cx) {
        let Some(holder) = self.holder_of(connection) else {
            return;
        };
        let unit = holder.unit;
        if result != S_OK {
            // SimConnect_Open returned E_FAIL until the sim took connections, 109s into its
            // boot (measured on MSFS 2024, 2026-10-09, record/areas/architecture/log.md), so
            // the platform tries again at its next tick, and a feature at its next call.
            tracing::debug!(?connection, result, "a connection didn't open");
            self.gone(unit, cx);
            return;
        }
        tracing::info!(?connection, "a connection to the sim opened");
        self.opened(connection, cx);
        if unit == self.me() {
            self.platform_opened(cx);
        }
    }

    /// A call on the connection failed. A connection the sim loses while it runs opens again
    /// at once, and the next makes the lost one's setup again
    /// (record/areas/core/03-sim-seam-and-wasm-module.md, "Connections").
    fn lost(&mut self, connection: Connection, cx: &Cx) {
        let Some(holder) = self.holder_of(connection) else {
            return;
        };
        let unit = holder.unit;
        tracing::info!(?connection, "a connection to the sim was lost");
        self.gone(unit, cx);
        if self.running() {
            self.open(unit, cx);
        }
    }

    fn message(&mut self, connection: Connection, record: &[u8], call: Option<Tag>, cx: &Cx) {
        let Some(holder) = self.holder_of(connection) else {
            tracing::trace!(?connection, "a message for a closed connection was dropped");
            return;
        };
        let unit = holder.unit;
        let Some(message) = Message::read(record) else {
            tracing::warn!(?connection, "a message from the sim was too short to read");
            return;
        };
        let platform = unit == self.me();
        match message {
            Message::Quit => {
                // The quit message ends the connection it came on. On the platform's, it
                // ends the run too, and the service opens nothing until the process exits
                // and another is found.
                self.gone(unit, cx);
                cx.out(SimCall::Close { connection });
                if platform {
                    tracing::info!("the sim sent its quit message");
                    self.quit = true;
                    Step::signal(cx, Step::Quit);
                }
            }
            Message::Open {
                application,
                version,
                simconnect,
            } => tracing::info!(
                ?connection,
                application,
                version = ?version,
                simconnect = ?simconnect,
                "the sim's open reply arrived"
            ),
            Message::Exception {
                exception,
                send_id,
                index,
            } => {
                let origin = call.and_then(|tag| self.origin(connection, tag));
                let to = origin.map_or(unit, |o| o.unit);
                if to == self.me() {
                    tracing::warn!(exception, send_id, index, "a call of the platform's failed");
                } else {
                    let call = origin.and_then(|o| o.handle);
                    self.tell(
                        to,
                        SimEvent::Exception {
                            call,
                            exception,
                            index,
                        },
                        cx,
                    );
                }
            }
            Message::Event { event, data, .. } if platform && event == self.platform.pause => {
                Step::signal(cx, Step::Pause(data));
            }
            Message::Filename { event, file } if platform => {
                if event == self.platform.aircraft_loaded {
                    Step::signal(cx, Step::AircraftLoaded(file));
                } else if event == self.platform.flight_loaded {
                    Step::signal(cx, Step::FlightLoaded);
                    self.read_flight_file(file, cx);
                }
            }
            Message::SystemState { request, text, .. }
                if platform && Some(request) == self.platform.aircraft_state =>
            {
                Step::signal(cx, Step::AircraftState(text));
            }
            Message::Flow { event, .. } if platform => {
                Step::signal(cx, Step::Flow(Flow::from_sdk(event)));
            }
            Message::ObjectData(data) => self.values(unit, &data, cx),
            Message::ClientData(data) if platform && data.request == self.platform.status => {
                self.status_read(&data.bytes, cx);
            }
            other => tracing::trace!(?connection, ?other, "a message nothing reads"),
        }
    }
}
