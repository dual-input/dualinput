//! The built model: one buffer, which the loop takes and reads in place, and the pose it
//! keeps beside it.
//!
//! The buffer opens with a header, then the small part, postcard-encoded: which code drives
//! which animation and visibility, the programs, the variables, and the yokes. Then comes
//! the large part, read where it lies: each scene's nodes, their names, its instances and
//! meshes, each mesh's positions, triangles, and BVH, and each animation's keys. So taking
//! the 58P's model decodes a few kilobytes, where decoding its nodes' names and keys too took
//! 0.79ms of a handler's 1ms (measured on our development machine, 2026-10-25,
//! tests/installed.rs).

use bytemuck::{Pod, Zeroable};
use msfs_rpn::{Program, Scratch, Var};
use ray_cast::{Aabb, Affine, BvhNode, Candidate, Mesh, Ray, Vec3};
use serde::{Deserialize, Serialize};

/// The buffer's first bytes, and its layout's version, which a model built by another layout
/// fails on, rather than misread.
pub(crate) const MAGIC: [u8; 4] = *b"DIAM";
pub(crate) const VERSION: u32 = 1;
pub(crate) const HEADER: usize = 16;

/// Which of the aircraft's two models.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Scene {
    Interior,
    Exterior,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Meta {
    pub(crate) interior: Option<SceneMeta>,
    pub(crate) exterior: Option<SceneMeta>,
    pub(crate) programs: Vec<ProgramMeta>,
    pub(crate) vars: Vec<Var>,
    pub(crate) yokes: Vec<Yoke>,
    pub(crate) seats: Vec<(String, Vec3)>,
    pub(crate) report: Report,
}

/// A run of records in the large part: its offset from the large part's start, and how many.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Span {
    pub(crate) at: u64,
    pub(crate) count: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct SceneMeta {
    /// `NodeRecord`s.
    pub(crate) nodes: Span,
    /// The nodes' names, one after another, which each record points into.
    pub(crate) names: Span,
    /// Each node's place, after every one above it, so worlds compose in one pass.
    pub(crate) order: Span,
    /// `InstanceRecord`s.
    pub(crate) instances: Span,
    /// `GeometryRecord`s.
    pub(crate) geometries: Span,
    pub(crate) animations: Vec<AnimationMeta>,
    pub(crate) visibility: Vec<(u32, u32)>,
    /// The box around every primitive at rest, the invisible ones included, in the model's
    /// frame.
    pub(crate) bounds: (Vec3, Vec3),
}

/// A node, 64 bytes: its parent, `NO_PARENT` for a root; whether an animation moves it and
/// whether it's stored as a matrix; its name in `SceneMeta::names`; and its transform at rest,
/// a translation, rotation, and scale, or a 3x4 matrix in columns.
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub(crate) struct NodeRecord {
    pub(crate) parent: u32,
    pub(crate) flags: u32,
    pub(crate) name_at: u32,
    pub(crate) name_len: u32,
    pub(crate) rest: [f32; 12],
}

pub(crate) const NO_PARENT: u32 = u32::MAX;
/// Some animation of the file moves it, posed or not, which tells a yoke's button from its
/// wheel.
pub(crate) const ANIMATED: u32 = 1;
pub(crate) const MATRIX: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub(crate) struct InstanceRecord {
    pub(crate) node: u32,
    pub(crate) geometry: u32,
}

/// Where one mesh's positions, triangles, and BVH lie in the large part, how many of each,
/// whether its triangles index its positions with 32 bits rather than 16, and its box.
#[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub(crate) struct GeometryRecord {
    pub(crate) positions_at: u64,
    pub(crate) triangles_at: u64,
    pub(crate) bvh_at: u64,
    pub(crate) positions: u32,
    pub(crate) triangles: u32,
    pub(crate) bvh: u32,
    pub(crate) wide: u32,
    pub(crate) bounds: Aabb,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct AnimationMeta {
    pub(crate) program: u32,
    pub(crate) length: f32,
    /// Its latest key, which the code's last frame plays.
    pub(crate) duration: f32,
    pub(crate) channels: Vec<ChannelMeta>,
}

