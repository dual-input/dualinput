//! `serve`: the profile extension's language server, over stdin and stdout
//! (record/areas/profiles/03-the-extension.md, "The language server" and "Building on save").
//!
//! The extension is a thin client, so this holds the rest: the open documents, the engine's
//! checks on each change, the editor's features from profile-language and, inside a script, from
//! TypeScript's language service, and each save's build into the local folder.
//!
//! Two runtimes hold TypeScript, so no request waits behind a check or a build: the one on this
//! thread answers requests inside a script, and the worker's checks the scripts once typing
//! pauses and runs each save's build. A check runs to its end, since TypeScript drops its whole
//! type checker when one is canceled, and its errors show only if the text hasn't changed since
//! it began.
//!
//! In a session's flight, it reaches the sim through the author's own core, as one more of its
//! clients, over a socket a thread of its own holds (record/areas/profiles/
//! 04-the-extension-in-the-sim.md, "The connection").

mod connection;
mod convert;
mod displays;
mod facts;
mod requests;
mod sim;
mod sync_log;
#[cfg(test)]
mod tests;
mod variants;
mod view;
mod worker;
mod yaml_edit;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender, select, unbounded};
use lsp_server::{Connection, Message, Notification, Request, RequestId, Response};
use lsp_types::{
    CodeActionKind, CodeActionOptions, CodeActionProviderCapability, CodeLensOptions,
    CompletionOptions, DidChangeConfigurationParams, DidChangeTextDocumentParams,
    DidChangeWatchedFilesParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
    DidSaveTextDocumentParams, DocumentOnTypeFormattingOptions, ExecuteCommandOptions,
    FileChangeType, FoldingRangeProviderCapability, HoverProviderCapability, InitializeParams,
    OneOf, RenameOptions, SaveOptions, ServerCapabilities, SignatureHelpOptions,
    TextDocumentSaveReason, TextDocumentSyncCapability, TextDocumentSyncKind,
    TextDocumentSyncOptions, TextDocumentSyncSaveOptions, WillSaveTextDocumentParams,
};
use profile_build::Service;
use profile_engine::{
    Diagnostic, Files, LEVEL, Place, Program, Severity, check, module_source, program, source,
};
use profile_language::{Pos, Workspace, closure, imports, programs};
use serde_json::{Value, json};

use connection::Link;
use convert::{Lines, path_of, uri_of};
use sim::Sim;
use worker::{Done, Job, Target};

/// How long typing pauses before TypeScript checks the scripts, and before the sim's features
/// take the open text.
const PAUSE: Duration = Duration::from_millis(300);

/// The commands the server runs through `workspace/executeCommand`, which the extension's
/// client registers with VS Code under these IDs; the panel's go to the server from its calls.
/// The extension registers its own under other IDs, as src/apps/profile-extension/src/
/// extension.ts says, `PANEL_COMMANDS` in src/apps/profile-extension/src/bridge.ts names the
/// panel's, and `SYNC_LOG_COMMANDS` in src/apps/profile-extension/src/sync-log.ts the Sync log's,
/// so change all four together.
const COMMANDS: [&str; 20] = [
    "dualInput.build",
    "dualInput.removeLocalBundle",
    "dualInput.importers",
    "dualInput.localFolder",
    "dualInput.variantFilter",
    "dualInput.panel.open",
    "dualInput.panel.pick",
    "dualInput.panel.addAircraft",
    "dualInput.panel.typed",
    "dualInput.panel.run",
    "dualInput.panel.move",
    "dualInput.panel.tick",
    "dualInput.panel.write",
    "dualInput.panel.add",
    "dualInput.panel.leave",
    "dualInput.panel.record",
    "dualInput.panel.stop",
    "dualInput.panel.play",
    "dualInput.syncLog.clear",
    "dualInput.syncLog.reveal",
];

pub(crate) fn serve() -> Result<(), String> {
    let (connection, io) = Connection::stdio();
    run(connection, connection::start())?;
    io.join()
        .map_err(|e| format!("the server's input and output failed: {e}"))
}

/// Serves one client until it says to exit, reaching the author's core through `link`. The
/// worker loads its runtime on its own thread while this one loads the requests' runtime, before
/// the client's `initialize` is answered.
pub(crate) fn run(connection: Connection, link: Link) -> Result<(), String> {
    let started = Instant::now();
    let (done, finished) = unbounded();
    let worker = worker::start(done);
    let service = Service::new();
    let (id, params) = connection.initialize_start().map_err(|e| e.to_string())?;
    let params: InitializeParams =
        serde_json::from_value(params).map_err(|e| format!("initialize didn't read: {e}"))?;
    let answer = json!({
        "capabilities": capabilities(),
        "serverInfo": { "name": "dualinput-profile-builder", "version": env!("CARGO_PKG_VERSION") },
    });
    connection
        .initialize_finish(id, answer)
        .map_err(|e| e.to_string())?;
    eprintln!(
        "Dual Input's profile server started in {}ms",
        started.elapsed().as_millis()
    );
    let core = link.down.clone();
    let sim = Sim::new(link, &params);
    let mut server = Server::new(
        connection.sender.clone(),
        worker,
        Some(service),
        sim,
        &params,
    );
    server.start();
    server.serve(&connection.receiver, &finished, &core)
}

