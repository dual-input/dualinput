//! The clients crate driven through the kernel as the core's edge drives it: sockets' inputs
//! go in, and what it sends each socket comes out (record/areas/core/
//! 02-clients-and-panel-bridge.md, "Cases for the bench").

use std::collections::BTreeMap;

use clients::{Clients, ClientsUnit, SettingDef, SocketOut, SocketUp, Sockets};
use kernel::{
    CancelTimer, Cx, FIRST, Input, JOBS, Kernel, Output, Registry, SetTimer, SourceId, StartJob,
    TIMERS, TimerId, View, Work, first_input,
};
use messages::clients::{SettingKind, ToClient};
use serde::Deserialize;
use serde_json::{Value, json};

/// A test unit standing in for a feature, and for the profile loader.
#[derive(Default)]
struct Feature {
    counter: u32,
    profile: bool,
    panel_needed: bool,
}

#[derive(Deserialize)]
struct Bump {
    by: u32,
}

/// Names the test unit's source, whose input loads its profile, `[1]`, loads one that needs no
/// panel, `[2]`, or unloads it, `[0]`.
struct ProfileKey;

impl Feature {
    fn register(r: &mut Registry) {
        let mut me = r.unit::<Feature>("feature");
        me.source::<ProfileKey>(Feature::profile);
        me.client_state(
            "feature",
            |me: &Feature, _: &View| json!({ "counter": me.counter }),
        )
        .command("feature.bump", Feature::bump)
        .command("feature.news", Feature::news)
        .command("feature.read-setting", Feature::read_setting)
        .panel_module("feature-panel", Feature::rule, |view: &View| {
            view.read::<Feature>().panel_needed
        })
        .one_panel_module("feature-one", Feature::gns, |view: &View| {
            view.read::<Feature>().panel_needed
        })
        .client_messages("feature-panel", Feature::echo)
        .setting(
            "feature.loud",
            SettingDef {
                label: "Loud",
                kind: SettingKind::Bool,
                default: json!(false),
                part_only: false,
                development: false,
            },
        );
    }

    /// Stands in for the profile loader.
    fn profile(me: &mut Feature, input: &Input, cx: &mut Cx) {
        me.profile = input.bytes != [0];
        me.panel_needed = input.bytes == [1];
        if me.profile {
            clients::profile_loaded(cx);
        } else {
            clients::profile_unloaded(cx);
        }
    }

    /// Raises a one-time notification.
    fn news(_: &mut Feature, _: Value, cx: &mut Cx) -> Result<(), String> {
        clients::notify(
            cx,
            "news",
            clients::Notification::new(
                clients::Level::Information,
                "News",
                clients::Landing::Session,
            )
            .detail("A line under it")
            .about("0".repeat(32))
            .once(),
        );
        Ok(())
    }

    fn bump(me: &mut Feature, args: Bump, _: &mut Cx) -> Result<(), String> {
        me.counter += args.by;
        Ok(())
    }

    /// The case from the loop's design: a command's handler reads the clients crate's
    /// settings while the clients crate dispatches it.
    fn read_setting(_: &mut Feature, _: Value, cx: &mut Cx) -> Result<(), String> {
        match cx.read::<Clients>().setting_as::<bool>("feature.loud") {
            Some(true) => Ok(()),
            _ => Err("not loud".into()),
        }
    }

    /// Sends a panel module's message back to its own panel alone.
    fn echo(_: &mut Feature, from: clients::Sender, body: Value, cx: &mut Cx) {
        clients::send(cx, clients::To::Socket(from.socket), "feature-panel", &body);
    }

    fn rule(view: &View, instruments: &[String]) -> Vec<String> {
        if !view.read::<Feature>().profile {
            return Vec::new();
        }
        instruments
            .iter()
            .filter(|i| i.starts_with("PFD"))
            .cloned()
            .collect()
    }

    /// The one-panel module's rule, which picks no instrument the other tests' panels hold.
    fn gns(view: &View, instruments: &[String]) -> Vec<String> {
        if !view.read::<Feature>().profile {
            return Vec::new();
        }
        instruments
            .iter()
            .filter(|i| i.starts_with("GNS"))
            .cloned()
            .collect()
    }
}