/// One animated part of one node, with its keys' times and values in the large part.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct ChannelMeta {
    pub(crate) node: u32,
    /// 0 for the translation, 1 the rotation, 2 the scale.
    pub(crate) path: u8,
    /// 0 for linear, 1 step, 2 a cubic spline.
    pub(crate) interpolation: u8,
    pub(crate) times: Span,
    pub(crate) values: Span,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct ProgramMeta {
    pub(crate) program: Program,
    /// The model's variable for each of the program's, by its place in `Meta::vars`, or
    /// `u32::MAX` for one a run keeps.
    pub(crate) vars: Vec<u32>,
}

/// What building found, for the log: how much of the aircraft's code it could pose.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Report {
    pub animation_codes: u32,
    pub visibility_codes: u32,
    /// Codes that compiled, read only variables posing has, and keep no state.
    pub posed: u32,
    /// The first few codes that didn't, each with why.
    pub not_posed: Vec<String>,
    pub triangles: u64,
}

/// A yoke, as `Figure` holds a hand on it on every machine from that machine's own yoke
/// variables (record/areas/avatars/01-avatars.md, "A hand on a yoke").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Yoke {
    /// On the left of the centerline, the pilot's, or the right, the copilot's.
    pub left: bool,
    /// The wheel's node in the interior.
    pub node: u32,
    /// The node the grips move with, the last of the yoke's animated nodes.
    pub last: u32,
    /// The frame the first stage's node sits in, in the aircraft's frame, with the yoke
    /// centered; or, with no stages, the frame of `last` itself.
    pub base: [f32; 12],
    pub stages: Vec<YokeStage>,
    /// Where the left hand's and the right hand's centers go, in `last`'s frame.
    pub grips: [Vec3; 2],
}

/// One of a yoke's animated nodes, whose animation's code reads one variable and gives a
/// frame linear in it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct YokeStage {
    /// From the frame before, `base` or the previous stage's node, to this node's parent.
    pub before: [f32; 12],
    pub var: Var,
    /// The frame is `slope × value + intercept`, out of `length`.
    pub slope: f32,
    pub intercept: f32,
    pub length: f32,
    /// The node's translation and rotation at 21 frames from 0 to `length`.
    pub samples: Vec<(Vec3, [f32; 4])>,
    pub scale: Vec3,
}

/// What a cast met.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    pub node: u32,
    pub point: Vec3,
    pub normal: Vec3,
    pub t: f32,
}

/// A press on a yoke, by what it met: the wheel, or a button on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum YokePart {
    Wheel,
    Button,
}

/// A node's transform as it plays: its parts, which an animation replaces one by one, or a
/// matrix, which no animation moves.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Rest {
    Parts {
        translation: Vec3,
        rotation: [f32; 4],
        scale: Vec3,
    },
    Matrix(Affine),
}

/// The large part of a buffer, read in place.
#[derive(Clone, Copy)]
pub(crate) struct Large<'a>(pub(crate) &'a [u8]);

impl<'a> Large<'a> {
    pub(crate) fn record<T: Pod>(self, span: Span, i: u32) -> Option<T> {
        if i >= span.count {
            return None;
        }
        let at = span.at as usize + i as usize * size_of::<T>();
        self.0
            .get(at..at + size_of::<T>())
            .map(bytemuck::pod_read_unaligned)
    }

    pub(crate) fn f32(self, span: Span, i: u32) -> f32 {
        self.record::<f32>(span, i).unwrap_or(0.0)
    }

    pub(crate) fn bytes(self, span: Span) -> &'a [u8] {
        let at = span.at as usize;
        self.0.get(at..at + span.count as usize).unwrap_or_default()
    }
}

/// A model taken from its buffer, and posed.
pub struct Model {
    bytes: Vec<u8>,
    data: usize,
    meta: Meta,
    values: Vec<f64>,
    changed: Vec<bool>,
    posed_once: bool,
    scratch: Vec<Scratch>,
    scenes: [Option<Posed>; 2],
}

struct Posed {
    parents: Vec<u32>,
    order: Vec<u32>,
    instances: Vec<InstanceRecord>,
    geometries: Vec<GeometryRecord>,
    parts: Vec<Rest>,
    world: Vec<Affine>,
    hidden: Vec<bool>,
    shown: Vec<bool>,
    placed: Vec<(Affine, Affine, Aabb)>,
}