fn capabilities() -> ServerCapabilities {
    ServerCapabilities {
        text_document_sync: Some(TextDocumentSyncCapability::Options(
            TextDocumentSyncOptions {
                open_close: Some(true),
                change: Some(TextDocumentSyncKind::FULL),
                will_save: Some(true),
                will_save_wait_until: None,
                save: Some(TextDocumentSyncSaveOptions::SaveOptions(SaveOptions {
                    include_text: Some(false),
                })),
            },
        )),
        completion_provider: Some(CompletionOptions {
            resolve_provider: Some(true),
            trigger_characters: Some(vec![".".into()]),
            ..CompletionOptions::default()
        }),
        hover_provider: Some(HoverProviderCapability::Simple(true)),
        signature_help_provider: Some(SignatureHelpOptions {
            trigger_characters: Some(vec!["(".into(), ",".into()]),
            ..SignatureHelpOptions::default()
        }),
        definition_provider: Some(OneOf::Left(true)),
        references_provider: Some(OneOf::Left(true)),
        rename_provider: Some(OneOf::Right(RenameOptions {
            prepare_provider: Some(true),
            work_done_progress_options: Default::default(),
        })),
        document_symbol_provider: Some(OneOf::Left(true)),
        workspace_symbol_provider: Some(OneOf::Left(true)),
        folding_range_provider: Some(FoldingRangeProviderCapability::Simple(true)),
        document_formatting_provider: Some(OneOf::Left(true)),
        document_on_type_formatting_provider: Some(DocumentOnTypeFormattingOptions {
            first_trigger_character: "\n".into(),
            more_trigger_character: Some(vec!["}".into()]),
        }),
        code_action_provider: Some(CodeActionProviderCapability::Options(CodeActionOptions {
            code_action_kinds: Some(vec![CodeActionKind::QUICKFIX]),
            ..CodeActionOptions::default()
        })),
        code_lens_provider: Some(CodeLensOptions {
            resolve_provider: Some(false),
        }),
        execute_command_provider: Some(ExecuteCommandOptions {
            commands: COMMANDS.iter().map(|c| c.to_string()).collect(),
            work_done_progress_options: Default::default(),
        }),
        ..ServerCapabilities::default()
    }
}

/// The settings the extension's configuration section `dualInput` gives.
#[derive(Clone, Debug, PartialEq)]
struct Settings {
    build_on_save: bool,
    /// Empty for the core's own local folder.
    local_folder: String,
    /// Empty for the core's own data folder.
    data_folder: String,
}

impl Default for Settings {
    fn default() -> Settings {
        Settings {
            build_on_save: true,
            local_folder: String::new(),
            data_folder: String::new(),
        }
    }
}

impl Settings {
    fn read(section: &Value) -> Settings {
        let text = |key: &str| {
            section
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string()
        };
        Settings {
            build_on_save: section
                .get("buildOnSave")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            local_folder: text("localFolder"),
            data_folder: text("dataFolder"),
        }
    }

    /// The core's data folder, whose `port.json` names the core's port: the one the setting
    /// names, for a development core, or the core's own, `%APPDATA%\DualInput\`.
    fn data(&self) -> Result<PathBuf, String> {
        if !self.data_folder.is_empty() {
            return Ok(PathBuf::from(&self.data_folder));
        }
        let app_data = std::env::var_os("APPDATA")
            .ok_or("APPDATA isn't set, and the dualInput.dataFolder setting names no folder")?;
        Ok(PathBuf::from(app_data).join("DualInput"))
    }

    /// The folder bundles go into, which the extension asks for with `dualInput.localFolder`: the
    /// one the setting names, or the core's own, `%APPDATA%\DualInput\profiles\local\`. `FOLDER`
    /// in src/platform/profile-loader/src/local.rs names the same folder inside the core's data
    /// folder, so change both together.
    fn local(&self) -> Result<PathBuf, String> {
        if !self.local_folder.is_empty() {
            return Ok(PathBuf::from(&self.local_folder));
        }
        let app_data = std::env::var_os("APPDATA")
            .ok_or("APPDATA isn't set, and the dualInput.localFolder setting names no folder")?;
        Ok(PathBuf::from(app_data).join("DualInput\\profiles\\local"))
    }
}

/// The root of one program the engine checks: a profile, or a module that no profile imports,
/// checked against its own entries.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Root {
    file: PathBuf,
    /// The profiles' folder its imports are found from.
    profiles: PathBuf,
    rel: String,
    module: bool,
}

