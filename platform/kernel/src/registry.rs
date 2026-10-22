//! How a crate adds its unit to the core, and the tables the kernel keeps of what each unit
//! registered.

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::marker::PhantomData;
use std::rc::Rc;

use crate::Moment;
use crate::edge::{Input, SourceId};
use crate::run::{Cx, View};

pub(crate) type SourceFn = Box<dyn Fn(&mut dyn Any, &Input, &mut Cx)>;
pub(crate) type MomentFn = Box<dyn Fn(&mut dyn Any, &dyn Any, &mut Cx)>;
pub(crate) type FileFn = Box<dyn Fn(&mut dyn Any, Option<&[u8]>, &mut Cx)>;
pub(crate) type DecideFn = Box<dyn Fn(&mut dyn Any, Box<dyn Any>, &mut Cx)>;
pub(crate) type BuildFn = Box<dyn Fn(&dyn Any, &View) -> Option<Box<dyn Any>>>;
pub(crate) type GuardFn = Box<dyn Fn(&dyn Any, &dyn Any, &View) -> Result<(), String>>;
pub(crate) type HandlerFn<A> = Rc<dyn Fn(&mut dyn Any, A, &mut Cx)>;

/// A unit's place in the registry, from 0, in the order the units registered.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UnitId(pub(crate) u32);

impl UnitId {
    pub fn place(self) -> u32 {
        self.0
    }
}

pub(crate) struct UnitInfo {
    pub(crate) name: &'static str,
}

pub(crate) struct Registered<F> {
    pub(crate) unit: u32,
    pub(crate) f: F,
}

pub(crate) struct StartFile {
    pub(crate) unit: u32,
    pub(crate) name: &'static str,
    pub(crate) f: FileFn,
}

pub(crate) struct Request {
    pub(crate) decider: u32,
    pub(crate) decide: DecideFn,
    pub(crate) build: BuildFn,
    pub(crate) guards: Vec<Registered<GuardFn>>,
}

/// Every unit of the core and what each registered. The core's `main` builds it by calling
/// each crate's `register`, the platform's crates first, from the kernel up, then the
/// features, and hands it to `Kernel::new`.
///
/// The tables are `HashMap`s for finding an entry by its type, and `Vec`s for anything the
/// kernel walks in order, since a `HashMap`'s order is seeded at random.
pub struct Registry {
    pub(crate) units: Vec<UnitInfo>,
    pub(crate) states: Vec<Option<Box<dyn Any>>>,
    pub(crate) by_type: HashMap<TypeId, u32>,
    /// One for each source, by its number, `None` for the kernel's own.
    pub(crate) sources: Vec<Option<Registered<SourceFn>>>,
    pub(crate) source_keys: HashMap<TypeId, SourceId>,
    pub(crate) moments: HashMap<TypeId, Vec<Registered<MomentFn>>>,
    pub(crate) start_files: Vec<StartFile>,
    pub(crate) requests: Vec<Request>,
    pub(crate) request_by_type: HashMap<TypeId, usize>,
}

impl Default for Registry {
    fn default() -> Registry {
        Registry::new()
    }
}

impl Registry {
    /// A registry with the kernel's own three sources, `FIRST`, `TIMERS`, and `JOBS`, so
    /// each unit's sources are numbered after them.
    pub fn new() -> Registry {
        Registry {
            units: Vec::new(),
            states: Vec::new(),
            by_type: HashMap::new(),
            sources: vec![None, None, None],
            source_keys: HashMap::new(),
            moments: HashMap::new(),
            start_files: Vec::new(),
            requests: Vec::new(),
            request_by_type: HashMap::new(),
        }
    }

    /// Adds a unit whose state, `S`, starts as `S::default()`. Each unit has a type of
    /// state of its own, which is how other units read it.
    pub fn unit<S: Default + 'static>(&mut self, name: &'static str) -> Unit<'_, S> {
        assert!(
            !self.by_type.contains_key(&TypeId::of::<S>()),
            "unit {name}'s state, {}, should be no other unit's",
            std::any::type_name::<S>()
        );
        assert!(
            !self.units.iter().any(|u| u.name == name),
            "unit {name} should register once"
        );
        let id = u32::try_from(self.units.len()).expect("the core should have under 2^32 units");
        self.units.push(UnitInfo { name });
        self.states.push(Some(Box::new(S::default())));
        self.by_type.insert(TypeId::of::<S>(), id);
        Unit {
            registry: self,
            id,
            state: PhantomData,
        }
    }

    /// A unit's state while the units register, so a crate of the platform's can keep in
    /// its own state what other units register with it, such as the clients crate's
    /// commands.
    pub fn state_mut<T: 'static>(&mut self) -> &mut T {
        let unit = self.unit_of::<T>();
        self.states[unit as usize]
            .as_mut()
            .and_then(|s| s.downcast_mut())
            .expect("a unit's state should be in its slot while the units register")
    }

    pub(crate) fn unit_of<T: 'static>(&self) -> u32 {
        *self
            .by_type
            .get(&TypeId::of::<T>())
            .unwrap_or_else(|| panic!("no unit holds {} as its state", std::any::type_name::<T>()))
    }
}

/// One unit, while it registers.
pub struct Unit<'r, S> {
    registry: &'r mut Registry,
    id: u32,
    state: PhantomData<fn() -> S>,
}

impl<S: 'static> Unit<'_, S> {
    pub fn id(&self) -> UnitId {
        UnitId(self.id)
    }

