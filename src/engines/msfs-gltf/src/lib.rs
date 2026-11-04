//! Reads an MSFS glTF: each node's place in the model and its triangles, the materials that
//! hide what they cover, and the animations, so `aircraft-model` can pose an aircraft's own
//! model and cast a ray into it (record/areas/avatars/01-avatars.md, "Its engines").
//!
//! MSFS compiles its models into glTF that the standard `gltf` crate can't take: every file
//! requires `MSFT_texture_dds`, and its normals, texture coordinates, and colors are signed
//! bytes and shorts that core glTF allows only as `normalized` or under
//! `KHR_mesh_quantization`, which MSFS's files don't declare, where `gltf` 1.4.1's readers end
//! in `unreachable!()` (record/areas/avatars/log.md, 2026-10-17). A ray needs none of those:
//! it needs each vertex's position, which these files store as plain floats, and the indices.
//! So this reader reads positions, indices, and animations alone, and refuses any layout of
//! them it doesn't name, and an extension the file requires that could change them, rather
//! than misread a file.
//!
//! It reads no file: whoever runs it hands it the JSON, then each buffer `Document::buffers`
//! names.

mod json;

use std::collections::BTreeMap;

/// The extensions a file may require that change nothing this reader reads: MSFS's textures.
const IGNORED_REQUIRED: &[&str] = &["MSFT_texture_dds"];

/// The material extension that marks what a material covers as never drawn, as the Comanche
/// wraps its panel and cabin in invisible shells (read in a2a-aircraft-pa24 2.1.3).
const INVISIBLE: &str = "ASOBO_material_invisible";

const FLOAT: u32 = 5126;
const UNSIGNED_BYTE: u32 = 5121;
const UNSIGNED_SHORT: u32 = 5123;
const UNSIGNED_INT: u32 = 5125;
/// A primitive's mode for a list of triangles, glTF's default.
const TRIANGLES: u32 = 4;

/// Why a file can't be read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

fn fail<T>(text: impl Into<String>) -> Result<T, Error> {
    Err(Error(text.into()))
}

/// A glTF's JSON, read, before its buffers.
pub struct Document {
    root: json::Root,
}

impl Document {
    pub fn parse(json: &[u8]) -> Result<Document, Error> {
        let root: json::Root = serde_json::from_slice(json)
            .map_err(|e| Error(format!("the glTF's JSON doesn't read: {e}")))?;
        if let Some(other) = root
            .extensions_required
            .iter()
            .find(|e| !IGNORED_REQUIRED.contains(&e.as_str()))
        {
            return fail(format!(
                "the glTF requires {other}, which this reader doesn't read"
            ));
        }
        Ok(Document { root })
    }

    /// Each buffer's URI, relative to the glTF, in the order `read` takes their bytes.
    pub fn buffers(&self) -> Vec<Option<String>> {
        self.root.buffers.iter().map(|b| b.uri.clone()).collect()
    }

    /// Reads the model from the buffers' bytes, one for each of `buffers`, in its order.
    pub fn read(&self, buffers: &[&[u8]]) -> Result<Gltf, Error> {
        Reader {
            root: &self.root,
            buffers,
        }
        .read()
    }
}

/// A model: its nodes, the triangles of each distinct pair of positions and indices, its
/// materials, and its animations.
#[derive(Clone, Debug, PartialEq)]
pub struct Gltf {
    pub nodes: Vec<Node>,
    pub geometries: Vec<Geometry>,
    pub materials: Vec<Material>,
    pub animations: Vec<Animation>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub name: String,
    pub parent: Option<u32>,
    pub children: Vec<u32>,
    /// Its transform from its parent's space as the file stores it, before any animation.
    pub rest: Transform,
    /// Each primitive of its mesh this reader read: a skinned node's are left out, as are
    /// primitives that draw no triangles.
    pub primitives: Vec<Primitive>,
    /// Whether it's skinned, which no cast follows: its triangles stay out.
    pub skinned: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Primitive {
    pub geometry: u32,
    pub material: Option<u32>,
}

/// A node's transform from its parent, as a translation, a rotation as a unit quaternion
/// `[x, y, z, w]`, and a scale, or as a column-major matrix.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Transform {
    Parts {
        translation: [f32; 3],
        rotation: [f32; 4],
        scale: [f32; 3],
    },
    Matrix([f32; 16]),
}

