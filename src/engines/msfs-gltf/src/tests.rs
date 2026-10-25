// Tests may panic and build their fixtures freely.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde_json::json;

use super::*;

/// A buffer laid out as MSFS lays out its vertices: interleaved, each vertex 36 bytes, a float
/// position, then a signed-byte normal and tangent and a signed-short texture coordinate,
/// which core glTF doesn't allow (record/areas/avatars/results/
/// 2026-10-17-aircraft-model-research.txt), then unsigned-short indices.
fn msfs_buffer(positions: &[[f32; 3]], indices: &[u16]) -> Vec<u8> {
    let mut bin = Vec::new();
    for p in positions {
        for c in p {
            bin.extend_from_slice(&c.to_le_bytes());
        }
        bin.extend_from_slice(&[0, 127, 0, 0]); // normal, VEC4 signed byte
        bin.extend_from_slice(&[127, 0, 0, 127]); // tangent, VEC4 signed byte
        bin.extend_from_slice(&[0x00, 0x3c, 0x00, 0x3c]); // texcoord, VEC2 signed short
        bin.extend_from_slice(&[0; 12]); // a second texcoord, a color, and padding
    }
    for i in indices {
        bin.extend_from_slice(&i.to_le_bytes());
    }
    bin
}

fn document(extra_required: &[&str]) -> (serde_json::Value, Vec<u8>) {
    let positions = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
    let indices = [0u16, 1, 2];
    let mut bin = msfs_buffer(&positions, &indices);
    let vertex_bytes = (positions.len() * 36) as u64;
    let times_at = bin.len() as u64;
    for t in [0.0f32, 1.0] {
        bin.extend_from_slice(&t.to_le_bytes());
    }
    let values_at = bin.len() as u64;
    for v in [0.0f32, 0.0, 0.0, 0.0, 2.0, 0.0] {
        bin.extend_from_slice(&v.to_le_bytes());
    }
    let mut required = vec!["MSFT_texture_dds".to_string()];
    required.extend(extra_required.iter().map(|s| s.to_string()));
    let gltf = json!({
        "extensionsRequired": required,
        "extensionsUsed": ["MSFT_texture_dds", "ASOBO_normal_map_convention"],
        "nodes": [
            { "name": "Root", "children": [1, 2] },
            { "name": "Switch", "mesh": 0, "translation": [0.5, 0.0, 0.0] },
            { "name": "Shell", "mesh": 1 },
        ],
        "meshes": [
            { "primitives": [
                { "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 }, "indices": 3, "material": 0 },
                { "attributes": { "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2 }, "indices": 3, "material": 0 },
            ]},
            { "primitives": [
                { "attributes": { "POSITION": 0 }, "indices": 3, "material": 1 },
            ]},
        ],
        "materials": [
            { "name": "Plastic" },
            { "name": "Shell", "extensions": { "ASOBO_material_invisible": {} } },
        ],
        "accessors": [
            { "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" },
            { "bufferView": 0, "byteOffset": 12, "componentType": 5120, "count": 3, "type": "VEC4" },
            { "bufferView": 0, "byteOffset": 20, "componentType": 5122, "count": 3, "type": "VEC2" },
            { "bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR" },
            { "bufferView": 2, "componentType": 5126, "count": 2, "type": "SCALAR" },
            { "bufferView": 3, "componentType": 5126, "count": 2, "type": "VEC3" },
        ],
        "bufferViews": [
            { "buffer": 0, "byteOffset": 0, "byteLength": vertex_bytes, "byteStride": 36 },
            { "buffer": 0, "byteOffset": vertex_bytes, "byteLength": 6 },
            { "buffer": 0, "byteOffset": times_at, "byteLength": 8 },
            { "buffer": 0, "byteOffset": values_at, "byteLength": 24 },
        ],
        "buffers": [{ "uri": "model.bin", "byteLength": bin.len() }],
        "animations": [{
            "name": "Switch_Lever",
            "samplers": [{ "input": 4, "output": 5, "interpolation": "LINEAR" }],
            "channels": [{ "sampler": 0, "target": { "node": 1, "path": "translation" } }],
        }],
    });
    (gltf, bin)
}

fn read(gltf: &serde_json::Value, bin: &[u8]) -> Result<Gltf, Error> {
    let doc = Document::parse(gltf.to_string().as_bytes())?;
    assert_eq!(doc.buffers(), vec![Some("model.bin".to_string())]);
    doc.read(&[bin])
}

#[test]
fn reads_msfs_interleaved_vertices_through_their_stride() {
    let (gltf, bin) = document(&[]);
    let model = read(&gltf, &bin).unwrap();
    assert_eq!(
        model.geometries.len(),
        1,
        "one pair of positions and indices"
    );
    let g = &model.geometries[0];
    assert_eq!(
        g.positions,
        vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    );
    assert_eq!(g.triangles, vec![[0, 1, 2]]);
}

#[test]
fn a_pair_two_primitives_name_is_read_once_and_listed_once_on_a_node() {
    let (gltf, bin) = document(&[]);
    let model = read(&gltf, &bin).unwrap();
    assert_eq!(
        model.nodes[1].primitives,
        vec![Primitive {
            geometry: 0,
            material: Some(0)
        }]
    );
    assert_eq!(model.nodes[2].primitives[0].geometry, 0);
}

#[test]
fn the_invisible_material_and_the_tree_are_read() {
    let (gltf, bin) = document(&[]);
    let model = read(&gltf, &bin).unwrap();
    assert!(!model.materials[0].invisible);
    assert!(model.materials[1].invisible);
    assert_eq!(model.nodes[1].parent, Some(0));
    assert_eq!(model.nodes[0].parent, None);
    assert_eq!(
        model.nodes[1].rest,
        Transform::Parts {
            translation: [0.5, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0; 3]
        }
    );
}

#[test]
fn an_animation_reads_its_keys_and_values() {
    let (gltf, bin) = document(&[]);
    let model = read(&gltf, &bin).unwrap();
    let c = &model.animations[0].channels[0];
    assert_eq!(model.animations[0].name, "Switch_Lever");
    assert_eq!((c.node, c.path), (1, Path::Translation));
    assert_eq!(c.times, vec![0.0, 1.0]);
    assert_eq!(c.values, vec![0.0, 0.0, 0.0, 0.0, 2.0, 0.0]);
}

#[test]
fn a_required_extension_that_could_change_the_geometry_is_refused() {
    let (gltf, _) = document(&["KHR_draco_mesh_compression"]);
    let error = Document::parse(gltf.to_string().as_bytes()).err().unwrap();
    assert!(error.0.contains("KHR_draco_mesh_compression"), "{error}");
}

#[test]
fn positions_in_a_layout_it_doesnt_name_are_refused() {
    let (mut gltf, bin) = document(&[]);
    gltf["accessors"][0]["componentType"] = json!(5122);
    let error = read(&gltf, &bin).err().unwrap();
    assert!(error.0.contains("positions"), "{error}");
}

#[test]
fn an_accessor_past_its_buffer_view_is_refused() {
    let (mut gltf, bin) = document(&[]);
    gltf["accessors"][0]["count"] = json!(4);
    let error = read(&gltf, &bin).err().unwrap();
    assert!(error.0.contains("runs past"), "{error}");
}

#[test]
fn an_index_past_the_vertices_is_refused() {
    let (gltf, mut bin) = document(&[]);
    let at = 3 * 36;
    bin[at..at + 2].copy_from_slice(&9u16.to_le_bytes());
    let error = read(&gltf, &bin).err().unwrap();
    assert!(error.0.contains("past the 3"), "{error}");
}

#[test]
fn a_skinned_node_keeps_no_triangles() {
    let (mut gltf, bin) = document(&[]);
    gltf["nodes"][1]["skin"] = json!(0);
    let model = read(&gltf, &bin).unwrap();
    assert!(model.nodes[1].skinned);
    assert!(model.nodes[1].primitives.is_empty());
}
