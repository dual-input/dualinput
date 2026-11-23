//! The features that need the sim, through the server, with the author's core faked behind the
//! connection's channels (record/areas/profiles/04-the-extension-in-the-sim.md, "Cases"): what
//! `serve` sends `authoring`, the boxes and the panel's view it makes of the slice, the code
//! lenses, the panel's commands, the picker's Sync, a new socket, and the views as the
//! extension's types read them.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, Instant};

use messages::authoring::{
    Action, AuthoringSlice, BundleState, CockpitPanel, Got, Outcome, Planned, Preview, RunResult,
    RunState, Seen, SessionProfile, Status, Value as Wire, Watched,
};
use messages::clients::{CoreSlice, FromClient, ToClient};
use serde_json::{Value, json};
use tokio::sync::mpsc::error::TryRecvError;

use super::{PATIENCE, Session};
use crate::serve::connection::{Down, Up};
use crate::serve::facts;
use crate::serve::sim::{Inputs, PanelState, panel_view};
use crate::serve::worker::{Bundle, Failure};

/// A profile with an entry of each kind a box and Run show: a value, a `Bool`, an entry the pilot
/// flying owns, a counting map, an instrument, and an event, and a `displays:`.
const PROFILE: &str = "maker: M
name: Test
maturity: experimental

aircraft:
  variants:
    a: test-aircraft

displays: GNS_DISABLED

state:
  battery:
    name: Battery
    watch: L('BATTERY')
    write: L('BATTERY')
  on_ground:
    name: On the ground
    watch: A('SIM ON GROUND', 'Bool')
    write: none
  throttle:
    name: Throttle
    watch: L('THROTTLE')
    write: L('THROTTLE')
    owner: pilot_flying
  com:
    name: COM frequency
    watch:
      inc: K('COM_INC')
      dec: K('COM_DEC')
      wrap: false
      range: [0, 100]
    write:
      inc: K('COM_INC')
      dec: K('COM_DEC')
    default: 0
  radio:
    name: Radio
    watch: instrument('KX155B_9', 'freq')
    write: none

events:
  ap_master:
    name: Autopilot master
    watch: K('AP_MASTER')
    write: K('AP_MASTER')
";

const FILE: &str = "aircraft/test.yaml";

/// The bundle the session pinned, which no case's open text builds.
const PINNED: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// The line, from 0, of the first line of `text` that holds `part`.
fn line_of(text: &str, part: &str) -> usize {
    text.lines()
        .position(|l| l.contains(part))
        .unwrap_or_else(|| panic!("no line holds {part}"))
}

impl Session {
    /// Hands the server something from the core, as the connection's thread does.
    fn tell(&self, down: Down) {
        self.core.tell.send(down).expect("the server listens");
    }

    /// The next message the server sends the core that `wanted` takes, keeping the others.
    fn heard_by_core(&mut self, what: &str, wanted: impl Fn(&FromClient) -> bool) -> FromClient {
        let held = self
            .core
            .held
            .iter()
            .position(|u| matches!(u, Up::Send(m) if wanted(m)));
        if let Some(Up::Send(m)) = held.and_then(|at| self.core.held.remove(at)) {
            return m;
        }
        let until = Instant::now() + PATIENCE;
        loop {
            match self.core.heard.try_recv() {
                Ok(Up::Send(m)) if wanted(&m) => return m,
                Ok(other) => self.core.held.push_back(other),
                Err(TryRecvError::Empty) if Instant::now() < until => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(e) => panic!("the server sent the core no {what}: {e}"),
            }
        }
    }

    /// The arguments of the next command `name` the server sends the core that `wanted` takes.
    fn command(&mut self, name: &str, wanted: impl Fn(&Value) -> bool) -> Value {
        let found = self.heard_by_core(
            name,
            |m| matches!(m, FromClient::Command { name: n, args, .. } if n == name && wanted(args)),
        );
        match found {
            FromClient::Command { args, .. } => args,
            _ => unreachable!("heard_by_core gave a command"),
        }
    }

    /// The commands `name` the server sends the core within `window`.
    fn commands(&mut self, name: &str, window: Duration) -> Vec<Value> {
        let until = Instant::now() + window;
        while Instant::now() < until {
            match self.core.heard.try_recv() {
                Ok(up) => self.core.held.push_back(up),
                Err(_) => std::thread::sleep(Duration::from_millis(5)),
            }
        }
        let mut found = Vec::new();
        self.core.held.retain(|up| match up {
            Up::Send(FromClient::Command { name: n, args, .. }) if n == name => {
                found.push(args.clone());
                false
            }
            _ => true,
        });
        found
    }

