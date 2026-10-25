//! What both commands start from: the connection, the loaded aircraft, its pose, and its own
//! model, read from its package on this PC as avatars' model job reads it, so the tool casts
//! into what avatars casts into (record/areas/avatars/01-avatars.md, "The aircraft model").

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use aircraft_model::{Aircraft, Hit, Model, Read, Scene};
use sim_client::message::{Camera, Message};
use sim_client::{Op, Period, Value, Var, Watch};
use simconnect_types::SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT;

use crate::ray::{self, AircraftPose};
use crate::screen::Cursor;
use crate::sim::{Events, Received, Sim};

/// A ray meets nothing farther than this, in meters, avatars' `MOST` in
/// src/features/avatars/core/src/mouse.rs.
const MOST: f32 = 20.0;

/// The figure's hand's radius, which the model's yoke grips sit out by, avatars'
/// `HAND_RADIUS` in src/features/avatars/core/src/hands.rs. The tool feeds no yoke, so it
/// only keeps the build the core's.
const HAND_RADIUS: f32 = 0.038;

/// Steam's `UserCfg.opt`, then the Microsoft Store's, each naming the packages folder, as the
/// sim service reads them in src/platform/sim-service/src/aircraft.rs, so change both
/// together.
const USER_CFGS: [(&str, &str); 2] = [
    ("APPDATA", r"Microsoft Flight Simulator 2024\UserCfg.opt"),
    (
        "LOCALAPPDATA",
        r"Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt",
    ),
];

/// The packages folders' children that hold packages, and how deep a package sits under
/// each, in the order the sim prefers a package found in two, as the sim service's `ROOTS`
/// in the same file.
const ROOTS: [(&str, u8); 4] = [
    ("Community2024", 1),
    ("Community", 1),
    ("Official2024", 2),
    ("Official2020", 2),
];

pub struct Cockpit {
    pub sim: Sim,
    pub events: Events,
    /// The aircraft's path below `SimObjects\Airplanes\`, as sim awareness gives it.
    pub aircraft: String,
    pub pose: AircraftPose,
    pub model: Model,
    watch: Option<Watch>,
}

impl Cockpit {
    pub fn connect() -> Result<Cockpit, String> {
        let events = Events::start();
        let mut sim = Sim::open(&events)?;
        println!("connected to the sim");
        let (request, op) = sim.client.system_state("AircraftLoaded");
        sim.make([op]);
        let file = sim.wait(&events, "the loaded aircraft", |_, r| match r {
            Received::Message(Message::SystemState {
                request: q, text, ..
            }) if *q == request => Some(text.clone()),
            _ => None,
        })?;
        let aircraft = sim_awareness::aircraft(&file)
            .ok_or_else(|| format!("the sim names no aircraft in SimObjects\\Airplanes\\, but {file}: load a flight first"))?;
        let vars = [
            Var::text("A:TITLE"),
            Var::number("A:PLANE LATITUDE", "degrees"),
            Var::number("A:PLANE LONGITUDE", "degrees"),
            Var::number("A:PLANE ALTITUDE", "feet"),
            Var::number("A:PLANE HEADING DEGREES TRUE", "degrees"),
            Var::number("A:PLANE PITCH DEGREES", "degrees"),
            Var::number("A:PLANE BANK DEGREES", "degrees"),
        ];
        let (watch, ops) = sim.client.watch(&(), &vars, Period::Once);
        sim.make(ops);
        let values = sim.wait(
            &events,
            "the aircraft's title and pose",
            |client, r| match r {
                Received::Message(Message::ObjectData(d)) if d.request == watch.request => {
                    client.values(d)
                }
                _ => None,
            },
        )?;
        let mut title = None;
        let mut pose = [0.0; 6];
        for (i, value) in values {
            match value {
                Value::Text(t) if i == 0 && !t.is_empty() => title = Some(t),
                Value::Number(n) if (1..=6).contains(&i) => pose[i - 1] = n,
                _ => {}
            }
        }
        let [latitude, longitude, altitude, heading, pitch, bank] = pose;
        let pose = AircraftPose {
            latitude,
            longitude,
            altitude,
            heading,
            pitch,
            bank,
        };
        println!(
            "aircraft: {} ({}), heading {heading:.1}° true, pitch {pitch:.1}°, bank {bank:.1}°",
            aircraft.path,
            title.as_deref().unwrap_or("no title")
        );
        let folder = aircraft.folder().to_string();
        let package = package(&packages_folders(), &folder).ok_or_else(|| {
            format!("no package on this PC holds SimObjects\\Airplanes\\{folder}: a streamed aircraft keeps no model on disk")
        })?;
        println!("package: {}", package.display());
        let model = build(&Aircraft {
            package: package.to_string_lossy().into_owned(),
            path: aircraft.path.clone(),
            title,
            eyes: Vec::new(),
            hand_radius: HAND_RADIUS,
        })?;
        let report = model.report();
        println!(
            "model: {} triangles; {} of {} animation and visibility codes posed",
            report.triangles,
            report.posed,
            report.animation_codes + report.visibility_codes
        );
        let mut cockpit = Cockpit {
            sim,
            events,
            aircraft: aircraft.path,
            pose,
            model,
            watch: None,
        };
        cockpit.watch_model();
        Ok(cockpit)
    }