struct Core {
    kernel: Kernel,
    sockets: SourceId,
    seq: u64,
    now: u64,
    timers: BTreeMap<(u64, TimerId), ()>,
    jobs: Vec<StartJob>,
}

const SECOND: u64 = 1_000_000;

impl Core {
    /// A core past its first input, whose job at start, the username's, has come back empty.
    fn new(settings: Option<&str>) -> (Core, Vec<SocketOut>) {
        let (mut core, outputs) = Core::start(settings);
        core.finish_jobs();
        (core, outputs)
    }

    /// A core past its first input, with its job at start still out.
    fn start(settings: Option<&str>) -> (Core, Vec<SocketOut>) {
        let mut registry = Registry::new();
        clients::register(&mut registry);
        Feature::register(&mut registry);
        let kernel = Kernel::new(registry);
        let sockets = kernel
            .source::<Sockets>()
            .expect("the clients crate takes the sockets");
        let files = vec![(
            "settings.json".to_string(),
            settings.map(|s| s.as_bytes().to_vec()),
        )];
        let mut core = Core {
            kernel,
            sockets,
            seq: 0,
            now: SECOND,
            timers: BTreeMap::new(),
            jobs: Vec::new(),
        };
        let outputs = core.handle(FIRST, first_input([1; 32], files));
        (core, outputs)
    }

    fn handle(&mut self, source: SourceId, bytes: Vec<u8>) -> Vec<SocketOut> {
        self.seq += 1;
        let outputs = self.kernel.handle(&Input {
            seq: self.seq,
            stamp: self.now,
            source,
            bytes,
        });
        self.carry(outputs)
    }

    fn carry(&mut self, outputs: Vec<Output>) -> Vec<SocketOut> {
        let mut out = Vec::new();
        for output in outputs {
            let value = output.into_value();
            let value = match value.downcast::<SetTimer>() {
                Ok(set) => {
                    self.timers.insert((set.due, set.id), ());
                    continue;
                }
                Err(value) => value,
            };
            let value = match value.downcast::<CancelTimer>() {
                Ok(cancel) => {
                    self.timers.retain(|(_, id), _| *id != cancel.id);
                    continue;
                }
                Err(value) => value,
            };
            let value = match value.downcast::<StartJob>() {
                Ok(job) => {
                    self.jobs.push(*job);
                    continue;
                }
                Err(value) => value,
            };
            if let Ok(socket) = value.downcast::<SocketOut>() {
                out.push(*socket);
            }
        }
        out
    }

    fn up(&mut self, up: SocketUp) -> Vec<SocketOut> {
        self.handle(self.sockets, up.encode())
    }

    fn say(&mut self, socket: u64, message: Value) -> Vec<SocketOut> {
        self.up(SocketUp::Text {
            socket,
            text: message.to_string(),
        })
    }

    fn join(&mut self, socket: u64, component: &str, instruments: &[&str]) -> Vec<SocketOut> {
        self.up(SocketUp::Opened { socket });
        self.say(
            socket,
            json!({ "t": "hello", "component": component, "version": messages::VERSION, "hash": messages::HASH, "instruments": instruments }),
        )
    }

    /// A cockpit panel's bridge says hello, naming its panel as the sim names it.
    fn join_panel(&mut self, socket: u64, panel: &str, instruments: &[&str]) -> Vec<SocketOut> {
        self.up(SocketUp::Opened { socket });
        self.say(
            socket,
            json!({ "t": "hello", "component": "panel-bridge", "version": messages::VERSION, "hash": messages::HASH, "panel": panel, "instruments": instruments }),
        )
    }

    /// Moves the clock to `to`, firing each timer due by then, in order.
    fn advance(&mut self, to: u64) -> Vec<SocketOut> {
        let mut out = Vec::new();
        while let Some((&(due, id), _)) = self.timers.iter().next() {
            if due > to {
                break;
            }
            self.timers.remove(&(due, id));
            self.now = due;
            out.extend(self.handle(TIMERS, id.fired()));
        }
        self.now = to;
        out
    }