    /// Waits until the server has handled every message before it, which it reads in order.
    fn settle(&mut self) {
        self.request("workspace/symbol", json!({ "query": "" }))
            .expect("answers");
    }

    /// A socket to a core of `version`: its hello and watch, and the core's slice `core`, and
    /// with this release's version, the window's ID from the `authoring.open` that follows.
    fn connect(&mut self, version: &str) -> Option<String> {
        self.open_socket(version);
        (version == messages::VERSION).then(|| {
            let open = self.command("authoring.open", |_| true);
            open["window"].as_str().expect("a window").to_string()
        })
    }

    /// A new socket's hello and watch, and the core's slice `core`, after which a core of this
    /// release hears the server's last `authoring.open` and `authoring.panel`. What the core heard
    /// on a socket before goes, so nothing of it is taken for the new one's.
    fn open_socket(&mut self, version: &str) {
        while self.core.heard.try_recv().is_ok() {}
        self.core.held.clear();
        self.tell(Down::Opened);
        let hello = self.heard_by_core("hello", |m| matches!(m, FromClient::Hello(_)));
        let FromClient::Hello(hello) = hello else {
            unreachable!()
        };
        assert_eq!(
            (
                hello.component.as_str(),
                hello.version.as_str(),
                hello.hash.as_str()
            ),
            ("profile-extension", messages::VERSION, messages::HASH)
        );
        let watch = self.heard_by_core("watch", |m| matches!(m, FromClient::Watch { .. }));
        assert_eq!(
            watch,
            FromClient::Watch {
                slices: vec!["authoring".into(), "core".into()]
            }
        );
        let core = CoreSlice {
            version: version.into(),
            hash: messages::HASH.into(),
            username: None,
        };
        self.tell(Down::Heard(ToClient::State {
            slice: "core".into(),
            value: serde_json::to_value(core).expect("encodes"),
        }));
    }

    fn slice(&self, slice: &AuthoringSlice) {
        self.tell(Down::Heard(ToClient::State {
            slice: "authoring".into(),
            value: serde_json::to_value(slice).expect("encodes"),
        }));
    }

    fn view(&mut self, wanted: impl Fn(&Value) -> bool) -> Value {
        self.wait("dualInput/panel", wanted)
    }

    fn execute(&mut self, command: &str, arguments: Value) -> Result<Value, String> {
        self.request(
            "workspace/executeCommand",
            json!({ "command": command, "arguments": arguments }),
        )
    }

    fn lenses(&mut self, rel: &str) -> Value {
        let uri = self.uri(rel);
        self.request(
            "textDocument/codeLens",
            json!({ "textDocument": { "uri": uri } }),
        )
        .expect("answers")
    }

    /// The server's next request of the client `method`.
    fn asked_for(&mut self, method: &str) -> Value {
        let until = Instant::now() + PATIENCE;
        loop {
            if let Some(at) = self.asked.iter().position(|r| r.method == method) {
                return self.asked.remove(at).expect("it's there").params;
            }
            match self.receive(until) {
                Some(lsp_server::Message::Notification(n)) => self.inbox.push_back(n),
                Some(_) => {}
                None => panic!("the server asked for no {method}"),
            }
        }
    }

    /// The open text's bundle the server sends `authoring`, once it builds.
    fn bundle(&mut self) -> Value {
        self.command("authoring.open", |a| a.get("bundle").is_some())["bundle"].clone()
    }
}

/// A session's status in its flight, alone and the pilot flying, with the open text's bundle
/// loaded.
fn flying() -> Status {
    Status {
        version: messages::VERSION.into(),
        session: true,
        in_flight: true,
        aircraft: Some("test-aircraft".into()),
        profile: Some(SessionProfile {
            maker: "M".into(),
            name: "Test".into(),
            hash: PINNED.into(),
            local: true,
        }),
        crew: false,
        flying: true,
        pilot_flying: Some("James".into()),
        bundle: BundleState::Loaded {
            hash: PINNED.into(),
        },
    }
}

fn slice(window: &str, status: Status) -> AuthoringSlice {
    AuthoringSlice {
        window: Some(window.into()),
        status,
        ..AuthoringSlice::default()
    }
}

fn watched(name: &str, got: Got) -> Watched {
    Watched {
        name: name.into(),
        got,
    }
}

fn number(n: f64) -> Got {
    Got::Value {
        value: Wire::Number(n),
    }
}