    /// Watches the variables the model's code reads, so each cast meets the cockpit as it is,
    /// a guard's cover open or a part hidden.
    fn watch_model(&mut self) {
        let vars: Vec<Var> = self.model.vars().iter().map(sim_var).collect();
        if vars.is_empty() {
            return;
        }
        let (watch, ops) = self.sim.client.watch(&(), &vars, Period::OnChange);
        self.sim.make(ops);
        self.watch = Some(watch);
    }

    /// Takes the values of the model's variables from what the sim handed up, when that's
    /// what it is.
    pub fn take(&mut self, received: &Received) -> bool {
        let (Some(watch), Received::Message(Message::ObjectData(d))) = (self.watch, received)
        else {
            return false;
        };
        if d.request != watch.request {
            return false;
        }
        for (i, value) in self.sim.client.values(d).unwrap_or_default() {
            if let Value::Number(n) = value {
                self.model.set(i, n);
            }
        }
        true
    }

    /// The camera, in the aircraft's frame, which the sim answers with no request of its own.
    pub fn ask_camera(&mut self) {
        self.sim.make([Op::CameraGet {
            referential: SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT as u32,
        }]);
    }
}

/// A model variable as the sim client names it, `A:` or `L:` with its unit, or `number` for
/// code that names none, as avatars' `sim_var` in src/features/avatars/core/src/model.rs.
fn sim_var(var: &aircraft_model::Var) -> Var {
    let unit = if var.unit.is_empty() {
        "number"
    } else {
        &var.unit
    };
    Var::number(&format!("{}:{}", var.kind, var.name), unit)
}

/// What the cursor points at: the ray from the camera through it, into the interior while the
/// camera is inside it and the exterior otherwise, with the model posed first.
pub fn cast(model: &mut Model, camera: &Camera, cursor: &Cursor) -> Option<(Hit, Scene)> {
    let ray = ray::cockpit(camera, cursor.x, cursor.y, cursor.aspect());
    let scene = if model.inside(ray.origin) {
        Scene::Interior
    } else {
        Scene::Exterior
    };
    model.pose();
    model.cast(scene, &ray, MOST).map(|hit| (hit, scene))
}

