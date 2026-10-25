// Tests may panic and build their fixtures freely.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::*;

const PACKAGE: &str = r"C:\Packages\Community\test-aircraft";

/// A glTF and its buffer, built from boxes.
struct Gltf {
    nodes: Vec<Value>,
    meshes: Vec<Value>,
    accessors: Vec<Value>,
    views: Vec<Value>,
    animations: Vec<Value>,
    bin: Vec<u8>,
}

impl Gltf {
    fn new() -> Gltf {
        Gltf {
            nodes: Vec::new(),
            meshes: Vec::new(),
            accessors: Vec::new(),
            views: Vec::new(),
            animations: Vec::new(),
            bin: Vec::new(),
        }
    }

    fn floats(&mut self, values: &[f32], kind: &str, count: usize) -> usize {
        let at = self.bin.len();
        for v in values {
            self.bin.extend_from_slice(&v.to_le_bytes());
        }
        self.views
            .push(json!({ "buffer": 0, "byteOffset": at, "byteLength": values.len() * 4 }));
        self.accessors.push(json!({
            "bufferView": self.views.len() - 1, "componentType": 5126, "count": count, "type": kind,
        }));
        self.accessors.len() - 1
    }

    /// A box from `min` to `max`, as a mesh, with a material.
    fn cuboid(&mut self, min: [f32; 3], max: [f32; 3], material: usize) -> usize {
        let mut p = Vec::new();
        for i in 0..8 {
            p.push(if i & 1 == 0 { min[0] } else { max[0] });
            p.push(if i & 2 == 0 { min[1] } else { max[1] });
            p.push(if i & 4 == 0 { min[2] } else { max[2] });
        }
        let positions = self.floats(&p, "VEC3", 8);
        let faces: [u16; 36] = [
            0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6,
            4, 1, 5, 7, 1, 7, 3,
        ];
        let at = self.bin.len();
        for f in faces {
            self.bin.extend_from_slice(&f.to_le_bytes());
        }
        while !self.bin.len().is_multiple_of(4) {
            self.bin.push(0);
        }
        self.views
            .push(json!({ "buffer": 0, "byteOffset": at, "byteLength": 72 }));
        self.accessors.push(json!({
            "bufferView": self.views.len() - 1, "componentType": 5123, "count": 36, "type": "SCALAR",
        }));
        self.meshes.push(json!({ "primitives": [{
            "attributes": { "POSITION": positions }, "indices": self.accessors.len() - 1, "material": material,
        }]}));
        self.meshes.len() - 1
    }

    fn node(&mut self, node: Value) -> usize {
        self.nodes.push(node);
        self.nodes.len() - 1
    }

    fn child(&mut self, parent: usize, child: usize) {
        let children = self.nodes[parent]
            .as_object_mut()
            .unwrap()
            .entry("children")
            .or_insert(json!([]));
        children.as_array_mut().unwrap().push(json!(child));
    }

    /// An animation over 1s that moves a node from `from` to `to`.
    fn animation(&mut self, name: &str, nodes: &[usize], path: &str, from: &[f32], to: &[f32]) {
        let times = self.floats(&[0.0, 1.0], "SCALAR", 2);
        let kind = if from.len() == 4 { "VEC4" } else { "VEC3" };
        let values: Vec<f32> = from.iter().chain(to).copied().collect();
        let output = self.floats(&values, kind, 2);
        let channels: Vec<Value> = nodes
            .iter()
            .map(|n| json!({ "sampler": 0, "target": { "node": n, "path": path } }))
            .collect();
        self.animations.push(json!({
            "name": name,
            "samplers": [{ "input": times, "output": output }],
            "channels": channels,
        }));
    }

    fn files(self, name: &str) -> (Vec<u8>, Vec<u8>) {
        let json = json!({
            "extensionsRequired": ["MSFT_texture_dds"],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": [
                { "name": "Plastic" },
                { "name": "Shell", "extensions": { "ASOBO_material_invisible": {} } },
            ],
            "accessors": self.accessors,
            "bufferViews": self.views,
            "buffers": [{ "uri": format!("{name}.bin"), "byteLength": self.bin.len() }],
            "animations": self.animations,
        });
        (json.to_string().into_bytes(), self.bin)
    }
}

/// A quaternion turning by `degrees` about z.
fn about_z(degrees: f32) -> [f32; 4] {
    let half = degrees.to_radians() / 2.0;
    [0.0, 0.0, half.sin(), half.cos()]
}