/// A server on `PROFILE`, open in its editor, connected to a core of this release.
fn connected(name: &str) -> (Session, String) {
    let mut s = Session::start(name, &[(FILE, PROFILE)], json!({}));
    s.open(FILE, PROFILE);
    s.settle();
    let window = s.connect(messages::VERSION).expect("a window");
    (s, window)
}

#[test]
fn serve_sends_each_watch_lines_name_with_how_its_line_reads_it() {
    let mut s = Session::start("sim-names", &[(FILE, PROFILE)], json!({}));
    s.open(FILE, PROFILE);
    s.settle();
    s.open_socket(messages::VERSION);
    let open = s.command("authoring.open", |_| true);
    assert_eq!(
        open["names"],
        json!([
            { "name": "L('BATTERY')", "reads": "value" },
            { "name": "A('SIM ON GROUND', 'Bool')", "reads": "value" },
            { "name": "L('THROTTLE')", "reads": "value" },
            { "name": "K('COM_INC')", "reads": "occurrences" },
            { "name": "K('COM_DEC')", "reads": "occurrences" },
            { "name": "instrument('KX155B_9', 'freq')", "reads": "value" },
            { "name": "K('AP_MASTER')", "reads": "occurrences" },
        ])
    );
    assert_eq!(open.get("bundle"), None, "no session names a profile yet");
    // A line typed later goes once typing pauses, and a file closed takes its names with it.
    let typed = PROFILE.replace(
        "    write: none\n\nevents:",
        "    write: none\n  strobe:\n    name: Strobe\n    watch: L('STROBE')\n    write: L('STROBE')\n\nevents:",
    );
    s.change(FILE, &typed, 2);
    let open = s.command("authoring.open", |a| a.to_string().contains("STROBE"));
    assert_eq!(
        open["names"][6],
        json!({ "name": "L('STROBE')", "reads": "value" })
    );
    s.notify(
        "textDocument/didClose",
        json!({ "textDocument": { "uri": s.uri(FILE) } }),
    );
    let open = s.command("authoring.open", |a| a["names"] == json!([]));
    assert_eq!(open["names"], json!([]));
}

#[test]
fn each_name_gets_its_box_on_its_line_and_a_files_boxes_go_only_when_they_change() {
    let (mut s, window) = connected("sim-boxes");
    let mut values = slice(&window, flying());
    values.names = vec![
        watched("L('BATTERY')", number(1.0)),
        watched("A('SIM ON GROUND', 'Bool')", number(1.0)),
        watched("L('THROTTLE')", number(0.250_000_1)),
        watched(
            "K('COM_INC')",
            Got::Fired {
                times: 3,
                last: None,
            },
        ),
        watched("K('COM_DEC')", Got::Waiting),
        watched(
            "instrument('KX155B_9', 'freq')",
            Got::Error {
                error: "no panel holds `KX155B_9`".into(),
            },
        ),
        watched(
            "K('AP_MASTER')",
            Got::Fired {
                times: 1,
                last: Some(0.0),
            },
        ),
    ];
    s.slice(&values);
    let uri = s.uri(FILE);
    let shown = s.wait("dualInput/values", |p| {
        p["uri"] == uri.as_str() && p["boxes"].as_array().is_some_and(|b| !b.is_empty())
    });
    let at = |part: &str| line_of(PROFILE, part);
    assert_eq!(
        shown["boxes"],
        json!([
            { "line": at("L('BATTERY')"), "text": "1", "kind": "value" },
            { "line": at("SIM ON GROUND"), "text": "true", "kind": "value" },
            { "line": at("watch: L('THROTTLE')"), "text": "0.25", "kind": "value" },
            { "line": at("inc: K('COM_INC')"), "text": "×3", "kind": "firing" },
            { "line": at("KX155B_9"), "text": "no panel holds `KX155B_9`", "kind": "error" },
            { "line": at("watch: K('AP_MASTER')"), "text": "×1, last 0", "kind": "firing" },
        ])
    );
    s.slice(&values);
    assert!(
        s.gather("dualInput/values", Duration::from_millis(500))
            .is_empty(),
        "the same boxes again send nothing"
    );
    // Another window's slice holds another window's names, and the boxes go.
    values.window = Some("another window".into());
    s.slice(&values);
    let cleared = s.wait("dualInput/values", |p| p["uri"] == uri.as_str());
    assert_eq!(cleared["boxes"], json!([]));
}

