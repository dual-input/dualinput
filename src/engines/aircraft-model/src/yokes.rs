//! Each yoke's grips, and how its animations move them, which `Figure` reads on every machine
//! to keep a hand on the horn (record/areas/avatars/01-avatars.md, "A hand on a yoke").
//!
//! Aircraft mark a yoke's grips with `HANDLING_Yoke_1_Hand_Left` and `_Right`, and the Baron
//! marks them on the pilot's yoke alone, its copilot's repeating the pilot's nodes with `_R`
//! for `_L` (record/areas/avatars/decisions.md, "The yoke hand holds the grips the aircraft
//! marks, or their copy on the copilot's yoke").

use msfs_rpn::{Scratch, Var};
use ray_cast::{Affine, Ray, Vec3};

use crate::Aircraft;
use crate::model::{AnimationMeta, Model, ProgramMeta, Rest, Scene, Yoke, YokeStage, to_12};

/// The frames across an animation a stage samples, from its first to its last.
const SAMPLES: usize = 21;
/// The animated nodes a yoke's grips can sit below, the stages `YokeSlot` in the message crate's
/// avatars slots holds, so change both together. Past them, the grips would sit in a frame
/// `Figure` doesn't play, so the hand holds where the centered yoke puts it.
const MOST_STAGES: usize = 2;
/// The values a variable is tried at to find a yoke's code linear in it, in its unit: the
/// yoke's whole travel, in percent.
const TRIES: [f64; 3] = [-100.0, 0.0, 100.0];

/// The model's yokes, found with the yoke centered: every variable at 0.
pub(crate) fn find(model: &mut Model, aircraft: &Aircraft) -> Vec<Yoke> {
    model.pose();
    let model = &*model;
    let mut yokes = Vec::new();
    let mut marked = 1;
    for k in 1..=4 {
        let (Some(left), Some(right)) = (
            model.find_node(Scene::Interior, &format!("HANDLING_Yoke_{k}_Hand_Left")),
            model.find_node(Scene::Interior, &format!("HANDLING_Yoke_{k}_Hand_Right")),
        ) else {
            continue;
        };
        let Some(node) = model.parent(Scene::Interior, left) else {
            continue;
        };
        let place = |n| model.world(Scene::Interior, n).map(|w| w.columns[3]);
        let (Some(l), Some(r)) = (place(left), place(right)) else {
            continue;
        };
        if let Some(y) = yoke(model, aircraft, node, [l, r]) {
            yokes.push(y);
            marked = k;
        }
    }
    // With one yoke marked, its copy on the other side, by its nodes' names with `_R` for
    // `_L`, or the other way, each grip placed from the copy's last animated node as the
    // marked one is from its own.
    if let [only] = yokes.as_slice() {
        let only = only.clone();
        let mirror = |n: u32| {
            let swapped = swap_side(model.node_name(Scene::Interior, n)?)?;
            model.find_node(Scene::Interior, &swapped)
        };
        if let (Some(node), Some(last)) = (mirror(only.node), mirror(only.last))
            && let (Some(from), Some(to)) = (
                model.world(Scene::Interior, only.last),
                model.world(Scene::Interior, last),
            )
        {
            let back = from.inverse();
            let grips = ["Left", "Right"].map(|hand| {
                let name = format!("HANDLING_Yoke_{marked}_Hand_{hand}");
                let grip = model
                    .find_node(Scene::Interior, &name)
                    .and_then(|n| model.world(Scene::Interior, n));
                to.point(back.point(grip.map_or([0.0; 3], |w| w.columns[3])))
            });
            if let Some(y) = yoke(model, aircraft, node, grips) {
                yokes.push(y);
            }
        }
    }
    yokes
}

/// `Yoke_L` to `Yoke_R`, or the other way.
fn swap_side(name: &str) -> Option<String> {
    for (from, to) in [("_L", "_R"), ("_R", "_L"), ("_l", "_r"), ("_r", "_l")] {
        if let Some(stem) = name.strip_suffix(from) {
            return Some(format!("{stem}{to}"));
        }
    }
    None
}

/// One yoke, from its wheel's node and its grips' points in the aircraft's frame.
fn yoke(model: &Model, aircraft: &Aircraft, node: u32, grips: [Vec3; 2]) -> Option<Yoke> {
    let animations: &[AnimationMeta] = model
        .meta()
        .interior
        .as_ref()
        .map_or(&[], |m| m.animations.as_slice());
    let moved_by = |n: u32| -> Vec<&AnimationMeta> {
        animations
            .iter()
            .filter(|a| a.channels.iter().any(|c| c.node == n))
            .collect()
    };
    // The animated nodes above the wheel, the topmost first.
    let mut chain = Vec::new();
    let mut at = Some(node);
    while let Some(n) = at {
        if !moved_by(n).is_empty() {
            chain.push(n);
        }
        at = model.parent(Scene::Interior, n);
    }
    chain.reverse();
    let last = chain.last().copied().unwrap_or(node);
    let last_world = model.world(Scene::Interior, last)?;
    let left = model.world(Scene::Interior, node)?.columns[3][0] > 0.0;
    let back = last_world.inverse();
    let mut spots = grips.map(|g| back.point(spot(model, aircraft, left, g)));
    // The left hand's grip is the one farther left, x being left in the aircraft's frame.
    if last_world.point(spots[0])[0] < last_world.point(spots[1])[0] {
        spots.swap(0, 1);
    }
    let stages = stages(model, &chain, &moved_by);
    let base = match (&stages, chain.first()) {
        (Some(_), Some(&top)) => model
            .parent(Scene::Interior, top)
            .and_then(|p| model.world(Scene::Interior, p))
            .unwrap_or(Affine::IDENTITY),
        _ => last_world,
    };
    Some(Yoke {
        left,
        node,
        last,
        base: to_12(&base),
        stages: stages.unwrap_or_default(),
        grips: spots,
    })
}

