//! What a feature calls: `on_sim` at registration, and in a handler `cx.sim()` and
//! `cx.module()`. Each call returns at once, the kernel runs it on the service once the
//! feature's handler has returned, and whatever the sim answers reaches the feature's
//! `on_sim` with the call's handle (record/areas/core/03-sim-seam-and-wasm-module.md, "What
//! a feature calls").

use bytemuck::Pod;
use kernel::{Cx, Handle, Unit, UnitId};
use messages::module::RoutineId;
use sim_client::message::{Camera, Data};
use sim_client::{InitPosition, Period, Value, Var};
use simconnect_types::SIMCONNECT_OBJECT_ID_USER;

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
        self.watch_on(SIMCONNECT_OBJECT_ID_USER, vars, period)
    }

    /// Watches `vars` on the object `object`, such as `SIMCONNECT_OBJECT_ID_USER_AVATAR`, the
    /// pilot on foot, or an object the unit created.
    pub fn watch_on(&self, object: u32, vars: &[Var], period: Period) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(
            SimService::watch_for,
            (origin, object, vars.to_vec(), period),
        );
        handle
    }

    /// Writes `values` into the variables of the watch `watch`, one for each, in its order.
    pub fn write(&self, watch: Handle, values: Vec<Value>) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(SimService::write_for, (origin, watch, values));
        handle
    }

    /// Watches each of `vars` on the pilot's aircraft, on a definition of its own, so a refused
    /// variable fails only its own watch and a write takes no other variable with it. One call
    /// of the service makes them all, since a profile names any number of them and the kernel
    /// allows 1,000 queued calls in one input. Returns a handle for each, in order.
    pub fn watch_each(&self, vars: &[Var], period: Period) -> Vec<Handle> {
        let watches: Vec<(Origin, Var)> = vars
            .iter()
            .map(|var| (self.origin().1, var.clone()))
            .collect();
        let handles = watches.iter().filter_map(|(o, _)| o.handle).collect();
        self.cx.call(
            SimService::watch_each_for,
            (watches, SIMCONNECT_OBJECT_ID_USER, period),
        );
        handles
    }

    /// A definition of `var` on the pilot's aircraft that only `write` uses, for a target no
    /// watch reads.
    pub fn define(&self, var: &Var) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(SimService::define_for, (origin, var.clone()));
        handle
    }

    /// Sends the sim's event `event`, such as `K:KOHLSMAN_SET`, with `values`, to the pilot's
    /// aircraft, by the legacy call for one value or none and by `_EX1` for more.
    pub fn key(&self, event: &str, values: &[u32]) -> Handle {
        self.key_on(SIMCONNECT_OBJECT_ID_USER, event, values)
    }

    /// Sends the sim's event `event` to the object `object`, as avatars freezes each figure
    /// it creates.
    pub fn key_on(&self, object: u32, event: &str, values: &[u32]) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(
            SimService::key_for,
            (origin, object, event.to_string(), values.to_vec()),
        );
        handle
    }

    /// Hears each of the sim's `events` from now on, through a group that never masks. Each
    /// occurrence arrives as `SimEvent::Heard` with that event's handle. Returns a handle for
    /// each, in order, from one call of the service, as `watch_each` does.
    pub fn listen(&self, events: &[String]) -> Vec<Handle> {
        let listens: Vec<(Origin, String)> = events
            .iter()
            .map(|event| (self.origin().1, event.clone()))
            .collect();
        let handles = listens.iter().filter_map(|(o, _)| o.handle).collect();
        self.cx.call(SimService::listen_for, listens);
        handles
    }

    /// Reads each of the input events `names`, once and then at each change, as
    /// `SimEvent::Input` with that name's handle, or `SimEvent::Failed` for a name the loaded
    /// aircraft doesn't have. Returns a handle for each, in order.
    pub fn input(&self, names: &[String]) -> Vec<Handle> {
        let reads: Vec<(Origin, String)> = names
            .iter()
            .map(|name| (self.origin().1, name.clone()))
            .collect();
        let handles = reads.iter().filter_map(|(o, _)| o.handle).collect();
        self.cx.call(SimService::input_for, reads);
        handles
    }

    /// Creates an object of the SimObject titled `title`, such as `DUALINPUT_FIGURE_PILOT`, in
    /// `livery`, at `at`. Its ID arrives as `SimEvent::Created` with this handle, or an
    /// exception does, as for a title the sim lacks. The object goes with the unit's
    /// connection.
    pub fn create_ai(&self, title: &str, livery: &str, at: InitPosition) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(
            SimService::create_for,
            (origin, title.to_string(), livery.to_string(), at),
        );
        handle
    }

    /// Removes an object the unit created.
    pub fn remove(&self, object: u32) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(SimService::remove_for, (origin, object));
        handle
    }

    /// Reads the camera once, in `referential`, such as
    /// `SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT`. It arrives as `SimEvent::Camera` with this
    /// handle.
    pub fn camera(&self, referential: u32) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(SimService::camera_for, (origin, referential));
        handle
    }

    /// Subscribes to the sim's `Frame` event, which arrives as `SimEvent::Frame` with this
    /// handle once each frame the sim draws.
    pub fn frames(&self) -> Handle {
        let (handle, origin) = self.origin();
        self.cx.call(SimService::frames_for, origin);
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

    /// Reads each report `routine` makes, a `R`, as the module writes it: each arrives as
    /// `SimEvent::Report` with this handle. The read lasts as long as the unit's connection,
    /// so a unit calls it each time it starts the routine, and a second call for the same
    /// routine only moves its reports to the new handle.
    pub fn reports<R: Pod>(&self, routine: RoutineId) -> Handle {
        let handle = self.cx.handle();
        let origin = Origin {
            unit: self.cx.unit(),
            handle: Some(handle),
        };
        let size = size_of::<R>() as u32;
        self.cx
            .call(SimService::reports_for, (origin, routine, size));
        handle
    }
}