    /// Finishes each job the clients crate started, as the edge would.
    fn finish_jobs(&mut self) -> Vec<Work> {
        let jobs = std::mem::take(&mut self.jobs);
        for job in &jobs {
            let bytes = job.id.finished(Ok(Vec::new()));
            self.handle(JOBS, bytes);
        }
        jobs.into_iter().map(|j| j.job.work).collect()
    }
}

/// Each message sent to `socket`, read.
fn to(socket: u64, outputs: &[SocketOut]) -> Vec<ToClient> {
    outputs
        .iter()
        .filter_map(|o| match o {
            SocketOut::Send { socket: s, text } if *s == socket => {
                Some(serde_json::from_str(text).expect("the core should send a ToClient"))
            }
            _ => None,
        })
        .collect()
}

fn answer(id: u32, error: Option<&str>) -> ToClient {
    ToClient::Answer {
        id,
        error: error.map(str::to_string),
    }
}

#[test]
fn a_client_gets_a_slice_at_once_then_at_most_once_a_round() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    let out = core.say(1, json!({ "t": "watch", "slices": ["feature"] }));
    assert_eq!(
        to(1, &out),
        [ToClient::State {
            slice: "feature".into(),
            value: json!({ "counter": 0 })
        }]
    );
    // Five changes between two rounds, each taken: the client hears of the last alone.
    for id in 0..5 {
        let out = core.say(
            1,
            json!({ "t": "command", "id": id, "name": "feature.bump", "args": { "by": 1 } }),
        );
        assert_eq!(to(1, &out), [answer(id, None)]);
    }
    let out = core.advance(core.now + 50_000);
    assert_eq!(
        to(1, &out),
        [ToClient::State {
            slice: "feature".into(),
            value: json!({ "counter": 5 })
        }]
    );
    let out = core.advance(core.now + 50_000);
    assert_eq!(to(1, &out), [], "an unchanged slice isn't sent again");
}

#[test]
fn a_command_no_unit_registered_answers_unknown_and_one_whose_arguments_dont_read_an_error() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    let out = core.say(
        1,
        json!({ "t": "command", "id": 7, "name": "nobody.knows", "args": {} }),
    );
    assert_eq!(to(1, &out), [answer(7, Some("unknown"))]);
    let out = core.say(
        1,
        json!({ "t": "command", "id": 8, "name": "feature.bump", "args": { "by": "two" } }),
    );
    let answers = to(1, &out);
    let [
        ToClient::Answer {
            id: 8,
            error: Some(error),
        },
    ] = answers.as_slice()
    else {
        panic!("the command should be answered with an error");
    };
    assert!(error.starts_with("its arguments didn't read"), "{error}");
}

