//! Finding an aircraft's model files from its package, one file leading to the next: the
//! preset's `aircraft.cfg` names the model folder, its `model.cfg` the interior and exterior
//! behavior files, each of those its most detailed glTF and the files it includes, and each
//! glTF its buffers, as our probes found them (read in
//! experiments/areas/avatars/lib/cockpit-files.mjs, `cockpitFiles` and `behaviorText`).
//!
//! The walk reads nothing itself. It's given what was read so far, and says what it needs
//! next, so whoever runs it, the core's edge or the authoring tool, reads the files.

use crate::xml;

/// What a read gave: the file's bytes, or that it isn't there.
pub enum Read<'a> {
    Bytes(&'a [u8]),
    Missing,
    NotYet,
}

/// The files of one model, the interior or the exterior.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ModelFiles {
    /// The behavior file `model.cfg` names, then each file it includes, in the order they
    /// include each other.
    pub(crate) behaviors: Vec<String>,
    pub(crate) gltf: Option<String>,
    pub(crate) buffers: Vec<String>,
}

/// Every file the walk found, and those it still needs read.
#[derive(Debug, Default)]
pub(crate) struct Walk {
    pub(crate) interior: Option<ModelFiles>,
    pub(crate) exterior: Option<ModelFiles>,
    pub(crate) wanted: Vec<String>,
    /// Why the walk ended short of a model, once every file it read says so.
    pub(crate) stopped: Option<String>,
}

/// Walks from the aircraft's folder, `<package>\SimObjects\Airplanes\<path>`, given what was
/// read so far.
pub(crate) fn walk<'a>(
    package: &str,
    path: &str,
    title: Option<&str>,
    read: &dyn Fn(&str) -> Read<'a>,
) -> Walk {
    let mut walk = Walk::default();
    let airplanes = join(package, r"SimObjects\Airplanes");
    let folder = join(&airplanes, &path.replace('/', "\\"));
    let base = join(&airplanes, path.split('/').next().unwrap_or(path));
    // A preset of a modular aircraft keeps its aircraft.cfg in a config folder.
    let cfgs = [
        join(&folder, "aircraft.cfg"),
        join(&folder, r"config\aircraft.cfg"),
    ];
    let Some((cfg_path, cfg)) = first_read(&cfgs, read, &mut walk) else {
        return walk;
    };
    let cfg_text = String::from_utf8_lossy(cfg);
    let model = fltsim(&cfg_text, title).and_then(|s| value(&s, "model").map(str::to_string));
    let model_folder = match model {
        Some(m) if !m.is_empty() => format!("model.{m}"),
        _ => "model".to_string(),
    };
    let cfg_folder = parent(&cfg_path);
    let model_cfgs = [
        join(&join(&cfg_folder, &model_folder), "model.cfg"),
        join(&join(&folder, &model_folder), "model.cfg"),
        join(&join(&base, &model_folder), "model.cfg"),
        join(&base, r"common\model\model.cfg"),
    ];
    let Some((model_cfg_path, model_cfg)) = first_read(&model_cfgs, read, &mut walk) else {
        return walk;
    };
    let models = section(&String::from_utf8_lossy(model_cfg), "models");
    let model_folder = parent(&model_cfg_path);
    let named = |key: &str| {
        value(&models, key).map(|f| join(&model_folder, f.trim_start_matches(['\\', '/'])))
    };
    walk.interior = named("interior").map(|xml| model_files(&xml, read, &mut walk));
    walk.exterior = named("exterior")
        .or_else(|| named("normal"))
        .map(|xml| model_files(&xml, read, &mut walk));
    if walk.interior.is_none() && walk.exterior.is_none() {
        walk.stopped = Some(format!(
            "{model_cfg_path} names no interior or exterior model"
        ));
    }
    walk
}

/// One model's behavior file, what it includes, its most detailed glTF, and that glTF's
/// buffers.
fn model_files<'a>(xml_path: &str, read: &dyn Fn(&str) -> Read<'a>, walk: &mut Walk) -> ModelFiles {
    let mut files = ModelFiles::default();
    let mut queue = vec![xml_path.to_string()];
    while let Some(path) = queue.pop() {
        if files
            .behaviors
            .iter()
            .any(|p| p.eq_ignore_ascii_case(&path))
        {
            continue;
        }
        let bytes = match read(&path) {
            Read::Bytes(b) => b,
            Read::Missing => continue,
            Read::NotYet => {
                walk.wanted.push(path);
                continue;
            }
        };
        files.behaviors.push(path.clone());
        let Ok(root) = xml::parse(&String::from_utf8_lossy(bytes)) else {
            continue;
        };
        let folder = parent(&path);
        // Only the model's own file picks the glTF: a file it includes names the LODs of the
        // aircraft it came from, which the sim doesn't draw for this one.
        if path == xml_path {
            files.gltf = most_detailed(&root).map(|f| join(&folder, &f));
        }
        let mut included = Vec::new();
        includes(&root, &mut included);
        for f in included.into_iter().rev() {
            queue.push(join(&folder, &f));
        }
    }
    if let Some(gltf) = &files.gltf {
        match read(gltf) {
            Read::Bytes(bytes) => match msfs_gltf::Document::parse(bytes) {
                Ok(doc) => {
                    let folder = parent(gltf);
                    for uri in doc.buffers().into_iter().flatten() {
                        let path = join(&folder, &uri);
                        if matches!(read(&path), Read::NotYet) {
                            walk.wanted.push(path.clone());
                        }
                        files.buffers.push(path);
                    }
                }
                Err(e) => walk.stopped = Some(format!("{gltf}: {e}")),
            },
            Read::Missing => walk.stopped = Some(format!("{gltf} isn't there")),
            Read::NotYet => walk.wanted.push(gltf.clone()),
        }
    }
    files
}