/// Where a hand's center goes for a grip at `grip`: one hand's radius out from where the line
/// from the seat's eye on that side meets the horn, since the marked nodes sit inside the
/// horns, and a hand placed on them sank into the yoke (record/areas/avatars/log.md,
/// 2026-10-03).
fn spot(model: &Model, aircraft: &Aircraft, left: bool, grip: Vec3) -> Vec3 {
    let eye = aircraft
        .eyes
        .iter()
        .filter(|e| (e[0] > 0.0) == left)
        .min_by(|a, b| distance(**a, grip).total_cmp(&distance(**b, grip)));
    let Some(&eye) = eye else {
        return grip;
    };
    let ray = Ray {
        origin: eye,
        direction: [grip[0] - eye[0], grip[1] - eye[1], grip[2] - eye[2]],
    };
    match model.cast(Scene::Interior, &ray, 1.05) {
        Some(hit) => [
            hit.point[0] + hit.normal[0] * aircraft.hand_radius,
            hit.point[1] + hit.normal[1] * aircraft.hand_radius,
            hit.point[2] + hit.normal[2] * aircraft.hand_radius,
        ],
        None => grip,
    }
}

fn distance(a: Vec3, b: Vec3) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// Each animated node's stage, or `None` when `Figure` can't play them: more than its slot
/// holds, or one that can't be played from one variable, moved by two animations, or by code
/// that reads two variables that change it, or gives a frame that isn't linear in its one.
fn stages<'m>(
    model: &Model,
    chain: &[u32],
    moved_by: &dyn Fn(u32) -> Vec<&'m AnimationMeta>,
) -> Option<Vec<YokeStage>> {
    if chain.len() > MOST_STAGES {
        return None;
    }
    let programs = &model.meta().programs;
    let vars = &model.meta().vars;
    let mut out = Vec::new();
    let mut before_frame: Option<Affine> = None;
    for &n in chain {
        let movers = moved_by(n);
        let [animation] = movers.as_slice() else {
            return None;
        };
        let program = programs.get(animation.program as usize)?;
        let (var, slope, intercept) = linear(program, vars)?;
        let parent = model
            .parent(Scene::Interior, n)
            .and_then(|p| model.world(Scene::Interior, p))
            .unwrap_or(Affine::IDENTITY);
        let before = match before_frame {
            Some(previous) => previous.inverse().then_inner(&parent),
            None => Affine::IDENTITY,
        };
        let rest = model.rest(Scene::Interior, n)?;
        let Rest::Parts { scale, .. } = rest else {
            return None;
        };
        let samples = (0..SAMPLES)
            .map(|k| {
                let frame = animation.length * k as f32 / (SAMPLES - 1) as f32;
                let t = (frame / animation.length).clamp(0.0, 1.0) * animation.duration;
                let mut part = rest;
                for c in animation.channels.iter().filter(|c| c.node == n) {
                    model.play(&mut part, c, t);
                }
                match part {
                    Rest::Parts {
                        translation,
                        rotation,
                        ..
                    } => (translation, rotation),
                    Rest::Matrix(_) => ([0.0; 3], [0.0, 0.0, 0.0, 1.0]),
                }
            })
            .collect();
        out.push(YokeStage {
            before: to_12(&before),
            var,
            slope: slope as f32,
            intercept: intercept as f32,
            length: animation.length,
            samples,
            scale,
        });
        before_frame = model.world(Scene::Interior, n);
    }
    Some(out)
}

/// The one variable a program's frame changes with, and the line from its value to the
/// frame, when the frame is linear in it.
fn linear(program: &ProgramMeta, vars: &[Var]) -> Option<(Var, f64, f64)> {
    let run = |at: Option<(usize, f64)>| {
        program.program.run(&mut Scratch::default(), &|i| match at {
            Some((j, v)) if i == j => v,
            _ => 0.0,
        })
    };
    let varying: Vec<usize> = (0..program.program.vars.len())
        .filter(|&i| {
            let [lo, _, hi] = TRIES.map(|v| run(Some((i, v))));
            (hi - lo).abs() > 1e-9
        })
        .collect();
    let [i] = varying.as_slice() else {
        return None;
    };
    let [lo, mid, hi] = TRIES.map(|v| run(Some((*i, v))));
    let slope = (hi - lo) / (TRIES[2] - TRIES[0]);
    if (mid - (lo + hi) / 2.0).abs() > 1e-6 * (hi - lo).abs().max(1.0) {
        return None;
    }
    let global = *program.vars.get(*i)?;
    Some((vars.get(global as usize)?.clone(), slope, mid))
}

/// The cockpit's `PILOT_` nodes, each with its place, which the seat tool seeds seats from.
pub(crate) fn seat_seeds(model: &Model) -> Vec<(String, Vec3)> {
    let count = model.meta().interior.as_ref().map_or(0, |m| m.nodes.count);
    (0..count)
        .filter_map(|n| {
            let name = model.node_name(Scene::Interior, n)?;
            if !name.to_ascii_uppercase().starts_with("PILOT_") {
                return None;
            }
            let w = model.world(Scene::Interior, n)?;
            Some((name.to_string(), w.columns[3]))
        })
        .collect()
}
