//! `serve`'s side of the features that need the sim: live values on `watch:` lines, Run, and the
//! display picker, through the core's feature `authoring`
//! (record/areas/profiles/04-the-extension-in-the-sim.md).
//!
//! `serve` sends `authoring` the open files' names, the open text's bundle of the session's
//! profile, what the panel shows, and each Run, and turns the slice `authoring` it watches into the
//! editor's: each open file's boxes, the Dual Input panel's view, and the code lenses. The extension
//! only draws them, so another editor would need only a client of its own.

use std::collections::{BTreeMap, BTreeSet};
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use lsp_server::{Request, RequestId};
use lsp_types::{InitializeParams, Position};
use messages::authoring::{
    self as wire, AuthoringSlice, BundleState, Got, Open, OpenBundle, OpenName, Outcome, Panel,
    command,
};
use messages::backend::{Older, older};
use messages::clients::{CORE, CoreSlice, FromClient, Hello, ToClient, component};
use messages::state_sync::{self, SyncLog};
use messages::tape::{self as tape, TapeOff, TapeSlice, TapeState, TapeStopped};
use profile_language::{Pos, Workspace, closure};
use serde::Serialize;
use serde_json::{Value, json};

use super::connection::{Down, Link, Up};
use super::convert::{Lines, path_of, uri_of};
use super::displays;
use super::facts::{self, EntryKind, Facts};
use super::sync_log::SyncLogRows;
use super::view::{
    Body, LineBox, PickerView, Preview, Recorder, RecorderOff, Refusal, Revert, RunView, Seen,
    ServerView, Status, Stopped, StoppedBy, Stopping, Takes, Update, action, box_text, given,
    reading, shown, typed,
};
use super::worker::{Bundle, Failure, Job};
use super::{PAUSE, Server, full, locate};

/// The extension's own commands, which the server's code lenses name, and which the server
/// doesn't list among its own, since the extension registers them. src/apps/profile-extension/
/// src/extension.ts registers both, so change both together.
const RUN: &str = "dualInput.run";
const PICK: &str = "dualInput.pickDisplays";

// The lenses' titles take VS Code's own icons, outlined as the Dual Input panel's lucide icons
// are, since a lens draws no other. A no-break space after each icon keeps a gap that a plain
// space after an icon lost in VS Code 1.147, where "Pick displays" touched its icon.
pub(super) const RUN_TITLE: &str = "$(play)\u{a0}Run";
pub(super) const RUN_PILOT_FLYING_TITLE: &str = "$(play)\u{a0}Run · pilot flying only";
pub(super) const PICK_TITLE: &str = "$(inspect)\u{a0}Pick displays";

/// What `serve` holds of the sim.
pub(crate) struct Sim {
    link: Link,
    /// This process's ID for its VS Code window, which each `authoring.open` names.
    window: String,
    socket: Option<Socket>,
    slice: Option<AuthoringSlice>,
    /// The recorder's slice, which the core's platform unit `tape` keeps.
    tape: Option<TapeSlice>,
    /// Each command sent on this socket and not yet answered, by its ID.
    asked: BTreeMap<u32, &'static str>,
    next: u32,
    /// Each open file's facts, from its text as typing last paused, and the open files edited
    /// since, whose boxes wait for the next pause, since the editor moves the boxes it drew with
    /// the edits.
    facts: BTreeMap<PathBuf, Facts>,
    stale: BTreeSet<PathBuf>,
    /// The names the open files watch, as `authoring.open` last carried them.
    names: Vec<OpenName>,
    names_due: Option<Instant>,
    bundle_due: Option<Instant>,
    building: bool,
    /// The texts of the newest bundle, built or failed, and what came of it.
    built_from: Option<BTreeMap<String, String>>,
    built: Option<Result<Bundle, Failure>>,
    /// What this socket last got of the bundle: its hash, or its error.
    sent: Option<String>,
    /// A count of every edit to the files, which the session's program is held against.
    edits: u64,
    program: Option<(u64, (String, String), Option<Program>)>,
    /// The last program `program()` found, whose files a Sync log link searches once the session
    /// ends, since the log's rows outlast it.
    last_program: Option<Program>,
    panel: PanelState,
    /// The file the author last opened, typed in, or named in a panel's command, which the status
    /// line is about while the panel shows neither Run nor the picker.
    last_file: Option<PathBuf>,
    boxes: BTreeMap<PathBuf, Vec<LineBox>>,
    view: Option<Value>,
    lenses: Lenses,
    /// Whether the editor takes `workspace/codeLens/refresh` and `workspace/applyEdit`.
    refresh: bool,
    apply: bool,
    /// A count of the requests it makes of the editor, which their IDs carry.
    requests: u64,
    /// The Sync log's rows, which outlast the socket, so a core that restarts keeps them.
    log: SyncLogRows,
}

/// A socket to the core, and the core's slice `core` once it comes.
struct Socket {
    core: Option<CoreSlice>,
}

/// What the panel shows, as `serve` holds it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum PanelState {
    Nothing,
    Run {
        file: PathBuf,
        key: String,
        /// The value field's text.
        field: String,
    },
    Picker {
        file: PathBuf,
        active: Option<String>,
        /// The rows the author ticked or unticked, by full key.
        ticks: BTreeMap<String, bool>,
    },
}

/// The session's profile in the workspace, and every file its program holds.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Program {
    pub(crate) root: PathBuf,
    pub(crate) rel: String,
    pub(crate) files: BTreeSet<PathBuf>,
}