/// A small aircraft: a panel 1m ahead, a switch on it, an invisible shell around the cabin,
/// and the pilot's yoke, which moves fore and aft and rolls, marked with its grips, with a
/// copilot's yoke that repeats its nodes with `_R`.
fn interior() -> (Vec<u8>, Vec<u8>) {
    let mut g = Gltf::new();
    let root = g.node(json!({ "name": "Cabin" }));
    let panel_mesh = g.cuboid([-1.0, 0.0, 0.95], [1.0, 1.2, 1.05], 0);
    let panel = g.node(json!({ "name": "Panel", "mesh": panel_mesh }));
    g.child(root, panel);
    let switch_mesh = g.cuboid([-0.01, -0.03, -0.02], [0.01, 0.03, 0.0], 0);
    let switch = g.node(
        json!({ "name": "Switch_Battery", "mesh": switch_mesh, "translation": [0.3, 0.8, 0.95] }),
    );
    g.child(root, switch);
    let shell_mesh = g.cuboid([-1.5, -0.5, -2.0], [1.5, 1.6, 2.0], 1);
    let shell = g.node(json!({ "name": "Shell", "mesh": shell_mesh }));
    g.child(root, shell);
    let pilot = g.node(json!({ "name": "PILOT_0", "translation": [0.3, 0.4, -0.2] }));
    g.child(root, pilot);
    let horn = g.cuboid([-0.15, -0.03, -0.02], [0.15, 0.03, 0.02], 0);
    let mut yoke = |side: &str, x: f32| {
        let visibility = g.node(
            json!({ "name": format!("YOKE_{side}_VISIBILITY"), "translation": [x, 0.7, 0.7] }),
        );
        let pitch = g.node(json!({ "name": format!("YokePitch_{}", &side[..1]) }));
        let roll = g.node(json!({ "name": format!("YokeRoll_{}", &side[..1]) }));
        let wheel = g.node(json!({ "name": format!("Yoke_{}", &side[..1]), "mesh": horn }));
        g.child(root, visibility);
        g.child(visibility, pitch);
        g.child(pitch, roll);
        g.child(roll, wheel);
        (pitch, roll, wheel)
    };
    let (pitch_l, roll_l, wheel_l) = yoke("LEFT", 0.3);
    let (pitch_r, roll_r, _) = yoke("RIGHT", -0.3);
    // The grips sit inside the horn, 12cm either side of the wheel's center.
    let grip_left =
        g.node(json!({ "name": "HANDLING_Yoke_1_Hand_Left", "translation": [0.12, 0.0, 0.0] }));
    let grip_right =
        g.node(json!({ "name": "HANDLING_Yoke_1_Hand_Right", "translation": [-0.12, 0.0, 0.0] }));
    g.child(wheel_l, grip_left);
    g.child(wheel_l, grip_right);
    let button_mesh = g.cuboid([-0.005, -0.005, -0.03], [0.005, 0.005, -0.02], 0);
    let button = g.node(
        json!({ "name": "YokeButton_L", "mesh": button_mesh, "translation": [0.1, 0.0, 0.0] }),
    );
    g.child(wheel_l, button);
    // Fore and aft, 10cm each way; rolled 90° each way.
    g.animation(
        "HANDLING_Yoke_Lever_StickForeAft",
        &[pitch_l, pitch_r],
        "translation",
        &[0.0, 0.0, -0.1],
        &[0.0, 0.0, 0.1],
    );
    g.animation(
        "HANDLING_YOKE_LEVER_StickLR",
        &[roll_l, roll_r],
        "rotation",
        &about_z(90.0),
        &about_z(-90.0),
    );
    g.animation(
        "Switch_Battery",
        &[switch],
        "rotation",
        &about_z(0.0),
        &about_z(60.0),
    );
    g.animation(
        "YokeButton_L",
        &[button],
        "translation",
        &[0.1, 0.0, 0.0],
        &[0.1, 0.0, 0.01],
    );
    g.animation(
        "Shell_Flutter",
        &[shell],
        "rotation",
        &about_z(0.0),
        &about_z(1.0),
    );
    g.files("test_INT")
}

fn exterior() -> (Vec<u8>, Vec<u8>) {
    let mut g = Gltf::new();
    let mesh = g.cuboid([-5.0, -1.0, -4.0], [5.0, 1.5, 4.0], 0);
    let body = g.node(json!({ "name": "Fuselage", "mesh": mesh }));
    let _ = body;
    g.files("test_EXT")
}