impl Model {
    /// Takes a model from the buffer `build` made: a check of its header, and a decode of its
    /// small part.
    pub fn take(bytes: Vec<u8>) -> Result<Model, String> {
        if bytes.get(..4) != Some(&MAGIC[..]) {
            return Err("the buffer isn't an aircraft model".into());
        }
        let word = |at: usize| {
            bytes
                .get(at..at + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        };
        if word(4) != Some(VERSION) {
            return Err(format!(
                "the model's layout is version {:?}, where this build reads {VERSION}",
                word(4)
            ));
        }
        let meta_len = bytes
            .get(8..16)
            .map(|b| u64::from_le_bytes(b.try_into().unwrap_or_default()) as usize)
            .ok_or("the model's header is short")?;
        let meta: Meta = bytes
            .get(HEADER..HEADER + meta_len)
            .and_then(|b| postcard::from_bytes(b).ok())
            .ok_or("the model's small part doesn't decode")?;
        let data = align(HEADER + meta_len);
        let large = Large(bytes.get(data..).unwrap_or_default());
        let scenes = [
            meta.interior.as_ref().map(|m| Posed::rest(large, m)),
            meta.exterior.as_ref().map(|m| Posed::rest(large, m)),
        ];
        Ok(Model {
            values: vec![0.0; meta.vars.len()],
            changed: vec![false; meta.vars.len()],
            posed_once: false,
            scratch: vec![Scratch::default(); meta.programs.len()],
            scenes,
            bytes,
            data,
            meta,
        })
    }

    fn large(&self) -> Large<'_> {
        Large(self.bytes.get(self.data..).unwrap_or_default())
    }

    /// Every variable the model's code reads that the sim gives, which the caller watches and
    /// hands over through `set`, each by its place here.
    pub fn vars(&self) -> &[Var] {
        &self.meta.vars
    }

    pub fn set(&mut self, var: usize, value: f64) {
        if let (Some(v), Some(c)) = (self.values.get_mut(var), self.changed.get_mut(var))
            && *v != value
        {
            *v = value;
            *c = true;
        }
    }

    /// Runs the code whose variables changed since the last pose, moves the nodes it drives,
    /// and hides the ones its visibility says to. The first pose runs all of it and places
    /// every mesh, which `take` leaves to it, so each stays well inside a handler's 1ms. So a
    /// caller poses before its first cast.
    pub fn pose(&mut self) {
        let first = !self.posed_once;
        self.posed_once = true;
        let changed = std::mem::replace(&mut self.changed, vec![false; self.values.len()]);
        let due: Vec<bool> = self
            .meta
            .programs
            .iter()
            .map(|p| {
                first
                    || p.vars
                        .iter()
                        .any(|&v| changed.get(v as usize) == Some(&true))
            })
            .collect();
        let results: Vec<Option<f64>> = (0..due.len() as u32)
            .map(|p| due[p as usize].then(|| self.run(p)))
            .collect();
        let result = |p: u32| results.get(p as usize).copied().flatten();
        let large = Large(self.bytes.get(self.data..).unwrap_or_default());
        let mut moved = [first; 2];
        for scene in [Scene::Interior, Scene::Exterior] {
            let (Some(meta), Some(posed)) = (
                scene_meta(&self.meta, scene),
                self.scenes[scene as usize].as_mut(),
            ) else {
                continue;
            };
            for a in &meta.animations {
                let Some(frame) = result(a.program) else {
                    continue;
                };
                let t = (frame as f32 / a.length).clamp(0.0, 1.0) * a.duration;
                for c in &a.channels {
                    if let Some(part) = posed.parts.get_mut(c.node as usize) {
                        apply(large, part, c, t);
                        moved[scene as usize] = true;
                    }
                }
            }
            for &(node, program) in &meta.visibility {
                let Some(value) = result(program) else {
                    continue;
                };
                if let Some(h) = posed.hidden.get_mut(node as usize) {
                    moved[scene as usize] |= *h != (value == 0.0);
                    *h = value == 0.0;
                }
            }
        }
        for scene in [Scene::Interior, Scene::Exterior] {
            if moved[scene as usize]
                && let Some(posed) = self.scenes[scene as usize].as_mut()
            {
                posed.refresh();
            }
        }
    }

    fn run(&mut self, program: u32) -> f64 {
        let (Some(p), Some(scratch)) = (
            self.meta.programs.get(program as usize),
            self.scratch.get_mut(program as usize),
        ) else {
            return 0.0;
        };
        let values = &self.values;
        p.program.run(scratch, &|i| {
            p.vars
                .get(i)
                .and_then(|&v| values.get(v as usize))
                .copied()
                .unwrap_or(0.0)
        })
    }