/// The first of `paths` that's there, or `None`, with each path not read yet wanted.
fn first_read<'a>(
    paths: &[String],
    read: &dyn Fn(&str) -> Read<'a>,
    walk: &mut Walk,
) -> Option<(String, &'a [u8])> {
    for p in paths {
        match read(p) {
            Read::Bytes(b) => return Some((p.clone(), b)),
            Read::Missing => {}
            Read::NotYet => {
                walk.wanted.push(p.clone());
                return None;
            }
        }
    }
    walk.stopped = Some(format!("none of {} is there", paths.join(", ")));
    None
}

/// The glTF of the `<LOD>` with the largest `minSize`, the one the sim draws closest.
fn most_detailed(root: &xml::Element) -> Option<String> {
    let mut best: Option<(f64, String)> = None;
    visit(root, &mut |e| {
        if e.name == "LOD"
            && let (Some(size), Some(file)) = (e.attr("minSize"), e.attr("ModelFile"))
        {
            let size: f64 = size.trim().parse().unwrap_or(0.0);
            if best.as_ref().is_none_or(|(b, _)| size > *b) {
                best = Some((size, file.to_string()));
            }
        }
    });
    best.map(|(_, f)| f)
}

/// The files a behavior file includes from the aircraft's own package: `<IncludeBase
/// RelativeFile>`, `<Include RelativeFile>`, and `<Include File>`, each relative to it. An
/// `<Include ModelBehaviorFile>` or `<Include Path>` names the sim's own template library,
/// which stays out (record/areas/avatars/decisions.md, "The model is posed only from code
/// in the aircraft's own files").
fn includes(root: &xml::Element, out: &mut Vec<String>) {
    visit(root, &mut |e| {
        if (e.name == "Include" || e.name == "IncludeBase")
            && let Some(f) = e.attr("RelativeFile").or_else(|| e.attr("File"))
        {
            out.push(f.to_string());
        }
    });
}

fn visit(e: &xml::Element, f: &mut dyn FnMut(&xml::Element)) {
    f(e);
    for c in e.elements() {
        visit(c, f);
    }
}

/// The `[FLTSIM.n]` section whose title is `title`, or the first when none is, as a list of
/// keys and values.
fn fltsim(cfg: &str, title: Option<&str>) -> Option<Vec<(String, String)>> {
    let mut first = None;
    for (name, body) in sections(cfg) {
        if !name.to_ascii_lowercase().starts_with("fltsim.") {
            continue;
        }
        let pairs = pairs(&body);
        let matches = title.is_some_and(|t| {
            value(&pairs, "title").is_some_and(|v| v.trim().eq_ignore_ascii_case(t.trim()))
        });
        if matches {
            return Some(pairs);
        }
        if first.is_none() {
            first = Some(pairs);
        }
    }
    first
}

/// One section of a `.cfg` file as keys and values, quotes and comments dropped.
pub(crate) fn section(cfg: &str, name: &str) -> Vec<(String, String)> {
    sections(cfg)
        .into_iter()
        .find(|(n, _)| n.eq_ignore_ascii_case(name))
        .map(|(_, body)| pairs(&body))
        .unwrap_or_default()
}

fn sections(cfg: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in cfg.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix('[').and_then(|l| l.split(']').next()) {
            out.push((name.trim().to_string(), String::new()));
        } else if let Some((_, body)) = out.last_mut() {
            body.push_str(line);
            body.push('\n');
        }
    }
    out
}

fn pairs(body: &str) -> Vec<(String, String)> {
    body.lines()
        .filter_map(|line| {
            let line = line.split(';').next().unwrap_or("");
            let (k, v) = line.split_once('=')?;
            Some((
                k.trim().to_ascii_lowercase(),
                v.trim().trim_matches('"').to_string(),
            ))
        })
        .collect()
}

pub(crate) fn value<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// `rel` from the folder `dir`, with `.` and `..` worked out, in Windows' separators.
pub(crate) fn join(dir: &str, rel: &str) -> String {
    let mut parts: Vec<&str> = dir.split(['\\', '/']).filter(|p| !p.is_empty()).collect();
    for part in rel.split(['\\', '/']) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    let joined = parts.join("\\");
    // A path from the root of a drive or a share keeps what started it.
    if dir.starts_with(r"\\") {
        format!(r"\\{joined}")
    } else if dir.starts_with(['\\', '/']) {
        format!(r"\{joined}")
    } else {
        joined
    }
}

pub(crate) fn parent(path: &str) -> String {
    match path.rfind(['\\', '/']) {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}