fn package() -> BTreeMap<String, Vec<u8>> {
    let folder = format!(r"{PACKAGE}\SimObjects\Airplanes\test-plane");
    let mut files = BTreeMap::new();
    let mut put = |path: String, bytes: Vec<u8>| {
        files.insert(path, bytes);
    };
    put(
        format!(r"{folder}\aircraft.cfg"),
        b"[FLTSIM.0]\ntitle = \"Test Plane Red\" ; the red one\nmodel = \"\"\n\n[FLTSIM.1]\ntitle = \"Test Plane Blue\"\nmodel = \"blue\"\n".to_vec(),
    );
    put(
        format!(r"{folder}\model\model.cfg"),
        b"[models]\nnormal = test_EXT.xml\ninterior = test_INT.xml\n".to_vec(),
    );
    put(
        format!(r"{folder}\model\test_INT.xml"),
        br#"<?xml version="1.0" encoding="utf-8"?>
<ModelInfo>
  <LODS>
    <LOD minSize="10" ModelFile="test_INT_LOD1.gltf"/>
    <LOD minSize="80" ModelFile="test_INT.gltf"/>
  </LODS>
  <Behaviors>
    <IncludeBase RelativeFile="..\common\base_INT.xml"/>
  </Behaviors>
</ModelInfo>"#
            .to_vec(),
    );
    put(
        format!(r"{folder}\common\base_INT.xml"),
        br#"<?xml version="1.0" encoding="utf-8"?>
<ModelInfo>
  <LODS><LOD minSize="80" ModelFile="never_read.gltf"/></LODS>
  <Behaviors>
    <Include ModelBehaviorFile="Asobo\Common.xml"/>
    <Include RelativeFile="templates.xml"/>
    <Macro Name="Locked">(L:test_controlLocks, bool)</Macro>
    <Component ID="YOKES">
      <Component ID="YokePitch_L" Node="YokePitch_L">
        <UseTemplate Name="ASOBO_GT_Anim_Code">
          <ANIM_NAME>HANDLING_Yoke_Lever_StickForeAft</ANIM_NAME>
          <ANIM_CODE>(A:YOKE Y POSITION WITH AP, Percent) @Locked if{ -1 max 1 min } 2 / 50 +</ANIM_CODE>
        </UseTemplate>
        <UseTemplate Name="ASOBO_GT_Anim_Code">
          <ANIM_NAME>HANDLING_YOKE_LEVER_StickLR</ANIM_NAME>
          <ANIM_CODE>(A:YOKE X POSITION WITH AP LINEAR, Percent) @Locked if{ -1 max 1 min } 2 / 50 +</ANIM_CODE>
        </UseTemplate>
        <UseTemplate Name="ASOBO_GT_Push_Button">
          <ANIM_NAME>YokeButton_L</ANIM_NAME>
        </UseTemplate>
      </Component>
    </Component>
    <Component ID="Battery" Node="Switch_Battery">
      <UseTemplate Name="TEST_SWITCH">
        <SWITCH_VAR>TEST_Battery</SWITCH_VAR>
      </UseTemplate>
    </Component>
    <Component ID="Covered" Node="Panel">
      <UseTemplate Name="ASOBO_GT_Visibility_Code">
        <VISIBILITY_CODE>(L:test_PanelShown, bool)</VISIBILITY_CODE>
      </UseTemplate>
    </Component>
    <Component ID="Flutter" Node="Shell">
      <UseTemplate Name="ASOBO_GT_Anim_Code">
        <ANIM_NAME>Shell_Flutter</ANIM_NAME>
        <ANIM_CODE>(O:flutter) 1 + d (&gt;O:flutter)</ANIM_CODE>
      </UseTemplate>
    </Component>
  </Behaviors>
</ModelInfo>"#
            .to_vec(),
    );
    put(
        format!(r"{folder}\common\templates.xml"),
        br#"<ModelBehaviors>
  <Template Name="TEST_SWITCH">
    <Parameters Type="Default">
      <SWITCH_RANGE>100</SWITCH_RANGE>
      <SWITCH_VAR>never</SWITCH_VAR>
    </Parameters>
    <Condition Valid="SWITCH_VAR">
      <True>
        <UseTemplate Name="ASOBO_GT_Anim_Code">
          <ANIM_NAME>Switch_Battery</ANIM_NAME>
          <ANIM_CODE>(L:#SWITCH_VAR#, bool) #SWITCH_RANGE# *</ANIM_CODE>
        </UseTemplate>
      </True>
    </Condition>
  </Template>
</ModelBehaviors>"#
            .to_vec(),
    );
    put(
        format!(r"{folder}\model\test_EXT.xml"),
        br#"<ModelInfo><LODS><LOD minSize="80" ModelFile="test_EXT.gltf"/></LODS></ModelInfo>"#
            .to_vec(),
    );
    let (json, bin) = interior();
    put(format!(r"{folder}\model\test_INT.gltf"), json);
    put(format!(r"{folder}\model\test_INT.bin"), bin);
    let (json, bin) = exterior();
    put(format!(r"{folder}\model\test_EXT.gltf"), json);
    put(format!(r"{folder}\model\test_EXT.bin"), bin);
    files
}

fn aircraft() -> Aircraft {
    Aircraft {
        package: PACKAGE.into(),
        path: "test-plane".into(),
        title: Some("Test Plane Red".into()),
        eyes: vec![[0.3, 1.1, 0.0], [-0.3, 1.1, 0.0]],
        hand_radius: 0.038,
    }
}

/// Reads as the edge's job does: each file `wanted` names, until it names none.
fn gather(disk: &BTreeMap<String, Vec<u8>>) -> (BTreeMap<String, Option<Vec<u8>>>, u32) {
    let aircraft = aircraft();
    let mut read: BTreeMap<String, Option<Vec<u8>>> = BTreeMap::new();
    let mut rounds = 0;
    loop {
        let next = wanted(&aircraft, &|p| lookup(&read, p));
        if next.is_empty() {
            return (read, rounds);
        }
        rounds += 1;
        assert!(rounds < 20, "the walk keeps asking: {next:?}");
        for p in next {
            read.insert(p.clone(), disk.get(&p).cloned());
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

fn model() -> Model {
    let (read, _) = gather(&package());
    let bytes = build(&aircraft(), &|p| lookup(&read, p)).unwrap();
    Model::take(bytes).unwrap()
}

#[test]
fn the_walk_reads_the_model_files_and_none_the_included_file_names_for_itself() {
    let (read, rounds) = gather(&package());
    let read: Vec<&str> = read
        .keys()
        .map(|k| k.rsplit('\\').next().unwrap())
        .collect();
    for f in [
        "aircraft.cfg",
        "model.cfg",
        "test_INT.xml",
        "base_INT.xml",
        "templates.xml",
        "test_INT.gltf",
        "test_INT.bin",
        "test_EXT.gltf",
    ] {
        assert!(read.contains(&f), "{f} in {read:?}");
    }
    for f in ["never_read.gltf", "test_INT_LOD1.gltf"] {
        assert!(!read.contains(&f), "{f} in {read:?}");
    }
    assert!(rounds <= 6, "{rounds} rounds");
}

#[test]
fn the_flight_sims_title_picks_its_model_folder() {
    let mut blue = aircraft();
    blue.title = Some("Test Plane Blue".into());
    let disk = package();
    let next = wanted(&blue, &|p| {
        if p.ends_with("aircraft.cfg") && !p.contains("config") {
            Read::Bytes(&disk[p])
        } else {
            Read::NotYet
        }
    });
    assert!(
        next.iter().any(|p| p.ends_with(r"model.blue\model.cfg")),
        "{next:?}"
    );
}

#[test]
fn templates_macros_and_includes_pose_the_cockpit() {
    let model = model();
    let report = model.report();
    assert_eq!(report.animation_codes, 4, "{report:?}");
    assert_eq!(report.visibility_codes, 1, "{report:?}");
    assert_eq!(
        report.posed, 4,
        "the flutter keeps its own state: {report:?}"
    );
    assert!(
        report.not_posed[0].contains("keeps its own state"),
        "{report:?}"
    );
    let names: Vec<String> = model
        .vars()
        .iter()
        .map(|v| format!("{}:{}", v.kind, v.name))
        .collect();
    for v in [
        "A:YOKE Y POSITION WITH AP",
        "A:YOKE X POSITION WITH AP LINEAR",
        "L:test_controlLocks",
        "L:TEST_Battery",
        "L:test_PanelShown",
    ] {
        assert!(names.contains(&v.to_string()), "{v} in {names:?}");
    }
}

#[test]
fn a_cast_meets_the_panel_through_the_invisible_shell_and_a_hidden_node_lets_it_pass() {
    let mut model = model();
    let shown = model
        .vars()
        .iter()
        .position(|v| v.name == "test_PanelShown")
        .unwrap();
    model.set(shown, 1.0);
    model.pose();
    let ray = Ray {
        origin: [-0.5, 0.5, 0.0],
        direction: [0.0, 0.0, 1.0],
    };
    let hit = model.cast(Scene::Interior, &ray, 10.0).unwrap();
    assert_eq!(model.node_name(Scene::Interior, hit.node), Some("Panel"));
    assert!((hit.point[2] - 0.95).abs() < 1e-4, "{hit:?}");
    model.set(shown, 0.0);
    model.pose();
    assert!(
        model.cast(Scene::Interior, &ray, 10.0).is_none(),
        "the panel hides, and the shell is invisible"
    );
}

#[test]
fn a_switch_moves_with_its_variable_and_the_cast_follows_it() {
    let mut model = model();
    let battery = model
        .vars()
        .iter()
        .position(|v| v.name == "TEST_Battery")
        .unwrap();
    model.pose();
    let off = model.world(Scene::Interior, 2).unwrap();
    model.set(battery, 1.0);
    model.pose();
    let on = model.world(Scene::Interior, 2).unwrap();
    assert_ne!(off, on, "the switch turned");
    // At 1 the code gives frame 100 of 100, the animation's end, 60° about z.
    let x = on.vector([1.0, 0.0, 0.0]);
    assert!((x[1] - 60f32.to_radians().sin()).abs() < 1e-4, "{x:?}");
}

#[test]
fn the_yokes_hold_their_grips_on_the_horn_and_play_from_one_variable_each() {
    let model = model();
    let yokes = model.yokes();
    assert_eq!(yokes.len(), 2, "the pilot's, and its copy on the copilot's");
    let pilot = yokes.iter().find(|y| y.left).unwrap();
    assert_eq!(model.node_name(Scene::Interior, pilot.node), Some("Yoke_L"));
    assert_eq!(
        model.node_name(Scene::Interior, pilot.last),
        Some("YokeRoll_L")
    );
    assert_eq!(pilot.stages.len(), 2);
    assert_eq!(pilot.stages[0].var.name, "YOKE Y POSITION WITH AP");
    assert_eq!(
        (pilot.stages[0].slope, pilot.stages[0].intercept),
        (0.5, 50.0)
    );
    assert_eq!(pilot.stages[1].var.name, "YOKE X POSITION WITH AP LINEAR");
    assert_eq!(pilot.stages[0].samples.len(), 21);
    // The horn's back face is 2cm behind the wheel's center, toward the eye, so a grip sits a
    // hand's radius behind it, and the left hand's farther left.
    let [left, right] = pilot.grips;
    assert!((left[2] - (-0.02 - 0.038)).abs() < 1e-3, "{left:?}");
    assert!(left[0] > right[0], "{left:?} {right:?}");
    let copilot = yokes.iter().find(|y| !y.left).unwrap();
    assert_eq!(
        model.node_name(Scene::Interior, copilot.node),
        Some("Yoke_R")
    );
    assert!(
        (copilot.grips[0][2] - (-0.02 - 0.038)).abs() < 1e-3,
        "{:?}",
        copilot.grips
    );
}

#[test]
fn a_button_on_the_yoke_is_told_from_the_wheel() {
    let model = model();
    let node = |name: &str| {
        (0..40)
            .find(|&n| model.node_name(Scene::Interior, n) == Some(name))
            .unwrap()
    };
    assert_eq!(
        model.yoke_part(node("YokeButton_L")),
        Some((0, YokePart::Button))
    );
    assert_eq!(model.yoke_part(node("Yoke_L")), Some((0, YokePart::Wheel)));
    assert_eq!(model.yoke_part(node("Panel")), None);
}

#[test]
fn inside_is_the_interior_box_and_the_seats_seed_from_pilot_nodes() {
    let model = model();
    assert!(
        model.inside([0.3, 0.8, 0.5]),
        "the shell is invisible, but the cabin's box holds the panel and yokes"
    );
    assert!(!model.inside([0.0, 0.5, -8.0]));
    assert_eq!(
        model.seat_seeds(),
        &[("PILOT_0".to_string(), [0.3, 0.4, -0.2])]
    );
}

#[test]
fn a_buffer_from_another_layout_or_not_a_model_is_refused() {
    assert!(Model::take(b"not a model".to_vec()).is_err());
    let (read, _) = gather(&package());
    let mut bytes = build(&aircraft(), &|p| lookup(&read, p)).unwrap();
    bytes[4] = 99;
    assert!(Model::take(bytes).err().unwrap().contains("version"));
}

#[test]
fn a_missing_aircraft_says_which_files_it_looked_for() {
    let mut other = aircraft();
    other.path = "no-such-plane".into();
    let disk = package();
    let mut read = BTreeMap::new();
    for _ in 0..3 {
        for p in wanted(&other, &|p| lookup(&read, p)) {
            read.insert(p.clone(), disk.get(&p).cloned());
        }
    }
    let error = build(&other, &|p| lookup(&read, p)).err().unwrap();
    assert!(error.contains("no-such-plane"), "{error}");
}