/// What the code lenses show, which the editor asks again for when it changes.
#[derive(Clone, Debug, Default, PartialEq)]
struct Lenses {
    /// Whether Run can run: in the session's flight, with the open text's bundle accepted.
    runs: bool,
    /// Whether the picker can open: in the session's flight.
    picks: bool,
    flying: bool,
    program: Option<(PathBuf, String)>,
}

impl Sim {
    pub(crate) fn new(link: Link, params: &InitializeParams) -> Sim {
        let workspace = params.capabilities.workspace.as_ref();
        // A process's own random SipHash keys make its window's ID, with no dependency for it.
        let window = format!(
            "{:016x}",
            std::collections::hash_map::RandomState::new()
                .build_hasher()
                .finish()
        );
        Sim {
            link,
            window,
            socket: None,
            slice: None,
            tape: None,
            asked: BTreeMap::new(),
            next: 0,
            facts: BTreeMap::new(),
            stale: BTreeSet::new(),
            names: Vec::new(),
            names_due: None,
            bundle_due: None,
            building: false,
            built_from: None,
            built: None,
            sent: None,
            edits: 0,
            program: None,
            last_program: None,
            panel: PanelState::Nothing,
            last_file: None,
            boxes: BTreeMap::new(),
            view: None,
            lenses: Lenses::default(),
            refresh: workspace
                .and_then(|w| w.code_lens.as_ref())
                .and_then(|c| c.refresh_support)
                .unwrap_or(false),
            apply: workspace.and_then(|w| w.apply_edit).unwrap_or(false),
            requests: 0,
            log: SyncLogRows::default(),
        }
    }

    /// Whether the socket's core is of this release, without which `serve` sends it nothing more.
    fn ready(&self) -> bool {
        self.socket
            .as_ref()
            .and_then(|s| s.core.as_ref())
            .is_some_and(|c| c.version == messages::VERSION)
    }

    /// The slice, while it's this window's.
    fn ours(&self) -> Option<&AuthoringSlice> {
        self.slice
            .as_ref()
            .filter(|s| self.ready() && s.window.as_deref() == Some(self.window.as_str()))
    }

    pub(crate) fn next_due(&self) -> Option<Instant> {
        let bundle = self.bundle_due.filter(|_| !self.building);
        [self.names_due, bundle].into_iter().flatten().min()
    }
}

impl Server {
    /// Tells the connection the core's data folder, whose `port.json` names the core's port.
    pub(super) fn point_at_core(&self) {
        match self.settings.data() {
            Ok(folder) => {
                let _ = self.sim.link.up.send(Up::Folder(folder));
            }
            Err(e) => eprintln!("{e}, so the sim's features are off"),
        }
    }

    fn up(&self, message: FromClient) {
        // The connection's thread ends only with the server.
        let _ = self.sim.link.up.send(Up::Send(message));
    }

    fn command(&mut self, name: &'static str, args: &impl Serialize) {
        if !self.sim.ready() {
            return;
        }
        self.sim.next += 1;
        let id = self.sim.next;
        self.sim.asked.insert(id, name);
        let args = serde_json::to_value(args).expect("authoring's commands should encode");
        self.up(FromClient::Command {
            id,
            name: name.into(),
            args,
        });
    }

    /// A message from the connection.
    pub(super) fn heard(&mut self, down: Down) {
        match down {
            Down::Opened => {
                self.sim.socket = Some(Socket { core: None });
                self.sim.sent = None;
                self.up(FromClient::Hello(Hello {
                    component: component::PROFILE_EXTENSION.into(),
                    version: messages::VERSION.into(),
                    hash: messages::HASH.into(),
                    panel: None,
                    instruments: Vec::new(),
                }));
                self.up(FromClient::Watch {
                    slices: vec![wire::NAME.into(), CORE.into(), tape::NAME.into()],
                });
            }
            Down::Heard(ToClient::State { slice, value }) if slice == CORE => {
                let core = match serde_json::from_value::<CoreSlice>(value) {
                    Ok(core) => core,
                    Err(e) => return eprintln!("Dual Input's slice `core` didn't read: {e}"),
                };
                if core.version != messages::VERSION {
                    eprintln!(
                        "Dual Input is {} and this extension is {}, so it sends Dual Input nothing until the one that's behind is updated",
                        core.version,
                        messages::VERSION
                    );
                }
                let was = self.sim.ready();
                if let Some(socket) = self.sim.socket.as_mut() {
                    socket.core = Some(core);
                }
                // A session that starts later, and a core that restarted, start from these
                // (record/areas/profiles/04-the-extension-in-the-sim.md, "The connection").
                if !was && self.sim.ready() {
                    self.send_open();
                    self.send_panel();
                }
            }
            Down::Heard(ToClient::State { slice, value }) if slice == wire::NAME => {
                match serde_json::from_value::<AuthoringSlice>(value) {
                    Ok(next) => {
                        let profile = |s: Option<&AuthoringSlice>| {
                            s.and_then(|s| s.status.profile.as_ref())
                                .map(|p| (p.maker.clone(), p.name.clone()))
                        };
                        if profile(Some(&next)) != profile(self.sim.slice.as_ref()) {
                            self.sim.bundle_due = Some(Instant::now());
                        }
                        self.sim.slice = Some(next);
                    }
                    // A core of another release may shape its slice otherwise, and comes up to 20
                    // times a second, so only this release's failing to read is a fault worth a line.
                    Err(e) if self.sim.ready() => {
                        eprintln!("Dual Input's slice `authoring` didn't read: {e}");
                    }
                    Err(_) => {}
                }
            }
            Down::Heard(ToClient::State { slice, value }) if slice == tape::NAME => {
                match serde_json::from_value::<TapeSlice>(value) {
                    Ok(next) => self.sim.tape = Some(next),
                    Err(e) if self.sim.ready() => {
                        eprintln!("Dual Input's slice `tape` didn't read: {e}");
                    }
                    Err(_) => {}
                }
            }
            Down::Heard(ToClient::Unit { unit, body }) if unit == state_sync::NAME => {
                match serde_json::from_value::<SyncLog>(body) {
                    Ok(log) if self.sim.ready() => {
                        let wall = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
                        self.sim.log.heard(log, Instant::now(), wall);
                    }
                    Ok(_) => {}
                    Err(e) if self.sim.ready() => {
                        eprintln!("state sync's Sync log message didn't read: {e}");
                    }
                    Err(_) => {}
                }
            }
            Down::Heard(ToClient::Answer { id, error }) => {
                let name = self.sim.asked.remove(&id).unwrap_or("a command");
                if let Some(error) = error {
                    eprintln!("Dual Input didn't take {name}: {error}");
                }
            }
            Down::Heard(_) => {}
            Down::Closed => {
                self.sim.socket = None;
                self.sim.slice = None;
                self.sim.tape = None;
                self.sim.asked.clear();
            }
        }
        self.show_sim();
    }