/// What each kind of check found in one program, each diagnostic with its file.
#[derive(Default)]
struct Results {
    root: Option<Root>,
    files: BTreeSet<PathBuf>,
    /// The engine's checks, from the open editors' text.
    engine: Vec<(PathBuf, Diagnostic)>,
    /// TypeScript's check, after typing paused.
    typed: Vec<(PathBuf, Diagnostic)>,
    /// The last build's report, from the files on disk.
    built: Vec<(PathBuf, Diagnostic)>,
}

/// A profiles' folder seen through the open editors: an open file's text, or else the file on
/// disk, for the engine's checks.
struct Overlay<'a> {
    root: &'a Path,
    open: &'a BTreeMap<PathBuf, String>,
}

impl Files for Overlay<'_> {
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        let path = full(self.root, rel);
        match self.open.get(&path) {
            Some(text) => Some(text.clone().into_bytes()),
            None => std::fs::read(&path).ok(),
        }
    }
}

/// A file's path from its profiles' folder and its path in it, as `aircraft/x.yaml`.
fn full(root: &Path, rel: &str) -> PathBuf {
    rel.split('/')
        .fold(root.to_path_buf(), |p, part| p.join(part))
}

/// A profile's or a module's profiles' folder, and its path in it, from its path on disk: a
/// profile sits in `aircraft/`, and a module anywhere under `modules/`.
fn locate(path: &Path) -> Option<(PathBuf, String)> {
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("yaml"))
    {
        return None;
    }
    let named = |p: &Path, name: &str| {
        p.file_name()
            .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(name))
    };
    let folder = if path.parent().is_some_and(|p| named(p, "aircraft")) {
        path.parent()?
    } else {
        path.ancestors().skip(1).find(|a| named(a, "modules"))?
    };
    let root = folder.parent()?;
    let mut rel: Vec<String> = path
        .strip_prefix(root)
        .ok()?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    rel[0] = rel[0].to_ascii_lowercase();
    Some((root.to_path_buf(), rel.join("/")))
}

pub(crate) struct Server {
    out: Sender<Message>,
    worker: Sender<Job>,
    service: Option<Service>,
    /// Each workspace folder's `profiles/`.
    roots: Vec<PathBuf>,
    open: BTreeMap<PathBuf, String>,
    /// Every profile's and module's text on disk, from the scan at the start and each change
    /// the extension reports, for which profiles import each module.
    disk: BTreeMap<PathBuf, String>,
    settings: Settings,
    configured: bool,
    /// Whether the client answers `workspace/configuration`.
    pull: bool,
    asked: u64,
    /// Each file's last `willSave` reason, which its `didSave` builds on.
    reasons: BTreeMap<PathBuf, TextDocumentSaveReason>,
    results: BTreeMap<PathBuf, Results>,
    /// Each program's count of changes, which a TypeScript check's result is held against.
    generation: BTreeMap<PathBuf, u64>,
    due: BTreeMap<PathBuf, Instant>,
    in_flight: BTreeSet<PathBuf>,
    /// Each build's request, for "Build now", answered once it's done.
    builds: BTreeMap<u64, Option<RequestId>>,
    next_build: u64,
    /// Each profile's last build's count of errors.
    errors: BTreeMap<PathBuf, usize>,
    /// The hash of each profile's bundle in the local folder, as last read. When the open text's
    /// bundle is that one and the session still flies another, the author has saved and the
    /// session is loading the save, so the recorder waits rather than asking for a save.
    written: BTreeMap<PathBuf, String>,
    /// The files whose diagnostics were last published with any in them.
    published: BTreeSet<PathBuf>,
    sim: Sim,
}

impl Server {
    fn new(
        out: Sender<Message>,
        worker: Sender<Job>,
        service: Option<Service>,
        sim: Sim,
        params: &InitializeParams,
    ) -> Server {
        let folders: Vec<PathBuf> = params
            .workspace_folders
            .iter()
            .flatten()
            .filter_map(|f| path_of(f.uri.as_str()))
            .collect();
        let pull = params
            .capabilities
            .workspace
            .as_ref()
            .and_then(|w| w.configuration)
            .unwrap_or(false);
        Server {
            out,
            worker,
            service,
            roots: folders.iter().map(|f| f.join("profiles")).collect(),
            open: BTreeMap::new(),
            disk: BTreeMap::new(),
            settings: Settings::default(),
            configured: false,
            pull,
            asked: 0,
            reasons: BTreeMap::new(),
            results: BTreeMap::new(),
            generation: BTreeMap::new(),
            due: BTreeMap::new(),
            in_flight: BTreeSet::new(),
            builds: BTreeMap::new(),
            next_build: 0,
            errors: BTreeMap::new(),
            written: BTreeMap::new(),
            published: BTreeSet::new(),
            sim,
        }
    }

    fn start(&mut self) {
        self.scan();
        if self.pull {
            self.start_configuration();
        } else {
            self.configured = true;
            self.announce(false);
            self.point_at_core();
        }
    }

