//! The language server's own cases (record/areas/profiles/03-the-extension.md, "Cases"), each
//! through lsp-server's connection in memory, with a workspace, a local folder, and a data folder
//! of its own in the system's temporary folder, never `%APPDATA%`, and the author's core faked
//! behind the channels the connection's thread would talk over, so no case reaches a core running
//! on the PC.

mod sim;

use std::collections::VecDeque;
use std::path::PathBuf;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crossbeam_channel::Sender;
use lsp_server::{Connection, Message, Notification, Request, RequestId, Response};
use profile_build::STACK;
use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedReceiver;

use super::connection::{Down, Link, Up};
use super::convert::uri_of;
use super::{full, run};
use crate::format::tests::Scratch;

/// How long a case waits for a message before it fails, generous for a debug build's TypeScript.
const PATIENCE: Duration = Duration::from_secs(60);

/// A profile whose one script reads `state.battery_1`.
const PROFILE: &str = "maker: M
name: Test
status: experimental

aircraft:
  variants:
    a: test-aircraft

state:
  battery_1:
    name: Battery 1
    watch: L('BATTERY_1')
    write: L('BATTERY_1')
  fuel_pump:
    name: Fuel pump
    watch: L('FUEL_PUMP')
    write: |
      (value) => {
        write(L('FUEL_PUMP'), state.battery_1 ? value : 0)
      }
";

/// A profile like `PROFILE` that imports `modules/radio`.
fn importing(name: &str) -> String {
    PROFILE
        .replace("name: Test", &format!("name: {name}"))
        .replace("\nstate:", "\nimport: modules/radio\n\nstate:")
}

const MODULE: &str = "state:
  com_power:
    name: COM power
    watch: L('COM_POWER')
    write: L('COM_POWER')
";

/// A client of a server of its own, which answers the server's `workspace/configuration`, and
/// the core behind the server's connection.
struct Session {
    connection: Connection,
    next: i32,
    inbox: VecDeque<Notification>,
    /// The server's requests of the client other than `workspace/configuration`, unanswered.
    asked: VecDeque<Request>,
    settings: Value,
    scratch: Scratch,
    server: Option<JoinHandle<Result<(), String>>>,
    core: FakeCore,
}

/// The core's end of the server's connection: what the server sends it, and what it tells the
/// server, as the connection's thread hands both on.
struct FakeCore {
    heard: UnboundedReceiver<Up>,
    /// What it heard that no case has taken yet.
    held: VecDeque<Up>,
    tell: Sender<Down>,
}

impl Session {
    /// A server on a workspace holding `files`, by their paths from `profiles/`, with `settings`
    /// and its own local and data folders.
    fn start(name: &str, files: &[(&str, &str)], settings: Value) -> Session {
        let scratch = Scratch::new(&format!("serve-{name}"));
        let workspace = scratch.0.join("workspace");
        for (rel, text) in files {
            let path = full(&workspace.join("profiles"), rel);
            std::fs::create_dir_all(path.parent().expect("a folder")).expect("makes folders");
            std::fs::write(&path, text).expect("writes a file");
        }
        let mut settings = settings;
        let folder = |name: &str| Value::from(scratch.0.join(name).to_string_lossy().into_owned());
        settings["localFolder"] = folder("local");
        settings["dataFolder"] = folder("data");
        let (client, server) = Connection::memory();
        let (up, heard) = tokio::sync::mpsc::unbounded_channel();
        let (tell, down) = crossbeam_channel::unbounded();
        let thread = std::thread::Builder::new()
            .stack_size(STACK)
            .spawn(move || run(server, Link { up, down }))
            .expect("the server's thread should start");
        let mut session = Session {
            connection: client,
            next: 0,
            inbox: VecDeque::new(),
            asked: VecDeque::new(),
            settings,
            scratch,
            server: Some(thread),
            core: FakeCore {
                heard,
                held: VecDeque::new(),
                tell,
            },
        };
        let params = json!({
            "capabilities": { "workspace": {
                "configuration": true,
                "applyEdit": true,
                "codeLens": { "refreshSupport": true },
            } },
            "workspaceFolders": [{ "uri": uri_of(&workspace), "name": "workspace" }],
        });
        session.request("initialize", params).expect("initializes");
        session.notify("initialized", json!({}));
        // Until the server has the settings, its local folder is `%APPDATA%`'s, so nothing goes
        // to it before they're answered.
        let until = Instant::now() + PATIENCE;
        loop {
            let left = until.saturating_duration_since(Instant::now());
            match session.connection.receiver.recv_timeout(left) {
                Ok(Message::Request(r)) if r.method == "workspace/configuration" => {
                    let answer = Response::new_ok(r.id, json!([session.settings.clone()]));
                    session
                        .connection
                        .sender
                        .send(answer.into())
                        .expect("answers");
                    break;
                }
                Ok(Message::Notification(n)) => session.inbox.push_back(n),
                Ok(_) => {}
                Err(_) => panic!("the server asked for no settings"),
            }
        }
        // A request the server answers after the settings, since it reads its messages in order.
        session
            .request("workspace/symbol", json!({ "query": "" }))
            .expect("answers");
        session
    }

