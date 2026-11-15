//! Traffic, the feature that shows the traffic host's AI traffic in every other pilot's sim
//! (record/areas/traffic-atc/01-traffic-and-atc.md).
//!
//! On the traffic host, the pilot traffic's key names, it polls the sim's AI aircraft,
//! helicopters, and nearby ground objects twice a second, and sends the crew each object's
//! identity once and its states as the gate lets them out. On every other machine, it creates a
//! frozen copy of each object while its pilot is in the flight, and feeds the copies' states to
//! the routine `Traffic`, which draws each one every frame in our WASM module, 1s behind the
//! traffic host's reads.
//!
//! It loads no profile, so it shares traffic in any aircraft, but a profile's unload closes its
//! connection with every feature's. Register it after every crate of the platform.

mod count;
mod host;
mod packs;
mod receive;
mod wire;

use clients::ClientsUnit;
use kernel::{Cx, Registry, TimerId, View};
use messages::traffic::{self as messages_traffic, Batch, HOST, Identified, TrafficSlice};
use network::{LinkUp, NetUnit, Sender};
use profile_loader::ProfileUnloaded;
use session::{FlightChanged, KeyChanged, Session, SessionEnded, SessionUnit};
use sim_service::{SimEvent, SimUnit};

use crate::count::Counting;
use crate::host::Hosting;
use crate::receive::Receiving;

/// The feature's state.
#[derive(Default)]
pub struct Traffic {
    /// While this pilot is the traffic host and in the flight.
    hosting: Option<Hosting>,
    receiving: Receiving,
    counting: Counting,
    listing: packs::Listing,
    /// This PC's traffic packs, once a page has asked for them.
    packs: Option<Vec<messages::traffic::Pack>>,
}

/// Registers traffic.
pub fn register(r: &mut Registry) {
    r.unit::<Traffic>("traffic")
        // The Traffic tab, src/features/traffic/efb/part.tsx, finds the role by this label, so
        // change both together.
        .role_key(HOST, "Share my traffic")
        .channel(messages_traffic::IDENTITIES, Traffic::on_identity)
        .channel(messages_traffic::STATES, Traffic::on_states)
        .on_sim(Traffic::on_sim)
        .on::<KeyChanged>(|me, changed, cx| {
            if changed.key == HOST.number {
                me.settle(cx);
            }
        })
        .on::<FlightChanged>(|me, _, cx| me.settle(cx))
        .on::<SessionEnded>(|me, _, cx| me.settle(cx))
        // The platform closes every feature's connection once a profile's unload is heard,
        // traffic's too, and the close takes the copies, their definitions, and every read
        // that was out (record/areas/architecture/02-code-map.md, "A connection for each
        // feature, for each load").
        .on::<ProfileUnloaded>(|me, _, cx| me.connection_gone(cx))
        .on::<LinkUp>(Traffic::link_up)
        .command(messages_traffic::LIST_PACKS, packs::list)
        .client_state(messages_traffic::SLICE, Traffic::slice);
}

impl Traffic {
    /// Follows the key and this pilot's flight: the traffic host polls while it's in the
    /// flight, and every other machine shows the key's member's copies while its pilot is.
    fn settle(&mut self, cx: &mut Cx) {
        let session = cx.read::<Session>();
        let me = session.me();
        let holder = session.key(HOST).flatten();
        let in_flight = me.is_some_and(|m| session.in_flight(&m));
        let host = in_flight && me.is_some() && holder == me;
        let from = holder.filter(|h| Some(*h) != me);
        if me.is_none() {
            self.receiving.clear(cx);
        }
        // A receiving pilot who takes the role has their copies removed first, and the poll
        // carries none of them while their removal lands.
        let removed = self.receiving.settle(from, in_flight, cx);
        self.counting.settle(self.receiving.shown().is_some(), cx);
        match (host, self.hosting.take()) {
            (true, None) => self.hosting = Some(Hosting::start(removed, cx)),
            (true, Some(hosting)) => self.hosting = Some(hosting),
            (false, Some(hosting)) => hosting.stop(!in_flight, cx),
            (false, None) => {}
        }
    }