#[test]
fn a_commands_handler_reads_the_settings_while_the_clients_crate_dispatches_it() {
    let (mut core, _) = Core::new(Some(r#"{ "feature.loud": true }"#));
    core.join(1, "efb-app", &[]);
    let out = core.say(
        1,
        json!({ "t": "command", "id": 1, "name": "feature.read-setting", "args": null }),
    );
    assert_eq!(to(1, &out), [answer(1, None)]);
}

/// A real job would open a window on the PC, so the job is checked here rather than on the bench.
#[test]
fn opening_our_discord_opens_the_link_the_core_holds_whatever_a_page_sends() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    core.finish_jobs();
    let out = core.say(1, json!({ "t": "command", "id": 1, "name": "clients.open-discord", "args": { "url": "https://example.com" } }));
    assert_eq!(to(1, &out), [answer(1, None)]);
    let jobs = core.finish_jobs();
    let [Work::OpenLink { url, app_url }] = jobs.as_slice() else {
        panic!("the command should open a link: {jobs:?}");
    };
    assert_eq!(url, messages::clients::DISCORD_INVITE);
    assert_eq!(app_url, messages::clients::DISCORD_APP_INVITE);
}

#[test]
fn a_settings_file_keeps_a_key_no_unit_registered_and_a_value_that_doesnt_fit_takes_its_default() {
    let (mut core, _) = Core::new(Some(r#"{ "feature.loud": "very", "gone.feature": 3 }"#));
    core.join(1, "desktop", &[]);
    let out = core.say(1, json!({ "t": "watch", "slices": ["settings"] }));
    let sent = to(1, &out);
    let [ToClient::State { value, .. }] = sent.as_slice() else {
        panic!("the settings should be sent at once");
    };
    let loud = value
        .as_array()
        .and_then(|settings| settings.iter().find(|s| s["key"] == "feature.loud"))
        .expect("the settings should list the feature's");
    assert_eq!(
        loud["value"],
        json!(false),
        "a stored value that doesn't fit takes the default"
    );
    let out = core.say(1, json!({ "t": "command", "id": 1, "name": "clients.set-setting", "args": { "key": "feature.loud", "value": true } }));
    assert_eq!(to(1, &out), [answer(1, None)]);
    let jobs = core.finish_jobs();
    let [Work::Write { path, bytes }] = jobs.as_slice() else {
        panic!("the change should write the file");
    };
    assert_eq!(path, "settings.json");
    let written: Value = serde_json::from_slice(bytes).expect("the file should be JSON");
    assert_eq!(written, json!({ "feature.loud": true, "gone.feature": 3 }));
    let out = core.say(1, json!({ "t": "command", "id": 2, "name": "clients.set-setting", "args": { "key": "feature.loud", "value": 1 } }));
    assert!(matches!(
        to(1, &out).as_slice(),
        [ToClient::Answer {
            id: 2,
            error: Some(_)
        }]
    ));
}

#[test]
fn the_core_slice_gives_the_version_the_hash_and_the_username_before_setup_is_done() {
    let (mut core, _) = Core::start(None);
    let job = core
        .jobs
        .pop()
        .expect("a core before setup reads the username");
    assert!(matches!(job.job.work, Work::Username));
    let bytes = job.id.finished(Ok(b"jordan".to_vec()));
    core.handle(JOBS, bytes);
    core.join(1, "efb-app", &[]);
    let out = core.say(1, json!({ "t": "watch", "slices": ["core", "settings"] }));
    let values = states(1, &out);
    assert_eq!(
        values[0],
        json!({ "version": messages::VERSION, "hash": messages::HASH, "username": "jordan" })
    );
    let keys: Vec<&str> = values[1]
        .as_array()
        .expect("the settings should be a list")
        .iter()
        .filter_map(|s| s["key"].as_str())
        .collect();
    assert!(keys.contains(&"app.setup-done") && keys.contains(&"app.guide-done"));

    let (core, _) = Core::start(Some(r#"{ "app.setup-done": true }"#));
    assert!(
        core.jobs.is_empty(),
        "a core past setup never reads the username, so its recordings never hold it"
    );
}

#[test]
fn a_message_that_doesnt_read_is_dropped_and_a_client_of_another_version_is_still_served() {
    let (mut core, _) = Core::new(None);
    core.up(SocketUp::Opened { socket: 1 });
    core.say(
        1,
        json!({ "t": "hello", "component": "efb-app", "version": "0.0.0", "hash": "another" }),
    );
    assert_eq!(
        core.up(SocketUp::Text {
            socket: 1,
            text: "{ not json".into()
        }),
        []
    );
    let out = core.say(
        1,
        json!({ "t": "command", "id": 3, "name": "feature.bump", "args": { "by": 1 } }),
    );
    assert_eq!(to(1, &out), [answer(3, None)]);
}

#[test]
fn the_core_says_alive_every_2s_and_closes_a_socket_quiet_for_8s() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    core.join(2, "banner", &[]);
    let out = core.advance_alive(core.now + 10 * SECOND, &[1]);
    assert!(
        out.contains(&SocketOut::Close {
            socket: 2,
            code: 1000
        }),
        "{out:?}"
    );
    assert!(
        !out.iter()
            .any(|o| matches!(o, SocketOut::Close { socket: 1, .. }))
    );
    assert_eq!(
        to(1, &out)
            .iter()
            .filter(|m| **m == ToClient::Alive)
            .count(),
        5
    );
}

#[test]
fn panels_get_their_modules_once_the_profile_loads_and_a_reloaded_panel_replaces_its_old_socket() {
    let (mut core, _) = Core::new(None);
    core.join_panel(1, "VCockpit01", &["PFD_1|", "MFD_1|"]);
    core.join_panel(2, "VCockpit02", &["CLOCK|"]);
    let out = core.handle_profile(true);
    assert_eq!(
        to(1, &out),
        [ToClient::Load {
            modules: vec![messages::clients::PanelModule {
                name: "feature-panel".into(),
                instruments: vec!["PFD_1|".into()]
            }]
        }]
    );
    assert_eq!(to(2, &out), [ToClient::None]);
    // Panel 1 reloads: its new socket names the same panel.
    let out = core.join_panel(3, "VCockpit01", &["PFD_1|", "MFD_1|"]);
    assert!(out.contains(&SocketOut::Close {
        socket: 1,
        code: 1000
    }));
    assert!(matches!(to(3, &out).as_slice(), [ToClient::Load { .. }]));
    let out = core.handle_profile(false);
    assert_eq!(
        to(3, &out),
        [ToClient::Stop {
            modules: vec!["feature-panel".into()]
        }]
    );
}

#[test]
fn a_unit_message_to_one_socket_reaches_that_panel_alone() {
    let (mut core, _) = Core::new(None);
    core.join_panel(1, "VCockpit01", &["PFD_1|"]);
    core.join_panel(2, "VCockpit02", &["PFD_2|"]);
    core.handle_profile(true);
    let out = core.say(
        2,
        json!({ "t": "unit", "unit": "feature-panel", "body": { "x": 1 } }),
    );
    let echo = ToClient::Unit {
        unit: "feature-panel".into(),
        body: json!({ "x": 1 }),
    };
    assert_eq!(to(2, &out), [echo]);
    assert_eq!(
        to(1, &out),
        [],
        "the other panel that loaded the module gets nothing"
    );
}

#[test]
fn a_settings_file_that_doesnt_read_is_never_written_over() {
    let (mut core, _) = Core::new(Some(r#"{ "feature.loud": true, "gone.feature": 3 "#));
    core.join(1, "desktop", &[]);
    let out = core.say(
        1,
        json!({ "t": "command", "id": 1, "name": "clients.set-setting", "args": { "key": "feature.loud", "value": true } }),
    );
    assert!(matches!(
        to(1, &out).as_slice(),
        [ToClient::Answer {
            id: 1,
            error: Some(_)
        }]
    ));
    assert!(
        core.finish_jobs().is_empty(),
        "no write of the file went out"
    );
}

#[test]
fn a_hello_whose_other_fields_dont_read_still_joins_on_its_component_version_and_hash() {
    let (mut core, _) = Core::new(None);
    core.up(SocketUp::Opened { socket: 1 });
    core.say(
        1,
        json!({ "t": "hello", "component": "efb-app", "version": "9.9.9", "hash": "another", "instruments": "not a list" }),
    );
    let out = core.say(
        1,
        json!({ "t": "command", "id": 2, "name": "feature.bump", "args": { "by": 1 } }),
    );
    assert_eq!(to(1, &out), [answer(2, None)]);
}

#[test]
fn two_panels_that_hold_instruments_of_one_key_both_keep_their_sockets() {
    let (mut core, _) = Core::new(None);
    // As the Black Square Baron's VCockpit66 and VCockpit67 each hold one keyed GNS_DISABLED.
    core.join_panel(1, "VCockpit66", &["GNS_DISABLED"]);
    let out = core.join_panel(2, "VCockpit67", &["GNS_DISABLED"]);
    assert!(
        !out.iter().any(|o| matches!(o, SocketOut::Close { .. })),
        "{out:?}"
    );
}

#[test]
fn a_one_panel_module_goes_to_one_of_two_panels_of_one_key_and_follows_it_through_a_reload() {
    let (mut core, _) = Core::new(None);
    core.join_panel(1, "VCockpit66", &["GNS_DISABLED"]);
    core.join_panel(2, "VCockpit67", &["GNS_DISABLED"]);
    let out = core.handle_profile(true);
    let one = ToClient::Load {
        modules: vec![messages::clients::PanelModule {
            name: "feature-one".into(),
            instruments: vec!["GNS_DISABLED".into()],
        }],
    };
    let one = std::slice::from_ref(&one);
    assert_eq!(to(1, &out), one);
    assert_eq!(to(2, &out), [ToClient::None]);
    // VCockpit66 reloads: its new socket names the same panel, and gets the module back.
    let out = core.join_panel(3, "VCockpit66", &["GNS_DISABLED"]);
    assert_eq!(to(3, &out), one);
    // VCockpit67 joins again, as for an instrument the sim created after its hello.
    let out = core.join_panel(4, "VCockpit67", &["GNS_DISABLED", "GNS_LATE"]);
    assert_eq!(to(4, &out), [ToClient::None]);
    core.handle_profile(false);
    let out = core.handle_profile(true);
    let holders = [3, 4]
        .into_iter()
        .filter(|&s| matches!(to(s, &out).as_slice(), [ToClient::Load { .. }]))
        .count();
    assert_eq!(holders, 1, "{out:?}");
}

#[test]
fn no_cockpit_panel_within_10s_of_the_profile_loading_raises_trouble_until_one_connects() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    core.say(1, json!({ "t": "watch", "slices": ["notifications"] }));
    core.handle_profile(true);
    let out = core.advance_alive(core.now + 10 * SECOND + 50_000, &[1]);
    let notifications = states(1, &out);
    assert_eq!(
        notifications
            .last()
            .map(|n| (n[0]["id"].clone(), n[0]["landing"].clone())),
        Some((json!("clients.no-panel"), json!("header")))
    );
    core.join_panel(2, "VCockpit02", &["CLOCK|"]);
    let out = core.advance(core.now + 50_000);
    assert_eq!(states(1, &out), [json!([])]);
}

#[test]
fn a_one_time_notification_goes_from_the_slice_after_its_10s_and_says_what_a_card_needs() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    core.say(1, json!({ "t": "watch", "slices": ["notifications"] }));
    core.say(
        1,
        json!({ "t": "command", "id": 1, "name": "feature.news", "args": null }),
    );
    let out = core.advance(core.now + 50_000);
    assert_eq!(
        states(1, &out),
        [
            json!([{ "id": "feature.news", "level": "information", "text": "News", "detail": "A line under it", "pilot": "0".repeat(32), "once": true, "landing": "session" }])
        ],
        "a flag that's off stays out of the JSON"
    );
    let out = core.advance_alive(core.now + 8 * SECOND, &[1]);
    assert_eq!(states(1, &out), Vec::<Value>::new(), "still up at 8s");
    let out = core.advance_alive(core.now + 4 * SECOND, &[1]);
    assert_eq!(states(1, &out), [json!([])], "gone by 12s");
}

#[test]
fn no_cockpit_panel_raises_no_trouble_under_a_profile_that_needs_none() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    core.say(1, json!({ "t": "watch", "slices": ["notifications"] }));
    let source = core
        .kernel
        .source::<ProfileKey>()
        .expect("the test unit takes its profile's input");
    core.handle(source, vec![2]);
    let out = core.advance_alive(core.now + 10 * SECOND + 50_000, &[1]);
    assert_eq!(states(1, &out), Vec::<Value>::new());
}

#[test]
fn the_banner_slice_says_whether_a_banner_pages_socket_is_open() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    let out = core.say(1, json!({ "t": "watch", "slices": ["banner"] }));
    assert_eq!(states(1, &out), [json!(false)]);
    core.join(2, "banner", &[]);
    let out = core.advance(core.now + 50_000);
    assert_eq!(states(1, &out), [json!(true)]);
    // A closed panel's page is gone while its socket stays open, so the banner is up until
    // the core closes that socket, 8s after its last message.
    let out = core.advance_alive(core.now + 10 * SECOND, &[1]);
    assert!(out.contains(&SocketOut::Close {
        socket: 2,
        code: 1000
    }));
    assert_eq!(states(1, &out), [json!(false)]);
}

#[test]
fn a_notification_clicked_outside_its_action_orders_the_efb_app_to_open_the_efb() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    core.join(2, "banner", &[]);
    // `feature.gone` isn't up, as when a notification clears as its click arrives, and the
    // EFB still opens where the click says, since the pilot asked to look.
    let out = core.say(
        2,
        json!({ "t": "command", "id": 4, "name": "clients.notification-clicked", "args": { "id": "feature.gone", "landing": "header" } }),
    );
    assert_eq!(to(2, &out), [answer(4, None)]);
    assert_eq!(
        to(1, &out),
        [ToClient::Unit {
            unit: "clients".into(),
            body: json!({ "t": "open-efb", "landing": "header", "id": "feature.gone" })
        }]
    );
    let out = core.say(
        2,
        json!({ "t": "command", "id": 6, "name": "clients.notification-clicked", "args": { "id": "feature.gone" } }),
    );
    assert!(matches!(
        to(2, &out).as_slice(),
        [ToClient::Answer {
            id: 6,
            error: Some(_)
        }]
    ));
    assert_eq!(
        to(1, &out),
        [],
        "a click that names no landing orders nothing"
    );
    let out = core.say(
        2,
        json!({ "t": "command", "id": 5, "name": "clients.notification-clicked", "args": null }),
    );
    assert!(matches!(
        to(2, &out).as_slice(),
        [ToClient::Answer {
            id: 5,
            error: Some(_)
        }]
    ));
    assert_eq!(
        to(1, &out),
        [],
        "a click whose arguments don't read orders nothing"
    );
}

/// The value of each `state` message sent to `socket`.
fn states(socket: u64, outputs: &[SocketOut]) -> Vec<Value> {
    to(socket, outputs)
        .into_iter()
        .filter_map(|m| match m {
            ToClient::State { value, .. } => Some(value),
            _ => None,
        })
        .collect()
}

#[test]
fn a_page_keeps_its_socket_through_12s_in_which_the_core_itself_stopped() {
    let (mut core, _) = Core::new(None);
    core.join(1, "efb-app", &[]);
    // The core stops for 12s: its timers fire only after, all at once, stamped late.
    core.now += 12 * SECOND;
    let mut out = Vec::new();
    while let Some((&(due, id), _)) = core.timers.iter().next() {
        if due > core.now {
            break;
        }
        core.timers.remove(&(due, id));
        out.extend(core.handle(TIMERS, id.fired()));
    }
    assert!(
        !out.iter().any(|o| matches!(o, SocketOut::Close { .. })),
        "{out:?}"
    );
    // The page's messages from those 12s come in now, and it goes on as before.
    core.say(1, json!({ "t": "alive" }));
    let out = core.advance_alive(core.now + 10 * SECOND, &[1]);
    assert!(
        !out.iter().any(|o| matches!(o, SocketOut::Close { .. })),
        "{out:?}"
    );
}

impl Core {
    /// Moves the clock to `to` a second at a time, with each of `sockets` saying `alive`
    /// each second, as a page does every 2s, and returns everything sent on the way.
    fn advance_alive(&mut self, to: u64, sockets: &[u64]) -> Vec<SocketOut> {
        let mut out = Vec::new();
        while self.now < to {
            out.extend(self.advance((self.now + SECOND).min(to)));
            for &socket in sockets {
                out.extend(self.say(socket, json!({ "t": "alive" })));
            }
        }
        out
    }

    /// Has the test unit load or unload its profile, as the profile loader would.
    fn handle_profile(&mut self, on: bool) -> Vec<SocketOut> {
        let source = self
            .kernel
            .source::<ProfileKey>()
            .expect("the test unit takes its profile's input");
        self.handle(source, vec![u8::from(on)])
    }
}