    fn serve(
        &mut self,
        inbox: &Receiver<Message>,
        finished: &Receiver<Done>,
        core: &Receiver<connection::Down>,
    ) -> Result<(), String> {
        let mut core = core.clone();
        loop {
            let wait = self.next_due().map_or(Duration::from_secs(3600), |t| {
                t.saturating_duration_since(Instant::now())
            });
            let mut lost = false;
            select! {
                recv(inbox) -> message => match message {
                    Ok(Message::Request(request)) => {
                        if let Some(response) = self.request(request) {
                            self.send(response.into());
                        }
                    }
                    Ok(Message::Notification(n)) if n.method == "exit" => return Ok(()),
                    Ok(Message::Notification(n)) => self.notification(n),
                    Ok(Message::Response(r)) => self.response(r),
                    Err(_) => return Ok(()),
                },
                recv(finished) -> done => match done {
                    Ok(done) => self.finished(done),
                    Err(_) => return Err("the server's second thread stopped".into()),
                },
                recv(core) -> down => match down {
                    Ok(down) => self.heard(down),
                    Err(_) => lost = true,
                },
                default(wait) => {}
            }
            // The editor's features don't need the sim, so a connection that stopped leaves them
            // working, and the loop waits on it no more.
            if lost {
                eprintln!("The connection to Dual Input stopped, so the sim's features are off");
                core = crossbeam_channel::never();
            }
            self.fire_due();
        }
    }

    fn send(&self, message: Message) {
        // A client that's gone takes nothing more, and its exit ends the loop.
        let _ = self.out.send(message);
    }

    fn notify(&self, method: &str, params: Value) {
        self.send(Notification::new(method.into(), params).into());
    }

