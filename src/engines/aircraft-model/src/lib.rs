//! An aircraft's own model, read from its package: the interior and exterior glTF, posed by
//! the animation and visibility code in its behavior files, with a ray cast into it, and its
//! yokes' grips, so a pilot's figure reaches where they click and holds the yoke in front of
//! its seat (record/areas/avatars/01-avatars.md, "The aircraft model").
//!
//! It reads no file. A job of the core's edge reads them through `wanted`, which says what to
//! read next given what was read, then `build` turns them into one buffer, which the loop
//! takes with `Model::take` and reads in place.

mod behavior;
mod build;
mod files;
mod model;
mod xml;
mod yokes;

pub use files::Read;
pub use model::{Hit, Model, Report, Scene, Yoke, YokePart, YokeStage};
pub use msfs_rpn::Var;
pub use ray_cast::{Affine, Ray, Vec3};

use serde::{Deserialize, Serialize};

/// Which aircraft to build, and what its yokes' grips are found from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Aircraft {
    /// The folder of the package that holds the aircraft, on disk.
    pub package: String,
    /// The aircraft's path below `SimObjects\Airplanes\`, its folder then its preset's path,
    /// as sim awareness gives it, such as `pa24-250/presets/a2a/pa24-250`.
    pub path: String,
    /// `A:TITLE`, which picks the `[FLTSIM.n]` section, and the model folder it names.
    pub title: Option<String>,
    /// Each seat's eye in the aircraft's frame, which a yoke's grips are found along the line
    /// from, by the eye on the yoke's side of the centerline.
    pub eyes: Vec<Vec3>,
    /// The figure's hand's radius, in meters, which a grip sits out from the horn's surface.
    pub hand_radius: f32,
}

/// The files the model needs that `read` hasn't read yet, given those it has. Empty once
/// every file is read, or once the walk can go no further, which `build` then reports.
pub fn wanted<'a>(aircraft: &Aircraft, read: &dyn Fn(&str) -> Read<'a>) -> Vec<String> {
    let mut wanted = files::walk(
        &aircraft.package,
        &aircraft.path,
        aircraft.title.as_deref(),
        read,
    )
    .wanted;
    wanted.dedup();
    wanted
}

/// Builds the model from every file `wanted` asked for, into the buffer `Model::take` takes.
pub fn build<'a>(aircraft: &Aircraft, read: &dyn Fn(&str) -> Read<'a>) -> Result<Vec<u8>, String> {
    build::build(aircraft, read)
}

#[cfg(test)]
mod tests;