    /// Traffic's connection went, lost or closed by a profile's unload, with everything traffic
    /// had in the sim: each copy is created again at its next state, and each object the host
    /// was reading is read again at the next poll.
    fn connection_gone(&mut self, cx: &mut Cx) {
        self.receiving.lost(cx);
        if let Some(hosting) = &mut self.hosting {
            hosting.lost();
        }
    }

    pub(crate) fn poll_tick(me: &mut Traffic, timer: TimerId, cx: &mut Cx) {
        if let Some(hosting) = &mut me.hosting {
            hosting.tick(timer, cx);
        }
    }

    pub(crate) fn upkeep(me: &mut Traffic, timer: TimerId, cx: &mut Cx) {
        me.receiving.upkeep(timer, cx);
    }

    pub(crate) fn count_tick(me: &mut Traffic, timer: TimerId, cx: &mut Cx) {
        me.counting.tick(timer, cx);
    }

    fn link_up(me: &mut Traffic, up: &LinkUp, cx: &mut Cx) {
        if let Some(hosting) = &mut me.hosting {
            hosting.link_up(up.member.pilot, cx);
        }
    }

    fn on_identity(me: &mut Traffic, from: Sender, identified: Identified, cx: &mut Cx) {
        me.receiving
            .identity(from, identified.object, identified.identity, cx);
    }

    fn on_states(me: &mut Traffic, from: Sender, batch: Batch, cx: &mut Cx) {
        me.receiving.states(from, batch.base, &batch.states, cx);
    }

    fn on_sim(me: &mut Traffic, event: SimEvent, cx: &mut Cx) {
        match event {
            SimEvent::Polled {
                call,
                object,
                values,
                entry,
                out_of,
            } => {
                let own = me.receiving.objects();
                let taken = me
                    .hosting
                    .as_mut()
                    .is_some_and(|h| h.polled(call, object, &values, (entry, out_of), &own, cx));
                if !taken {
                    me.counting
                        .polled(call, object, &values, (entry, out_of), &own);
                }
            }
            SimEvent::Values { watch, values } => {
                if let Some(hosting) = &mut me.hosting {
                    hosting.identity(watch, &values, cx);
                }
            }
            SimEvent::Created { call, object } => {
                // A copy that went while its create was out finds no copy waiting for it. A
                // pilot who took the role meanwhile could poll it before its removal lands, so
                // their poll skips it too.
                let waited = me.receiving.created(call, object, cx);
                if !waited {
                    me.receiving.orphan(object, cx);
                    if let Some(hosting) = &mut me.hosting {
                        hosting.removing(object);
                    }
                }
            }
            SimEvent::Exception {
                call: Some(call),
                exception,
                index,
            } => {
                let hosts = me.hosting.as_mut().is_some_and(|h| h.refused(call));
                if !hosts && !me.receiving.refused(call, cx) {
                    // A release, which failed on every `StaticObject` our probes created while
                    // their freeze held anyway, or a write of a copy's dress
                    // (record/areas/traffic-atc/results/2026-10-17-sdk-and-probes.txt, section B).
                    tracing::info!(exception, index, "the sim refused a call of traffic's");
                }
            }
            SimEvent::Exception {
                call: None,
                exception,
                index,
            } => {
                tracing::info!(exception, index, "the sim refused a call of traffic's");
            }
            SimEvent::Failed { call } => {
                if let Some(hosting) = &mut me.hosting {
                    hosting.refused(call);
                }
            }
            SimEvent::Lost => me.connection_gone(cx),
            _ => {}
        }
    }

    fn slice(me: &Traffic, _: &View) -> TrafficSlice {
        let receiving = me.receiving.shown().is_some();
        TrafficSlice {
            missing: if receiving { me.receiving.missing() } else { 0 },
            others: if receiving { me.counting.others } else { 0 },
            packs: me.packs.clone(),
        }
    }
}
