//! Casting a ray into a model made of many meshes, each placed by its node's transform: one
//! BVH, a tree of boxes, for each distinct mesh in its own space, built once, and a cast that
//! turns the ray into each mesh's space, so a pose that moves nodes rebuilds nothing
//! (record/areas/avatars/01-avatars.md, "Its engines").
//!
//! We build our own rather than take `bvh`, `obvhs`, or `parry3d`: `bvh` turns on rayon by
//! default and takes about 415 MB at 2.6 million triangles, `obvhs` reads the clock in one of
//! its builders, and `parry3d` brings more than 10 crates, while the loop's Clippy rules see
//! inside none of them (record/areas/avatars/log.md, 2026-10-17). The BVH is the usual binned
//! surface-area one: each split is the one of 12 planes along a box's longest axis that
//! costs the least, counting each child's triangles by its box's surface area.
//!
//! A cast reads its nodes and triangles through `Mesh`, so they can sit in a flat buffer that
//! the core's loop reads in place.

mod affine;
mod build;
mod cast;

pub use affine::Affine;
pub use build::{Built, build};
pub use cast::{Candidate, Hit, Mesh, Ray, cast, cast_mesh};

use bytemuck::{Pod, Zeroable};

pub type Vec3 = [f32; 3];

/// A box, by its corners.
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Aabb {
    pub min: Vec3,
    pub max: Vec3,
}

impl Aabb {
    /// A box that holds nothing, which `grow` takes to the first point.
    pub const EMPTY: Aabb = Aabb {
        min: [f32::INFINITY; 3],
        max: [f32::NEG_INFINITY; 3],
    };

    pub fn grow(&mut self, p: Vec3) {
        self.join(&Aabb { min: p, max: p });
    }

    pub fn join(&mut self, other: &Aabb) {
        for (lo, other) in self.min.iter_mut().zip(other.min) {
            *lo = lo.min(other);
        }
        for (hi, other) in self.max.iter_mut().zip(other.max) {
            *hi = hi.max(other);
        }
    }

    pub fn is_empty(&self) -> bool {
        (0..3).any(|k| self.min[k] > self.max[k])
    }

    pub fn contains(&self, p: Vec3) -> bool {
        (0..3).all(|k| p[k] >= self.min[k] && p[k] <= self.max[k])
    }

    /// Half the box's surface area, which the split's cost compares.
    fn half_area(&self) -> f32 {
        if self.is_empty() {
            return 0.0;
        }
        let d = [
            self.max[0] - self.min[0],
            self.max[1] - self.min[1],
            self.max[2] - self.min[2],
        ];
        d[0] * d[1] + d[1] * d[2] + d[2] * d[0]
    }

    /// The box around this one moved by `to`, the box of its eight corners.
    pub fn moved(&self, to: &Affine) -> Aabb {
        let mut out = Aabb::EMPTY;
        if self.is_empty() {
            return out;
        }
        for i in 0..8 {
            let corner = [
                if i & 1 == 0 { self.min[0] } else { self.max[0] },
                if i & 2 == 0 { self.min[1] } else { self.max[1] },
                if i & 4 == 0 { self.min[2] } else { self.max[2] },
            ];
            out.grow(to.point(corner));
        }
        out
    }
}

/// One node of a BVH, 32 bytes. A leaf, with `count` above 0, holds the triangles from
/// `first` in the BVH's order; any other node's two children are `first` and `first + 1`.
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct BvhNode {
    pub bounds: Aabb,
    pub first: u32,
    pub count: u32,
}

#[cfg(test)]
mod tests;
