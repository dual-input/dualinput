//! A transform that rotates, scales, and moves, as a glTF node's does.

use bytemuck::{Pod, Zeroable};

use crate::Vec3;

/// A 3x4 matrix in columns: the images of x, y, and z, then the translation.
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Affine {
    pub columns: [Vec3; 4],
}

impl Default for Affine {
    fn default() -> Affine {
        Affine::IDENTITY
    }
}

impl Affine {
    pub const IDENTITY: Affine = Affine {
        columns: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [0.0; 3]],
    };

    /// From a translation, a unit quaternion `[x, y, z, w]`, and a scale, applied scale first,
    /// as glTF composes a node's parts.
    pub fn from_parts(translation: Vec3, rotation: [f32; 4], scale: Vec3) -> Affine {
        let [x, y, z, w] = rotation;
        let r = [
            [
                1.0 - 2.0 * (y * y + z * z),
                2.0 * (x * y + z * w),
                2.0 * (x * z - y * w),
            ],
            [
                2.0 * (x * y - z * w),
                1.0 - 2.0 * (x * x + z * z),
                2.0 * (y * z + x * w),
            ],
            [
                2.0 * (x * z + y * w),
                2.0 * (y * z - x * w),
                1.0 - 2.0 * (x * x + y * y),
            ],
        ];
        Affine {
            columns: [
                scaled(r[0], scale[0]),
                scaled(r[1], scale[1]),
                scaled(r[2], scale[2]),
                translation,
            ],
        }
    }

    /// From glTF's column-major 4x4 matrix, whose last row an affine transform keeps as
    /// `0 0 0 1`.
    pub fn from_matrix(m: [f32; 16]) -> Affine {
        Affine {
            columns: [
                [m[0], m[1], m[2]],
                [m[4], m[5], m[6]],
                [m[8], m[9], m[10]],
                [m[12], m[13], m[14]],
            ],
        }
    }

    /// `self` after `inner`: a point goes through `inner` first.
    pub fn then_inner(&self, inner: &Affine) -> Affine {
        Affine {
            columns: [
                self.vector(inner.columns[0]),
                self.vector(inner.columns[1]),
                self.vector(inner.columns[2]),
                self.point(inner.columns[3]),
            ],
        }
    }

    pub fn point(&self, p: Vec3) -> Vec3 {
        let v = self.vector(p);
        let t = self.columns[3];
        [v[0] + t[0], v[1] + t[1], v[2] + t[2]]
    }

    pub fn vector(&self, v: Vec3) -> Vec3 {
        let [a, b, c, _] = self.columns;
        [
            a[0] * v[0] + b[0] * v[1] + c[0] * v[2],
            a[1] * v[0] + b[1] * v[1] + c[1] * v[2],
            a[2] * v[0] + b[2] * v[1] + c[2] * v[2],
        ]
    }

    /// The transform that undoes this one, or the identity for one that flattens space,
    /// such as a scale of 0, which no ray can be turned into.
    pub fn inverse(&self) -> Affine {
        let [a, b, c, t] = self.columns;
        // The rows of the inverse of the 3x3 part are the cross products of its columns, over
        // its determinant.
        let r0 = cross(b, c);
        let r1 = cross(c, a);
        let r2 = cross(a, b);
        let det = dot(a, r0);
        if det.abs() < f32::MIN_POSITIVE {
            return Affine::IDENTITY;
        }
        let inv = 1.0 / det;
        let rows = [scaled(r0, inv), scaled(r1, inv), scaled(r2, inv)];
        let columns = [
            [rows[0][0], rows[1][0], rows[2][0]],
            [rows[0][1], rows[1][1], rows[2][1]],
            [rows[0][2], rows[1][2], rows[2][2]],
        ];
        let moved = [-dot(rows[0], t), -dot(rows[1], t), -dot(rows[2], t)];
        Affine {
            columns: [columns[0], columns[1], columns[2], moved],
        }
    }

    /// A surface's normal turned by this transform, through the inverse's transpose, so it
    /// stays square to a surface this transform stretched. Not normalized.
    pub fn normal(&self, n: Vec3) -> Vec3 {
        let inverse = self.inverse();
        let [a, b, c, _] = inverse.columns;
        [dot(a, n), dot(b, n), dot(c, n)]
    }
}

pub(crate) fn dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(crate) fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub(crate) fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn scaled(v: Vec3, s: f32) -> Vec3 {
    [v[0] * s, v[1] * s, v[2] * s]
}
