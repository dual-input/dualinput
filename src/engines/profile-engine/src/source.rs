//! A profile and its modules, read through whoever runs the engine, since the engine reads no
//! file itself: the builder hands it files on disk, and the IDE its open editors.

use crate::report::{Diagnostic, Place, Report};
use crate::tree::{self, Kind, Node};

/// Hands the engine a file's bytes by its path from `profiles/`, as `modules/gns-430.yaml`.
pub trait Files {
    fn read(&self, path: &str) -> Option<Vec<u8>>;
}

/// A profile and every module it imports, parsed: the profile first, then each module once,
/// in the order it's first imported, which is the order a bundle holds their entries in.
pub struct Source {
    pub(crate) files: Vec<SourceFile>,
}

pub(crate) struct SourceFile {
    pub(crate) path: String,
    pub(crate) root: Node,
}

impl Source {
    /// Each file's path, the profile's first.
    pub fn paths(&self) -> Vec<&str> {
        self.files.iter().map(|f| f.path.as_str()).collect()
    }
}

/// Reads and parses a profile and its modules. A file that's missing or doesn't parse, and an
/// import cycle, fail it, since the checks need every file's tree.
pub fn source(files: &impl Files, path: &str) -> Result<Source, Report> {
    let mut loader = Loader {
        files,
        loaded: Vec::new(),
        stack: Vec::new(),
        report: Report::default(),
    };
    loader.load(path, None);
    if loader.report.has_errors() {
        loader.report.sort();
        return Err(loader.report);
    }
    Ok(Source {
        files: loader.loaded,
    })
}

struct Loader<'a, F: Files> {
    files: &'a F,
    loaded: Vec<SourceFile>,
    stack: Vec<String>,
    report: Report,
}

impl<F: Files> Loader<'_, F> {
    fn load(&mut self, path: &str, imported_at: Option<&Place>) {
        let missing = |what: &str| {
            Diagnostic::error(
                imported_at
                    .cloned()
                    .unwrap_or_else(|| Place::new(path, 1, 1)),
                "module-missing",
                format!("{path} {what}"),
            )
        };
        let Some(bytes) = self.files.read(path) else {
            self.report.push(missing("doesn't exist"));
            return;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            self.report.push(missing("isn't UTF-8 text"));
            return;
        };
        let root = match tree::parse(path, &text) {
            Ok(root) => root,
            Err(e) => {
                self.report.push(e);
                return;
            }
        };
        let imports = imports(&root);
        self.loaded.push(SourceFile {
            path: path.to_string(),
            root,
        });
        self.stack.push(path.to_string());
        for (name, at) in imports {
            let Some(module) = module_path(&name) else {
                self.report.push(Diagnostic::error(
                    at,
                    "module-missing",
                    format!(
                        "`{name}` is a module's path from profiles/ without .yaml, as `modules/gns-430`"
                    ),
                ));
                continue;
            };
            if self.stack.contains(&module) {
                self.report.push(Diagnostic::error(
                    at,
                    "import-cycle",
                    format!(
                        "Importing `{name}` here makes a cycle: {} imports it again",
                        self.stack.join(", then ")
                    ),
                ));
                continue;
            }
            if self.loaded.iter().any(|f| f.path == module) {
                continue;
            }
            self.load(&module, Some(&at));
        }
        self.stack.pop();
    }
}

/// The modules a file imports, each with its place, in the order it lists them. The checker
/// reports an `import` of the wrong shape.
fn imports(root: &Node) -> Vec<(String, Place)> {
    let Kind::Map(entries) = &root.kind else {
        return Vec::new();
    };
    let Some((_, node)) = entries.iter().find(|(k, _)| k.text == "import") else {
        return Vec::new();
    };
    let items: Vec<&Node> = match &node.kind {
        Kind::Seq(items) => items.iter().collect(),
        _ => vec![node],
    };
    items
        .into_iter()
        .filter_map(|n| n.str().map(|t| (t.text.trim().to_string(), n.at.clone())))
        .collect()
}

/// A module's file from its import, which stays inside `profiles/`.
fn module_path(name: &str) -> Option<String> {
    let inside = !name.is_empty()
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains(':')
        && name
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..");
    inside.then(|| format!("{name}.yaml"))
}
