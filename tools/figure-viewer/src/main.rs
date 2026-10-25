//! The figure viewer's program, which serve.ts runs: it builds the Baron 58P from where the
//! sim installed it, runs `Figure` over the scripts, and writes what the page draws.
//!
//!   figure-viewer <the 58P's package folder> <the output folder>
//!
//! It writes cockpit.json, interior.bin, exterior.bin, parts.bin, and scripts.json into the
//! output folder, and reads the seat from seat.json there when serve.ts wrote one.
//!
//! `Figure` solves with the sizes avatars-routines' build script compiled in from
//! src/features/avatars/figure/figure.json, and this program reads the same file as it
//! builds, so a change to figure.json needs a build of this program before a run.

mod cockpit;
mod place;
mod record;
mod scripts;
mod seat;
mod slot;

use std::path::Path;
use std::process::ExitCode;
use std::time::Instant;

use aircraft_model::{Model, Scene, Vec3};
use serde_json::{Value, json};

use crate::cockpit::TITLE;
use crate::scripts::{AIMS, Stage};
use crate::seat::Seat;

/// The figure's spec as `Figure` was compiled with it.
const SPEC: &str = include_str!("../../../src/features/avatars/figure/figure.json");

/// The pilot's eye before a seat is known, about 0.7m above the 58P's `PILOT_1` mirrored, as
/// aircraft-model's tests/installed.rs guesses it.
const GUESS: Vec3 = [0.28, 0.83, -0.02];