    /// The newest bundle's hash, or its build's error, which tells a bundle this socket had from
    /// one it hasn't.
    fn bundle_key(&self) -> Option<String> {
        self.sim.built.as_ref().map(|built| match built {
            Ok(b) => b.hash.clone(),
            Err(f) => format!("{}: {}", f.place, f.message),
        })
    }

    /// `authoring.open`: the open files' names, and the open text's bundle when this socket
    /// hasn't had it.
    fn send_open(&mut self) {
        if !self.sim.ready() {
            return;
        }
        let key = self.bundle_key();
        let bundle = match (&self.sim.built, &key) {
            (Some(built), Some(_)) if self.sim.sent != key => Some(match built {
                Ok(b) => OpenBundle::Built {
                    text: b.text.clone(),
                },
                Err(f) => OpenBundle::Failed {
                    error: format!("{}: {}", f.place, f.message),
                },
            }),
            _ => None,
        };
        if bundle.is_some() {
            self.sim.sent = key;
        }
        let open = Open {
            window: self.sim.window.clone(),
            names: self.sim.names.clone(),
            bundle,
        };
        self.command(command::OPEN, &open);
    }

    /// `authoring.panel`: Run's entry with the value field's text, or the picker's row.
    fn send_panel(&mut self) {
        let panel = match &self.sim.panel {
            PanelState::Nothing => Panel::Nothing,
            PanelState::Run { file, key, field } => Panel::Run {
                entry: key.clone(),
                typed: self
                    .sim
                    .facts
                    .get(file)
                    .and_then(|f| f.entry(key))
                    .and_then(|e| given(field, takes(e.kind))),
            },
            PanelState::Picker { active, .. } => Panel::Picker {
                active: active.clone(),
            },
        };
        self.command(command::PANEL, &panel);
    }

    /// A file opened, closed, or changed, on disk or in its editor. Its names and the open
    /// text's bundle are due as typing pauses, or at once as a file opens or closes.
    pub(super) fn sim_edited(&mut self, file: &Path, edited: bool, now: bool) {
        self.sim.edits += 1;
        if self.open.contains_key(file) {
            self.sim.stale.insert(file.to_path_buf());
            if edited {
                self.sim.last_file = Some(file.to_path_buf());
            }
        } else {
            self.sim.facts.remove(file);
            self.sim.stale.remove(file);
            self.sim.boxes.remove(file);
        }
        let at = if now {
            Instant::now()
        } else {
            Instant::now() + PAUSE
        };
        self.sim.names_due = Some(at);
        self.sim.bundle_due = Some(at);
    }

    pub(super) fn fire_sim(&mut self) {
        let now = Instant::now();
        if self.sim.names_due.is_some_and(|t| t <= now) {
            self.sim.names_due = None;
            self.names_paused();
        }
        if !self.sim.building && self.sim.bundle_due.is_some_and(|t| t <= now) {
            self.sim.bundle_due = None;
            self.build_bundle();
        }
    }

    /// Reads a file's facts from its open text now, if it's open and its YAML parses.
    fn fresh(&mut self, file: &Path) {
        if self.sim.facts.contains_key(file) && !self.sim.stale.contains(file) {
            return;
        }
        if let Some(found) = self.open.get(file).and_then(|t| facts::read(t)) {
            self.sim.facts.insert(file.to_path_buf(), found);
            self.sim.stale.remove(file);
        }
    }

    /// Typing paused: each open file's facts again, and `authoring.open` when their names changed.
    fn names_paused(&mut self) {
        let stale: Vec<PathBuf> = self.sim.stale.iter().cloned().collect();
        for file in stale {
            // A file whose YAML doesn't parse keeps the names and boxes its last text gave.
            self.fresh(&file);
        }
        let mut names: Vec<OpenName> = Vec::new();
        for facts in self.sim.facts.values() {
            for w in &facts.watches {
                let name = OpenName {
                    name: w.text.clone(),
                    reads: w.reads,
                };
                if !names.contains(&name) {
                    names.push(name);
                }
            }
        }
        if names != self.sim.names {
            self.sim.names = names;
            self.send_open();
        }
        self.show_sim();
    }