#[test]
fn the_status_line_says_where_the_session_stands_and_unsaved_edits_show_only_with_a_crew() {
    let other = "maker: X\nname: Other\nmaturity: experimental\n\naircraft:\n  variants:\n    x: other-aircraft\n\nstate:\n  lamp:\n    name: Lamp\n    watch: L('LAMP')\n    write: L('LAMP')\n";
    let files = [(FILE, PROFILE), ("aircraft/other.yaml", other)];
    let mut s = Session::start("sim-status", &files, json!({}));
    s.open(FILE, PROFILE);
    s.view(|v| v["status"] == json!({ "kind": "not-running" }));
    s.settle();
    assert_eq!(s.connect("0.0.1"), None);
    let release = json!({ "kind": "other-release", "extension": messages::VERSION, "dualInput": "0.0.1", "update": "dual-input" });
    s.view(|v| v["status"] == release);
    assert!(
        s.commands("authoring.open", Duration::from_millis(300))
            .is_empty(),
        "a core of another release gets nothing more"
    );
    s.tell(Down::Closed);
    s.view(|v| v["status"]["kind"] == "not-running");

    let window = s.connect(messages::VERSION).expect("a window");
    s.slice(&slice("another window", flying()));
    s.view(|v| v["status"]["kind"] == "other-window");
    let mut status = flying();
    status.session = false;
    status.in_flight = false;
    s.slice(&slice(&window, status.clone()));
    s.view(|v| v["status"]["kind"] == "no-session");
    status.session = true;
    s.slice(&slice(&window, status.clone()));
    s.view(|v| v["status"]["kind"] == "not-in-flight");
    s.slice(&slice(&window, flying()));
    let view = s.view(|v| v["status"]["kind"] == "in-flight");
    assert_eq!(
        view,
        json!({ "status": { "kind": "in-flight", "aircraft": "M Test", "runs": true, "crew": false }, "unpinned": false, "body": { "kind": "nothing" } })
    );

    // The open text's bundle differs from the pinned one, which concerns only a crew.
    let bundle = s.bundle();
    assert_eq!(bundle["t"], "built", "{bundle}");
    let built = profile_engine::hash(bundle["text"].as_str().expect("a text").as_bytes());
    let mut crew = flying();
    crew.crew = true;
    s.slice(&slice(&window, crew.clone()));
    s.view(|v| v["unpinned"] == true && v["status"]["crew"] == true);
    crew.profile.as_mut().expect("a profile").hash = built;
    s.slice(&slice(&window, crew));
    s.view(|v| v["unpinned"] == false && v["status"]["crew"] == true);

    // A file of another aircraft shows its values, and the status line says Run is off.
    s.open("aircraft/other.yaml", other);
    s.change("aircraft/other.yaml", &other.replace("Lamp", "Lamps"), 2);
    s.view(|v| v["status"]["runs"] == false);
}