/// How far beside the left wingtip the figure walks, in meters.
const BESIDE: f32 = 1.5;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("figure-viewer: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [package, out] = args.as_slice() else {
        return Err("say the 58P's package folder and the output folder".into());
    };
    let out = Path::new(out);
    let start = Instant::now();
    let spec: Value = serde_json::from_str(SPEC).map_err(|e| format!("figure.json: {e}"))?;
    let hand = spec
        .pointer("/hand/radius")
        .and_then(Value::as_f64)
        .ok_or("figure.json gives no /hand/radius")? as f32;
    let given: Option<Seat> = std::fs::read_to_string(out.join("seat.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok());

    // A grip sits where the line from the seat's eye meets the horn, so the model is built
    // with the seat's eye. With no seat given, a first build finds the cockpit's `PILOT_`
    // nodes, where the seat starts, and a second builds with its eye.
    let eye = given.map_or(GUESS, |s| s.eye_point());
    let mut model = cockpit::build(&cockpit::baron(package, eyes(eye), hand))?;
    let seat = match given {
        Some(s) => s,
        None => Seat::at(left_seed(model.seat_seeds()).ok_or_else(|| {
            format!(
                "the 58P's cockpit has no PILOT_ node to seat the figure at, of {:?}",
                model.seat_seeds()
            )
        })?),
    };
    if distance(seat.eye_point(), eye) > 0.01 {
        model = cockpit::build(&cockpit::baron(package, eyes(seat.eye_point()), hand))?;
    }
    let built = start.elapsed();

    let exterior_at_rest = cockpit::drawn(&model, Scene::Exterior, &[]);
    let (low, high) = cockpit::bounds(&exterior_at_rest.still).unwrap_or(([0.0; 3], [0.0; 3]));
    let pilot_yoke = model.yokes().iter().find(|y| y.left);
    let stage = Stage {
        seat,
        spots: AIMS
            .iter()
            .filter_map(|(name, yaw, pitch)| {
                let dir = scripts::direction(seat.facing + yaw, *pitch);
                Some((*name, cockpit::spot(&model, seat.eye_point(), dir, hand)?))
            })
            .collect(),
        ground: low[1],
        beside: high[0] + BESIDE,
        yoke: pilot_yoke.map_or(Vec::new(), |y| {
            y.stages
                .iter()
                .map(|s| format!("{}:{}", s.var.kind, s.var.name))
                .collect()
        }),
    };
    let yokes = slot::yokes(model.yokes());
    let scripts = scripts::all(&stage);
    let recorded: Vec<Vec<record::Frame>> = scripts
        .iter()
        .map(|s| record::run(s, &seat, &yokes))
        .collect();

    // The nodes the scripts' aircraft variables move, such as the yoke's, which the page
    // places each frame from the model posed as the sim would pose it; every other node
    // stays where the model is at rest.
    let scenes = [Scene::Interior, Scene::Exterior];
    let rest = scenes.map(|s| cockpit::frames(&model, s));
    let mut moving: [Vec<u32>; 2] = [Vec::new(), Vec::new()];
    for script in &scripts {
        for frame in sample_times(script.seconds) {
            pose(&mut model, &(script.at)(frame).aircraft);
            for (k, scene) in scenes.into_iter().enumerate() {
                for node in cockpit::moved(&model, scene, &rest[k]) {
                    if !moving[k].contains(&node) {
                        moving[k].push(node);
                    }
                }
            }
        }
        pose(&mut model, &zeroed(&(script.at)(0.0).aircraft));
    }
    let drawn = [0, 1].map(|k| cockpit::drawn(&model, scenes[k], &moving[k]));
    let parts: Vec<(Scene, u32)> = (0..2)
        .flat_map(|k| drawn[k].moving.iter().map(move |(n, _)| (scenes[k], *n)))
        .collect();
    // Each script that moves a part gets a file of each part's frame at each of its frames,
    // as f32 little-endian, 16 to a frame, frame by frame: the grip script's come to 4.8 MB,
    // which as JSON took 12 MB.
    let mut placed = Vec::new();
    for (script, frames) in scripts.iter().zip(&recorded) {
        if (script.at)(0.0).aircraft.is_empty() {
            placed.push(None);
            continue;
        }
        let mut bytes = Vec::with_capacity(frames.len() * parts.len() * 64);
        for f in frames {
            pose(&mut model, &(script.at)(f.t).aircraft);
            for (scene, node) in &parts {
                let m = model
                    .world(*scene, *node)
                    .map_or([0.0; 16], |w| cockpit::matrix(&w));
                for v in m {
                    bytes.extend_from_slice(&v.to_le_bytes());
                }
            }
        }
        pose(&mut model, &zeroed(&(script.at)(0.0).aircraft));
        let name = format!("{}.parts.bin", script.name);
        write(out, &name, &bytes)?;
        placed.push(Some(name));
    }

    write(out, "interior.bin", &cockpit::bytes(&drawn[0].still))?;
    write(out, "exterior.bin", &cockpit::bytes(&drawn[1].still))?;
    let mut part_bytes = Vec::new();
    let mut part_list = Vec::new();
    for (k, d) in drawn.iter().enumerate() {
        for (node, triangles) in &d.moving {
            part_list.push(json!({
                "scene": if k == 0 { "interior" } else { "exterior" },
                "node": model.node_name(scenes[k], *node).unwrap_or("?"),
                "at": part_bytes.len() / 36,
                "triangles": triangles.len(),
                "rest": cockpit::matrix(&rest[k][node]),
            }));
            part_bytes.extend(cockpit::bytes(triangles));
        }
    }
    write(out, "parts.bin", &part_bytes)?;
    let report = model.report();
    let cockpit = json!({
        "aircraft": TITLE,
        "seat": seat,
        "eye": seat.eye_point(),
        "seeds": model.seat_seeds(),
        "ground": stage.ground,
        "beside": stage.beside,
        "interior": drawn[0].still.len(),
        "exterior": drawn[1].still.len(),
        "parts": part_list,
        "spots": stage.spots.iter().map(|(n, s)| json!({ "name": n, "at": s.at, "normal": s.normal })).collect::<Vec<_>>(),
        "yokes": model.yokes().len(),
        "report": {
            "triangles": report.triangles,
            "animationCodes": report.animation_codes,
            "visibilityCodes": report.visibility_codes,
            "posed": report.posed,
        },
    });
    write(out, "cockpit.json", cockpit.to_string().as_bytes())?;
    let mut channels: Vec<&str> = avatars_routines::solve::CHANNELS.to_vec();
    channels.extend(["COLOR", "SHOWS"]);
    let scripts_json = json!({
        "fps": record::FPS,
        "channels": channels,
        "spec": spec,
        "scripts": scripts.iter().zip(&recorded).zip(&placed).map(|((s, frames), parts)| json!({
            "name": s.name,
            "title": s.title,
            "seconds": s.seconds,
            "frames": frames,
            "parts": parts,
        })).collect::<Vec<_>>(),
    });
    write(out, "scripts.json", scripts_json.to_string().as_bytes())?;
    println!(
        "figure-viewer: the 58P built in {:.1}s; {} triangles inside, {} outside, {} moving parts; {} scripts, {} frames; {} spots of {}; written in {:.1}s",
        built.as_secs_f64(),
        drawn[0].still.len(),
        drawn[1].still.len(),
        parts.len(),
        scripts.len(),
        recorded.iter().map(Vec::len).sum::<usize>(),
        stage.spots.len(),
        AIMS.len(),
        start.elapsed().as_secs_f64(),
    );
    Ok(())
}

/// Where the left seat starts: a `PILOT_` node left of the centerline, or the mirror of one
/// right of it, since the 58P's cockpit has only `PILOT_1`, the right seat's (read in
/// bksq-aircraft-baronpro, as aircraft-model's tests/installed.rs prints it).
fn left_seed(seeds: &[(String, Vec3)]) -> Option<Vec3> {
    let left = seeds.iter().find(|(_, at)| at[0] > 0.0).map(|(_, at)| *at);
    left.or_else(|| seeds.first().map(|(_, [x, y, z])| [-x, *y, *z]))
}

/// The seat's eye, and its mirror across the centerline for the copilot's yoke.
fn eyes(eye: Vec3) -> Vec<Vec3> {
    vec![eye, [-eye[0], eye[1], eye[2]]]
}

fn distance(a: Vec3, b: Vec3) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// A script's times every 0.1s, which find the nodes its variables move.
fn sample_times(seconds: f32) -> impl Iterator<Item = f32> {
    (0..=(seconds * 10.0) as u32).map(|k| k as f32 / 10.0)
}

/// Poses the model with each of `values`' variables, by its name with its prefix.
fn pose(model: &mut Model, values: &[(String, f64)]) {
    for (name, value) in values {
        if let Some(at) = model
            .vars()
            .iter()
            .position(|v| format!("{}:{}", v.kind, v.name) == *name)
        {
            model.set(at, *value);
        }
    }
    model.pose();
}

fn zeroed(values: &[(String, f64)]) -> Vec<(String, f64)> {
    values.iter().map(|(n, _)| (n.clone(), 0.0)).collect()
}

fn write(out: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let file = out.join(name);
    std::fs::write(&file, bytes).map_err(|e| format!("{}: {e}", file.display()))
}