    /// The nearest surface `ray` meets in a scene, past hidden nodes and invisible materials,
    /// which the build left out.
    pub fn cast(&self, scene: Scene, ray: &Ray, most: f32) -> Option<Hit> {
        let posed = self.scenes[scene as usize].as_ref()?;
        let large = self.large();
        let views: Vec<GeometryView<'_>> = posed
            .geometries
            .iter()
            .map(|g| GeometryView { large, record: *g })
            .collect();
        let candidates = posed.instances.iter().enumerate().filter_map(|(i, inst)| {
            if !posed
                .shown
                .get(inst.node as usize)
                .copied()
                .unwrap_or(false)
            {
                return None;
            }
            let (to_model, to_mesh, bounds) = posed.placed.get(i)?;
            Some(Candidate {
                id: i as u32,
                to_model,
                to_mesh,
                bounds,
                mesh: views.get(inst.geometry as usize)?,
            })
        });
        let hit = ray_cast::cast(ray, most, candidates)?;
        Some(Hit {
            node: posed.instances.get(hit.id as usize)?.node,
            point: hit.point,
            normal: hit.normal,
            t: hit.t,
        })
    }

    /// Whether `point`, in the aircraft's frame, is inside the interior model's box at rest.
    pub fn inside(&self, point: Vec3) -> bool {
        self.meta.interior.as_ref().is_some_and(|m| {
            Aabb {
                min: m.bounds.0,
                max: m.bounds.1,
            }
            .contains(point)
        })
    }

    /// A node's frame in the aircraft's frame, as the model is posed.
    pub fn world(&self, scene: Scene, node: u32) -> Option<Affine> {
        self.scenes[scene as usize]
            .as_ref()?
            .world
            .get(node as usize)
            .copied()
    }

    pub fn node_name(&self, scene: Scene, node: u32) -> Option<&str> {
        let meta = scene_meta(&self.meta, scene)?;
        let large = self.large();
        let record: NodeRecord = large.record(meta.nodes, node)?;
        let names = large.bytes(meta.names);
        let at = record.name_at as usize;
        std::str::from_utf8(names.get(at..at + record.name_len as usize)?).ok()
    }

    /// The first node named `name`, compared ignoring case.
    pub fn find_node(&self, scene: Scene, name: &str) -> Option<u32> {
        let count = scene_meta(&self.meta, scene)?.nodes.count;
        (0..count).find(|&n| {
            self.node_name(scene, n)
                .is_some_and(|m| m.eq_ignore_ascii_case(name))
        })
    }

    pub fn parent(&self, scene: Scene, node: u32) -> Option<u32> {
        let p = *self.scenes[scene as usize]
            .as_ref()?
            .parents
            .get(node as usize)?;
        (p != NO_PARENT).then_some(p)
    }

    pub fn yokes(&self) -> &[Yoke] {
        &self.meta.yokes
    }

    /// Which yoke a node of the interior belongs to, and whether it's the wheel or a button: a
    /// node below the yoke's own that an animation moves, or that sits below one, is a
    /// button, since every button on the 58P's yokes moves with an animation of its own and
    /// every other part of the wheel moves with the wheel (read in bksq-aircraft-baronpro
    /// 0.1.1, BaronProfessional_Pressurized_INT.gltf).
    pub fn yoke_part(&self, node: u32) -> Option<(usize, YokePart)> {
        let meta = self.meta.interior.as_ref()?;
        let large = self.large();
        let mut animated = false;
        let mut at = Some(node);
        while let Some(n) = at {
            if let Some(y) = self.meta.yokes.iter().position(|y| y.node == n) {
                let part = if animated {
                    YokePart::Button
                } else {
                    YokePart::Wheel
                };
                return Some((y, part));
            }
            let record: NodeRecord = large.record(meta.nodes, n)?;
            animated |= record.flags & ANIMATED != 0;
            at = (record.parent != NO_PARENT).then_some(record.parent);
        }
        None
    }

    /// The seat objects the cockpit marks with `PILOT_` nodes, with each one's place, which
    /// the seat tool seeds seats from (record/areas/avatars/01-avatars.md, "The authoring
    /// tool").
    pub fn seat_seeds(&self) -> &[(String, Vec3)] {
        &self.meta.seats
    }

    pub fn report(&self) -> &Report {
        &self.meta.report
    }

    pub(crate) fn meta(&self) -> &Meta {
        &self.meta
    }