#[test]
fn run_shows_its_entry_and_sends_the_core_what_the_field_holds() {
    let (mut s, window) = connected("sim-run");
    s.slice(&slice(&window, flying()));
    let uri = s.uri(FILE);
    s.execute("dualInput.panel.open", json!([uri, "battery"]))
        .expect("opens");
    assert_eq!(
        s.command("authoring.panel", |p| p["t"] == "run"),
        json!({ "t": "run", "entry": "battery" })
    );
    let view = s.view(|v| v["body"]["kind"] == "run");
    assert_eq!(
        view["body"]["run"],
        json!({ "name": "Battery", "key": "battery", "takes": "value", "live": [], "field": "", "seen": [], "preview": { "kind": "waiting" }, "refused": null, "revert": null })
    );
    s.execute("dualInput.panel.typed", json!(["0.5"]))
        .expect("types");
    let half = json!({ "t": "value", "value": { "as": "number", "value": 0.5 } });
    s.command("authoring.panel", |p| p["typed"] == half);

    let mut state = slice(&window, flying());
    state.names = vec![watched("L('BATTERY')", number(0.5))];
    state.run = Some(RunState {
        entry: "battery".into(),
        seen: Seen::Values {
            values: vec![Wire::Number(0.0), Wire::Number(1.0)],
        },
        preview: Preview::Sends {
            actions: vec![Planned {
                action: Action::Set {
                    name: "L('BATTERY')".into(),
                    value: Wire::Number(0.5),
                },
                times: 1,
                every: "1 frame".into(),
            }],
        },
    });
    state.last = Some(RunResult {
        run: 1,
        entry: "battery".into(),
        outcome: Outcome::Reverted {
            to: Wire::Number(0.0),
            after_ms: 120,
        },
    });
    s.slice(&state);
    let view = s.view(|v| v["body"]["run"]["revert"] != Value::Null);
    assert_eq!(
        view["body"]["run"],
        json!({
            "name": "Battery", "key": "battery", "takes": "value",
            "live": [{ "of": null, "value": "0.5" }], "field": "0.5", "seen": ["0", "1"],
            "preview": { "kind": "sends", "actions": [{ "does": "set", "name": "L:BATTERY", "values": ["0.5"], "times": 1, "apart": null }] },
            "refused": null, "revert": { "to": "0", "afterMs": 120 },
        })
    );
    s.execute("dualInput.panel.run", json!(["0.5"]))
        .expect("runs");
    assert_eq!(
        s.command("authoring.run", |_| true),
        json!({ "entry": "battery", "given": half })
    );

    // An event entry at the cursor, whose empty field fires with no value.
    let at = json!({ "line": line_of(PROFILE, "watch: K('AP_MASTER')"), "character": 4 });
    s.execute("dualInput.panel.open", json!([uri, at]))
        .expect("opens");
    s.command("authoring.panel", |p| {
        p["entry"] == "ap_master" && p["typed"] == json!({ "t": "nothing" })
    });
    s.view(|v| v["body"]["run"]["takes"] == "event");
    s.execute("dualInput.panel.run", json!([""])).expect("runs");
    assert_eq!(
        s.command("authoring.run", |_| true),
        json!({ "entry": "ap_master", "given": { "t": "nothing" } })
    );

    // A counting entry takes a step count.
    s.execute("dualInput.panel.open", json!([uri, "com"]))
        .expect("opens");
    s.view(|v| v["body"]["run"]["takes"] == "steps");
    for (text, steps) in [("+3", 3), ("-2", -2)] {
        s.execute("dualInput.panel.run", json!([text]))
            .expect("runs");
        assert_eq!(
            s.command("authoring.run", |_| true),
            json!({ "entry": "com", "given": { "t": "steps", "steps": steps } })
        );
    }

    // The pilot flying's entry, while this pilot monitors, and the engine's refusal in its words.
    s.execute("dualInput.panel.open", json!([uri, "throttle"]))
        .expect("opens");
    let mut monitoring = slice(&window, flying());
    monitoring.status.flying = false;
    monitoring.run = Some(RunState {
        entry: "throttle".into(),
        seen: Seen::Many,
        preview: Preview::Refused {
            why: "a state entry with no reading yet".into(),
        },
    });
    s.slice(&monitoring);
    let view = s.view(|v| v["body"]["run"]["refused"] != Value::Null);
    let run = &view["body"]["run"];
    assert_eq!(
        run["refused"],
        json!({ "kind": "pilot-flying-only", "pilotFlying": "James" })
    );
    assert_eq!(run["seen"], "many");
    let place = format!("{FILE}:{}:3", line_of(PROFILE, "  throttle:") + 1);
    assert_eq!(
        run["preview"],
        json!({ "kind": "error", "message": "A state entry with no reading yet", "where": place })
    );
    assert!(
        s.execute(
            "dualInput.panel.open",
            json!([uri, { "line": 0, "character": 0 }])
        )
        .is_err(),
        "no entry holds the file's first line"
    );

    // Text that doesn't build has no Run, and the preview shows the build's first error.
    s.bundle();
    let broken = PROFILE.replacen("    write: L('THROTTLE')\n", "", 1);
    s.change(FILE, &broken, 2);
    let failed = s.bundle();
    assert_eq!(failed["t"], "failed", "{failed}");
    let error = failed["error"].as_str().expect("an error");
    assert!(error.starts_with(&format!("{FILE}:")), "{error}");
    let view = s.view(|v| {
        v["body"]["run"]["preview"]["where"]
            .as_str()
            .is_some_and(|w| error.starts_with(w))
    });
    assert!(
        error.ends_with(
            view["body"]["run"]["preview"]["message"]
                .as_str()
                .expect("words")
        ),
        "{view}"
    );
}

/// Each lens's title and its command's arguments.
fn titles(lenses: &Value) -> Vec<(String, Value)> {
    lenses
        .as_array()
        .expect("lenses")
        .iter()
        .map(|l| {
            (
                l["command"]["title"].as_str().expect("a title").to_string(),
                l["command"]["arguments"].clone(),
            )
        })
        .collect()
}

