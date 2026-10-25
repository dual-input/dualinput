//! Building the model from the aircraft's files into the buffer the loop takes.

use std::collections::BTreeMap;

use bytemuck::Pod;
use msfs_gltf::{Gltf, Interpolation, Path, Transform};
use msfs_rpn::{Program, Var};
use ray_cast::{Aabb, Affine};

use crate::behavior;
use crate::files::{self, ModelFiles, Read};
use crate::model::{
    ANIMATED, AnimationMeta, ChannelMeta, GeometryRecord, HEADER, InstanceRecord, MAGIC, MATRIX,
    Meta, Model, NO_PARENT, NodeRecord, ProgramMeta, Report, SceneMeta, Span, VERSION, align,
    to_12,
};
use crate::{Aircraft, xml, yokes};

/// How many codes that couldn't be posed the report names.
const NAMED_FAILURES: usize = 12;

/// Builds the model from `read`, which holds every file `wanted` asked for.
pub(crate) fn build<'a>(
    aircraft: &Aircraft,
    read: &dyn Fn(&str) -> Read<'a>,
) -> Result<Vec<u8>, String> {
    let walk = files::walk(
        &aircraft.package,
        &aircraft.path,
        aircraft.title.as_deref(),
        read,
    );
    if !walk.wanted.is_empty() {
        return Err(format!("files weren't read: {}", walk.wanted.join(", ")));
    }
    if let Some(stopped) = walk.stopped {
        return Err(stopped);
    }
    let mut meta = Meta::default();
    let mut programs = Programs::default();
    let mut large = Large::default();
    if let Some(files) = &walk.interior {
        meta.interior = Some(scene(
            files,
            read,
            &mut programs,
            &mut meta.report,
            &mut large,
        )?);
    }
    if let Some(files) = &walk.exterior {
        meta.exterior = Some(scene(
            files,
            read,
            &mut programs,
            &mut meta.report,
            &mut large,
        )?);
    }
    meta.programs = programs.list;
    meta.vars = programs.vars;
    meta.report.not_posed.truncate(NAMED_FAILURES);
    // The yokes and the seats' seeds read the model as `Model` poses it, so they come from a
    // model taken from the buffer as it stands, then go into the buffer's final form.
    let mut taken = Model::take(encode(&meta, &large.bytes))?;
    if meta.interior.is_some() {
        meta.yokes = yokes::find(&mut taken, aircraft);
        meta.seats = yokes::seat_seeds(&taken);
    }
    Ok(encode(&meta, &large.bytes))
}

fn encode(meta: &Meta, large: &[u8]) -> Vec<u8> {
    let small = postcard::to_stdvec(meta).unwrap_or_default();
    let data = align(HEADER + small.len());
    let mut out = Vec::with_capacity(data + large.len());
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&(small.len() as u64).to_le_bytes());
    out.extend_from_slice(&small);
    out.resize(data, 0);
    out.extend_from_slice(large);
    out
}

/// The large part as it's written, each run starting at a multiple of 8.
#[derive(Default)]
struct Large {
    bytes: Vec<u8>,
}

impl Large {
    fn records<T: Pod>(&mut self, records: &[T]) -> Span {
        self.bytes.resize(align(self.bytes.len()), 0);
        let at = self.bytes.len() as u64;
        self.bytes.extend_from_slice(bytemuck::cast_slice(records));
        Span {
            at,
            count: records.len() as u32,
        }
    }

    fn raw(&mut self, bytes: &[u8]) -> Span {
        self.bytes.resize(align(self.bytes.len()), 0);
        let at = self.bytes.len() as u64;
        self.bytes.extend_from_slice(bytes);
        Span {
            at,
            count: bytes.len() as u32,
        }
    }
}

/// The model's programs, each compiled once however many animations it drives, and every
/// variable they read from the sim.
#[derive(Default)]
struct Programs {
    list: Vec<ProgramMeta>,
    by_code: BTreeMap<String, u32>,
    vars: Vec<Var>,
}

impl Programs {
    /// The program for `code`, or why it can't pose: it doesn't compile, reads what posing has
    /// no value for, or keeps state from one run to the next.
    fn add(&mut self, code: &str) -> Result<u32, String> {
        if let Some(&p) = self.by_code.get(code) {
            return Ok(p);
        }
        let program: Program = msfs_rpn::compile(code).map_err(|e| e.0)?;
        if program.keeps_state {
            return Err(format!("it keeps its own state, in: {}", code.trim()));
        }
        if let Some(v) = program.vars.iter().find(|v| !v.known()) {
            return Err(format!(
                "it reads {}:{}, which posing has no value for, in: {}",
                v.kind,
                v.name,
                code.trim()
            ));
        }
        let vars = program
            .vars
            .iter()
            .map(|v| {
                if v.kept() {
                    return u32::MAX;
                }
                match self.vars.iter().position(|w| w == v) {
                    Some(i) => i as u32,
                    None => {
                        self.vars.push(v.clone());
                        (self.vars.len() - 1) as u32
                    }
                }
            })
            .collect();
        let at = self.list.len() as u32;
        self.list.push(ProgramMeta { program, vars });
        self.by_code.insert(code.to_string(), at);
        Ok(at)
    }
}

