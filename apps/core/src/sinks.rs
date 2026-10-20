//! Where each output goes: one sink for each output type, which hands the output to the
//! edge that carries it out.

use std::any::{Any, TypeId};
use std::collections::HashMap;

use kernel::Output;

type Sink = Box<dyn FnMut(Box<dyn Any + Send>) + Send>;

#[derive(Default)]
pub struct Sinks {
    by_type: HashMap<TypeId, Sink>,
}

impl Sinks {
    pub fn on<T: 'static>(&mut self, mut sink: impl FnMut(T) + Send + 'static) {
        let sink: Sink = Box::new(move |value| {
            sink(
                *value
                    .downcast::<T>()
                    .expect("a sink should get its own type"),
            );
        });
        self.by_type.insert(TypeId::of::<T>(), sink);
    }

    /// Hands `output` to its sink. An output of a type no edge carries out is a unit's
    /// output that `main` never wired, which is a bug.
    pub fn carry(&mut self, output: Output) {
        let Some(sink) = self.by_type.get_mut(&output.value_type()) else {
            panic!(
                "no edge carries out {}, which unit {} put out",
                output.type_name(),
                output.unit_name()
            )
        };
        sink(output.into_value());
    }
}