#[test]
fn lenses_come_with_a_flight_and_say_pilot_flying_only_to_the_pilot_monitoring() {
    let (mut s, window) = connected("sim-lenses");
    assert_eq!(s.lenses(FILE), json!([]), "no lens before the flight");
    s.slice(&slice(&window, flying()));
    s.asked_for("workspace/codeLens/refresh");
    let uri = s.uri(FILE);
    let run = |key: &str| ("$(play)\u{a0}Run".to_string(), json!([uri, key]));
    let pick = ("$(inspect)\u{a0}Pick displays".to_string(), json!([uri]));
    assert_eq!(
        titles(&s.lenses(FILE)),
        [
            run("battery"),
            run("throttle"),
            run("com"),
            run("ap_master"),
            pick.clone()
        ]
    );
    let lenses = s.lenses(FILE);
    let battery = line_of(PROFILE, "  battery:");
    assert_eq!(
        lenses[0]["range"],
        json!({ "start": { "line": battery, "character": 2 }, "end": { "line": battery, "character": 9 } })
    );
    assert_eq!(lenses[0]["command"]["command"], "dualInput.run");
    assert_eq!(lenses[4]["command"]["command"], "dualInput.pickDisplays");

    // Control passes to the crewmate.
    let mut monitoring = flying();
    monitoring.flying = false;
    s.slice(&slice(&window, monitoring.clone()));
    s.asked_for("workspace/codeLens/refresh");
    let found = titles(&s.lenses(FILE));
    assert_eq!(
        found[1],
        (
            "$(play)\u{a0}Run · pilot flying only".to_string(),
            json!([uri, "throttle"])
        )
    );
    assert_eq!(found[0], run("battery"));

    // A bundle authoring refused has no Run, and out of the flight there's no lens.
    monitoring.bundle = BundleState::Refused {
        why: "the open text doesn't build".into(),
    };
    s.slice(&slice(&window, monitoring.clone()));
    s.asked_for("workspace/codeLens/refresh");
    assert_eq!(titles(&s.lenses(FILE)), [pick]);
    monitoring.in_flight = false;
    s.slice(&slice(&window, monitoring));
    s.asked_for("workspace/codeLens/refresh");
    assert_eq!(s.lenses(FILE), json!([]));
}

#[test]
fn the_picker_lists_the_cockpits_panels_and_sync_writes_the_ticked_rows_into_displays() {
    let (mut s, window) = connected("sim-picker");
    let uri = s.uri(FILE);
    s.execute("dualInput.panel.pick", json!([uri]))
        .expect("picks");
    assert_eq!(
        s.command("authoring.panel", |p| p["t"] == "picker"),
        json!({ "t": "picker" })
    );
    let mut picking = slice(&window, flying());
    picking.panels = vec![
        CockpitPanel {
            name: Some("VCockpit60".into()),
            instruments: vec!["GNS_DISABLED".into(), "KX155B|Index=1".into()],
        },
        CockpitPanel {
            name: Some("VCockpit61".into()),
            instruments: vec!["GNS_DISABLED".into(), "KX155B|Index=2".into()],
        },
    ];
    s.slice(&picking);
    let row = |key: &str, panels: u32, ticked: bool| json!({ "key": key, "fullKey": key, "panels": panels, "ticked": ticked, "refused": null });
    let view = s.view(|v| v["body"]["kind"] == "picker");
    assert_eq!(
        view["body"]["picker"],
        json!({ "groups": [
            { "kind": "single", "row": row("GNS_DISABLED", 2, true) },
            { "kind": "shared", "identifier": "KX155B", "rows": [row("KX155B|Index=1", 1, false), row("KX155B|Index=2", 1, false)] },
        ], "active": "" })
    );
    s.execute("dualInput.panel.move", json!(["KX155B"]))
        .expect("moves");
    assert_eq!(
        s.command("authoring.panel", |p| p.get("active").is_some()),
        json!({ "t": "picker", "active": "KX155B" })
    );
    s.execute("dualInput.panel.tick", json!(["KX155B"]))
        .expect("ticks");
    s.view(|v| {
        v["body"]["picker"]["groups"][1]["rows"][1]["ticked"] == true
            && v["body"]["picker"]["active"] == "KX155B"
    });
    s.execute("dualInput.panel.write", json!([]))
        .expect("syncs");
    let edit = s.asked_for("workspace/applyEdit");
    let line = line_of(PROFILE, "displays:");
    assert_eq!(
        edit["edit"]["changes"][uri.as_str()],
        json!([{
            "range": { "start": { "line": line, "character": 0 }, "end": { "line": line + 1, "character": 0 } },
            "newText": "displays:\n  - GNS_DISABLED\n  - KX155B\n",
        }])
    );
    s.command("authoring.panel", |p| p["t"] == "nothing");
    s.view(|v| v["body"]["kind"] == "nothing");
}