    /// Builds the open text's bundle of the session's profile on the second thread, unless its
    /// program's texts are those the last build had.
    fn build_bundle(&mut self) {
        let Some(program) = self.program() else {
            return;
        };
        let all = self.texts(&program.root, false);
        let ws = Workspace {
            files: all.iter().map(|(k, v)| (k.as_str(), *v)).collect(),
        };
        let texts: BTreeMap<String, String> = closure(&ws, &program.rel)
            .into_iter()
            .filter_map(|rel| all.get(&rel).map(|t| (rel, t.to_string())))
            .collect();
        if self.sim.built_from.as_ref() == Some(&texts) {
            return;
        }
        self.sim.building = true;
        let job = Job::Bundle {
            root: program.root,
            rel: program.rel,
            texts,
        };
        if self.worker.send(job).is_err() {
            eprintln!("The server's second thread stopped, so Run has no bundle");
        }
    }

    /// The open text's bundle came back from the second thread.
    pub(super) fn bundled(
        &mut self,
        texts: BTreeMap<String, String>,
        bundle: Result<Bundle, Failure>,
    ) {
        self.sim.building = false;
        match &bundle {
            Ok(b) => eprintln!("The open text built for Run: {}", b.hash),
            Err(f) => eprintln!(
                "The open text doesn't build, so Run is off: {}: {}",
                f.place, f.message
            ),
        }
        self.sim.built_from = Some(texts);
        self.sim.built = Some(bundle);
        // An edit that leaves the bundle as it was, such as a comment's, sends nothing.
        if self.bundle_key() != self.sim.sent {
            self.send_open();
        }
        // The texts may have changed while it built, which the next build's check tells.
        self.sim.bundle_due.get_or_insert_with(Instant::now);
        self.show_sim();
    }

    /// The session's profile in the workspace, found by the maker and model the slice names it
    /// by, with every file of its program, as of the last edit.
    fn program(&mut self) -> Option<Program> {
        let profile = self.sim.slice.as_ref()?.status.profile.as_ref()?;
        let wanted = (profile.maker.clone(), profile.name.clone());
        if let Some((edits, key, found)) = &self.sim.program
            && *edits == self.sim.edits
            && *key == wanted
        {
            return found.clone();
        }
        let found = self.find_program(&wanted.0, &wanted.1);
        if found.is_some() {
            self.sim.last_program.clone_from(&found);
        }
        self.sim.program = Some((self.sim.edits, wanted, found.clone()));
        found
    }

    fn find_program(&self, maker: &str, model: &str) -> Option<Program> {
        let mut roots: BTreeSet<PathBuf> = self.roots.iter().cloned().collect();
        roots.extend(self.open.keys().filter_map(|p| locate(p).map(|(r, _)| r)));
        for root in roots {
            let texts = self.texts(&root, false);
            for (rel, text) in &texts {
                if !rel.starts_with("aircraft/") {
                    continue;
                }
                // A profile whose open text doesn't parse is found by its text on disk.
                let disk = self.disk.get(&full(&root, rel)).map(String::as_str);
                let named = [Some(*text), disk].into_iter().flatten().any(|t| {
                    facts::read(t).is_some_and(|f| {
                        f.maker.as_deref() == Some(maker) && f.model.as_deref() == Some(model)
                    })
                });
                if !named {
                    continue;
                }
                let ws = Workspace {
                    files: texts.iter().map(|(k, v)| (k.as_str(), *v)).collect(),
                };
                let files = closure(&ws, rel).iter().map(|r| full(&root, r)).collect();
                return Some(Program {
                    root: root.clone(),
                    rel: rel.clone(),
                    files,
                });
            }
        }
        None
    }

    /// The file the panel is about: Run's entry's or the picker's, or else the one the author
    /// last worked in.
    fn panel_file(&self) -> Option<&Path> {
        match &self.sim.panel {
            PanelState::Run { file, .. } | PanelState::Picker { file, .. } => Some(file),
            PanelState::Nothing => self.sim.last_file.as_deref(),
        }
    }

    /// Whether the panel's file is the session's profile or a module it imports.
    fn runs(&mut self) -> bool {
        let file = self.panel_file().map(Path::to_path_buf);
        self.program()
            .is_some_and(|p| file.is_none_or(|f| p.files.contains(&f)))
    }

    pub(super) fn show_sim(&mut self) {
        self.show_boxes();
        self.show_view();
        self.show_lenses();
        self.show_log();
    }

    /// The Sync log's rows that changed, sent to the extension, which keeps its own copy for the
    /// view (record/areas/profiles/06-the-sync-log.md, "What `serve` keeps").
    fn show_log(&mut self) {
        if let Some(update) = self.sim.log.update() {
            let value = serde_json::to_value(&update).expect("the Sync log's rows should encode");
            self.notify("dualInput/syncLog", value);
        }
    }

