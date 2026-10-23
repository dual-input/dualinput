//! What a feature calls: `on_sim` at registration, and in a handler `cx.sim()` and
//! `cx.module()`. Each call returns at once, the kernel runs it on the service once the
//! feature's handler has returned, and whatever the sim answers reaches the feature's
//! `on_sim` with the call's handle (record/areas/core/03-sim-seam-and-wasm-module.md, "What
//! a feature calls").

use bytemuck::Pod;
use kernel::{Cx, Handle, Unit, UnitId};
use messages::module::RoutineId;
use sim_client::message::Data;
use sim_client::{Period, Value, Var};

use crate::connections::Origin;
use crate::{SimEvent, SimService};

/// Registers what a unit hears from the sim.
pub trait SimUnit {
    type State;
    /// Hands `f` each value, exception, and loss that comes for the unit's calls.
    fn on_sim(&mut self, f: fn(&mut Self::State, SimEvent, &mut Cx)) -> &mut Self;
}

impl<S: 'static> SimUnit for Unit<'_, S> {
    type State = S;

    fn on_sim(&mut self, f: fn(&mut S, SimEvent, &mut Cx)) -> &mut Self {
        let hook = self.handler(f);
        let unit = self.id().place();
        self.registry()
            .state_mut::<SimService>()
            .hooks
            .insert(unit, hook);
        self
    }
}

/// The sim's calls, from a handler.
pub trait SimCx<'k> {
    fn sim(&self) -> Sim<'_, 'k>;
    fn module(&self) -> ModuleCalls<'_, 'k>;
}

impl<'k> SimCx<'k> for Cx<'k> {
    fn sim(&self) -> Sim<'_, 'k> {
        Sim { cx: self }
    }

    fn module(&self) -> ModuleCalls<'_, 'k> {
        ModuleCalls { cx: self }
    }
}

/// The calling unit's calls of the sim, on its own connection, which the service opens at
/// its first call.
pub struct Sim<'c, 'k> {
    cx: &'c Cx<'k>,
}

impl Sim<'_, '_> {
    /// Watches `vars` on the pilot's aircraft, as one tagged definition: their values
    /// arrive as `SimEvent::Values` with this handle.
    pub fn watch(&self, vars: &[Var], period: Period) -> Handle {
        let (handle, origin) = self.origin();
        self.cx
            .call(SimService::watch_for, (origin, vars.to_vec(), period));
        handle
    }

    /// Writes `values` into the variables of the watch `watch`, one for each, in its order.
    pub fn write(&self, watch: Handle, values: Vec<Value>) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(SimService::write_for, (origin, watch, values));
        handle
    }

    /// Sends the sim's event `event`, such as `K:PAUSE_SET`, with one value, to the pilot's
    /// aircraft.
    pub fn key(&self, event: &str, value: u32) -> Handle {
        let (handle, origin) = self.origin();
        self.cx
            .call(SimService::key_for, (origin, event.to_string(), value));
        handle
    }

    /// A new handle, and the call's origin with it.
    fn origin(&self) -> (Handle, Origin) {
        let handle = self.cx.handle();
        let origin = Origin {
            unit: self.cx.unit(),
            handle: Some(handle),
        };
        (handle, origin)
    }
}

/// The calling unit's routines in our WASM module.
pub struct ModuleCalls<'c, 'k> {
    cx: &'c Cx<'k>,
}

impl ModuleCalls<'_, '_> {
    /// Feeds `routine` a new `slot`, which the service writes into the routine's slot on the
    /// unit's connection, and again every 200ms until the next feed or `end`.
    pub fn feed<S: Pod>(&self, routine: RoutineId, slot: &S) {
        let body = bytemuck::bytes_of(slot).to_vec();
        self.cx
            .call(SimService::feed, (self.cx.unit(), routine, body));
    }

    /// Ends `routine`, which the routine host drops at its next frame.
    pub fn end(&self, routine: RoutineId) {
        self.cx.call(SimService::end, (self.cx.unit(), routine));
    }
}

impl SimService {
    fn watch_for(
        me: &mut SimService,
        (origin, vars, period): (Origin, Vec<Var>, Period),
        cx: &mut Cx,
    ) {
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        let (watch, ops) = client.watch(&origin, &vars, period);
        if let (Some(holder), Some(handle)) =
            (me.holders.get_mut(&origin.unit.place()), origin.handle)
        {
            holder
                .routes
                .insert(watch.request, (handle, period == Period::Once));
            holder.watches.insert(handle, watch);
        }
        me.make(origin, ops, cx);
    }

    fn write_for(
        me: &mut SimService,
        (origin, watch, values): (Origin, Handle, Vec<Value>),
        cx: &mut Cx,
    ) {
        let found = me
            .holders
            .get(&origin.unit.place())
            .and_then(|h| h.watches.get(&watch))
            .copied();
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        match found.and_then(|watch| client.write(watch, &values)) {
            Some(op) => me.make(origin, vec![op], cx),
            None => {
                tracing::warn!(
                    unit = origin.unit.place(),
                    "a write named no watch of its unit, or values that don't fit it"
                );
                if let Some(call) = origin.handle {
                    me.tell(origin.unit, SimEvent::Failed { call }, cx);
                }
            }
        }
    }

    fn key_for(me: &mut SimService, (origin, event, value): (Origin, String, u32), cx: &mut Cx) {
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        let ops = client.key(&origin, &event, value);
        me.make(origin, ops, cx);
    }

    /// A watch's values: the platform's own once-reads, or a unit's watch, routed by the
    /// request that asked for them.
    pub(crate) fn values(&mut self, unit: UnitId, data: &Data, cx: &Cx) {
        let me = self.me();
        let Some(holder) = self.holders.get_mut(&unit.place()) else {
            return;
        };
        let Some(values) = holder.client.values(data) else {
            return;
        };
        if unit == me {
            if self.platform.title == Some(data.request) {
                self.platform.title = None;
                let aircraft = cx
                    .read::<crate::SimAwareness>()
                    .aircraft
                    .as_ref()
                    .map(|a| a.path.clone());
                if let Some((_, Value::Text(title))) = values.first() {
                    tracing::info!(title, aircraft, "the loaded aircraft's title");
                }
            } else if self.platform.freeze == Some(data.request) {
                self.platform.freeze = None;
                self.freeze_read(&values, cx);
            }
            return;
        }
        let Some(&(watch, once)) = holder.routes.get(&data.request) else {
            return;
        };
        if once {
            holder.routes.remove(&data.request);
        }
        self.tell(unit, SimEvent::Values { watch, values }, cx);
    }
}
