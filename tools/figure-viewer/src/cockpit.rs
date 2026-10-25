//! The Baron 58P built with aircraft-model as avatars' model job builds it, and its triangles
//! as the posed model shows them, which the page draws around the figure. The 58P's files
//! can't be in the tree, so serve.ts names the package where the sim installed it, and what
//! this writes goes only into target/.

use std::collections::BTreeMap;

use aircraft_model::{Affine, Aircraft, Model, Ray, Read, Scene, Vec3};

/// The 58P's preset and its livery's title, as aircraft-model's tests/installed.rs builds it.
const PATH: &str = "bksq-aircraft-baronpropress";
pub const TITLE: &str = "Black Square Baron 58P Professional N513LW";

/// The 58P in `package`, with grips found along the lines from `eyes`.
pub fn baron(package: &str, eyes: Vec<Vec3>, hand_radius: f32) -> Aircraft {
    Aircraft {
        package: package.to_string(),
        path: PATH.into(),
        title: Some(TITLE.into()),
        eyes,
        hand_radius,
    }
}

/// Reads every file `wanted` asks for, builds the model, and poses it once.
pub fn build(aircraft: &Aircraft) -> Result<Model, String> {
    let mut read: BTreeMap<String, Option<Vec<u8>>> = BTreeMap::new();
    loop {
        let next = aircraft_model::wanted(aircraft, &|p| lookup(&read, p));
        if next.is_empty() {
            break;
        }
        for p in next {
            let bytes = std::fs::read(&p).ok();
            read.insert(p, bytes);
        }
    }
    let bytes = aircraft_model::build(aircraft, &|p| lookup(&read, p))?;
    let mut model = Model::take(bytes)?;
    model.pose();
    Ok(model)
}

fn lookup<'a>(read: &'a BTreeMap<String, Option<Vec<u8>>>, path: &str) -> Read<'a> {
    match read.get(path) {
        Some(Some(b)) => Read::Bytes(b),
        Some(None) => Read::Missing,
        None => Read::NotYet,
    }
}

/// A spot a hand reaches for: where its center goes, one hand's radius out from the surface
/// along its normal, as avatars places a `Point`, and the surface's normal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spot {
    pub at: Vec3,
    pub normal: Vec3,
}

/// The spot a press would make from `eye` toward `direction`, in the interior as posed.
pub fn spot(model: &Model, eye: Vec3, direction: Vec3, hand_radius: f32) -> Option<Spot> {
    let hit = model.cast(
        Scene::Interior,
        &Ray {
            origin: eye,
            direction,
        },
        3.0,
    )?;
    let [x, y, z] = hit.point;
    let [nx, ny, nz] = hit.normal;
    Some(Spot {
        at: [
            x + nx * hand_radius,
            y + ny * hand_radius,
            z + nz * hand_radius,
        ],
        normal: hit.normal,
    })
}

/// A scene as the page draws it: the triangles that stay still in the aircraft's frame, and
/// each node that moves, with its triangles in its own frame.
pub struct Drawn {
    pub still: Vec<[Vec3; 3]>,
    pub moving: Vec<(u32, Vec<[Vec3; 3]>)>,
}

/// `scene` split into what stays still and the nodes in `moving`.
pub fn drawn(model: &Model, scene: Scene, moving: &[u32]) -> Drawn {
    let mut out = Drawn {
        still: Vec::new(),
        moving: Vec::new(),
    };
    for (node, triangles) in model.shown(scene) {
        if moving.contains(&node) {
            match out.moving.iter_mut().find(|(n, _)| *n == node) {
                Some((_, all)) => all.extend(triangles),
                None => out.moving.push((node, triangles)),
            }
            continue;
        }
        let world = model.world(scene, node).unwrap_or(Affine::IDENTITY);
        out.still
            .extend(triangles.iter().map(|t| t.map(|p| world.point(p))));
    }
    out
}

/// The nodes in `rest` whose frame in `scene`, as posed, differs from the one `rest` holds.
pub fn moved(model: &Model, scene: Scene, rest: &BTreeMap<u32, Affine>) -> Vec<u32> {
    rest.iter()
        .filter(|(node, was)| {
            model.world(scene, **node).is_some_and(|now| {
                now.columns
                    .iter()
                    .flatten()
                    .zip(was.columns.iter().flatten())
                    .any(|(a, b)| (a - b).abs() > 1e-6)
            })
        })
        .map(|(node, _)| *node)
        .collect()
}

/// Each shown node's frame in `scene`, as posed.
pub fn frames(model: &Model, scene: Scene) -> BTreeMap<u32, Affine> {
    model
        .shown(scene)
        .into_iter()
        .filter_map(|(node, _)| Some((node, model.world(scene, node)?)))
        .collect()
}

/// The box around `triangles`: its lowest corner, then its highest.
pub fn bounds(triangles: &[[Vec3; 3]]) -> Option<(Vec3, Vec3)> {
    let mut points = triangles.iter().flatten();
    let first = *points.next()?;
    Some(points.fold((first, first), |(lo, hi), p| {
        (
            [lo[0].min(p[0]), lo[1].min(p[1]), lo[2].min(p[2])],
            [hi[0].max(p[0]), hi[1].max(p[1]), hi[2].max(p[2])],
        )
    }))
}

/// Triangles as f32 little-endian, nine to a triangle, as the page reads them.
pub fn bytes(triangles: &[[Vec3; 3]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(triangles.len() * 36);
    for p in triangles.iter().flatten().flatten() {
        out.extend_from_slice(&p.to_le_bytes());
    }
    out
}

/// A frame as the page sets a matrix: 16 numbers in columns.
pub fn matrix(a: &Affine) -> [f32; 16] {
    let [x, y, z, t] = a.columns;
    [
        x[0], x[1], x[2], 0.0, y[0], y[1], y[2], 0.0, z[0], z[1], z[2], 0.0, t[0], t[1], t[2], 1.0,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triangles_go_out_as_nine_floats_each_and_bound_their_box() {
        let t = [[[0.0, -1.0, 0.0], [1.0, 2.0, 0.0], [0.0, 0.0, 3.0]]];
        let b = bytes(&t);
        assert_eq!(b.len(), 36);
        assert_eq!(f32::from_le_bytes([b[4], b[5], b[6], b[7]]), -1.0);
        assert_eq!(bounds(&t), Some(([0.0, -1.0, 0.0], [1.0, 2.0, 3.0])));
        assert_eq!(bounds(&[]), None);
    }

    #[test]
    fn a_frame_goes_out_in_columns_with_its_translation_last() {
        let a = Affine::from_parts([1.0, 2.0, 3.0], [0.0, 0.0, 0.0, 1.0], [1.0; 3]);
        let m = matrix(&a);
        assert_eq!((m[0], m[5], m[10], m[15]), (1.0, 1.0, 1.0, 1.0));
        assert_eq!(&m[12..15], &[1.0, 2.0, 3.0]);
    }
}