    fn notification(&mut self, n: Notification) {
        let file = |uri: &lsp_types::Uri| path_of(uri.as_str());
        match n.method.as_str() {
            "textDocument/didOpen" => {
                if let Ok(p) = n.extract::<DidOpenTextDocumentParams>("textDocument/didOpen")
                    && let Some(path) = file(&p.text_document.uri)
                {
                    self.open.insert(path.clone(), p.text_document.text);
                    self.changed(&path);
                    self.sim_edited(&path, true, true);
                }
            }
            "textDocument/didChange" => {
                if let Ok(p) = n.extract::<DidChangeTextDocumentParams>("textDocument/didChange")
                    && let Some(path) = file(&p.text_document.uri)
                    && let Some(change) = p.content_changes.into_iter().last()
                {
                    self.open.insert(path.clone(), change.text);
                    self.changed(&path);
                    self.sim_edited(&path, true, false);
                }
            }
            "textDocument/didClose" => {
                if let Ok(p) = n.extract::<DidCloseTextDocumentParams>("textDocument/didClose")
                    && let Some(path) = file(&p.text_document.uri)
                {
                    self.open.remove(&path);
                    self.changed(&path);
                    self.sim_edited(&path, false, true);
                }
            }
            "textDocument/willSave" => {
                if let Ok(p) = n.extract::<WillSaveTextDocumentParams>("textDocument/willSave")
                    && let Some(path) = file(&p.text_document.uri)
                {
                    self.reasons.insert(path, p.reason);
                }
            }
            "textDocument/didSave" => {
                if let Ok(p) = n.extract::<DidSaveTextDocumentParams>("textDocument/didSave")
                    && let Some(path) = file(&p.text_document.uri)
                {
                    self.saved(&path);
                }
            }
            "workspace/didChangeConfiguration" => {
                let Ok(p) =
                    n.extract::<DidChangeConfigurationParams>("workspace/didChangeConfiguration")
                else {
                    return;
                };
                match p.settings.get("dualInput") {
                    Some(section) => self.apply(Settings::read(section)),
                    None if self.pull => self.start_configuration(),
                    None => {}
                }
            }
            "workspace/didChangeWatchedFiles" => {
                if let Ok(p) =
                    n.extract::<DidChangeWatchedFilesParams>("workspace/didChangeWatchedFiles")
                {
                    for change in p.changes {
                        if let Some(path) = file(&change.uri) {
                            self.on_disk(&path, change.typ == FileChangeType::DELETED);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// Asks the client for the `dualInput` section, which `response` reads.
    fn start_configuration(&mut self) {
        self.asked += 1;
        let id = RequestId::from(format!("configuration-{}", self.asked));
        let params = json!({ "items": [{ "section": "dualInput" }] });
        self.send(Request::new(id, "workspace/configuration".into(), params).into());
    }

    /// The client's answer to one of the server's requests: `workspace/configuration`, whose ID
    /// `start_configuration` makes, or the sim's lenses' refresh or Sync's edit.
    fn response(&mut self, response: Response) {
        let id = serde_json::to_value(&response.id).unwrap_or(Value::Null);
        if !id
            .as_str()
            .is_some_and(|id| id.starts_with("configuration-"))
        {
            match response.response_result {
                Ok(answer) if answer.get("applied") == Some(&Value::Bool(false)) => eprintln!(
                    "The editor didn't take Sync's edit to displays: {}",
                    answer["failureReason"]
                        .as_str()
                        .unwrap_or("it gave no reason")
                ),
                Err(e) => eprintln!("The editor refused {id}: {}", e.message),
                Ok(_) => {}
            }
            return;
        }
        match response.response_result {
            Ok(Value::Array(sections)) => {
                let section = sections.into_iter().next().unwrap_or(Value::Null);
                self.apply(Settings::read(&section));
            }
            Ok(_) => self.apply(self.settings.clone()),
            Err(e) => {
                eprintln!("The editor gave no settings: {}", e.message);
                self.apply(self.settings.clone());
            }
        }
    }

    fn apply(&mut self, next: Settings) {
        let moved = next.local_folder != self.settings.local_folder;
        let core_moved = next.data_folder != self.settings.data_folder;
        self.settings = next;
        if !self.configured {
            self.configured = true;
            self.announce(false);
            self.point_at_core();
        } else {
            if moved {
                self.announce(true);
            }
            if core_moved {
                self.point_at_core();
            }
        }
    }

    /// Reads every profile and module in each workspace folder's `profiles/`.
    fn scan(&mut self) {
        let mut found = Vec::new();
        for root in &self.roots {
            let mut folders = vec![root.join("aircraft"), root.join("modules")];
            while let Some(folder) = folders.pop() {
                for entry in std::fs::read_dir(&folder).into_iter().flatten().flatten() {
                    let path = entry.path();
                    if path.is_dir() && !folder.ends_with("aircraft") {
                        folders.push(path);
                    } else if locate(&path).is_some() {
                        found.push(path);
                    }
                }
            }
        }
        for path in found {
            if let Ok(text) = std::fs::read_to_string(&path) {
                self.disk.insert(path, text);
            }
        }
        let profiles = self
            .disk
            .keys()
            .filter(|p| locate(p).is_some_and(|(_, rel)| rel.starts_with("aircraft/")))
            .count();
        let counted = |n: usize, what: &str| match n {
            1 => format!("1 {what}"),
            n => format!("{n} {what}s"),
        };
        eprintln!(
            "Read {} and {}",
            counted(profiles, "profile"),
            counted(self.disk.len() - profiles, "module")
        );
    }

    /// One `dualInput/build` for each profile whose bundle the local folder holds, as of its
    /// last write, or with `all`, for every profile, as when the local folder changes.
    fn announce(&mut self, all: bool) {
        let Ok(local) = self.settings.local() else {
            return;
        };
        let profiles: Vec<(PathBuf, String)> = self
            .disk
            .keys()
            .filter_map(|p| locate(p).filter(|(_, rel)| rel.starts_with("aircraft/")))
            .collect();
        for (root, rel) in profiles {
            let profile = full(&root, &rel);
            let name = rel.rsplit('/').next().unwrap_or(&rel);
            let held = worker::held(&local.join(name));
            if held.is_none() && !all {
                continue;
            }
            let errors = if held.is_some() {
                0
            } else {
                self.errors.get(&profile).copied().unwrap_or(0)
            };
            self.notify_build(&profile, &profile, held.as_ref(), errors);
        }
    }

    fn notify_build(
        &mut self,
        profile: &Path,
        trigger: &Path,
        held: Option<&worker::Held>,
        errors: usize,
    ) {
        match held {
            Some(h) => self.written.insert(profile.to_path_buf(), h.hash.clone()),
            None => self.written.remove(profile),
        };
        self.notify(
            "dualInput/build",
            json!({
                "profile": uri_of(profile),
                "trigger": uri_of(trigger),
                "hash": held.map(|h| h.hash.clone()),
                "errors": errors,
                "builtAt": held.and_then(|h| h.built_at.clone()),
                "bundle": held.map(|h| h.bundle.to_string_lossy().into_owned()),
            }),
        );
    }

    /// A file the extension reports changed on disk. An open file's checks read its editor's
    /// text, which a save leaves the same, so only a closed file's programs are checked again.
    fn on_disk(&mut self, path: &Path, deleted: bool) {
        if locate(path).is_none() {
            return;
        }
        match std::fs::read_to_string(path) {
            Ok(text) if !deleted => self.disk.insert(path.to_path_buf(), text),
            _ => self.disk.remove(path),
        };
        if !self.open.contains_key(path) {
            self.changed(path);
            self.sim_edited(path, false, false);
        }
    }

    /// The text of a file: its editor's, or else the one on disk.
    fn text_of(&self, file: &Path) -> Option<String> {
        self.open
            .get(file)
            .or_else(|| self.disk.get(file))
            .cloned()
            .or_else(|| std::fs::read_to_string(file).ok())
    }

    /// Every profile's and module's text under a profiles' folder, by its path in it: an open
    /// file's editor's, or else the one on disk; with `saved`, the one on disk alone.
    fn texts(&self, root: &Path, saved: bool) -> BTreeMap<String, &str> {
        let mut texts = BTreeMap::new();
        let open = self.open.iter().filter(|_| !saved);
        for (path, text) in self.disk.iter().chain(open) {
            if let Some((r, rel)) = locate(path)
                && r == root
            {
                texts.insert(rel, text.as_str());
            }
        }
        texts
    }

    /// The programs that hold `file`: each profile whose imports reach it, or the module on its
    /// own when none does.
    fn programs_of(&self, file: &Path) -> Vec<Root> {
        let Some((root, rel)) = locate(file) else {
            return Vec::new();
        };
        let texts = self.texts(&root, false);
        let ws = Workspace {
            files: texts.iter().map(|(k, v)| (k.as_str(), *v)).collect(),
        };
        programs(&ws, &rel)
            .into_iter()
            .map(|p| Root {
                file: full(&root, &p),
                profiles: root.clone(),
                module: !p.starts_with("aircraft/"),
                rel: p,
            })
            .collect()
    }

    /// The engine's checks of every program that holds `file`, which a change to it may have
    /// changed, with their TypeScript check due once typing pauses.
    fn changed(&mut self, file: &Path) {
        let mut touched: BTreeSet<PathBuf> = BTreeSet::from([file.to_path_buf()]);
        // A file renamed or deleted must show no errors. `programs_of` still gives it a program
        // of its own, whose check reports that the file doesn't exist, so it runs none: its
        // results go, and each program its last check read is checked again without it.
        let roots: Vec<Root> = if self.open.contains_key(file) || file.exists() {
            self.programs_of(file)
        } else {
            self.disk.remove(file);
            touched.extend(self.forget(file));
            self.results
                .values()
                .filter(|r| r.files.contains(file))
                .filter_map(|r| r.root.clone())
                .collect()
        };
        for root in roots {
            *self.generation.entry(root.file.clone()).or_default() += 1;
            let (files, engine, clean) = self.engine(&root);
            // A module checked on its own before a profile imported it holds a TS2339 at each
            // `state.<key>` of the profile's, and nothing checks it on its own again once a
            // profile's program holds it, so that check's results go.
            let alone: Vec<PathBuf> = files
                .iter()
                .filter(|f| {
                    !root.module
                        && **f != root.file
                        && self
                            .results
                            .get(*f)
                            .and_then(|r| r.root.as_ref())
                            .is_some_and(|r| r.module && r.file == **f)
                })
                .cloned()
                .collect();
            for module in alone {
                touched.extend(self.forget(&module));
            }
            let results = self.results.entry(root.file.clone()).or_default();
            touched.extend(results.files.iter().cloned());
            touched.extend(files.iter().cloned());
            results.root = Some(root.clone());
            results.files = files;
            results.engine = engine;
            results.typed.clear();
            results.built.clear();
            // The build type-checks only a profile the engine's checks pass, as this does, so an
            // entry the checks dropped shows no error of TypeScript's on each read of it.
            if clean {
                self.due.insert(root.file.clone(), Instant::now() + PAUSE);
            } else {
                self.due.remove(&root.file);
            }
        }
        self.publish(touched);
    }

    /// Drops a program's results and its TypeScript check, and gives the files they showed in,
    /// for `publish` to show without them. Its generation stays, so a check of it still running
    /// comes back to no results, or to a later generation's, and shows nothing.
    fn forget(&mut self, program: &Path) -> BTreeSet<PathBuf> {
        self.due.remove(program);
        let Some(results) = self.results.remove(program) else {
            return BTreeSet::new();
        };
        let mut files = results.files;
        let shown = results
            .engine
            .iter()
            .chain(&results.typed)
            .chain(&results.built);
        files.extend(shown.map(|(f, _)| f.clone()));
        files
    }

    /// The engine's checks of one program, the files they read, and whether they passed.
    fn engine(&self, root: &Root) -> (BTreeSet<PathBuf>, Vec<(PathBuf, Diagnostic)>, bool) {
        let files = Overlay {
            root: &root.profiles,
            open: &self.open,
        };
        let found = if root.module {
            module_source(&files, &root.rel)
        } else {
            source(&files, &root.rel)
        };
        let (paths, report) = match &found {
            Ok(src) => (
                src.paths().iter().map(|p| p.to_string()).collect(),
                check(src, LEVEL),
            ),
            Err(report) => (vec![root.rel.clone()], report.clone()),
        };
        let diagnostics: Vec<(PathBuf, Diagnostic)> = report
            .diagnostics
            .iter()
            .map(|d| (full(&root.profiles, &d.at.file), d.clone()))
            .collect();
        let mut set: BTreeSet<PathBuf> = paths.iter().map(|p| full(&root.profiles, p)).collect();
        set.extend(diagnostics.iter().map(|(f, _)| f.clone()));
        (set, diagnostics, found.is_ok() && !report.has_errors())
    }

    /// The program TypeScript checks for a root, from the open editors' text.
    fn program_of(&self, root: &Root) -> Option<Program> {
        let files = Overlay {
            root: &root.profiles,
            open: &self.open,
        };
        let found = if root.module {
            module_source(&files, &root.rel)
        } else {
            source(&files, &root.rel)
        };
        found.ok().map(|src| program(&src, LEVEL))
    }

    fn next_due(&self) -> Option<Instant> {
        self.due
            .iter()
            .filter(|(p, _)| !self.in_flight.contains(*p))
            .map(|(_, t)| *t)
            .chain(self.sim.next_due())
            .min()
    }

    /// Sends each program whose pause has passed to the worker's TypeScript, one check of a
    /// program at a time.
    fn fire_due(&mut self) {
        let now = Instant::now();
        let ready: Vec<PathBuf> = self
            .due
            .iter()
            .filter(|(p, t)| **t <= now && !self.in_flight.contains(*p))
            .map(|(p, _)| p.clone())
            .collect();
        for file in ready {
            self.due.remove(&file);
            let Some(root) = self.results.get(&file).and_then(|r| r.root.clone()) else {
                continue;
            };
            let Some(scripts) = self.program_of(&root) else {
                continue;
            };
            let generation = self.generation.get(&file).copied().unwrap_or(0);
            self.in_flight.insert(file.clone());
            let job = Job::Check {
                program: file,
                generation,
                scripts: Box::new(scripts),
            };
            if self.worker.send(job).is_err() {
                eprintln!("The server's second thread stopped, so TypeScript checks nothing");
            }
        }
        self.fire_sim();
    }

    fn finished(&mut self, done: Done) {
        match done {
            Done::Checked {
                program,
                generation,
                report,
            } => {
                self.in_flight.remove(&program);
                // A check of text that changed while it ran shows nothing, and the check of the
                // newest text, due once typing paused, follows.
                if self.generation.get(&program) != Some(&generation) {
                    return;
                }
                let Some(results) = self.results.get_mut(&program) else {
                    return;
                };
                let Some(root) = results.root.clone() else {
                    return;
                };
                results.typed = report
                    .diagnostics
                    .into_iter()
                    .map(|d| (full(&root.profiles, &d.at.file), d))
                    .collect();
                let mut touched = results.files.clone();
                touched.extend(results.typed.iter().map(|(f, _)| f.clone()));
                self.publish(touched);
            }
            Done::Built { id, trigger, built } => {
                let mut touched = BTreeSet::new();
                for b in built {
                    let profile = full(&b.root, &b.rel);
                    let errors = b.report.errors().count();
                    self.errors.insert(profile.clone(), errors);
                    let results = self.results.entry(profile.clone()).or_default();
                    results.root.get_or_insert_with(|| Root {
                        file: profile.clone(),
                        profiles: b.root.clone(),
                        rel: b.rel.clone(),
                        module: false,
                    });
                    results.built = b
                        .report
                        .diagnostics
                        .iter()
                        .map(|d| (full(&b.root, &d.at.file), d.clone()))
                        .collect();
                    touched.extend(results.files.iter().cloned());
                    touched.extend(results.built.iter().map(|(f, _)| f.clone()));
                    touched.insert(profile.clone());
                    self.notify_build(&profile, &trigger, b.held.as_ref(), errors);
                }
                self.publish(touched);
                if let Some(Some(request)) = self.builds.remove(&id) {
                    self.send(Response::new_ok(request, Value::Null).into());
                }
                // The bundle just written may be the open text's, which turns the recorder's
                // "save first" into waiting for the session to load it.
                self.show_sim();
            }
            Done::Bundled { texts, bundle } => self.bundled(texts, bundle),
        }
    }

    /// A save, which builds when it's one the author made and building on save is on.
    fn saved(&mut self, file: &Path) {
        if let Ok(text) = std::fs::read_to_string(file)
            && locate(file).is_some()
        {
            self.disk.insert(file.to_path_buf(), text);
        }
        let reason = self.reasons.remove(file);
        if reason == Some(TextDocumentSaveReason::MANUAL)
            && self.settings.build_on_save
            && let Err(e) = self.build(file, None)
        {
            eprintln!("{e}");
        }
    }

    /// Builds as a save the author makes does: a profile's file builds that profile, and a
    /// module's each profile on disk that imports it, writing only the bundles of those the local
    /// folder holds already, so a module's save makes no bundle of a profile nobody is testing.
    fn build(&mut self, file: &Path, request: Option<RequestId>) -> Result<(), String> {
        let (root, rel) = locate(file).ok_or_else(|| {
            format!(
                "{} is neither a profile, in profiles/aircraft/, nor a module, in profiles/modules/",
                file.display()
            )
        })?;
        let profiles: Vec<Target> = if rel.starts_with("aircraft/") {
            vec![Target {
                root: root.clone(),
                rel,
                always: true,
            }]
        } else {
            self.importers(&root, &rel)
                .into_iter()
                .map(|p| Target {
                    root: root.clone(),
                    rel: p,
                    always: false,
                })
                .collect()
        };
        if profiles.is_empty() {
            eprintln!(
                "No profile imports {}, so its save built nothing",
                file.display()
            );
            if let Some(request) = request {
                self.send(Response::new_ok(request, Value::Null).into());
            }
            return Ok(());
        }
        let id = self.next_build;
        self.next_build += 1;
        self.builds.insert(id, request);
        let job = Job::Build {
            id,
            trigger: file.to_path_buf(),
            profiles,
            local: self.settings.local(),
        };
        self.worker
            .send(job)
            .map_err(|_| "The server's second thread stopped, so nothing builds".to_string())
    }

    /// The profiles on disk whose imports reach a module, as their files were saved.
    fn importers(&self, root: &Path, rel: &str) -> Vec<String> {
        let texts = self.texts(root, true);
        let ws = Workspace {
            files: texts.iter().map(|(k, v)| (k.as_str(), *v)).collect(),
        };
        programs(&ws, rel)
            .into_iter()
            .filter(|p| p.starts_with("aircraft/"))
            .collect()
    }

    /// Publishes each file's diagnostics, every check's merged, so one fault shows once.
    fn publish(&mut self, files: BTreeSet<PathBuf>) {
        for file in files {
            let mut found: Vec<Diagnostic> = Vec::new();
            for results in self.results.values() {
                let all = results
                    .engine
                    .iter()
                    .chain(&results.typed)
                    .chain(&results.built);
                found.extend(all.filter(|(f, _)| *f == file).map(|(_, d)| d.clone()));
                if let Some(root) = &results.root
                    && root.file == file
                    && !root.module
                {
                    found.extend(self.import_errors(results, root));
                }
            }
            let mut seen = BTreeSet::new();
            found.retain(|d| {
                seen.insert((d.at.line, d.at.column, d.code.clone(), d.message.clone()))
            });
            found.sort_by_key(|d| (d.at.line, d.at.column));
            if found.is_empty() && !self.published.contains(&file) {
                continue;
            }
            let text = self.text_of(&file).unwrap_or_default();
            let lines = Lines::new(&text);
            let diagnostics: Vec<Value> = found
                .iter()
                .map(|d| {
                    json!({
                        "range": lines.token(Pos::new(d.at.line, d.at.column)),
                        "severity": if d.severity == Severity::Error { 1 } else { 2 },
                        "code": d.code,
                        "source": "Dual Input",
                        "message": d.message,
                    })
                })
                .collect();
            if found.is_empty() {
                self.published.remove(&file);
            } else {
                self.published.insert(file.clone());
            }
            self.notify(
                "textDocument/publishDiagnostics",
                json!({ "uri": uri_of(&file), "diagnostics": diagnostics }),
            );
        }
    }

    /// An error at each import of a profile through which a module's errors break it, each
    /// naming the module and its first error.
    fn import_errors(&self, results: &Results, root: &Root) -> Vec<Diagnostic> {
        let mut by_file: BTreeMap<&PathBuf, Vec<&Diagnostic>> = BTreeMap::new();
        for (f, d) in results
            .engine
            .iter()
            .chain(&results.typed)
            .chain(&results.built)
        {
            if *f != root.file && d.severity == Severity::Error {
                by_file.entry(f).or_default().push(d);
            }
        }
        if by_file.is_empty() {
            return Vec::new();
        }
        let Some(text) = self.text_of(&root.file) else {
            return Vec::new();
        };
        let texts = self.texts(&root.profiles, false);
        let ws = Workspace {
            files: texts.iter().map(|(k, v)| (k.as_str(), *v)).collect(),
        };
        let mut out = Vec::new();
        for (rel, range) in imports(&text) {
            let reached = closure(&ws, &rel);
            for (file, errors) in &by_file {
                let Some((_, file_rel)) = locate(file) else {
                    continue;
                };
                if !reached.contains(&file_rel) {
                    continue;
                }
                let first = errors[0];
                let count = match errors.len() {
                    1 => "1 error".to_string(),
                    n => format!("{n} errors"),
                };
                out.push(Diagnostic::error(
                    Place::new(&root.rel, range.start.line, range.start.column),
                    "module-errors",
                    format!(
                        "{file_rel} has {count}, the first at line {}: {}",
                        first.at.line, first.message
                    ),
                ));
            }
        }
        out
    }

    /// The runtime that answers requests inside a script, loaded on its first use where the
    /// server was made without one.
    fn service(&mut self) -> &mut Service {
        self.service.get_or_insert_with(Service::new)
    }
}
