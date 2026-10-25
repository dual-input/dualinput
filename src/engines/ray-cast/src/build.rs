//! Building one mesh's BVH, with binned surface-area splits.

use crate::{Aabb, BvhNode, Vec3};

/// The planes a split tries along a box's longest axis, between 13 bins of equal width.
const BINS: usize = 13;
/// A node with this many triangles or fewer becomes a leaf.
const LEAF: usize = 4;
/// A node with this many triangles or fewer becomes a leaf when no split costs less than
/// keeping it whole, so a mesh of triangles stacked on one spot still ends in small leaves.
const MOST_IN_LEAF: usize = 16;
/// What crossing one node costs, against one triangle's test, in the split's cost.
const TRAVERSE: f32 = 1.0;

/// A mesh's BVH: its nodes, the root first, and its triangles in the order the leaves hold
/// them, each an index into the triangles it was built from.
#[derive(Clone, Debug, PartialEq)]
pub struct Built {
    pub nodes: Vec<BvhNode>,
    pub order: Vec<u32>,
}

/// Builds the BVH of `triangles`, each three indices into `positions`. A mesh with no
/// triangles gets one empty leaf, which no ray meets.
pub fn build(positions: &[Vec3], triangles: &[[u32; 3]]) -> Built {
    let corner = |i: u32| positions.get(i as usize).copied().unwrap_or([0.0; 3]);
    let boxes: Vec<Aabb> = triangles
        .iter()
        .map(|t| {
            let mut b = Aabb::EMPTY;
            for &v in t {
                b.grow(corner(v));
            }
            b
        })
        .collect();
    let centers: Vec<Vec3> = boxes
        .iter()
        .map(|b| {
            [
                (b.min[0] + b.max[0]) * 0.5,
                (b.min[1] + b.max[1]) * 0.5,
                (b.min[2] + b.max[2]) * 0.5,
            ]
        })
        .collect();
    let mut order: Vec<u32> = (0..triangles.len() as u32).collect();
    let mut nodes = vec![BvhNode {
        bounds: Aabb::EMPTY,
        first: 0,
        count: 0,
    }];
    // Each entry is a node to finish and the triangles it holds, as a range of `order`, so the
    // build never recurses, however deep the tree.
    let mut work = vec![(0usize, 0usize, order.len())];
    while let Some((node, start, end)) = work.pop() {
        let mut bounds = Aabb::EMPTY;
        let mut spread = Aabb::EMPTY;
        for &t in &order[start..end] {
            bounds.join(&boxes[t as usize]);
            spread.grow(centers[t as usize]);
        }
        let count = end - start;
        let leaf = BvhNode {
            bounds,
            first: start as u32,
            count: count as u32,
        };
        if count <= LEAF {
            nodes[node] = leaf;
            continue;
        }
        let split = best_split(&order[start..end], &boxes, &centers, &spread);
        let mid = match split {
            Some((axis, plane, cost)) if cost < count as f32 || count > MOST_IN_LEAF => {
                let mid = start
                    + partition(&mut order[start..end], |t| {
                        centers[t as usize][axis] < plane
                    });
                // Every center on one side of the plane: halve by count instead.
                if mid == start || mid == end {
                    start + count / 2
                } else {
                    mid
                }
            }
            None if count > MOST_IN_LEAF => start + count / 2,
            _ => {
                nodes[node] = leaf;
                continue;
            }
        };
        let left = nodes.len();
        nodes.push(leaf);
        nodes.push(leaf);
        nodes[node] = BvhNode {
            bounds,
            first: left as u32,
            count: 0,
        };
        work.push((left + 1, mid, end));
        work.push((left, start, mid));
    }
    Built { nodes, order }
}

/// The plane across the longest axis of the centers' spread that costs least, with that
/// cost, counted in triangle tests; or `None` when the centers all sit at one spot.
fn best_split(
    tris: &[u32],
    boxes: &[Aabb],
    centers: &[Vec3],
    spread: &Aabb,
) -> Option<(usize, f32, f32)> {
    let extent = [
        spread.max[0] - spread.min[0],
        spread.max[1] - spread.min[1],
        spread.max[2] - spread.min[2],
    ];
    let axis = (0..3).fold(0, |best, k| if extent[k] > extent[best] { k } else { best });
    if extent[axis] <= f32::EPSILON * spread.max[axis].abs().max(1.0) {
        return None;
    }
    let scale = BINS as f32 / extent[axis];
    let bin_of = |t: u32| {
        let at = (centers[t as usize][axis] - spread.min[axis]) * scale;
        (at as usize).min(BINS - 1)
    };
    let mut bins = [(Aabb::EMPTY, 0u32); BINS];
    for &t in tris {
        let b = &mut bins[bin_of(t)];
        b.0.join(&boxes[t as usize]);
        b.1 += 1;
    }
    // The area and count to the left of each plane, then to the right, swept from each end.
    let mut left = [(0.0f32, 0u32); BINS - 1];
    let mut acc = (Aabb::EMPTY, 0u32);
    for i in 0..BINS - 1 {
        acc.0.join(&bins[i].0);
        acc.1 += bins[i].1;
        left[i] = (acc.0.half_area(), acc.1);
    }
    let mut parent = acc.0;
    parent.join(&bins[BINS - 1].0);
    let parent_area = parent.half_area().max(f32::MIN_POSITIVE);
    let mut best: Option<(usize, f32)> = None;
    let mut acc = (Aabb::EMPTY, 0u32);
    for i in (0..BINS - 1).rev() {
        acc.0.join(&bins[i + 1].0);
        acc.1 += bins[i + 1].1;
        let (left_area, left_count) = left[i];
        if left_count == 0 || acc.1 == 0 {
            continue;
        }
        let cost = TRAVERSE
            + (left_area * left_count as f32 + acc.0.half_area() * acc.1 as f32) / parent_area;
        if best.is_none_or(|(_, c)| cost < c) {
            best = Some((i, cost));
        }
    }
    let (i, cost) = best?;
    let plane = spread.min[axis] + (i + 1) as f32 / scale;
    Some((axis, plane, cost))
}

/// Puts every triangle `left` takes before every one it doesn't, and returns how many it
/// took. It keeps no order within either side, which the tree doesn't need.
fn partition(tris: &mut [u32], left: impl Fn(u32) -> bool) -> usize {
    let mut i = 0;
    let mut j = tris.len();
    while i < j {
        if left(tris[i]) {
            i += 1;
        } else {
            j -= 1;
            tris.swap(i, j);
        }
    }
    i
}