fn scene<'a>(
    files: &ModelFiles,
    read: &dyn Fn(&str) -> Read<'a>,
    programs: &mut Programs,
    report: &mut Report,
    large: &mut Large,
) -> Result<SceneMeta, String> {
    let bytes = |path: &str| -> Result<&'a [u8], String> {
        match read(path) {
            Read::Bytes(b) => Ok(b),
            _ => Err(format!("{path} isn't there")),
        }
    };
    let gltf_path = files.gltf.as_deref().ok_or("the model names no glTF")?;
    let document =
        msfs_gltf::Document::parse(bytes(gltf_path)?).map_err(|e| format!("{gltf_path}: {e}"))?;
    let buffers: Vec<&[u8]> = files
        .buffers
        .iter()
        .map(|b| bytes(b))
        .collect::<Result<_, _>>()?;
    let gltf = document
        .read(&buffers)
        .map_err(|e| format!("{gltf_path}: {e}"))?;
    let roots: Vec<xml::Element> = files
        .behaviors
        .iter()
        .filter_map(|p| bytes(p).ok())
        .filter_map(|b| xml::parse(&String::from_utf8_lossy(b)).ok())
        .collect();
    let found = behavior::walk(&roots);
    let mut meta = SceneMeta::default();
    nodes(&gltf, &mut meta, large);
    geometries(&gltf, &mut meta, report, large);
    let named = |name: &str| -> Vec<u32> {
        (0..gltf.nodes.len() as u32)
            .filter(|&n| gltf.nodes[n as usize].name.eq_ignore_ascii_case(name))
            .collect()
    };
    for a in &found.animations {
        report.animation_codes += 1;
        let Some(animation) = gltf
            .animations
            .iter()
            .find(|g| g.name.eq_ignore_ascii_case(&a.name))
        else {
            continue;
        };
        match programs.add(&a.code) {
            Ok(program) => {
                report.posed += 1;
                let channels: Vec<ChannelMeta> = animation
                    .channels
                    .iter()
                    .map(|c| ChannelMeta {
                        node: c.node,
                        path: match c.path {
                            Path::Translation => 0,
                            Path::Rotation => 1,
                            Path::Scale => 2,
                        },
                        interpolation: match c.interpolation {
                            Interpolation::Linear => 0,
                            Interpolation::Step => 1,
                            Interpolation::CubicSpline => 2,
                        },
                        times: large.records(&c.times),
                        values: large.records(&c.values),
                    })
                    .collect();
                let duration = animation
                    .channels
                    .iter()
                    .filter_map(|c| c.times.last().copied())
                    .fold(0.0f32, f32::max);
                meta.animations.push(AnimationMeta {
                    program,
                    length: a.length,
                    duration,
                    channels,
                });
            }
            Err(why) => report.not_posed.push(format!("{}: {why}", a.name)),
        }
    }
    for v in &found.visibility {
        report.visibility_codes += 1;
        let nodes = named(&v.node);
        if nodes.is_empty() {
            continue;
        }
        match programs.add(&v.code) {
            Ok(program) => {
                report.posed += 1;
                meta.visibility
                    .extend(nodes.into_iter().map(|n| (n, program)));
            }
            Err(why) => report.not_posed.push(format!("{}: {why}", v.node)),
        }
    }
    Ok(meta)
}

/// Each node's record and name, and the order that composes their worlds: each root, then
/// its tree.
fn nodes(gltf: &Gltf, meta: &mut SceneMeta, large: &mut Large) {
    let mut animated = vec![false; gltf.nodes.len()];
    for a in &gltf.animations {
        for c in &a.channels {
            if let Some(slot) = animated.get_mut(c.node as usize) {
                *slot = true;
            }
        }
    }
    let mut names = Vec::new();
    let records: Vec<NodeRecord> = gltf
        .nodes
        .iter()
        .zip(animated)
        .map(|(n, animated)| {
            let name_at = names.len() as u32;
            names.extend_from_slice(n.name.as_bytes());
            let (rest, matrix) = match n.rest {
                Transform::Parts {
                    translation: t,
                    rotation: r,
                    scale: s,
                } => (
                    [
                        t[0], t[1], t[2], r[0], r[1], r[2], r[3], s[0], s[1], s[2], 0.0, 0.0,
                    ],
                    false,
                ),
                Transform::Matrix(m) => (to_12(&Affine::from_matrix(m)), true),
            };
            NodeRecord {
                parent: n.parent.unwrap_or(NO_PARENT),
                flags: if animated { ANIMATED } else { 0 } | if matrix { MATRIX } else { 0 },
                name_at,
                name_len: n.name.len() as u32,
                rest,
            }
        })
        .collect();
    meta.nodes = large.records(&records);
    meta.names = large.raw(&names);
    let mut order = Vec::with_capacity(gltf.nodes.len());
    let mut stack: Vec<u32> = (0..gltf.nodes.len() as u32)
        .filter(|&n| gltf.nodes[n as usize].parent.is_none())
        .rev()
        .collect();
    while let Some(n) = stack.pop() {
        order.push(n);
        stack.extend(gltf.nodes[n as usize].children.iter().rev().copied());
    }
    meta.order = large.records(&order);
}