    /// One of the Sync log's commands: Clear, and opening an entry's line from a link.
    pub(super) fn sync_log_command(&mut self, command: &str, args: &[Value]) -> Result<(), String> {
        match command {
            "dualInput.syncLog.clear" => {
                self.sim.log.clear();
                self.show_log();
                Ok(())
            }
            "dualInput.syncLog.reveal" => {
                let key = args
                    .first()
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("{command} takes an entry's key"))?;
                self.reveal(key)
            }
            other => Err(format!("{other} isn't a command this server runs")),
        }
    }

    /// Opens the line of the entry `key` in the editor, from the open files first, then from the
    /// files of the session's profile, as Go to Definition finds an entry, or once the session
    /// ends, from the files of the last profile a session had.
    fn reveal(&mut self, key: &str) -> Result<(), String> {
        let mut files: Vec<PathBuf> = self.sim.facts.keys().cloned().collect();
        if let Some(program) = self.program().or_else(|| self.sim.last_program.clone()) {
            files.extend(program.files);
        }
        for file in files {
            let Some(text) = self.text_of(&file) else {
                continue;
            };
            let Some(entry) = facts::read(&text).and_then(|f| f.entry(key).cloned()) else {
                continue;
            };
            let at = Position::new(entry.line as u32, entry.column as u32);
            self.sim.requests += 1;
            let id = RequestId::from(format!("showDocument-{}", self.sim.requests));
            let params = json!({
                "uri": uri_of(&file),
                "takeFocus": true,
                "selection": { "start": at, "end": at },
            });
            self.send(Request::new(id, "window/showDocument".into(), params).into());
            return Ok(());
        }
        Err(format!(
            "no open file or file of the session's profile holds `{key}`"
        ))
    }

    /// Each open file's boxes, sent when they changed.
    fn show_boxes(&mut self) {
        let mut changed: Vec<(PathBuf, Vec<LineBox>)> = Vec::new();
        let files: BTreeSet<PathBuf> = self
            .sim
            .facts
            .keys()
            .chain(self.sim.boxes.keys())
            .cloned()
            .collect();
        for file in files {
            if self.sim.stale.contains(&file) {
                continue;
            }
            let boxes = match (self.sim.ours(), self.sim.facts.get(&file)) {
                (Some(slice), Some(facts)) => boxes(slice, facts, &self.sim.log),
                _ => Vec::new(),
            };
            if self
                .sim
                .boxes
                .get(&file)
                .map_or(boxes.is_empty(), |b| *b == boxes)
            {
                continue;
            }
            changed.push((file, boxes));
        }
        for (file, boxes) in changed {
            self.notify(
                "dualInput/values",
                json!({ "uri": uri_of(&file), "boxes": boxes }),
            );
            if self.open.contains_key(&file) {
                self.sim.boxes.insert(file, boxes);
            } else {
                self.sim.boxes.remove(&file);
            }
        }
    }

    /// The Dual Input panel's view, sent when it changed.
    fn show_view(&mut self) {
        let runs = self.runs();
        let file = self.panel_file().map(Path::to_path_buf);
        let written = self
            .program()
            .and_then(|p| self.written.get(&full(&p.root, &p.rel)));
        let view = panel_view(&Inputs {
            socket: self.sim.socket.as_ref().map(|s| s.core.as_ref()),
            slice: self.sim.slice.as_ref(),
            tape: self.sim.tape.as_ref(),
            window: &self.sim.window,
            runs,
            built: self.sim.built.as_ref(),
            written: written.map(String::as_str),
            panel: &self.sim.panel,
            facts: file.as_ref().and_then(|f| self.sim.facts.get(f)),
            rel: file.as_ref().and_then(|f| locate(f)).map(|(_, rel)| rel),
        });
        let value = serde_json::to_value(&view).expect("the panel's view should encode");
        if self.sim.view.as_ref() != Some(&value) {
            self.notify("dualInput/panel", value.clone());
            self.sim.view = Some(value);
        }
    }

    fn lenses(&mut self) -> Lenses {
        let (in_flight, loaded, flying) = match self.sim.ours() {
            Some(s) => (
                s.status.in_flight,
                matches!(s.status.bundle, BundleState::Loaded { .. }),
                s.status.flying,
            ),
            None => (false, false, false),
        };
        Lenses {
            runs: in_flight && loaded,
            picks: in_flight,
            flying,
            program: self.program().map(|p| (p.root, p.rel)),
        }
    }

    /// Asks the editor for the code lenses again when what they show changed, control passing
    /// included.
    fn show_lenses(&mut self) {
        let now = self.lenses();
        if now == self.sim.lenses {
            return;
        }
        self.sim.lenses = now;
        if self.sim.refresh {
            self.sim.requests += 1;
            let id = RequestId::from(format!("codeLens-{}", self.sim.requests));
            self.send(Request::new(id, "workspace/codeLens/refresh".into(), Value::Null).into());
        }
    }

    /// The code lenses of a file: Run above each entry that writes, while Run can run, and
    /// Pick displays above `displays:`, each only in the session's profile and the modules it
    /// imports.
    pub(super) fn code_lenses(&mut self, uri: &str) -> Value {
        let lenses = self.lenses();
        let Some(file) = path_of(uri) else {
            return json!([]);
        };
        let in_program = self.program().is_some_and(|p| p.files.contains(&file));
        let Some(text) = self.text_of(&file).filter(|_| lenses.picks && in_program) else {
            return json!([]);
        };
        let Some(facts) = facts::read(&text) else {
            return json!([]);
        };
        let lines = Lines::new(&text);
        let uri = uri_of(&file);
        let at = |line: usize, column: usize, length: usize| {
            json!({
                "start": lines.lsp(Pos::new(line + 1, column + 1)),
                "end": lines.lsp(Pos::new(line + 1, column + 1 + length)),
            })
        };
        let mut out = Vec::new();
        for e in facts.entries.iter().filter(|e| e.writes && lenses.runs) {
            // A pilot monitoring's change to an entry the pilot flying owns, state sync puts back
            // (record/areas/sync/05-units.md, "Who sends, and putting back").
            let title = if e.pilot_flying && !lenses.flying {
                RUN_PILOT_FLYING_TITLE
            } else {
                RUN_TITLE
            };
            out.push(json!({
                "range": at(e.line, e.column, e.key.chars().count()),
                "command": { "title": title, "command": RUN, "arguments": [uri, e.key] },
            }));
        }
        if let Some((line, _)) = &facts.displays {
            out.push(json!({
                "range": at(*line, 0, "displays".len()),
                "command": { "title": PICK_TITLE, "command": PICK, "arguments": [uri] },
            }));
        }
        Value::Array(out)
    }

    /// One of the panel's commands, which the extension sends for the panel's calls and for the
    /// lenses' clicks.
    pub(super) fn panel_command(&mut self, command: &str, args: &[Value]) -> Result<(), String> {
        let text = |n: usize| args.get(n).and_then(Value::as_str).map(str::to_string);
        let file = || {
            text(0)
                .as_deref()
                .and_then(path_of)
                .ok_or_else(|| format!("{command} takes a file's URI"))
        };
        match command {
            "dualInput.panel.open" => {
                let file = file()?;
                self.fresh(&file);
                let facts = self.sim.facts.get(&file).ok_or_else(|| {
                    format!("{} isn't open, or its YAML doesn't parse", file.display())
                })?;
                let key = match args.get(1) {
                    Some(Value::String(key)) => key.clone(),
                    Some(at) => {
                        let at: Position = serde_json::from_value(at.clone())
                            .map_err(|_| format!("{command} takes an entry's key or a position"))?;
                        facts
                            .entry_at(at.line as usize)
                            .map(|e| e.key.clone())
                            .ok_or("There's no entry at the cursor")?
                    }
                    None => return Err(format!("{command} takes an entry's key or a position")),
                };
                if facts.entry(&key).is_none() {
                    return Err(format!("{} has no entry `{key}`", file.display()));
                }
                let field = match &self.sim.panel {
                    PanelState::Run {
                        file: f,
                        key: k,
                        field,
                    } if *f == file && *k == key => field.clone(),
                    _ => String::new(),
                };
                self.sim.last_file = Some(file.clone());
                self.sim.panel = PanelState::Run { file, key, field };
                self.send_panel();
            }
            "dualInput.panel.pick" => {
                let file = file()?;
                self.fresh(&file);
                self.sim.last_file = Some(file.clone());
                self.sim.panel = PanelState::Picker {
                    file,
                    active: None,
                    ticks: BTreeMap::new(),
                };
                self.send_panel();
            }
            "dualInput.panel.typed" => {
                if let PanelState::Run { field, .. } = &mut self.sim.panel {
                    *field = text(0).unwrap_or_default();
                    self.send_panel();
                }
            }
            "dualInput.panel.run" => self.run(text(0).unwrap_or_default()),
            "dualInput.panel.move" => {
                if let PanelState::Picker { active, .. } = &mut self.sim.panel {
                    *active = text(0);
                    self.send_panel();
                }
            }
            "dualInput.panel.tick" => {
                let groups = self.picker_groups();
                if let (PanelState::Picker { ticks, .. }, Some(row)) =
                    (&mut self.sim.panel, text(0))
                {
                    displays::tick(&groups, &row, ticks);
                }
            }
            "dualInput.panel.write" => self.sync()?,
            "dualInput.panel.leave" => {
                self.sim.panel = PanelState::Nothing;
                self.send_panel();
            }
            "dualInput.panel.record" => self.command(tape::command::RECORD, &Value::Null),
            "dualInput.panel.stop" => self.command(tape::command::STOP, &Value::Null),
            "dualInput.panel.play" => self.command(tape::command::PLAY, &Value::Null),
            other => return Err(format!("{other} isn't a command this server runs")),
        }
        self.show_sim();
        Ok(())
    }

    /// Runs the panel's entry with the value field's text, while Run can run in its file.
    fn run(&mut self, text: String) {
        let PanelState::Run { file, key, field } = &mut self.sim.panel else {
            return;
        };
        *field = text.clone();
        let (file, key) = (file.clone(), key.clone());
        self.send_panel();
        let Some(entry) = self.sim.facts.get(&file).and_then(|f| f.entry(&key)) else {
            return;
        };
        let Some(given) = given(&text, takes(entry.kind)) else {
            return;
        };
        let in_flight = self.sim.ours().is_some_and(|s| s.status.in_flight);
        if in_flight && self.runs() {
            // The Sync log notes the local change state sync reads after it.
            let preview = self
                .sim
                .ours()
                .and_then(|s| s.run.as_ref())
                .filter(|r| r.entry == key)
                .map(|r| r.preview.clone());
            self.sim.log.ran(&key, Instant::now(), preview.as_ref());
            self.command(command::RUN, &wire::Run { entry: key, given });
        }
    }

    /// The picker's groups, from the panels the slice lists and the picker's file's `displays`.
    fn picker_groups(&self) -> Vec<super::view::PickerGroup> {
        let PanelState::Picker { file, ticks, .. } = &self.sim.panel else {
            return Vec::new();
        };
        let panels = self.sim.ours().map_or(&[][..], |s| &s.panels[..]);
        let named = self
            .sim
            .facts
            .get(file)
            .and_then(|f| f.displays.as_ref())
            .map_or(&[][..], |(_, d)| &d[..]);
        displays::groups(panels, named, ticks)
    }

    /// The picker's Sync: the ticked rows written into the file's `displays`, through the editor,
    /// and the picker left.
    fn sync(&mut self) -> Result<(), String> {
        let PanelState::Picker { file, .. } = &self.sim.panel else {
            return Ok(());
        };
        let file = file.clone();
        self.fresh(&file);
        let text = self
            .text_of(&file)
            .ok_or_else(|| format!("couldn't read {}", file.display()))?;
        let named: Vec<String> = self
            .sim
            .facts
            .get(&file)
            .and_then(|f| f.displays.as_ref())
            .map(|(_, d)| d.clone())
            .unwrap_or_default();
        let written = displays::written(&self.picker_groups(), &named);
        if let Some(edit) = displays::edit(&text, &written)? {
            if !self.sim.apply {
                return Err("this editor takes no edit from its language server, so Sync can't write displays".into());
            }
            let lines = Lines::new(&text);
            let edit = json!({ "range": lines.range(edit.range), "newText": edit.text });
            self.sim.requests += 1;
            let id = RequestId::from(format!("applyEdit-{}", self.sim.requests));
            let params = json!({
                "label": "Sync displays",
                "edit": { "changes": { uri_of(&file): [edit] } },
            });
            self.send(Request::new(id, "workspace/applyEdit".into(), params).into());
        }
        self.sim.panel = PanelState::Nothing;
        self.send_panel();
        Ok(())
    }
}