/// One distinct pair of a primitive's positions and indices. Two primitives, on one node or
/// on several, that name the same pair share one, which the Baron's models do often: the
/// exterior lists one pair twice on 31 meshes, and reuses meshes across 28 nodes
/// (read in bksq-aircraft-baronpro 0.1.1, record/areas/avatars/results/
/// 2026-10-17-aircraft-model-research.txt).
#[derive(Clone, Debug, PartialEq)]
pub struct Geometry {
    /// In meters, in its node's own space.
    pub positions: Vec<[f32; 3]>,
    /// Each triangle's three vertices.
    pub triangles: Vec<[u32; 3]>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Material {
    pub name: String,
    /// Marked `ASOBO_material_invisible`: what it covers is never drawn, so a cast passes it.
    pub invisible: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Animation {
    pub name: String,
    pub channels: Vec<Channel>,
}

/// One animated part of one node: its keys' times in seconds, and its values, three floats a
/// key for a translation or a scale and four for a rotation, or three times that for a cubic
/// spline, which keeps an in-tangent and an out-tangent around each value.
#[derive(Clone, Debug, PartialEq)]
pub struct Channel {
    pub node: u32,
    pub path: Path,
    pub interpolation: Interpolation,
    pub times: Vec<f32>,
    pub values: Vec<f32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Path {
    Translation,
    Rotation,
    Scale,
}

impl Path {
    /// How many floats one value takes.
    pub fn width(self) -> usize {
        match self {
            Path::Rotation => 4,
            Path::Translation | Path::Scale => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Interpolation {
    Linear,
    Step,
    CubicSpline,
}

struct Reader<'a> {
    root: &'a json::Root,
    buffers: &'a [&'a [u8]],
}

impl Reader<'_> {
    fn read(&self) -> Result<Gltf, Error> {
        let root = self.root;
        if self.buffers.len() != root.buffers.len() {
            return fail(format!(
                "the glTF names {} buffers, and {} were given",
                root.buffers.len(),
                self.buffers.len()
            ));
        }
        for (i, (b, bytes)) in root.buffers.iter().zip(self.buffers).enumerate() {
            if (bytes.len() as u64) < b.byte_length {
                return fail(format!(
                    "buffer {i} holds {} bytes, short of the {} the glTF gives it",
                    bytes.len(),
                    b.byte_length
                ));
            }
        }
        let materials = root
            .materials
            .iter()
            .map(|m| Material {
                name: m.name.clone().unwrap_or_default(),
                invisible: m.extensions.contains_key(INVISIBLE),
            })
            .collect();
        let mut nodes = Vec::with_capacity(root.nodes.len());
        let mut geometries = Vec::new();
        let mut shared: BTreeMap<(u32, Option<u32>), u32> = BTreeMap::new();
        for (i, n) in root.nodes.iter().enumerate() {
            let mut primitives = Vec::new();
            let skinned = n.skin.is_some();
            if let (Some(mesh), false) = (n.mesh, skinned) {
                let Some(mesh) = root.meshes.get(mesh as usize) else {
                    return fail(format!("node {i} names mesh {mesh}, which doesn't exist"));
                };
                for p in &mesh.primitives {
                    if p.mode.unwrap_or(TRIANGLES) != TRIANGLES {
                        continue;
                    }
                    let Some(&position) = p.attributes.get("POSITION") else {
                        continue;
                    };
                    let key = (position, p.indices);
                    let geometry = match shared.get(&key) {
                        Some(&g) => g,
                        None => {
                            let g = geometries.len() as u32;
                            geometries.push(self.geometry(position, p.indices)?);
                            shared.insert(key, g);
                            g
                        }
                    };
                    let primitive = Primitive {
                        geometry,
                        material: p.material,
                    };
                    if !primitives.contains(&primitive) {
                        primitives.push(primitive);
                    }
                }
            }
            nodes.push(Node {
                name: n.name.clone().unwrap_or_default(),
                parent: None,
                children: n.children.clone(),
                rest: transform(n),
                primitives,
                skinned,
            });
        }
        let count = nodes.len() as u32;
        for i in 0..nodes.len() {
            for c in nodes[i].children.clone() {
                if c >= count {
                    return fail(format!("node {i} names child {c}, which doesn't exist"));
                }
                if nodes[c as usize].parent.is_some() {
                    return fail(format!("node {c} has two parents"));
                }
                nodes[c as usize].parent = Some(i as u32);
            }
        }
        // With one parent each, nodes can still sit in a ring, which no root reaches, and a walk
        // up from one would never end, on the core's loop when a click hits its mesh.
        let mut reached = 0;
        let mut below: Vec<u32> = (0..count)
            .filter(|&i| nodes[i as usize].parent.is_none())
            .collect();
        while let Some(n) = below.pop() {
            reached += 1;
            below.extend_from_slice(&nodes[n as usize].children);
        }
        if reached != nodes.len() {
            return fail("some nodes are their own ancestors, which no root reaches");
        }
        let animations = root
            .animations
            .iter()
            .map(|a| self.animation(a, count))
            .collect::<Result<_, _>>()?;
        Ok(Gltf {
            nodes,
            geometries,
            materials,
            animations,
        })
    }

    fn geometry(&self, position: u32, indices: Option<u32>) -> Result<Geometry, Error> {
        let a = self.accessor(position)?;
        if a.component_type != FLOAT || a.kind != "VEC3" || a.normalized {
            return fail(format!(
                "accessor {position} holds positions as {} {}, where this reader takes float VEC3",
                a.component_type, a.kind
            ));
        }
        let positions: Vec<[f32; 3]> = self
            .elements(position, 12)?
            .map(|e| [f32_at(e, 0), f32_at(e, 4), f32_at(e, 8)])
            .collect();
        let vertices = positions.len() as u64;
        let flat: Vec<u32> = match indices {
            None => (0..positions.len() as u32).collect(),
            Some(i) => {
                let a = self.accessor(i)?;
                if a.kind != "SCALAR" {
                    return fail(format!(
                        "accessor {i} holds indices as {}, where this reader takes SCALAR",
                        a.kind
                    ));
                }
                match a.component_type {
                    UNSIGNED_BYTE => self.elements(i, 1)?.map(|e| u32::from(e[0])).collect(),
                    UNSIGNED_SHORT => self
                        .elements(i, 2)?
                        .map(|e| u32::from(u16::from_le_bytes([e[0], e[1]])))
                        .collect(),
                    UNSIGNED_INT => self
                        .elements(i, 4)?
                        .map(|e| u32::from_le_bytes([e[0], e[1], e[2], e[3]]))
                        .collect(),
                    other => {
                        return fail(format!(
                            "accessor {i} holds indices of component type {other}"
                        ));
                    }
                }
            }
        };
        if let Some(bad) = flat.iter().find(|&&v| u64::from(v) >= vertices) {
            return fail(format!(
                "an index of {bad} names a vertex past the {vertices} its positions hold"
            ));
        }
        let triangles = flat.chunks_exact(3).map(|t| [t[0], t[1], t[2]]).collect();
        Ok(Geometry {
            positions,
            triangles,
        })
    }

    fn animation(&self, a: &json::Animation, nodes: u32) -> Result<Animation, Error> {
        let name = a.name.clone().unwrap_or_default();
        let mut channels = Vec::new();
        for c in &a.channels {
            let path = match c.target.path.as_str() {
                "translation" => Path::Translation,
                "rotation" => Path::Rotation,
                "scale" => Path::Scale,
                // A morph target's weights move no node.
                _ => continue,
            };
            let Some(node) = c.target.node else {
                continue;
            };
            if node >= nodes {
                return fail(format!(
                    "animation {name} moves node {node}, which doesn't exist"
                ));
            }
            let Some(s) = a.samplers.get(c.sampler as usize) else {
                return fail(format!(
                    "animation {name} names sampler {}, which doesn't exist",
                    c.sampler
                ));
            };
            let interpolation = match s.interpolation.as_deref() {
                None | Some("LINEAR") => Interpolation::Linear,
                Some("STEP") => Interpolation::Step,
                Some("CUBICSPLINE") => Interpolation::CubicSpline,
                Some(other) => {
                    return fail(format!("animation {name} interpolates by {other}"));
                }
            };
            let times = self.floats(s.input, "SCALAR")?;
            let kind = if path == Path::Rotation {
                "VEC4"
            } else {
                "VEC3"
            };
            let values = self.floats(s.output, kind)?;
            let per_key = path.width()
                * if interpolation == Interpolation::CubicSpline {
                    3
                } else {
                    1
                };
            if times.is_empty() || values.len() != times.len() * per_key {
                return fail(format!(
                    "animation {name} has {} keys and {} values for them",
                    times.len(),
                    values.len()
                ));
            }
            channels.push(Channel {
                node,
                path,
                interpolation,
                times,
                values,
            });
        }
        Ok(Animation { name, channels })
    }

    fn floats(&self, accessor: u32, kind: &str) -> Result<Vec<f32>, Error> {
        let a = self.accessor(accessor)?;
        if a.component_type != FLOAT || a.kind != kind {
            return fail(format!(
                "accessor {accessor} holds {} {}, where this reader takes float {kind}",
                a.component_type, a.kind
            ));
        }
        let width = match kind {
            "SCALAR" => 1,
            "VEC3" => 3,
            _ => 4,
        };
        let elements = self.elements(accessor, width * 4)?;
        let mut out = Vec::with_capacity(elements.len() * width);
        for e in elements {
            for k in 0..width {
                out.push(f32_at(e, k * 4));
            }
        }
        Ok(out)
    }

    fn accessor(&self, i: u32) -> Result<&json::Accessor, Error> {
        let Some(a) = self.root.accessors.get(i as usize) else {
            return fail(format!("accessor {i} doesn't exist"));
        };
        if a.sparse.is_some() {
            return fail(format!(
                "accessor {i} is sparse, which this reader doesn't read"
            ));
        }
        Ok(a)
    }

    /// Each element of an accessor, `size` bytes, through its buffer view's stride.
    fn elements(
        &self,
        accessor: u32,
        size: usize,
    ) -> Result<impl ExactSizeIterator<Item = &[u8]> + '_, Error> {
        let a = self.accessor(accessor)?;
        let Some(view) = a.buffer_view else {
            return fail(format!("accessor {accessor} has no buffer view"));
        };
        let Some(v) = self.root.buffer_views.get(view as usize) else {
            return fail(format!("buffer view {view} doesn't exist"));
        };
        let Some(&bytes) = self.buffers.get(v.buffer as usize) else {
            return fail(format!("buffer {} doesn't exist", v.buffer));
        };
        let stride = v.byte_stride.unwrap_or(size as u64);
        if stride < size as u64 {
            return fail(format!(
                "buffer view {view} strides {stride} bytes, under its elements' {size}"
            ));
        }
        // Each sum is checked, since the file gives every term: a count of 2^60 + 1 with a
        // stride of 16 would wrap around to an end that fits.
        let span = match a.count {
            0 => Some(0),
            n => (n - 1)
                .checked_mul(stride)
                .and_then(|s| s.checked_add(size as u64)),
        };
        let bounds = span.and_then(|span| {
            let start = v.byte_offset.checked_add(a.byte_offset)?;
            Some((
                start,
                start.checked_add(span)?,
                a.byte_offset.checked_add(span)?,
            ))
        });
        let Some((start, _, _)) =
            bounds.filter(|&(_, end, used)| used <= v.byte_length && end <= bytes.len() as u64)
        else {
            return fail(format!(
                "accessor {accessor} runs past the end of its buffer view"
            ));
        };
        let (start, stride) = (start as usize, stride as usize);
        Ok((0..a.count as usize).map(move |k| {
            let at = start + k * stride;
            // The bounds were checked above, for the last element too.
            bytes.get(at..at + size).unwrap_or_default()
        }))
    }
}

fn transform(n: &json::Node) -> Transform {
    match n.matrix {
        Some(m) => Transform::Matrix(m),
        None => Transform::Parts {
            translation: n.translation.unwrap_or([0.0; 3]),
            rotation: n.rotation.unwrap_or([0.0, 0.0, 0.0, 1.0]),
            scale: n.scale.unwrap_or([1.0; 3]),
        },
    }
}

fn f32_at(bytes: &[u8], at: usize) -> f32 {
    let mut word = [0; 4];
    if let Some(b) = bytes.get(at..at + 4) {
        word.copy_from_slice(b);
    }
    f32::from_le_bytes(word)
}

#[cfg(test)]
mod tests;