/// Each mesh's BVH and its large parts, and an instance for each primitive a material shows.
/// The scene's box takes in the invisible ones too, since the Comanche draws its cabin's
/// extent with invisible shells (read in experiments/areas/avatars/lib/raycast.mjs), and the
/// box tells a camera inside the aircraft from one outside it.
fn geometries(gltf: &Gltf, meta: &mut SceneMeta, report: &mut Report, large: &mut Large) {
    let rest = rest_worlds(gltf);
    let mut placed: Vec<Option<u32>> = vec![None; gltf.geometries.len()];
    let mut records: Vec<GeometryRecord> = Vec::new();
    let mut instances: Vec<InstanceRecord> = Vec::new();
    let mut whole = Aabb::EMPTY;
    for (n, node) in gltf.nodes.iter().enumerate() {
        for p in &node.primitives {
            let Some(source) = gltf.geometries.get(p.geometry as usize) else {
                continue;
            };
            let invisible = p
                .material
                .and_then(|m| gltf.materials.get(m as usize))
                .is_some_and(|m| m.invisible);
            if let Some(w) = rest.get(n) {
                for v in &source.positions {
                    whole.grow(w.point(*v));
                }
            }
            if invisible || source.triangles.is_empty() {
                continue;
            }
            let g = p.geometry as usize;
            let geometry = match placed.get(g).copied().flatten() {
                Some(at) => at,
                None => {
                    let at = records.len() as u32;
                    records.push(lay_out(source, large));
                    report.triangles += source.triangles.len() as u64;
                    placed[g] = Some(at);
                    at
                }
            };
            instances.push(InstanceRecord {
                node: n as u32,
                geometry,
            });
        }
    }
    meta.geometries = large.records(&records);
    meta.instances = large.records(&instances);
    meta.bounds = (whole.min, whole.max);
}

fn rest_worlds(gltf: &Gltf) -> Vec<Affine> {
    let local = |n: &msfs_gltf::Node| match n.rest {
        Transform::Parts {
            translation,
            rotation,
            scale,
        } => Affine::from_parts(translation, rotation, scale),
        Transform::Matrix(m) => Affine::from_matrix(m),
    };
    let mut world = vec![Affine::IDENTITY; gltf.nodes.len()];
    let mut stack: Vec<(u32, Affine)> = gltf
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.parent.is_none())
        .map(|(i, n)| (i as u32, local(n)))
        .collect();
    while let Some((n, w)) = stack.pop() {
        world[n as usize] = w;
        for &c in &gltf.nodes[n as usize].children {
            stack.push((c, w.then_inner(&local(&gltf.nodes[c as usize]))));
        }
    }
    world
}

/// Builds one mesh's BVH and lays out its positions, its triangles in the BVH's order, and
/// the BVH's nodes.
fn lay_out(source: &msfs_gltf::Geometry, large: &mut Large) -> GeometryRecord {
    let built = ray_cast::build(&source.positions, &source.triangles);
    let wide = source.positions.len() > usize::from(u16::MAX) + 1;
    let mut bounds = Aabb::EMPTY;
    for p in &source.positions {
        bounds.grow(*p);
    }
    let positions = large.records(&source.positions);
    let ordered: Vec<u32> = built
        .order
        .iter()
        .flat_map(|&t| source.triangles[t as usize])
        .collect();
    let triangles = if wide {
        large.records(&ordered)
    } else {
        let narrow: Vec<u16> = ordered.iter().map(|&v| v as u16).collect();
        large.records(&narrow)
    };
    let bvh = large.records(&built.nodes);
    GeometryRecord {
        positions_at: positions.at,
        triangles_at: triangles.at,
        bvh_at: bvh.at,
        positions: positions.count,
        triangles: built.order.len() as u32,
        bvh: bvh.count,
        wide: u32::from(wide),
        bounds,
    }
}