/// The boxes of one file's watch lines, from the slice, the first of each entry's with its hint,
/// the entry's latest step in the Sync log (record/areas/profiles/06-the-sync-log.md, "The hint
/// at the end of a line").
fn boxes(slice: &AuthoringSlice, facts: &Facts, log: &SyncLogRows) -> Vec<LineBox> {
    // The slice comes up to 20 times a second, each time with every name the open files watch.
    let got: BTreeMap<&str, &Got> = slice
        .names
        .iter()
        .map(|n| (n.name.as_str(), &n.got))
        .collect();
    let mut hinted = BTreeSet::new();
    facts
        .watches
        .iter()
        .filter_map(|w| {
            let (text, kind) = box_text(got.get(w.text.as_str())?, &w.name)?;
            let hint = match hinted.insert(w.entry.as_str()) {
                true => log.hint(&w.entry),
                false => None,
            };
            Some(LineBox {
                line: w.line,
                text,
                kind,
                hint,
            })
        })
        .collect()
}

fn got<'s>(slice: &'s AuthoringSlice, name: &str) -> Option<&'s Got> {
    slice.names.iter().find(|n| n.name == name).map(|n| &n.got)
}

fn takes(kind: EntryKind) -> Takes {
    match kind {
        EntryKind::State => Takes::Value,
        EntryKind::Counting => Takes::Steps,
        EntryKind::Event => Takes::Event,
    }
}