    /// A node's transform at rest, before any animation.
    pub(crate) fn rest(&self, scene: Scene, node: u32) -> Option<Rest> {
        let meta = scene_meta(&self.meta, scene)?;
        self.large()
            .record::<NodeRecord>(meta.nodes, node)
            .map(|r| rest_of(&r))
    }

    /// Plays one channel at `t` seconds into a node's parts.
    pub(crate) fn play(&self, part: &mut Rest, c: &ChannelMeta, t: f32) {
        apply(self.large(), part, c, t);
    }
}

pub(crate) fn scene_meta(meta: &Meta, scene: Scene) -> Option<&SceneMeta> {
    match scene {
        Scene::Interior => meta.interior.as_ref(),
        Scene::Exterior => meta.exterior.as_ref(),
    }
}

pub(crate) fn rest_of(r: &NodeRecord) -> Rest {
    let p = r.rest;
    if r.flags & MATRIX != 0 {
        Rest::Matrix(from_12(&p))
    } else {
        Rest::Parts {
            translation: [p[0], p[1], p[2]],
            rotation: [p[3], p[4], p[5], p[6]],
            scale: [p[7], p[8], p[9]],
        }
    }
}

impl Posed {
    fn rest(large: Large<'_>, meta: &SceneMeta) -> Posed {
        let records: Vec<NodeRecord> = (0..meta.nodes.count)
            .filter_map(|i| large.record(meta.nodes, i))
            .collect();
        let n = records.len();
        let instances: Vec<InstanceRecord> = (0..meta.instances.count)
            .filter_map(|i| large.record(meta.instances, i))
            .collect();
        Posed {
            parents: records.iter().map(|r| r.parent).collect(),
            order: (0..meta.order.count)
                .filter_map(|i| large.record::<u32>(meta.order, i))
                .filter(|&o| (o as usize) < n)
                .collect(),
            geometries: (0..meta.geometries.count)
                .filter_map(|i| large.record(meta.geometries, i))
                .collect(),
            parts: records.iter().map(rest_of).collect(),
            world: vec![Affine::IDENTITY; n],
            hidden: vec![false; n],
            shown: vec![true; n],
            placed: vec![(Affine::IDENTITY, Affine::IDENTITY, Aabb::EMPTY); instances.len()],
            instances,
        }
    }

    /// Composes each node's world, what shows, and each mesh's place again.
    fn refresh(&mut self) {
        for &n in &self.order {
            let n = n as usize;
            let local = affine_of(&self.parts[n]);
            let parent = self.parents[n];
            let (world, shown) = match self.world.get(parent as usize) {
                Some(p) if parent != NO_PARENT => (
                    p.then_inner(&local),
                    self.shown[parent as usize] && !self.hidden[n],
                ),
                _ => (local, !self.hidden[n]),
            };
            self.world[n] = world;
            self.shown[n] = shown;
        }
        for (i, inst) in self.instances.iter().enumerate() {
            let world = self
                .world
                .get(inst.node as usize)
                .copied()
                .unwrap_or_default();
            let bounds = self
                .geometries
                .get(inst.geometry as usize)
                .map(|g| g.bounds.moved(&world))
                .unwrap_or(Aabb::EMPTY);
            self.placed[i] = (world, world.inverse(), bounds);
        }
    }
}

pub(crate) fn affine_of(rest: &Rest) -> Affine {
    match rest {
        Rest::Parts {
            translation,
            rotation,
            scale,
        } => Affine::from_parts(*translation, *rotation, *scale),
        Rest::Matrix(m) => *m,
    }
}

pub(crate) fn from_12(m: &[f32; 12]) -> Affine {
    Affine {
        columns: [
            [m[0], m[1], m[2]],
            [m[3], m[4], m[5]],
            [m[6], m[7], m[8]],
            [m[9], m[10], m[11]],
        ],
    }
}

pub(crate) fn to_12(a: &Affine) -> [f32; 12] {
    let c = a.columns;
    [
        c[0][0], c[0][1], c[0][2], c[1][0], c[1][1], c[1][2], c[2][0], c[2][1], c[2][2], c[3][0],
        c[3][1], c[3][2],
    ]
}

pub(crate) fn align(at: usize) -> usize {
    at.div_ceil(8) * 8
}