    /// The whole registry, for a crate of the platform's that adds its own hooks to `Unit`
    /// through an extension trait and keeps them in its own state, through `state_mut`.
    pub fn registry(&mut self) -> &mut Registry {
        self.registry
    }

    /// Calls `f` for each moment `M` that a crate raises.
    pub fn on<M: Moment>(&mut self, f: fn(&mut S, &M, &mut Cx)) -> &mut Self {
        let f: MomentFn = Box::new(move |state, moment, cx| {
            f(
                downcast_mut(state),
                moment
                    .downcast_ref()
                    .expect("a moment should be its own type"),
                cx,
            )
        });
        self.registry
            .moments
            .entry(TypeId::of::<M>())
            .or_default()
            .push(Registered { unit: self.id, f });
        self
    }

    /// Takes inputs from outside the core, which the edge pushes under the source this
    /// returns. `K` names the source, so the edge finds its number through
    /// `Kernel::source::<K>()`; it's usually an empty type in the unit's crate.
    pub fn source<K: 'static>(&mut self, f: fn(&mut S, &Input, &mut Cx)) -> SourceId {
        let id = SourceId(
            u32::try_from(self.registry.sources.len())
                .expect("the core should have under 2^32 sources"),
        );
        assert!(
            self.registry
                .source_keys
                .insert(TypeId::of::<K>(), id)
                .is_none(),
            "source {} should register once",
            std::any::type_name::<K>()
        );
        let f: SourceFn = Box::new(move |state, input, cx| f(downcast_mut(state), input, cx));
        self.registry
            .sources
            .push(Some(Registered { unit: self.id, f }));
        id
    }

    /// Hands the unit a file in the core's data folder as the core starts, such as the
    /// settings: the edge reads it into the core's first input, so a replay needs no file.
    /// `f` gets `None` when the file is missing.
    pub fn start_file(
        &mut self,
        name: &'static str,
        f: fn(&mut S, Option<&[u8]>, &mut Cx),
    ) -> &mut Self {
        let f: FileFn = Box::new(move |state, bytes, cx| f(downcast_mut(state), bytes, cx));
        self.registry.start_files.push(StartFile {
            unit: self.id,
            name,
            f,
        });
        self
    }

    /// Declares a request `R` this unit decides, for a crate of the platform's, such as the
    /// session crate's control. `decide` runs once every guard on a request allows it, and
    /// `build` gives the request this pilot would make if they asked now, so the kernel can
    /// keep each request's verdict current for the apps to show
    /// (record/areas/architecture/02-code-map.md, "Guards").
    pub fn request<R: 'static>(
        &mut self,
        decide: fn(&mut S, R, &mut Cx),
        build: fn(&S, &View) -> Option<R>,
    ) -> &mut Self {
        let decide: DecideFn = Box::new(move |state, request, cx| {
            let request = *request
                .downcast::<R>()
                .expect("a request should be its own type");
            decide(downcast_mut(state), request, cx);
        });
        let build: BuildFn = Box::new(move |state, view| {
            build(downcast_ref(state), view).map(|r| Box::new(r) as Box<dyn Any>)
        });
        let index = self.registry.requests.len();
        assert!(
            self.registry
                .request_by_type
                .insert(TypeId::of::<R>(), index)
                .is_none(),
            "request {} should be declared once",
            std::any::type_name::<R>()
        );
        self.registry.requests.push(Request {
            decider: self.id,
            decide,
            build,
            guards: Vec::new(),
        });
        self
    }

    /// Adds a check that can refuse a request `R`, with the reason the apps show. The
    /// crate that decides `R` registers before any unit that guards it, since the platform
    /// registers from the kernel up and the features after it.
    pub fn guard<R: 'static>(&mut self, f: fn(&S, &R, &View) -> Result<(), String>) -> &mut Self {
        let index = *self
            .registry
            .request_by_type
            .get(&TypeId::of::<R>())
            .unwrap_or_else(|| {
                panic!(
                    "request {} should be declared before a unit guards it",
                    std::any::type_name::<R>()
                )
            });
        let f: GuardFn = Box::new(move |state, request, view| {
            f(
                downcast_ref(state),
                request
                    .downcast_ref()
                    .expect("a request should be its own type"),
                view,
            )
        });
        self.registry.requests[index]
            .guards
            .push(Registered { unit: self.id, f });
        self
    }

    /// A handler another unit can have the kernel call, as the clients crate calls the
    /// handler a feature registered for a command. The call runs once the calling handler
    /// has returned (`Cx::call_handler`).
    pub fn handler<A: 'static>(&self, f: fn(&mut S, A, &mut Cx)) -> Handler<A> {
        Handler {
            unit: self.id,
            f: Rc::new(move |state, arg, cx| f(downcast_mut(state), arg, cx)),
        }
    }
}

/// A unit's handler that another unit can call with an argument `A`.
pub struct Handler<A> {
    pub(crate) unit: u32,
    pub(crate) f: HandlerFn<A>,
}

impl<A> Clone for Handler<A> {
    fn clone(&self) -> Self {
        Handler {
            unit: self.unit,
            f: self.f.clone(),
        }
    }
}

impl<A> Handler<A> {
    /// The unit whose handler this is.
    pub fn unit(&self) -> UnitId {
        UnitId(self.unit)
    }
}

pub(crate) fn downcast_mut<S: 'static>(state: &mut dyn Any) -> &mut S {
    state
        .downcast_mut()
        .expect("a handler should get its own unit's state")
}

pub(crate) fn downcast_ref<S: 'static>(state: &dyn Any) -> &S {
    state
        .downcast_ref()
        .expect("a handler should get its own unit's state")
}