#[test]
fn a_new_socket_gets_the_last_open_with_its_bundle_and_the_last_panel_again() {
    let (mut s, window) = connected("sim-again");
    s.slice(&slice(&window, flying()));
    let bundle = s.bundle();
    assert_eq!(bundle["t"], "built", "{bundle}");
    let uri = s.uri(FILE);
    s.execute("dualInput.panel.open", json!([uri, "battery"]))
        .expect("opens");
    s.execute("dualInput.panel.typed", json!(["1"]))
        .expect("types");
    let panel = s.command("authoring.panel", |p| p.get("typed").is_some());
    assert_eq!(
        panel,
        json!({ "t": "run", "entry": "battery", "typed": { "t": "value", "value": { "as": "number", "value": 1.0 } } })
    );
    // A change that leaves the names and the bundle as they were sends nothing.
    s.change(
        FILE,
        &PROFILE.replace("name: Battery", "name: Battery # the master"),
        2,
    );
    assert!(
        s.commands("authoring.open", Duration::from_millis(800))
            .is_empty()
    );

    // The core restarted, and the new socket hears the last open, its bundle included, and the
    // last panel.
    s.tell(Down::Closed);
    s.open_socket(messages::VERSION);
    let open = s.command("authoring.open", |_| true);
    assert_eq!(open["window"], window.as_str());
    assert_eq!(open["bundle"], bundle);
    assert_eq!(open["names"].as_array().map(Vec::len), Some(7));
    assert_eq!(s.command("authoring.panel", |_| true), panel);
}