/// The packages folders each `UserCfg.opt` names on its `InstalledPackagesPath` line.
fn packages_folders() -> Vec<String> {
    USER_CFGS
        .iter()
        .filter_map(|(variable, rest)| {
            let cfg = Path::new(&std::env::var_os(variable)?).join(rest);
            let text = std::fs::read_to_string(cfg).ok()?;
            let line = text
                .lines()
                .find_map(|l| l.trim_start().strip_prefix("InstalledPackagesPath "))?;
            let folder = line.trim().trim_matches('"').trim_end_matches('\\');
            (!folder.is_empty()).then(|| folder.to_string())
        })
        .collect()
}

/// The package that holds the aircraft's folder, in the first root the sim prefers.
fn package(folders: &[String], aircraft: &str) -> Option<PathBuf> {
    let holds = |p: &Path| {
        p.join("SimObjects")
            .join("Airplanes")
            .join(aircraft)
            .is_dir()
    };
    let children = |p: &Path| -> Vec<PathBuf> {
        let mut found: Vec<PathBuf> = std::fs::read_dir(p)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        found.sort();
        found
    };
    for (root, depth) in ROOTS {
        for folder in folders {
            let mut level = vec![Path::new(folder).join(root)];
            for _ in 1..depth {
                level = level.iter().flat_map(|p| children(p)).collect();
            }
            if let Some(p) = level.iter().flat_map(|p| children(p)).find(|p| holds(p)) {
                return Some(p);
            }
        }
    }
    None
}

/// Reads every file the model names, one round at a time, as avatars' model job does, and
/// builds the model.
fn build(aircraft: &Aircraft) -> Result<Model, String> {
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
    let bytes = aircraft_model::build(aircraft, &|p| lookup(&read, p))
        .map_err(|e| format!("the aircraft's model didn't build: {e}"))?;
    Model::take(bytes)
}