impl SimService {
    /// Maps the routine's report slot on the unit's connection and asks for it each time the
    /// module sets it, or, when the connection reads it already, hands its reports to the new
    /// call.
    fn reports_for(
        me: &mut SimService,
        (origin, routine, size): (Origin, RoutineId, u32),
        cx: &mut Cx,
    ) {
        let Some(call) = origin.handle else {
            return;
        };
        if me.client(origin, cx).is_none() {
            return;
        }
        let Some(holder) = me.holders.get_mut(&origin.unit.place()) else {
            return;
        };
        if let Some(read) = holder
            .reports
            .values_mut()
            .find(|(name, _)| *name == routine.name)
        {
            read.1 = call;
            return;
        }
        let (area, mut ops) = holder.client.area(&origin, &routine.report_slot(), size);
        let (request, op) = holder.client.read_area(&origin, area);
        ops.push(op);
        holder.reports.insert(request, (routine.name, call));
        me.make(origin, ops, cx);
    }

    /// A routine's report, which the module wrote into its report slot: the unit's latest
    /// `reports` call for the routine hears it.
    pub(crate) fn report_read(&self, unit: UnitId, request: u32, bytes: Vec<u8>, cx: &Cx) {
        if let Some(&(_, call)) = self
            .holders
            .get(&unit.place())
            .and_then(|h| h.reports.get(&request))
        {
            self.tell(unit, SimEvent::Report { call, bytes }, cx);
        }
    }

