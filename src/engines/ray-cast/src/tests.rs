// Tests may panic and build their fixtures freely.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::*;

/// A mesh held in plain vectors, as a test builds one.
struct Plain {
    positions: Vec<Vec3>,
    triangles: Vec<[u32; 3]>,
    built: Built,
}

impl Plain {
    fn new(positions: Vec<Vec3>, triangles: Vec<[u32; 3]>) -> Plain {
        let built = build(&positions, &triangles);
        Plain {
            positions,
            triangles,
            built,
        }
    }
}

impl Mesh for Plain {
    fn node(&self, i: u32) -> Option<BvhNode> {
        self.built.nodes.get(i as usize).copied()
    }

    fn triangle(&self, i: u32) -> Option<[Vec3; 3]> {
        let t = self.triangles[*self.built.order.get(i as usize)? as usize];
        Some(t.map(|v| self.positions[v as usize]))
    }
}

/// A small generator of numbers, so every run casts the same rays.
struct Numbers(u64);

impl Numbers {
    fn next(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
}

/// A bumpy sheet of 2 Ã— 60 Ã— 60 triangles over a metre square, and loose triangles above it.
fn sheet() -> Plain {
    let n = 60;
    let mut positions = Vec::new();
    for i in 0..=n {
        for j in 0..=n {
            let (x, z) = (i as f32 / n as f32, j as f32 / n as f32);
            positions.push([x, 0.05 * (x * 17.0).sin() * (z * 11.0).cos(), z]);
        }
    }
    let at = |i: u32, j: u32| i * (n + 1) + j;
    let mut triangles = Vec::new();
    for i in 0..n {
        for j in 0..n {
            triangles.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
            triangles.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
        }
    }
    let mut numbers = Numbers(7);
    for _ in 0..200 {
        let base = positions.len() as u32;
        let c = [numbers.next(), 0.2 + numbers.next() * 0.5, numbers.next()];
        for k in 0..3 {
            positions.push([
                c[0] + 0.03 * numbers.next(),
                c[1] + 0.03 * k as f32,
                c[2] + 0.03 * numbers.next(),
            ]);
        }
        triangles.push([base, base + 1, base + 2]);
    }
    Plain::new(positions, triangles)
}

/// The nearest hit by testing every triangle, which the BVH must agree with.
fn every_triangle(mesh: &Plain, ray: &Ray) -> Option<f32> {
    let all = Plain {
        positions: mesh.positions.clone(),
        triangles: mesh.triangles.clone(),
        built: Built {
            nodes: vec![BvhNode {
                bounds: Aabb {
                    min: [-1e9; 3],
                    max: [1e9; 3],
                },
                first: 0,
                count: mesh.triangles.len() as u32,
            }],
            order: (0..mesh.triangles.len() as u32).collect(),
        },
    };
    cast_mesh(&all, ray, f32::INFINITY).map(|(t, _)| t)
}

#[test]
fn every_cast_meets_what_testing_every_triangle_meets() {
    let mesh = sheet();
    let mut numbers = Numbers(11);
    let mut hits = 0;
    for _ in 0..2_000 {
        let origin = [
            numbers.next() * 1.4 - 0.2,
            1.0 + numbers.next(),
            numbers.next() * 1.4 - 0.2,
        ];
        let target = [numbers.next(), 0.0, numbers.next()];
        let ray = Ray {
            origin,
            direction: [
                target[0] - origin[0],
                target[1] - origin[1],
                target[2] - origin[2],
            ],
        };
        let fast = cast_mesh(&mesh, &ray, f32::INFINITY).map(|(t, _)| t);
        let slow = every_triangle(&mesh, &ray);
        assert_eq!(fast, slow, "{ray:?}");
        hits += usize::from(fast.is_some());
    }
    assert!(hits > 1_500, "most rays aimed at the sheet meet it: {hits}");
}

#[test]
fn leaves_stay_small_and_every_triangle_is_in_one() {
    let mesh = sheet();
    let mut seen = vec![0u32; mesh.triangles.len()];
    for node in &mesh.built.nodes {
        assert!(node.count as usize <= 16, "{node:?}");
        for k in node.first..node.first + node.count {
            seen[mesh.built.order[k as usize] as usize] += 1;
        }
    }
    assert!(seen.iter().all(|&s| s == 1));
}

#[test]
fn a_cast_turns_the_ray_into_each_mesh_and_meets_the_nearer() {
    // One unit square in the mesh's frame, at z = 0, placed three times: 2m and 5m in front of
    // a ray along +z, the far one scaled up so it would cover the ray's whole view, and once
    // lying flat 0.2m under the ray, which no ray here meets.
    let square = Plain::new(
        vec![
            [-0.5, -0.5, 0.0],
            [0.5, -0.5, 0.0],
            [0.5, 0.5, 0.0],
            [-0.5, 0.5, 0.0],
        ],
        vec![[0, 1, 2], [0, 2, 3]],
    );
    let quarter_turn = [(0.5f32).sqrt(), 0.0, 0.0, (0.5f32).sqrt()];
    let near = Affine::from_parts([0.1, 0.0, 2.0], [0.0, 0.0, 0.0, 1.0], [1.0; 3]);
    let far = Affine::from_parts([0.0, 0.0, 5.0], [0.0, 0.0, 0.0, 1.0], [10.0; 3]);
    let flat = Affine::from_parts([0.0, -0.2, 1.0], quarter_turn, [1.0; 3]);
    let local = Aabb {
        min: [-0.5, -0.5, 0.0],
        max: [0.5, 0.5, 0.0],
    };
    let placed: Vec<(Affine, Affine, Aabb)> = [near, far, flat]
        .into_iter()
        .map(|a| (a, a.inverse(), local.moved(&a)))
        .collect();
    let candidates = || {
        placed
            .iter()
            .enumerate()
            .map(|(i, (to_model, to_mesh, bounds))| Candidate {
                id: i as u32,
                to_model,
                to_mesh,
                bounds,
                mesh: &square,
            })
    };
    let ray = Ray {
        origin: [0.0, 0.0, 0.0],
        direction: [0.0, 0.0, 2.0],
    };
    let hit = cast(&ray, f32::INFINITY, candidates()).unwrap();
    assert_eq!(hit.id, 0);
    assert!(
        (hit.t - 1.0).abs() < 1e-6,
        "t counts the ray's own lengths: {}",
        hit.t
    );
    assert!((hit.point[2] - 2.0).abs() < 1e-6);
    assert!(
        (hit.normal[2] + 1.0).abs() < 1e-6,
        "faces the ray: {:?}",
        hit.normal
    );
    let past = Ray {
        origin: [0.0, 0.0, 0.0],
        direction: [0.4, 0.0, 1.0],
    };
    assert_eq!(cast(&past, f32::INFINITY, candidates()).unwrap().id, 1);
    assert!(
        cast(&ray, 0.5, candidates()).is_none(),
        "a hit past `most` doesn't count"
    );
}

#[test]
fn an_inverse_undoes_its_transform() {
    let a = Affine::from_parts(
        [1.0, -2.0, 3.0],
        [0.2, 0.4, -0.1, 0.8888194],
        [1.0, 2.0, 0.5],
    );
    let p = [0.3, -0.7, 1.9];
    let back = a.inverse().point(a.point(p));
    for k in 0..3 {
        assert!((back[k] - p[k]).abs() < 1e-5, "{back:?}");
    }
    let both = a.then_inner(&a.inverse()).point(p);
    for k in 0..3 {
        assert!((both[k] - p[k]).abs() < 1e-5, "{both:?}");
    }
}

#[test]
fn an_empty_mesh_meets_nothing() {
    let empty = Plain::new(Vec::new(), Vec::new());
    let ray = Ray {
        origin: [0.0; 3],
        direction: [0.0, 0.0, 1.0],
    };
    assert_eq!(cast_mesh(&empty, &ray, f32::INFINITY), None);
}
