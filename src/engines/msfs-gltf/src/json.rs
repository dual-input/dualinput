//! The parts of a glTF's JSON the reader names. serde skips every field not named here, such as
//! the ASOBO_ extensions and the textures, which neither a pose nor a cast reads.

use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Root {
    #[serde(default)]
    pub(crate) extensions_required: Vec<String>,
    #[serde(default)]
    pub(crate) nodes: Vec<Node>,
    #[serde(default)]
    pub(crate) meshes: Vec<Mesh>,
    #[serde(default)]
    pub(crate) accessors: Vec<Accessor>,
    #[serde(default)]
    pub(crate) buffer_views: Vec<BufferView>,
    #[serde(default)]
    pub(crate) buffers: Vec<Buffer>,
    #[serde(default)]
    pub(crate) materials: Vec<Material>,
    #[serde(default)]
    pub(crate) animations: Vec<Animation>,
}

#[derive(Deserialize)]
pub(crate) struct Node {
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) children: Vec<u32>,
    pub(crate) mesh: Option<u32>,
    pub(crate) skin: Option<u32>,
    pub(crate) matrix: Option<[f32; 16]>,
    pub(crate) translation: Option<[f32; 3]>,
    pub(crate) rotation: Option<[f32; 4]>,
    pub(crate) scale: Option<[f32; 3]>,
}

#[derive(Deserialize)]
pub(crate) struct Mesh {
    #[serde(default)]
    pub(crate) primitives: Vec<Primitive>,
}

#[derive(Deserialize)]
pub(crate) struct Primitive {
    #[serde(default)]
    pub(crate) attributes: BTreeMap<String, u32>,
    pub(crate) indices: Option<u32>,
    pub(crate) material: Option<u32>,
    pub(crate) mode: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Accessor {
    pub(crate) buffer_view: Option<u32>,
    #[serde(default)]
    pub(crate) byte_offset: u64,
    pub(crate) component_type: u32,
    #[serde(default)]
    pub(crate) normalized: bool,
    pub(crate) count: u64,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) sparse: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BufferView {
    pub(crate) buffer: u32,
    #[serde(default)]
    pub(crate) byte_offset: u64,
    pub(crate) byte_length: u64,
    pub(crate) byte_stride: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Buffer {
    pub(crate) uri: Option<String>,
    pub(crate) byte_length: u64,
}

#[derive(Deserialize)]
pub(crate) struct Material {
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) extensions: BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
pub(crate) struct Animation {
    pub(crate) name: Option<String>,
    #[serde(default)]
    pub(crate) channels: Vec<Channel>,
    #[serde(default)]
    pub(crate) samplers: Vec<Sampler>,
}

#[derive(Deserialize)]
pub(crate) struct Channel {
    pub(crate) sampler: u32,
    pub(crate) target: Target,
}

#[derive(Deserialize)]
pub(crate) struct Target {
    pub(crate) node: Option<u32>,
    pub(crate) path: String,
}

#[derive(Deserialize)]
pub(crate) struct Sampler {
    pub(crate) input: u32,
    pub(crate) output: u32,
    pub(crate) interpolation: Option<String>,
}