    fn watch_for(
        me: &mut SimService,
        (origin, object, vars, period): (Origin, u32, Vec<Var>, Period),
        cx: &mut Cx,
    ) {
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        let (watch, ops) = client.watch_on(&origin, object, &vars, period);
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

    fn define_for(me: &mut SimService, (origin, var): (Origin, Var), cx: &mut Cx) {
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        let (watch, ops) = client.define(&origin, &var);
        if let (Some(holder), Some(handle)) =
            (me.holders.get_mut(&origin.unit.place()), origin.handle)
        {
            holder.watches.insert(handle, watch);
        }
        me.make(origin, ops, cx);
    }

    fn watch_each_for(
        me: &mut SimService,
        (watches, object, period): (Vec<(Origin, Var)>, u32, Period),
        cx: &mut Cx,
    ) {
        for (origin, var) in watches {
            SimService::watch_for(me, (origin, object, vec![var], period), cx);
        }
    }

    fn key_for(
        me: &mut SimService,
        (origin, object, event, values): (Origin, u32, String, Vec<u32>),
        cx: &mut Cx,
    ) {
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        let ops = client.key_values(&origin, object, &event, &values);
        me.make(origin, ops, cx);
    }

    fn listen_for(me: &mut SimService, listens: Vec<(Origin, String)>, cx: &mut Cx) {
        for (origin, event) in listens {
            let Some(client) = me.client(origin, cx) else {
                continue;
            };
            let (client_event, ops) = client.listen(&origin, &event);
            if let (Some(holder), Some(handle)) =
                (me.holders.get_mut(&origin.unit.place()), origin.handle)
            {
                holder.listens.insert(client_event, handle);
            }
            me.make(origin, ops, cx);
        }
    }

    fn input_for(me: &mut SimService, reads: Vec<(Origin, String)>, cx: &mut Cx) {
        for (origin, name) in reads {
            let Some(client) = me.client(origin, cx) else {
                continue;
            };
            match client.input(&origin, &name) {
                sim_client::InputAsk::Waiting(ops) => me.make(origin, ops, cx),
                sim_client::InputAsk::Ready(ready) => me.input_ready(ready, cx),
            }
        }
    }

    /// One page of the list of input events: once the last has come, every read that waited
    /// for the list goes out by its name's hash.
    pub(crate) fn input_page(
        &mut self,
        unit: UnitId,
        request: u32,
        entry: u32,
        out_of: u32,
        events: Vec<sim_client::message::InputEvent>,
        cx: &Cx,
    ) {
        let Some(holder) = self.holders.get_mut(&unit.place()) else {
            return;
        };
        let readies = holder.client.input_page(request, entry, out_of, events);
        for ready in readies {
            self.input_ready(ready, cx);
        }
    }

    fn input_ready(&mut self, ready: sim_client::InputReady<Origin>, cx: &Cx) {
        let origin = ready.by;
        let Some(call) = origin.handle else {
            return;
        };
        let Some((request, hash)) = ready.found else {
            tracing::info!(
                name = ready.name,
                "the loaded aircraft has no input event of this name"
            );
            self.tell(origin.unit, SimEvent::Failed { call }, cx);
            return;
        };
        if let Some(holder) = self.holders.get_mut(&origin.unit.place()) {
            holder.input_reads.insert(request, call);
            holder.inputs.entry(hash).or_default().push(call);
        }
        self.make(origin, ready.ops, cx);
    }

    pub(crate) fn input_value(&mut self, unit: UnitId, request: u32, value: Value, cx: &Cx) {
        let Some(call) = self
            .holders
            .get_mut(&unit.place())
            .and_then(|h| h.input_reads.remove(&request))
        else {
            return;
        };
        let first = true;
        self.tell(unit, SimEvent::Input { call, value, first }, cx);
    }

    pub(crate) fn input_changed(&mut self, unit: UnitId, hash: u64, value: Value, cx: &Cx) {
        let calls = self
            .holders
            .get(&unit.place())
            .and_then(|h| h.inputs.get(&hash))
            .cloned()
            .unwrap_or_default();
        for call in calls {
            let value = value.clone();
            let first = false;
            self.tell(unit, SimEvent::Input { call, value, first }, cx);
        }
    }

    /// An event the unit listens for, which the sim handed to its group.
    pub(crate) fn heard(&self, unit: UnitId, event: u32, data: [u32; 5], cx: &Cx) {
        if let Some(&call) = self
            .holders
            .get(&unit.place())
            .and_then(|h| h.listens.get(&event))
        {
            self.tell(unit, SimEvent::Heard { call, data }, cx);
        }
    }

    fn create_for(
        me: &mut SimService,
        (origin, title, livery, at): (Origin, String, String, InitPosition),
        cx: &mut Cx,
    ) {
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        let (request, op) = client.create(&title, &livery, at);
        if let (Some(holder), Some(handle)) =
            (me.holders.get_mut(&origin.unit.place()), origin.handle)
        {
            holder.creates.insert(request, handle);
        }
        me.make(origin, vec![op], cx);
    }

    fn remove_for(me: &mut SimService, (origin, object): (Origin, u32), cx: &mut Cx) {
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        let op = client.remove(object);
        if let Some(holder) = me.holders.get_mut(&origin.unit.place()) {
            holder.objects.remove(&object);
        }
        me.make(origin, vec![op], cx);
    }

    fn camera_for(me: &mut SimService, (origin, referential): (Origin, u32), cx: &mut Cx) {
        if me.client(origin, cx).is_none() {
            return;
        }
        if let (Some(holder), Some(handle)) =
            (me.holders.get_mut(&origin.unit.place()), origin.handle)
        {
            holder.cameras.push_back(handle);
        }
        me.make(origin, vec![sim_client::Op::CameraGet { referential }], cx);
    }

    fn frames_for(me: &mut SimService, origin: Origin, cx: &mut Cx) {
        let Some(client) = me.client(origin, cx) else {
            return;
        };
        let (event, op) = client.frames(&origin);
        if let (Some(holder), Some(handle)) =
            (me.holders.get_mut(&origin.unit.place()), origin.handle)
        {
            holder.frames.insert(event, handle);
        }
        me.make(origin, vec![op], cx);
    }

    /// An object a unit's create made: the create's handle, found by its request, hears the
    /// object's ID.
    pub(crate) fn assigned(&mut self, unit: UnitId, request: u32, object: u32, cx: &Cx) {
        let Some(holder) = self.holders.get_mut(&unit.place()) else {
            return;
        };
        let Some(call) = holder.creates.remove(&request) else {
            return;
        };
        holder.objects.insert(object);
        self.tell(unit, SimEvent::Created { call, object }, cx);
    }

    /// The camera's answer, which names no request, so it goes to the unit's oldest camera
    /// call still waiting. A call the sim refused leaves the queue with its exception, so the
    /// answers that follow still find their calls.
    pub(crate) fn camera_read(&mut self, unit: UnitId, camera: Camera, cx: &Cx) {
        let Some(call) = self
            .holders
            .get_mut(&unit.place())
            .and_then(|h| h.cameras.pop_front())
        else {
            return;
        };
        self.tell(unit, SimEvent::Camera { call, camera }, cx);
    }

    pub(crate) fn frame(&mut self, unit: UnitId, event: u32, rate: f32, speed: f32, cx: &Cx) {
        let Some(&call) = self
            .holders
            .get(&unit.place())
            .and_then(|h| h.frames.get(&event))
        else {
            return;
        };
        self.tell(unit, SimEvent::Frame { call, rate, speed }, cx);
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
            if self.aware.read == Some(data.request) {
                self.aware.read = None;
                self.title_read(&values, cx);
            } else if self.aware.tail_read == Some(data.request) {
                self.aware.tail_read = None;
                self.tail_read(&values);
            }
            return;
        }
        let Some(&(watch, once)) = holder.routes.get(&data.request) else {
            return;
        };
        // A read once is over with its answer, and avatars makes one each frame on foot.
        if once {
            holder.routes.remove(&data.request);
            holder.watches.remove(&watch);
        }
        self.tell(unit, SimEvent::Values { watch, values }, cx);
    }
}