fn lookup<'a>(read: &'a BTreeMap<String, Option<Vec<u8>>>, path: &str) -> Read<'a> {
    match read.get(path) {
        Some(Some(b)) => Read::Bytes(b),
        Some(None) => Read::Missing,
        None => Read::NotYet,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const PACKAGE: &str = r"C:\Packages\Community\fixture";

    /// A cockpit of three boxes: a floor, whose length makes the interior's box hold the
    /// pilot's eye, a panel 0.95m ahead of the reference point, and a switch on it, 0.2m right
    /// of the pilot's eye.
    fn package() -> BTreeMap<String, Vec<u8>> {
        let mut bin = Vec::new();
        let (mut views, mut accessors, mut meshes) = (Vec::new(), Vec::new(), Vec::new());
        let mut cuboid = |min: [f32; 3], max: [f32; 3]| {
            let at = bin.len();
            for i in 0..8 {
                for k in 0..3 {
                    let v = if i & (1 << k) == 0 { min[k] } else { max[k] };
                    bin.extend_from_slice(&v.to_le_bytes());
                }
            }
            views.push(json!({ "buffer": 0, "byteOffset": at, "byteLength": 96 }));
            accessors.push(json!({ "bufferView": views.len() - 1, "componentType": 5126, "count": 8, "type": "VEC3" }));
            let faces: [u16; 36] = [
                0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0,
                6, 4, 1, 5, 7, 1, 7, 3,
            ];
            let at = bin.len();
            for f in faces {
                bin.extend_from_slice(&f.to_le_bytes());
            }
            views.push(json!({ "buffer": 0, "byteOffset": at, "byteLength": 72 }));
            accessors.push(json!({ "bufferView": views.len() - 1, "componentType": 5123, "count": 36, "type": "SCALAR" }));
            meshes.push(json!({ "primitives": [{
                "attributes": { "POSITION": accessors.len() - 2 }, "indices": accessors.len() - 1, "material": 0,
            }]}));
            meshes.len() - 1
        };
        let floor = cuboid([-1.0, -0.5, -2.0], [1.0, -0.45, 2.0]);
        let panel = cuboid([-1.0, 0.0, 0.95], [1.0, 1.2, 1.05]);
        let switch = cuboid([-0.01, -0.03, -0.02], [0.01, 0.03, 0.0]);
        let nodes: Vec<Value> = vec![
            json!({ "name": "Cabin", "children": [1, 2, 3] }),
            json!({ "name": "Floor", "mesh": floor }),
            json!({ "name": "Panel", "mesh": panel }),
            json!({ "name": "Switch_Battery", "mesh": switch, "translation": [0.1, 0.8, 0.95] }),
        ];
        let gltf = json!({
            "extensionsRequired": ["MSFT_texture_dds"],
            "nodes": nodes,
            "meshes": meshes,
            "materials": [{ "name": "Plastic" }],
            "accessors": accessors,
            "bufferViews": views,
            "buffers": [{ "uri": "fixture_INT.bin", "byteLength": bin.len() }],
        });
        let folder = format!(r"{PACKAGE}\SimObjects\Airplanes\fixture-plane");
        BTreeMap::from([
            (format!(r"{folder}\aircraft.cfg"), b"[FLTSIM.0]\ntitle = \"Fixture\"\n".to_vec()),
            (format!(r"{folder}\model\model.cfg"), b"[models]\ninterior = fixture_INT.xml\n".to_vec()),
            (
                format!(r"{folder}\model\fixture_INT.xml"),
                br#"<ModelInfo><LODS><LOD minSize="80" ModelFile="fixture_INT.gltf"/></LODS></ModelInfo>"#.to_vec(),
            ),
            (format!(r"{folder}\model\fixture_INT.gltf"), gltf.to_string().into_bytes()),
            (format!(r"{folder}\model\fixture_INT.bin"), bin),
        ])
    }

    fn model() -> Model {
        let disk = package();
        let aircraft = Aircraft {
            package: PACKAGE.into(),
            path: "fixture-plane".into(),
            title: None,
            eyes: Vec::new(),
            hand_radius: HAND_RADIUS,
        };
        let mut read = BTreeMap::new();
        loop {
            let next = aircraft_model::wanted(&aircraft, &|p| lookup(&read, p));
            if next.is_empty() {
                break;
            }
            for p in next {
                let bytes = disk.get(&p).cloned();
                read.insert(p, bytes);
            }
        }
        Model::take(aircraft_model::build(&aircraft, &|p| lookup(&read, p)).unwrap()).unwrap()
    }

    #[test]
    fn a_cast_from_the_camera_through_the_cursor_meets_what_it_points_at() {
        let mut model = model();
        let camera = Camera {
            position: [0.3, 0.8, 0.0],
            referential: SIMCONNECT_POSITION_REFERENTIAL_SIMOBJECT as u32,
            fov: 0.9,
            ..Camera::default()
        };
        let mut cursor = Cursor {
            x: 0.0,
            y: 0.0,
            width: 1920,
            height: 1080,
        };
        let (hit, scene) = cast(&mut model, &camera, &cursor).unwrap();
        assert_eq!(scene, Scene::Interior);
        assert_eq!(model.node_name(scene, hit.node), Some("Panel"));
        assert!((hit.point[2] - 0.95).abs() < 1e-4, "{hit:?}");
        // The switch's face sits 0.93m ahead and 0.2m right of the eye, and right is −x.
        cursor.x = (0.2 / 0.93) / ((camera.fov as f32 / 2.0).tan() * cursor.aspect());
        let (hit, scene) = cast(&mut model, &camera, &cursor).unwrap();
        assert_eq!(model.node_name(scene, hit.node), Some("Switch_Battery"));
        let expected = [0.1, 0.8, 0.93];
        assert!(
            (0..3).all(|k| (hit.point[k] - expected[k]).abs() < 2e-3),
            "{hit:?}"
        );
        cursor.y = 1.0;
        cursor.x = 0.0;
        let camera = Camera {
            pitch: -80.0,
            ..camera
        };
        assert!(
            cast(&mut model, &camera, &cursor).is_none(),
            "the ray up past the panel meets nothing"
        );
    }
}
