//! Casting a ray through the meshes of a model, each in its node's frame.

use crate::affine::{cross, dot, sub};
use crate::{Aabb, Affine, BvhNode, Vec3};

/// A ray from `origin` along `direction`, which needn't be of unit length: a hit's `t` counts
/// lengths of `direction`, in every mesh's frame alike, since a cast turns the ray into a
/// mesh's frame without normalizing it again.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ray {
    pub origin: Vec3,
    pub direction: Vec3,
}

/// One mesh's BVH and triangles, wherever they're kept.
pub trait Mesh {
    /// The `i`th node, the root at 0, or `None` past the last.
    fn node(&self, i: u32) -> Option<BvhNode>;
    /// The corners of the triangle at place `i` in the BVH's order, in the mesh's own frame.
    fn triangle(&self, i: u32) -> Option<[Vec3; 3]>;
}

/// A mesh where a model places it: its transforms both ways, and its box in the model's
/// frame, which a cast tests before it turns the ray into the mesh's frame. `id` is the
/// caller's, which a hit names.
pub struct Candidate<'m, M: Mesh> {
    pub id: u32,
    pub to_model: &'m Affine,
    pub to_mesh: &'m Affine,
    pub bounds: &'m Aabb,
    pub mesh: &'m M,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    /// The candidate it met.
    pub id: u32,
    pub t: f32,
    /// In the model's frame.
    pub point: Vec3,
    /// The surface's normal in the model's frame, of unit length, on the side the ray came
    /// from.
    pub normal: Vec3,
}

/// The nearest hit of `ray` among `candidates`, within `t` of `most`.
pub fn cast<'m, M: Mesh + 'm>(
    ray: &Ray,
    most: f32,
    candidates: impl IntoIterator<Item = Candidate<'m, M>>,
) -> Option<Hit> {
    let inverse = inverse_of(ray.direction);
    let mut nearest = most;
    let mut best = None;
    for c in candidates {
        if !meets_box(ray, &inverse, c.bounds, nearest) {
            continue;
        }
        let local = Ray {
            origin: c.to_mesh.point(ray.origin),
            direction: c.to_mesh.vector(ray.direction),
        };
        if let Some((t, corners)) = cast_mesh(c.mesh, &local, nearest) {
            nearest = t;
            best = Some((c.id, t, corners, c.to_model));
        }
    }
    let (id, t, [a, b, c], to_model) = best?;
    let point = [
        ray.origin[0] + ray.direction[0] * t,
        ray.origin[1] + ray.direction[1] * t,
        ray.origin[2] + ray.direction[2] * t,
    ];
    let mut normal = to_model.normal(cross(sub(b, a), sub(c, a)));
    if dot(normal, ray.direction) > 0.0 {
        normal = [-normal[0], -normal[1], -normal[2]];
    }
    let length = dot(normal, normal).sqrt();
    if length > 0.0 {
        normal = [normal[0] / length, normal[1] / length, normal[2] / length];
    }
    Some(Hit {
        id,
        t,
        point,
        normal,
    })
}

/// The nearest triangle of one mesh that `ray`, in the mesh's frame, meets within `most`,
/// with its `t` and its corners.
pub fn cast_mesh(mesh: &impl Mesh, ray: &Ray, most: f32) -> Option<(f32, [Vec3; 3])> {
    let inverse = inverse_of(ray.direction);
    let mut nearest = most;
    let mut best = None;
    // The nodes still to visit, the nearer child of each pair visited first, so the farther
    // is often skipped once a hit is nearer than its box.
    let mut stack: Vec<u32> = Vec::with_capacity(64);
    stack.push(0);
    while let Some(i) = stack.pop() {
        let Some(node) = mesh.node(i) else {
            continue;
        };
        if !meets_box(ray, &inverse, &node.bounds, nearest) {
            continue;
        }
        if node.count > 0 {
            for k in node.first..node.first.saturating_add(node.count) {
                let Some(corners) = mesh.triangle(k) else {
                    continue;
                };
                if let Some(t) = meets_triangle(ray, &corners, nearest) {
                    nearest = t;
                    best = Some((t, corners));
                }
            }
            continue;
        }
        let (a, b) = (node.first, node.first.saturating_add(1));
        let near_a = mesh
            .node(a)
            .and_then(|n| entry(ray, &inverse, &n.bounds))
            .unwrap_or(f32::INFINITY);
        let near_b = mesh
            .node(b)
            .and_then(|n| entry(ray, &inverse, &n.bounds))
            .unwrap_or(f32::INFINITY);
        if near_a <= near_b {
            stack.push(b);
            stack.push(a);
        } else {
            stack.push(a);
            stack.push(b);
        }
    }
    best
}

fn inverse_of(d: Vec3) -> Vec3 {
    [1.0 / d[0], 1.0 / d[1], 1.0 / d[2]]
}

fn meets_box(ray: &Ray, inverse: &Vec3, b: &Aabb, most: f32) -> bool {
    entry(ray, inverse, b).is_some_and(|t| t <= most)
}

/// Where the ray enters the box, by the slab test, or `None` when it misses, the box is
/// behind it, or the box holds nothing, as an empty mesh's root does, whose `count` of 0
/// would otherwise read as a node with children.
fn entry(ray: &Ray, inverse: &Vec3, b: &Aabb) -> Option<f32> {
    if b.is_empty() {
        return None;
    }
    let mut near = 0.0f32;
    let mut far = f32::INFINITY;
    let slabs = b.min.iter().zip(&b.max).zip(ray.origin.iter().zip(inverse));
    for ((&lo, &hi), (&origin, &inverse)) in slabs {
        let t0 = (lo - origin) * inverse;
        let t1 = (hi - origin) * inverse;
        // A NaN, from a ray along a box's face, leaves the bound as it was.
        near = near.max(t0.min(t1));
        far = far.min(t0.max(t1));
    }
    (near <= far).then_some(near)
}

/// Möller and Trumbore's test, from either side of the triangle, since a cockpit's surfaces
/// are seen from both.
fn meets_triangle(ray: &Ray, [a, b, c]: &[Vec3; 3], most: f32) -> Option<f32> {
    let e1 = sub(*b, *a);
    let e2 = sub(*c, *a);
    let p = cross(ray.direction, e2);
    let det = dot(e1, p);
    if det.abs() < 1e-12 {
        return None;
    }
    let inv = 1.0 / det;
    let s = sub(ray.origin, *a);
    let u = dot(s, p) * inv;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = cross(s, e1);
    let v = dot(ray.direction, q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let t = dot(e2, q) * inv;
    (t > 0.0 && t < most).then_some(t)
}