/// Plays one channel at `t` seconds into a node's parts. A node stored as a matrix has no
/// parts to play into, which glTF forbids animating anyway.
fn apply(large: Large<'_>, part: &mut Rest, c: &ChannelMeta, t: f32) {
    let Rest::Parts {
        translation,
        rotation,
        scale,
    } = part
    else {
        return;
    };
    match c.path {
        0 => *translation = vec3(&sample(large, c, t, 3)),
        1 => {
            let q = sample(large, c, t, 4);
            *rotation = normalized([q[0], q[1], q[2], q[3]]);
        }
        _ => *scale = vec3(&sample(large, c, t, 3)),
    }
}

fn vec3(v: &[f32]) -> Vec3 {
    [
        v.first().copied().unwrap_or(0.0),
        v.get(1).copied().unwrap_or(0.0),
        v.get(2).copied().unwrap_or(0.0),
    ]
}

/// A channel's value at `t` seconds: held before its first key and after its last, linear
/// between keys, or spherical for a rotation. A cubic spline is read at its keys' values,
/// which it passes through, and linear between them.
fn sample(large: Large<'_>, c: &ChannelMeta, t: f32, width: usize) -> Vec<f32> {
    let cubic = c.interpolation == 2;
    let at = |k: u32| -> Vec<f32> {
        let start = if cubic {
            (3 * k + 1) * width as u32
        } else {
            k * width as u32
        };
        (0..width as u32)
            .map(|j| large.f32(c.values, start + j))
            .collect()
    };
    let count = c.times.count;
    if count == 0 {
        return vec![0.0; width];
    }
    let time = |k: u32| large.f32(c.times, k);
    let last = count - 1;
    if t <= time(0) {
        return at(0);
    }
    if t >= time(last) {
        return at(last);
    }
    // The last key at or before `t`, by halving.
    let (mut lo, mut hi) = (0, last);
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if time(mid) <= t {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    if c.interpolation == 1 {
        return at(lo);
    }
    let (t0, t1) = (time(lo), time(hi));
    let u = if t1 > t0 { (t - t0) / (t1 - t0) } else { 0.0 };
    let (a, b) = (at(lo), at(hi));
    if width == 4 {
        return slerp([a[0], a[1], a[2], a[3]], [b[0], b[1], b[2], b[3]], u).to_vec();
    }
    a.iter().zip(&b).map(|(x, y)| x + (y - x) * u).collect()
}

fn slerp(a: [f32; 4], mut b: [f32; 4], u: f32) -> [f32; 4] {
    let mut d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if d < 0.0 {
        b = b.map(|x| -x);
        d = -d;
    }
    if d > 0.9995 {
        return normalized([
            a[0] + (b[0] - a[0]) * u,
            a[1] + (b[1] - a[1]) * u,
            a[2] + (b[2] - a[2]) * u,
            a[3] + (b[3] - a[3]) * u,
        ]);
    }
    let th = d.acos();
    let s = th.sin();
    let (wa, wb) = (((1.0 - u) * th).sin() / s, (u * th).sin() / s);
    [
        a[0] * wa + b[0] * wb,
        a[1] * wa + b[1] * wb,
        a[2] * wa + b[2] * wb,
        a[3] * wa + b[3] * wb,
    ]
}

fn normalized(q: [f32; 4]) -> [f32; 4] {
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if l > 0.0 {
        q.map(|x| x / l)
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

/// One mesh's large parts, read where they lie in the buffer.
struct GeometryView<'a> {
    large: Large<'a>,
    record: GeometryRecord,
}

impl Mesh for GeometryView<'_> {
    fn node(&self, i: u32) -> Option<BvhNode> {
        let span = Span {
            at: self.record.bvh_at,
            count: self.record.bvh,
        };
        self.large.record(span, i)
    }

    fn triangle(&self, i: u32) -> Option<[Vec3; 3]> {
        let positions = Span {
            at: self.record.positions_at,
            count: self.record.positions,
        };
        let mut corners = [[0.0; 3]; 3];
        for (k, corner) in corners.iter_mut().enumerate() {
            let index = 3 * i + k as u32;
            let v = if self.record.wide != 0 {
                let span = Span {
                    at: self.record.triangles_at,
                    count: self.record.triangles * 3,
                };
                self.large.record::<u32>(span, index)?
            } else {
                let span = Span {
                    at: self.record.triangles_at,
                    count: self.record.triangles * 3,
                };
                u32::from(self.large.record::<u16>(span, index)?)
            };
            *corner = self.large.record::<Vec3>(positions, v)?;
        }
        Some(corners)
    }
}