    fn profiles(&self) -> PathBuf {
        self.scratch.0.join("workspace").join("profiles")
    }

    fn local(&self) -> PathBuf {
        self.scratch.0.join("local")
    }

    fn uri(&self, rel: &str) -> String {
        uri_of(&full(&self.profiles(), rel))
    }

    fn notify(&self, method: &str, params: Value) {
        let message = Notification::new(method.into(), params).into();
        self.connection
            .sender
            .send(message)
            .expect("the server takes messages");
    }

    /// The next message, after answering any `workspace/configuration` of the server's. Its other
    /// requests are kept in `asked` too, for a case to take.
    fn receive(&mut self, until: Instant) -> Option<Message> {
        loop {
            let left = until.saturating_duration_since(Instant::now());
            match self.connection.receiver.recv_timeout(left).ok()? {
                Message::Request(r) if r.method == "workspace/configuration" => {
                    let answer = Response::new_ok(r.id, json!([self.settings.clone()]));
                    self.connection.sender.send(answer.into()).expect("answers");
                }
                Message::Request(r) => {
                    self.asked.push_back(r.clone());
                    return Some(Message::Request(r));
                }
                other => return Some(other),
            }
        }
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next += 1;
        let id = RequestId::from(self.next);
        let message = Request::new(id.clone(), method.into(), params).into();
        self.connection
            .sender
            .send(message)
            .expect("the server takes messages");
        let until = Instant::now() + PATIENCE;
        loop {
            match self.receive(until) {
                Some(Message::Response(r)) if r.id == id => {
                    return r.response_result.map_err(|e| e.message);
                }
                Some(Message::Notification(n)) => self.inbox.push_back(n),
                Some(_) => {}
                None => panic!("no answer to {method}"),
            }
        }
    }

    /// The next notification of `method` that `wanted` takes.
    fn wait(&mut self, method: &str, wanted: impl Fn(&Value) -> bool) -> Value {
        if let Some(at) = self
            .inbox
            .iter()
            .position(|n| n.method == method && wanted(&n.params))
        {
            return self.inbox.remove(at).expect("it's there").params;
        }
        let until = Instant::now() + PATIENCE;
        loop {
            match self.receive(until) {
                Some(Message::Notification(n)) if n.method == method && wanted(&n.params) => {
                    return n.params;
                }
                Some(Message::Notification(n)) => self.inbox.push_back(n),
                Some(_) => {}
                None => panic!("no {method} came"),
            }
        }
    }

    /// Each notification of `method` that comes within `window`, those already in hand first.
    fn gather(&mut self, method: &str, window: Duration) -> Vec<Value> {
        let mut found: Vec<Value> = Vec::new();
        self.inbox.retain(|n| {
            let take = n.method == method;
            if take {
                found.push(n.params.clone());
            }
            !take
        });
        let until = Instant::now() + window;
        while let Some(message) = self.receive(until) {
            if let Message::Notification(n) = message {
                if n.method == method {
                    found.push(n.params);
                } else {
                    self.inbox.push_back(n);
                }
            }
        }
        found
    }

    fn open(&self, rel: &str, text: &str) {
        let document = json!({ "uri": self.uri(rel), "languageId": "dualinput-profile", "version": 1, "text": text });
        self.notify("textDocument/didOpen", json!({ "textDocument": document }));
    }

    fn change(&self, rel: &str, text: &str, version: i32) {
        self.notify(
            "textDocument/didChange",
            json!({
                "textDocument": { "uri": self.uri(rel), "version": version },
                "contentChanges": [{ "text": text }],
            }),
        );
    }