/// What the panel's view is made from.
pub(crate) struct Inputs<'a> {
    /// The socket, if there is one, with the core's slice `core` once it came.
    pub(crate) socket: Option<Option<&'a CoreSlice>>,
    pub(crate) slice: Option<&'a AuthoringSlice>,
    pub(crate) window: &'a str,
    /// Whether the panel's file is the session's profile or a module it imports.
    pub(crate) runs: bool,
    pub(crate) built: Option<&'a Result<Bundle, Failure>>,
    /// The recorder's slice.
    pub(crate) tape: Option<&'a TapeSlice>,
    /// The hash of the session's profile's bundle in the local folder, as last read.
    pub(crate) written: Option<&'a str>,
    pub(crate) panel: &'a PanelState,
    /// The panel's file's facts and its path from `profiles/`.
    pub(crate) facts: Option<&'a Facts>,
    pub(crate) rel: Option<String>,
}

/// The panel's view. Run and the picker show only in the session's flight, in a file of its
/// profile, and otherwise the status line says why nothing does.
pub(crate) fn panel_view(i: &Inputs) -> ServerView {
    let none = AuthoringSlice::default();
    let slice = i.slice.unwrap_or(&none);
    let s = &slice.status;
    let status = match i.socket {
        None => Status::NotRunning,
        Some(Some(core)) if core.version != messages::VERSION => Status::OtherRelease {
            extension: messages::VERSION.into(),
            dual_input: core.version.clone(),
            update: behind(messages::VERSION, &core.version),
        },
        Some(_) if slice.window.as_deref().is_some_and(|w| w != i.window) => Status::OtherWindow,
        Some(_) if !s.session => Status::NoSession,
        Some(_) if !s.in_flight => Status::NotInFlight,
        Some(_) => Status::InFlight {
            aircraft: s
                .profile
                .as_ref()
                .map(|p| format!("{} {}", p.maker, p.name))
                .or_else(|| s.aircraft.clone())
                .unwrap_or_default(),
            runs: i.runs,
            crew: s.crew,
        },
    };
    let shows = matches!(status, Status::InFlight { runs: true, .. });
    let differs = matches!((i.built, &s.profile), (Some(Ok(b)), Some(p)) if b.hash != p.hash);
    // A Run of unsaved edits runs on this PC alone, since each crewmate's state sync writes with
    // the bundle the session pinned.
    let unpinned = s.crew && differs;
    // A bundle the local folder holds that the session hasn't loaded yet is a save on its way,
    // which the recorder waits for in silence, rather than asking for a save just made. Text that
    // doesn't build isn't the pinned bundle either, and counting it as unsaved keeps the
    // recorder's line from coming and going as the text breaks and mends while you type.
    let saving = matches!((i.built, i.written), (Some(Ok(b)), Some(w)) if b.hash == w);
    let unsaved = (differs && !saving) || matches!(i.built, Some(Err(_)));
    let recorder = recorder(&status, i.tape, unsaved, differs && saving);
    let body = match (shows, i.panel, i.facts) {
        (true, PanelState::Run { key, field, .. }, Some(facts)) => {
            run_view(i, slice, facts, key, field).map_or(Body::Nothing, |run| Body::Run { run })
        }
        (true, PanelState::Picker { active, ticks, .. }, facts) => {
            let named = facts
                .and_then(|f| f.displays.as_ref())
                .map_or(&[][..], |(_, d)| &d[..]);
            Body::Picker {
                picker: PickerView {
                    groups: displays::groups(&slice.panels, named, ticks),
                    active: active.clone().unwrap_or_default(),
                },
            }
        }
        _ => Body::Nothing,
    };
    ServerView {
        status,
        unpinned,
        body,
        recorder,
    }
}

