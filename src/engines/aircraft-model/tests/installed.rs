//! The Baron 58P as installed on this PC, built and cast into, which measures 01-avatars'
//! budgets for the model, by hand (record/areas/build/plan.md, "17 Avatars"):
//!
//!   cargo test -p aircraft-model --release --test installed -- --ignored --nocapture
//!
//! It reads the packages folder from the Steam edition's `UserCfg.opt`, and fails on a PC
//! without the 58P installed in its Community folder.

// A test runs off the core's loop, so it reads files and the clock, which the root's
// clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods, clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::time::Instant;

use aircraft_model::{Aircraft, Model, Ray, Read, Scene, YokePart, build, wanted};

/// The 58P's figure's hand, 3.8cm on the probes' figure (read in
/// experiments/areas/avatars/p25-figure-hands.mjs, `HAND_RADIUS`).
const HAND_RADIUS: f32 = 0.038;

fn packages() -> String {
    let cfg = std::env::var("APPDATA").unwrap() + r"\Microsoft Flight Simulator 2024\UserCfg.opt";
    let text = std::fs::read_to_string(cfg).unwrap();
    let line = text
        .lines()
        .find_map(|l| l.trim_start().strip_prefix("InstalledPackagesPath "))
        .unwrap();
    line.trim().trim_matches('"').to_string()
}

fn baron() -> Aircraft {
    Aircraft {
        package: format!(r"{}\Community\bksq-aircraft-baronpro", packages()),
        path: "bksq-aircraft-baronpropress".into(),
        title: Some("Black Square Baron 58P Professional N513LW".into()),
        // The pilot's and the copilot's eyes, about 0.7m above the copilot's seat node,
        // `PILOT_1` at [-0.28, 0.13, -0.05], and its mirror; the profile's seats give the
        // real ones.
        eyes: vec![[0.28, 0.83, -0.02], [-0.28, 0.83, -0.02]],
        hand_radius: HAND_RADIUS,
    }
}

fn gather(aircraft: &Aircraft) -> BTreeMap<String, Option<Vec<u8>>> {
    let mut read: BTreeMap<String, Option<Vec<u8>>> = BTreeMap::new();
    loop {
        let next = wanted(aircraft, &|p| lookup(&read, p));
        if next.is_empty() {
            return read;
        }
        for p in next {
            let bytes = std::fs::read(&p).ok();
            read.insert(p, bytes);
        }
    }
}

fn lookup<'a>(read: &'a BTreeMap<String, Option<Vec<u8>>>, path: &str) -> Read<'a> {
    match read.get(path) {
        Some(Some(b)) => Read::Bytes(b),
        Some(None) => Read::Missing,
        None => Read::NotYet,
    }
}

fn p99(mut us: Vec<f64>) -> f64 {
    us.sort_by(f64::total_cmp);
    us[(us.len() * 99 / 100).min(us.len() - 1)]
}

#[test]
#[ignore = "needs the Baron 58P installed; run by hand for 01-avatars' budgets"]
fn the_58ps_model_builds_poses_and_casts_within_its_budgets() {
    let aircraft = baron();
    let start = Instant::now();
    let read = gather(&aircraft);
    let gathered = start.elapsed();
    let bytes = build(&aircraft, &|p| lookup(&read, p)).unwrap();
    let built = start.elapsed();
    let size = bytes.len();
    // The recording keeps the model's job's result at each load, compressed at the
    // recording's level (src/engines/recording-format/src/lib.rs, `LEVEL`).
    let recorded = zstd::bulk::compress(&bytes, 3).unwrap().len();
    // `Model::take` alone. The loop also copies the result in the kernel and for the recording,
    // which an engine's test can't reach (record/areas/avatars/log.md, 2026-11-04).
    let take = Instant::now();
    let mut model = Model::take(bytes).unwrap();
    let taken = take.elapsed();
    let first = Instant::now();
    model.pose();
    let first_pose = first.elapsed();
    println!(
        "in a recording, with zstd at level 3: {:.1} MB",
        recorded as f64 / 1e6
    );
    println!("first pose in {first_pose:?}");
    let report = model.report().clone();
    println!("files read: {} in {gathered:?}", read.len());
    println!(
        "built in {built:?}, the job's whole time, into {:.1} MB",
        size as f64 / 1e6
    );
    println!("taken in {taken:?}");
    println!(
        "codes: {} animation, {} visibility, {} posed; triangles: {}",
        report.animation_codes, report.visibility_codes, report.posed, report.triangles
    );
    for why in &report.not_posed {
        println!("  not posed: {why}");
    }
    println!("variables watched: {}", model.vars().len());
    for y in model.yokes() {
        println!(
            "yoke {} ({}): last {}, {} stages, grips {:?}",
            model.node_name(Scene::Interior, y.node).unwrap_or("?"),
            if y.left { "left" } else { "right" },
            model.node_name(Scene::Interior, y.last).unwrap_or("?"),
            y.stages.len(),
            y.grips
        );
        for s in &y.stages {
            println!(
                "  {}:{} x{} + {}",
                s.var.kind, s.var.name, s.slope, s.intercept
            );
        }
        let last = model.world(Scene::Interior, y.last).unwrap();
        println!(
            "  in the aircraft's frame: wheel {:?}, grips {:?}",
            model.world(Scene::Interior, y.node).unwrap().columns[3],
            y.grips.map(|g| last.point(g))
        );
    }
    println!("seat seeds: {:?}", model.seat_seeds());

    // Casts from the pilot's eye across the panel, each with a pose of its own, as a pilot's
    // clicks each come after the yoke moved.
    let yoke_x = model
        .vars()
        .iter()
        .position(|v| v.name == "YOKE X POSITION WITH AP LINEAR");
    let mut times = Vec::new();
    let mut parts = BTreeMap::new();
    for i in 0..2_000 {
        let (u, v) = ((i % 50) as f32 / 49.0, (i / 50) as f32 / 39.0);
        if let Some(x) = yoke_x {
            model.set(x, f64::from(u) * 100.0 - 50.0);
        }
        let ray = Ray {
            origin: aircraft.eyes[0],
            direction: [0.6 - 1.2 * u, -0.6 + 0.6 * v, 1.0],
        };
        let t = Instant::now();
        model.pose();
        let hit = model.cast(Scene::Interior, &ray, 10.0);
        times.push(t.elapsed().as_secs_f64() * 1e6);
        if let Some(hit) = hit {
            let part = model.yoke_part(hit.node).map(|(_, p)| p);
            *parts.entry(format!("{part:?}")).or_insert(0) += 1;
        }
    }
    println!(
        "cast with its posing: p99 {:.0}µs, slowest {:.0}µs",
        p99(times.clone()),
        times.iter().cloned().fold(0.0, f64::max)
    );
    println!("hits by yoke part: {parts:?}");
    assert!(built.as_secs_f64() < 2.0, "the model's job within 2s");
    assert!(size < 60_000_000, "the model under 60 MB");
    assert!(p99(times) < 500.0, "a cast within 0.5ms at p99");
    assert!(model.yokes().len() == 2, "both yokes");
    assert!(
        parts.contains_key(&format!("{:?}", Some(YokePart::Wheel))) || parts.contains_key("None")
    );
}