    /// A save with the protocol's reason: 1 the author's, 2 after a delay, 3 as the focus moves.
    fn save(&self, rel: &str, reason: i32) {
        let document = json!({ "uri": self.uri(rel) });
        self.notify(
            "textDocument/willSave",
            json!({ "textDocument": document, "reason": reason }),
        );
        self.notify("textDocument/didSave", json!({ "textDocument": document }));
    }

    fn build(&mut self, profile: &str) -> Value {
        let uri = self.uri(profile);
        self.wait("dualInput/build", |p| p["profile"] == uri.as_str())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if self.request("shutdown", Value::Null).is_ok() {
            self.notify("exit", Value::Null);
        }
        if let Some(thread) = self.server.take() {
            let _ = thread.join();
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    profile_engine::hash(bytes)
}

#[test]
fn a_manual_save_builds_and_writes_the_bundle_and_an_automatic_one_builds_nothing() {
    let mut s = Session::start("manual", &[("aircraft/test.yaml", PROFILE)], json!({}));
    s.save("aircraft/test.yaml", 2);
    s.save("aircraft/test.yaml", 3);
    s.save("aircraft/test.yaml", 1);
    let build = s.build("aircraft/test.yaml");
    assert_eq!(build["errors"], 0, "{build}");
    assert_eq!(build["trigger"], s.uri("aircraft/test.yaml"));
    let bundle = s.local().join("test.yaml");
    let bytes = std::fs::read(&bundle).expect("the bundle is in the local folder");
    assert_eq!(build["hash"], sha256_hex(&bytes));
    assert_eq!(build["bundle"], bundle.to_string_lossy().as_ref());
    assert!(
        build["builtAt"].as_str().is_some_and(|t| t.ends_with('Z')),
        "{build}"
    );
    assert!(!s.local().join("test.yaml.new").exists());
    // The two saves VS Code made on its own built nothing: the worker builds in order, so theirs
    // would have come first, and none comes after.
    assert!(
        s.gather("dualInput/build", Duration::from_secs(2))
            .is_empty()
    );
}

#[test]
fn a_modules_save_builds_each_importer_and_writes_only_the_bundles_the_folder_holds() {
    let alpha = importing("Alpha");
    let beta = importing("Beta");
    let files = [
        ("aircraft/alpha.yaml", alpha.as_str()),
        ("aircraft/beta.yaml", beta.as_str()),
        ("modules/radio.yaml", MODULE),
    ];
    let mut s = Session::start("module", &files, json!({}));
    std::fs::create_dir_all(s.local()).expect("makes the local folder");
    std::fs::write(s.local().join("alpha.yaml"), "an old bundle").expect("writes");
    let importers = s
        .request(
            "workspace/executeCommand",
            json!({ "command": "dualInput.importers", "arguments": [s.uri("modules/radio.yaml")] }),
        )
        .expect("lists");
    assert_eq!(
        importers,
        json!([s.uri("aircraft/alpha.yaml"), s.uri("aircraft/beta.yaml")])
    );
    s.save("modules/radio.yaml", 1);
    let a = s.build("aircraft/alpha.yaml");
    let b = s.build("aircraft/beta.yaml");
    assert_eq!(a["trigger"], s.uri("modules/radio.yaml"));
    let written = std::fs::read(s.local().join("alpha.yaml")).expect("alpha's bundle");
    assert_eq!(a["hash"], sha256_hex(&written));
    assert_eq!(
        (b["errors"].clone(), b["hash"].clone()),
        (json!(0), Value::Null)
    );
    assert!(!s.local().join("beta.yaml").exists());
}

#[test]
fn a_build_reads_the_files_as_saved_though_a_module_has_unsaved_changes() {
    let profile = importing("Test");
    let files = [
        ("aircraft/test.yaml", profile.as_str()),
        ("modules/radio.yaml", MODULE),
    ];
    let mut s = Session::start("saved", &files, json!({}));
    s.open(
        "modules/radio.yaml",
        &MODULE.replace("com_power", "unsaved_power"),
    );
    s.save("aircraft/test.yaml", 1);
    let build = s.build("aircraft/test.yaml");
    assert_eq!(build["errors"], 0, "{build}");
    let bundle = std::fs::read_to_string(s.local().join("test.yaml")).expect("the bundle");
    assert!(bundle.contains("com_power:") && !bundle.contains("unsaved_power"));
}

#[test]
fn a_save_with_errors_writes_nothing_and_reports_their_count() {
    let broken = PROFILE
        .replace("    write: L('BATTERY_1')\n", "")
        .replace("maker: M\n", "");
    let mut s = Session::start(
        "errors",
        &[("aircraft/test.yaml", broken.as_str())],
        json!({}),
    );
    s.save("aircraft/test.yaml", 1);
    let build = s.build("aircraft/test.yaml");
    assert_eq!(build["errors"], 2, "{build}");
    assert_eq!(build["hash"], Value::Null);
    assert!(!s.local().join("test.yaml").exists());
}

#[test]
fn with_building_on_save_off_a_save_builds_nothing_and_build_now_builds() {
    let settings = json!({ "buildOnSave": false });
    let mut s = Session::start("off", &[("aircraft/test.yaml", PROFILE)], settings);
    s.save("aircraft/test.yaml", 1);
    s.request(
        "workspace/executeCommand",
        json!({ "command": "dualInput.build", "arguments": [s.uri("aircraft/test.yaml")] }),
    )
    .expect("builds");
    let builds = s.gather("dualInput/build", Duration::ZERO);
    assert_eq!(builds.len(), 1, "{builds:?}");
    assert!(s.local().join("test.yaml").exists());
}

#[test]
fn remove_local_bundle_deletes_the_bundle_announced_at_the_start() {
    let scratch_bundle = "a bundle from Monday";
    let mut s = Session::start("remove", &[("aircraft/test.yaml", PROFILE)], json!({}));
    // The server announced at its start before the folder held a bundle, so this one is written
    // first and announced again by building.
    std::fs::create_dir_all(s.local()).expect("makes the local folder");
    std::fs::write(s.local().join("test.yaml"), scratch_bundle).expect("writes");
    s.request(
        "workspace/executeCommand",
        json!({ "command": "dualInput.removeLocalBundle", "arguments": [s.uri("aircraft/test.yaml")] }),
    )
    .expect("removes");
    let removed = s.build("aircraft/test.yaml");
    assert_eq!(removed["hash"], Value::Null);
    assert!(!s.local().join("test.yaml").exists());
}

#[test]
fn the_start_announces_each_bundle_the_local_folder_holds() {
    let scratch = Scratch::new("serve-announce-local");
    let local = scratch.0.join("held");
    std::fs::create_dir_all(&local).expect("makes the folder");
    std::fs::write(local.join("test.yaml"), "held bytes").expect("writes");
    let settings = json!({ "localFolder": local.to_string_lossy() });
    let mut s = Session::start("announce", &[("aircraft/test.yaml", PROFILE)], json!({}));
    s.notify(
        "workspace/didChangeConfiguration",
        json!({ "settings": { "dualInput": settings } }),
    );
    let announced = s.build("aircraft/test.yaml");
    assert_eq!(announced["hash"], sha256_hex(b"held bytes"));
    assert_eq!(announced["trigger"], s.uri("aircraft/test.yaml"));
    assert_eq!(announced["errors"], 0);
    assert!(announced["builtAt"].is_string());
    let folder = s
        .request(
            "workspace/executeCommand",
            json!({ "command": "dualInput.localFolder", "arguments": [] }),
        )
        .expect("names the folder");
    assert_eq!(folder, local.to_string_lossy().as_ref());
}

#[test]
fn completion_inside_a_script_answers_from_typescript_with_each_entrys_name() {
    let text = PROFILE.replace("state.battery_1 ? value : 0", "state.");
    let mut s = Session::start(
        "script",
        &[("aircraft/test.yaml", text.as_str())],
        json!({}),
    );
    s.open("aircraft/test.yaml", &text);
    let line = text
        .lines()
        .position(|l| l.contains("state."))
        .expect("the line") as u32;
    let character = text
        .lines()
        .nth(line as usize)
        .expect("the line")
        .find("state.")
        .expect("it") as u32
        + 6;
    let position = json!({ "line": line, "character": character });
    let uri = s.uri("aircraft/test.yaml");
    let found = s
        .request(
            "textDocument/completion",
            json!({ "textDocument": { "uri": uri }, "position": position }),
        )
        .expect("completes");
    let items = found["items"].as_array().expect("items");
    let labels: Vec<&str> = items.iter().filter_map(|i| i["label"].as_str()).collect();
    assert!(
        labels.contains(&"battery_1") && labels.contains(&"fuel_pump"),
        "{labels:?}"
    );
    let battery = items
        .iter()
        .find(|i| i["label"] == "battery_1")
        .expect("battery_1")
        .clone();
    let resolved = s
        .request("completionItem/resolve", battery)
        .expect("resolves");
    assert_eq!(
        resolved["documentation"]["value"], "Battery 1",
        "{resolved}"
    );
    assert!(
        resolved["detail"]
            .as_str()
            .is_some_and(|d| d.contains("battery_1: number"))
    );
}

#[test]
fn a_typescript_error_shows_after_a_pause_and_a_check_of_text_that_changed_shows_nothing() {
    let baron = include_str!("../../../../profiles/aircraft/bksq-baronpro.yaml");
    let first = baron.replace(
        "value == state.ap_altitude_hold",
        "value == state.first_missing",
    );
    let second = baron.replace(
        "value == state.ap_altitude_hold",
        "value == state.second_missing",
    );
    let mut s = Session::start(
        "pause",
        &[("aircraft/bksq-baronpro.yaml", baron)],
        json!({}),
    );
    s.open("aircraft/bksq-baronpro.yaml", &first);
    // The check of the first text starts once typing has paused for 300ms, and the second text
    // comes while it runs.
    std::thread::sleep(Duration::from_millis(400));
    s.change("aircraft/bksq-baronpro.yaml", &second, 2);
    let uri = s.uri("aircraft/bksq-baronpro.yaml");
    let typed = |p: &Value| {
        p["uri"] == uri.as_str()
            && p["diagnostics"]
                .as_array()
                .is_some_and(|d| d.iter().any(|d| d["code"] == "TS2339"))
    };
    let shown = s.wait("textDocument/publishDiagnostics", typed);
    let text = shown.to_string();
    assert!(
        text.contains("second_missing") && !text.contains("first_missing"),
        "{text}"
    );
}

#[test]
fn a_modules_errors_show_in_it_and_at_each_import_they_break() {
    let profile = importing("Test");
    let broken = MODULE.replace("    write: L('COM_POWER')\n", "");
    let files = [
        ("aircraft/test.yaml", profile.as_str()),
        ("modules/radio.yaml", broken.as_str()),
    ];
    let mut s = Session::start("module-errors", &files, json!({}));
    s.open("aircraft/test.yaml", &profile);
    let module = s.uri("modules/radio.yaml");
    let in_module = s.wait("textDocument/publishDiagnostics", |p| {
        p["uri"] == module.as_str() && p["diagnostics"].as_array().is_some_and(|d| !d.is_empty())
    });
    assert_eq!(in_module["diagnostics"][0]["code"], "required");
    let uri = s.uri("aircraft/test.yaml");
    let at_import = s.wait("textDocument/publishDiagnostics", |p| {
        p["uri"] == uri.as_str()
    });
    let first = &at_import["diagnostics"][0];
    assert_eq!(first["code"], "module-errors", "{at_import}");
    let line = profile
        .lines()
        .position(|l| l.starts_with("import:"))
        .expect("the import");
    assert_eq!(first["range"]["start"]["line"], line);
}

/// Whether a `publishDiagnostics` is for `uri` and holds an error of `code`.
fn shows(p: &Value, uri: &str, code: &str) -> bool {
    p["uri"] == uri
        && p["diagnostics"]
            .as_array()
            .is_some_and(|d| d.iter().any(|d| d["code"] == code))
}

#[test]
fn a_module_checked_on_its_own_loses_that_checks_errors_once_a_profile_imports_it() {
    let module = MODULE.replace(
        "    write: L('COM_POWER')\n",
        "    write: |\n      (value) => {\n        write(L('COM_POWER'), state.battery_1 ? value : 0)\n      }\n",
    );
    // The profile's own script reads a key it lacks, so its check shows when it has run.
    let profile = PROFILE.replace("state.battery_1 ? value", "state.not_an_entry ? value");
    let files = [
        ("aircraft/test.yaml", profile.as_str()),
        ("modules/radio.yaml", module.as_str()),
    ];
    let mut s = Session::start("module-alone", &files, json!({}));
    let radio = s.uri("modules/radio.yaml");
    s.open("modules/radio.yaml", &module);
    // On its own, the module holds no `battery_1`.
    s.wait("textDocument/publishDiagnostics", |p| {
        shows(p, &radio, "TS2339")
    });
    s.open(
        "aircraft/test.yaml",
        &profile.replace("\nstate:", "\nimport: modules/radio\n\nstate:"),
    );
    let uri = s.uri("aircraft/test.yaml");
    s.wait("textDocument/publishDiagnostics", |p| {
        shows(p, &uri, "TS2339")
    });
    let shown: Vec<Value> = s
        .gather("textDocument/publishDiagnostics", Duration::from_secs(1))
        .into_iter()
        .filter(|p| p["uri"] == radio.as_str())
        .collect();
    let last = shown
        .last()
        .expect("the module's diagnostics are published again");
    assert_eq!(last["diagnostics"], json!([]), "{shown:?}");
}

#[test]
fn a_renamed_profiles_old_file_shows_no_errors() {
    let broken = PROFILE.replace("maker: M\n", "");
    let mut s = Session::start(
        "rename",
        &[("aircraft/old.yaml", broken.as_str())],
        json!({}),
    );
    let (old, new) = (s.uri("aircraft/old.yaml"), s.uri("aircraft/new.yaml"));
    s.open("aircraft/old.yaml", &broken);
    s.wait("textDocument/publishDiagnostics", |p| {
        shows(p, &old, "required")
    });
    // VS Code renames the file on disk, closes the old document and opens the new one, and its
    // watcher reports both files.
    std::fs::rename(
        full(&s.profiles(), "aircraft/old.yaml"),
        full(&s.profiles(), "aircraft/new.yaml"),
    )
    .expect("renames");
    s.notify(
        "textDocument/didClose",
        json!({ "textDocument": { "uri": old } }),
    );
    s.open("aircraft/new.yaml", &broken);
    s.notify(
        "workspace/didChangeWatchedFiles",
        json!({ "changes": [{ "uri": old, "type": 3 }, { "uri": new, "type": 1 }] }),
    );
    s.wait("textDocument/publishDiagnostics", |p| {
        shows(p, &new, "required")
    });
    let shown: Vec<Value> = s
        .gather("textDocument/publishDiagnostics", Duration::from_secs(1))
        .into_iter()
        .filter(|p| p["uri"] == old.as_str())
        .collect();
    assert!(
        !shown.is_empty() && shown.iter().all(|p| p["diagnostics"] == json!([])),
        "{shown:?}"
    );
}

/// A snippet's text with each blank filled: a choice by its first word, a placeholder by its
/// text, and an empty blank by `X`.
fn filled(snippet: &str) -> String {
    let mut out = String::new();
    let mut rest = snippet;
    while let Some(at) = rest.find('$') {
        out.push_str(&rest[..at]);
        rest = &rest[at + 1..];
        if let Some(inner) = rest.strip_prefix('{') {
            let end = inner.find('}').expect("a blank ends");
            let blank = &inner[..end];
            rest = &inner[end + 1..];
            if let Some((_, choices)) = blank.split_once('|') {
                out.push_str(choices.split(',').next().expect("a choice"));
            } else if let Some((_, text)) = blank.split_once(':') {
                out.push_str(text);
            } else {
                out.push('X');
            }
        } else {
            let digits = rest.chars().take_while(char::is_ascii_digit).count();
            rest = &rest[digits..];
        }
    }
    out.push_str(rest);
    out
}

#[test]
fn a_new_profile_written_by_its_snippet_with_its_blanks_filled_builds() {
    let mut s = Session::start("snippet", &[("aircraft/new.yaml", "")], json!({}));
    s.open("aircraft/new.yaml", "");
    let uri = s.uri("aircraft/new.yaml");
    let found = s
        .request(
            "textDocument/completion",
            json!({ "textDocument": { "uri": uri }, "position": { "line": 0, "character": 0 } }),
        )
        .expect("completes");
    let item = &found["items"][0];
    assert_eq!(item["label"], "new profile");
    let text = filled(item["textEdit"]["newText"].as_str().expect("its text"));
    std::fs::write(full(&s.profiles(), "aircraft/new.yaml"), &text).expect("writes");
    s.change("aircraft/new.yaml", &text, 2);
    s.save("aircraft/new.yaml", 1);
    let build = s.build("aircraft/new.yaml");
    assert_eq!(build["errors"], 0, "{build}\n{text}");
    assert!(build["hash"].is_string());
}