/// Views built from each state the panel shows, written as a TypeScript file whose every view
/// `satisfies` the extension's `ServerView`, so `tsc`, which tools/check.ts runs on the
/// extension, fails when one of these types and view.ts's part.
#[test]
fn the_views_serve_sends_are_the_extensions_types() {
    let facts = facts::read(PROFILE).expect("parses");
    let window = "w";
    let core = CoreSlice {
        version: messages::VERSION.into(),
        hash: messages::HASH.into(),
        username: None,
    };
    let older = CoreSlice {
        version: "0.0.1".into(),
        ..core.clone()
    };
    let run = |key: &str, field: &str| PanelState::Run {
        file: Path::new("aircraft").join("test.yaml"),
        key: key.into(),
        field: field.into(),
    };
    let built: Result<Bundle, Failure> = Ok(Bundle {
        text: "maker: M".into(),
        hash: "b".repeat(64),
    });
    let failed: Result<Bundle, Failure> = Err(Failure {
        message: "Cannot find name 'valu'. Did you mean 'value'?".into(),
        place: format!("{FILE}:16:12"),
    });

    let mut lever = slice(window, flying());
    lever.status.crew = true;
    lever.names = vec![watched("L('BATTERY')", number(0.82))];
    lever.run = Some(RunState {
        entry: "battery".into(),
        seen: Seen::Values {
            values: vec![Wire::Number(0.0), Wire::Number(1.0)],
        },
        preview: Preview::Sends {
            actions: vec![Planned {
                action: Action::Key {
                    name: "K('HDG_INC')".into(),
                    values: vec![],
                },
                times: 3,
                every: "2 frames".into(),
            }],
        },
    });
    lever.last = Some(RunResult {
        run: 4,
        entry: "battery".into(),
        outcome: Outcome::Reverted {
            to: Wire::Number(0.0),
            after_ms: 120,
        },
    });
    let mut event = slice(window, flying());
    event.names = vec![watched(
        "K('AP_MASTER')",
        Got::Fired {
            times: 3,
            last: Some(1.0),
        },
    )];
    let mut counting = slice(window, flying());
    counting.status.flying = false;
    counting.names = vec![
        watched(
            "K('COM_INC')",
            Got::Fired {
                times: 4,
                last: None,
            },
        ),
        watched(
            "K('COM_DEC')",
            Got::Error {
                error: "the sim refused it".into(),
            },
        ),
    ];
    counting.run = Some(RunState {
        entry: "com".into(),
        seen: Seen::Many,
        preview: Preview::Waiting,
    });
    let mut picking = slice(window, flying());
    picking.panels = vec![
        CockpitPanel {
            name: Some("VCockpit60".into()),
            instruments: vec![
                "GNS_DISABLED".into(),
                "KX155B|Index=1".into(),
                "KAS297B_1|Index=1".into(),
            ],
        },
        CockpitPanel {
            name: Some("VCockpit61".into()),
            instruments: vec![
                "GNS_DISABLED".into(),
                "KX155B|Index=2".into(),
                "WasmInstrument|wasm_module=Gauge/TDSGTNXiGaugeModule.wasm&wasm_gauge=GTNXI750U1"
                    .into(),
            ],
        },
    ];
    let mut no_session = flying();
    no_session.session = false;
    no_session.in_flight = false;
    let mut waiting = flying();
    waiting.in_flight = false;
    let flight = slice(window, flying());
    let mut ticks = BTreeMap::new();
    ticks.insert("KX155B|Index=2".to_string(), true);
    let picker = PanelState::Picker {
        file: Path::new("aircraft").join("test.yaml"),
        active: Some("KX155B".into()),
        ticks,
    };
    let nothing = PanelState::Nothing;
    let another = slice("another", flying());
    let away = slice(window, no_session);
    let before = slice(window, waiting);

    let base = |socket, slice, runs, panel| Inputs {
        socket,
        slice,
        window,
        runs,
        built: None,
        panel,
        facts: Some(&facts),
        rel: Some(FILE.into()),
    };
    let (lever_run, event_run, counting_run) = (
        run("battery", "0.5"),
        run("ap_master", ""),
        run("com", "+3"),
    );
    let views = [
        ("not running", base(None, None, true, &nothing)),
        (
            "another release",
            base(Some(Some(&older)), None, true, &nothing),
        ),
        (
            "another window",
            base(Some(Some(&core)), Some(&another), true, &nothing),
        ),
        (
            "no session",
            base(Some(Some(&core)), Some(&away), true, &nothing),
        ),
        (
            "not in the flight",
            base(Some(Some(&core)), Some(&before), true, &nothing),
        ),
        (
            "in a flight",
            base(Some(Some(&core)), Some(&flight), true, &nothing),
        ),
        (
            "another aircraft's file",
            base(Some(Some(&core)), Some(&flight), false, &nothing),
        ),
        (
            "Run, a lever with a crew and unsaved edits",
            Inputs {
                built: Some(&built),
                ..base(Some(Some(&core)), Some(&lever), true, &lever_run)
            },
        ),
        (
            "Run, an event, not building",
            Inputs {
                built: Some(&failed),
                ..base(Some(Some(&core)), Some(&event), true, &event_run)
            },
        ),
        (
            "Run, a counting entry, pilot flying only",
            base(Some(Some(&core)), Some(&counting), true, &counting_run),
        ),
        (
            "the picker",
            base(Some(Some(&core)), Some(&picking), true, &picker),
        ),
    ];
    let mut out = String::from(
        "// Written by the test `the_views_serve_sends_are_the_extensions_types` in\n\
         // tools/profile-builder/src/serve/tests/sim.rs, from views `serve` sends in its `dualInput/panel`,\n\
         // so tsc checks that each is a `ServerView` as panel/src/view.ts writes one. cargo test writes it\n\
         // again, so edit the test, not this file.\n\
         \n\
         import type { ServerView } from \"./bridge.ts\"\n\
         \n\
         export const VIEWS = {\n",
    );
    let mut kinds = Vec::new();
    for (name, inputs) in &views {
        let view = serde_json::to_value(panel_view(inputs)).expect("encodes");
        kinds.push((view["status"]["kind"].clone(), view["body"]["kind"].clone()));
        let text = serde_json::to_string_pretty(&view).expect("encodes");
        let indented = text.replace('\n', "\n  ");
        out.push_str(&format!("  {name:?}: {indented} satisfies ServerView,\n"));
    }
    out.push_str("}\n");
    assert_eq!(
        kinds,
        [
            ("not-running", "nothing"),
            ("other-release", "nothing"),
            ("other-window", "nothing"),
            ("no-session", "nothing"),
            ("not-in-flight", "nothing"),
            ("in-flight", "nothing"),
            ("in-flight", "nothing"),
            ("in-flight", "run"),
            ("in-flight", "run"),
            ("in-flight", "run"),
            ("in-flight", "picker"),
        ]
        .map(|(status, body)| (json!(status), json!(body)))
    );
    let file = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/apps/profile-extension/src/serve-views.test.ts");
    std::fs::write(file, out).expect("the extension's folder should be writable");
}