/// The recorder's island: what `tape` runs, or else why it can't act, which is the core's to say
/// but for the open text being unsaved, which only `serve` can tell, or loading, as `saving` says
/// of a save the session hasn't loaded yet (record/areas/profiles/05-the-recorder.md, "When the
/// recorder works").
fn recorder(status: &Status, tape: Option<&TapeSlice>, unsaved: bool, saving: bool) -> Recorder {
    let length = tape.and_then(|t| match t.state {
        TapeState::Recorded { length_ms } => Some(length_ms),
        _ => None,
    });
    let off = |why| Recorder::Off {
        why,
        length_ms: length,
    };
    let Status::InFlight { crew, .. } = status else {
        return off(RecorderOff::NoFlight);
    };
    if let Some(t) = tape {
        match t.state {
            TapeState::Recording { elapsed_ms } => return Recorder::Recording { elapsed_ms },
            TapeState::Restoring { length_ms } => return Recorder::PuttingBack { length_ms },
            TapeState::Playing { at_ms, length_ms } => {
                return Recorder::Playing { at_ms, length_ms };
            }
            TapeState::Empty | TapeState::Recorded { .. } => {}
        }
    }
    let why = match tape.and_then(|t| t.off) {
        _ if *crew => Some(RecorderOff::Crew),
        // The status line says "In a flight" from the flight's start, so under it the core's "no
        // flight" can only be preflight, which the island says itself.
        Some(TapeOff::NoFlight) => Some(RecorderOff::Preflight),
        Some(TapeOff::Crew) => Some(RecorderOff::Crew),
        Some(TapeOff::Loading) => Some(RecorderOff::Loading),
        None if unsaved => Some(RecorderOff::Unsaved),
        None if saving => Some(RecorderOff::Loading),
        None => None,
    };
    match (why, length, tape) {
        (Some(why), ..) => off(why),
        (None, Some(length_ms), Some(t)) => Recorder::Recorded {
            length_ms,
            stopped: t.stopped.as_ref().map(stopped),
        },
        _ => Recorder::Empty,
    }
}

fn stopped(s: &TapeStopped) -> Stopped {
    Stopped {
        what: match s.what {
            tape::Stopping::Recording => Stopping::Recording,
            tape::Stopping::Playback => Stopping::Playback,
        },
        by: match &s.by {
            tape::StoppedBy::Reload => StoppedBy::Reload,
            tape::StoppedBy::Joined { name } => StoppedBy::Joined { who: name.clone() },
        },
    }
}

fn run_view(
    i: &Inputs,
    slice: &AuthoringSlice,
    facts: &Facts,
    key: &str,
    field: &str,
) -> Option<RunView> {
    let entry = facts.entry(key)?;
    let watches: Vec<_> = facts.watches.iter().filter(|w| w.entry == key).collect();
    let live = watches
        .iter()
        .filter_map(|w| reading(got(slice, &w.text)?, &w.name, w.of.as_deref()))
        .collect();
    let state = slice.run.as_ref().filter(|r| r.entry == key);
    let seen = match state.map(|r| &r.seen) {
        Some(wire::Seen::Many) => Seen::Many,
        Some(wire::Seen::Values { values }) => Seen::Values(values.iter().map(typed).collect()),
        None => Seen::Values(Vec::new()),
    };
    let place = i
        .rel
        .as_ref()
        .map(|rel| format!("{rel}:{}:{}", entry.line + 1, entry.column + 1))
        .unwrap_or_default();
    let preview = match (i.built, state.map(|r| &r.preview)) {
        // A file that doesn't build has no Run, and the panel shows the build's first error.
        (Some(Err(f)), _) => Preview::Error {
            message: f.message.clone(),
            place: f.place.clone(),
        },
        (_, Some(wire::Preview::Sends { actions })) => Preview::Sends {
            actions: actions.iter().map(action).collect(),
        },
        (_, Some(wire::Preview::Refused { why })) => Preview::Error {
            message: sentence(why),
            place,
        },
        _ => Preview::Waiting,
    };
    let refused = (entry.pilot_flying && !slice.status.flying).then(|| Refusal::PilotFlyingOnly {
        pilot_flying: slice
            .status
            .pilot_flying
            .clone()
            .unwrap_or_else(|| "The pilot flying".into()),
    });
    let name = watches.first().map(|w| &w.name);
    let revert = slice
        .last
        .as_ref()
        .filter(|l| l.entry == key)
        .and_then(|l| match (&l.outcome, name) {
            (Outcome::Reverted { to, after_ms }, Some(name)) => Some(Revert {
                to: shown(to, name),
                after_ms: *after_ms,
            }),
            _ => None,
        });
    Some(RunView {
        name: entry.name.clone(),
        key: key.to_string(),
        takes: takes(entry.kind),
        live,
        field: field.to_string(),
        seen,
        preview,
        refused,
        revert,
    })
}

/// `authoring`'s words, which run on after a colon, as a sentence of their own.
fn sentence(words: &str) -> String {
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// The side whose release is older, which updates.
fn behind(extension: &str, dual_input: &str) -> Update {
    match older(extension, dual_input) {
        Older::Mine => Update::Extension,
        Older::Theirs => Update::DualInput,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_older_release_updates() {
        assert_eq!(behind("0.3.2", "0.4.0"), Update::Extension);
        assert_eq!(behind("0.4.0", "0.3.2"), Update::DualInput);
    }
}
