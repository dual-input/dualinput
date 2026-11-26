//! Authoring, the feature that serves the profile extension's language server, `serve`, which
//! connects to the author's own core as a client: live values on the open files' `watch:` lines,
//! Run, which writes one entry with a value the author types, and the display picker's list of
//! panels and its outline in the sim (record/areas/profiles/04-the-extension-in-the-sim.md).
//!
//! It serves one `serve`, the last to connect whose `hello` carries this core's version, and acts
//! on what that one last sent while this pilot is in a session's flight. It watches through sim
//! variables, and writes through a sync engine of its own loaded from the open text, one that
//! runs only the writes it's asked for, so a Run takes the route a synced write takes, and only
//! state sync puts back a change the pilot flying owns.

mod live;
mod names;

use std::collections::BTreeMap;

use clients::{ClientJoined, ClientLeft, Clients, ClientsUnit, Sender};
use kernel::{Cx, JobId, Registry, TimerId, View};
use messages::authoring::{
    self as wire, AuthoringSlice, CockpitPanel, NAME, OUTLINE, Open, OpenBundle, OpenName, Outcome,
    Panel, RunResult, RunState, SessionProfile, Status, Watched, command,
};
use messages::clients::component::{PANEL_BRIDGE, PROFILE_EXTENSION};
use messages::profiles::PIN;
use messages::sync::Value;
use profile_engine::{Name, key_names};
use profile_loader::{ProfileLoaded, Profiles};
use session::{FlightChanged, Session, SessionEnded, SessionStarted};
use sim_service::{ANNOUNCE_EVERY, SimAwareness, SimEvent, SimService, SimUnit};
use sim_variables::{VariablesEvent, VariablesUnit};

use crate::live::Live;

/// Authoring's state.
#[derive(Default)]
pub struct Authoring {
    /// Each `profile-extension` client, by its socket.
    clients: BTreeMap<u64, Client>,
    /// How many have joined, which orders them, so the last to connect is served.
    joined: u64,
    /// Whether `outline`'s rule gives the module to every cockpit panel, as `clients` last heard.
    outlining: bool,
    /// What authoring watches and runs while it serves a client in this pilot's flight.
    live: Option<Live>,
    /// Each open cockpit panel, which the slice reads here, since a slice can't read `clients`.
    panels: Vec<PanelSeen>,
    /// The wait after authoring's latest recall of every cockpit panel, while the panels told
    /// `none` before it may still be coming back.
    recalling: Option<TimerId>,
    /// How many Runs the served clients have sent, which numbers each.
    runs: u32,
    last: Option<RunResult>,
}

/// A `profile-extension` client, and the last `authoring.open` and `authoring.panel` it sent,
/// which it keeps for its socket's life, so a session that starts after it connected, or another
/// window's leaving, starts from them.
struct Client {
    order: u64,
    /// The version its `hello` carries.
    version: String,
    window: Option<String>,
    names: Vec<OpenName>,
    bundle: Option<OpenBundle>,
    panel: Panel,
}

/// An open cockpit panel, as its `hello` names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PanelSeen {
    pub(crate) socket: u64,
    pub(crate) name: Option<String>,
    pub(crate) instruments: Vec<String>,
}

/// Registers authoring. Register it after sim variables, which its `on_variables` registers
/// with.
pub fn register(r: &mut Registry) {
    let mut me = r.unit::<Authoring>(NAME);
    me.on::<ClientJoined>(Authoring::joined)
        .on::<ClientLeft>(Authoring::left)
        .on::<FlightChanged>(|me, _, cx| me.refresh(cx))
        .on::<SessionStarted>(|me, _, cx| me.refresh(cx))
        .on::<SessionEnded>(|me, _, cx| me.refresh(cx))
        .on::<ProfileLoaded>(Authoring::profile_loaded)
        .on_sim(Authoring::on_sim)
        .on_variables(Authoring::on_variables)
        .command_from(command::OPEN, Authoring::open)
        .command_from(command::PANEL, Authoring::panel)
        .command_from(command::RUN, Authoring::run)
        // An author's tool needs no panel to exist, so a cockpit with none raises no trouble
        // for it.
        .panel_module(OUTLINE, Authoring::outline_rule, |_| false)
        .client_state(NAME, Authoring::slice);
}

impl Authoring {
    /// The client this core serves: the last to connect of those whose `hello` carries the
    /// core's version.
    fn served(&self) -> Option<u64> {
        self.clients
            .iter()
            .filter(|(_, c)| c.version == messages::VERSION)
            .max_by_key(|(_, c)| c.order)
            .map(|(&socket, _)| socket)
    }

    /// `outline`'s rule: every instrument of every cockpit panel while a client is served, so
    /// every panel stays, by decision 011's own rule, and the display picker lists them all
    /// (record/areas/profiles/04-the-extension-in-the-sim.md, "Every panel stays while the
    /// extension is connected").
    fn outline_rule(view: &View, instruments: &[String]) -> Vec<String> {
        if view.read::<Authoring>().served().is_some() {
            instruments.to_vec()
        } else {
            Vec::new()
        }
    }

    fn joined(me: &mut Authoring, joined: &ClientJoined, cx: &mut Cx) {
        if joined.component == PANEL_BRIDGE {
            me.panels_changed(cx);
            return;
        }
        if joined.component != PROFILE_EXTENSION {
            return;
        }
        me.joined += 1;
        if joined.version != messages::VERSION {
            tracing::info!(
                socket = joined.socket,
                version = joined.version,
                "a profile extension of another release connected, so authoring doesn't serve it"
            );
        }
        me.clients.insert(
            joined.socket,
            Client {
                order: me.joined,
                version: joined.version.clone(),
                window: None,
                names: Vec::new(),
                bundle: None,
                panel: Panel::Nothing,
            },
        );
        me.refresh(cx);
    }

    fn left(me: &mut Authoring, left: &ClientLeft, cx: &mut Cx) {
        if left.component == PANEL_BRIDGE {
            me.panels_changed(cx);
            if let Some(live) = me.live.as_mut() {
                live.panel_left(left.socket);
            }
            return;
        }
        if me.clients.remove(&left.socket).is_some() {
            me.refresh(cx);
        }
    }

    fn panels_changed(&mut self, cx: &Cx) {
        self.panels = cx
            .read::<Clients>()
            .cockpit_panels()
            .map(|p| PanelSeen {
                socket: p.socket,
                name: p.name.map(str::to_string),
                instruments: p.instruments.to_vec(),
            })
            .collect();
    }

    /// Brings `clients`' rule for `outline` and what authoring watches and runs up to date with
    /// the clients, the session, and this pilot's flight. Every change of those ends here.
    fn refresh(&mut self, cx: &mut Cx) {
        let served = self.served();
        if served.is_some() != self.outlining {
            self.outlining = served.is_some();
            tracing::info!(
                outlining = self.outlining,
                "authoring's rule for every cockpit panel changed"
            );
            clients::panel_rules_changed(cx);
            // A panel told `none` as the profile loaded closed its socket, and comes back on the
            // announcement's new count, which `unheld` gives one announcement period.
            if self.outlining && cx.read::<Session>().held() {
                sim_service::recall_panels(cx);
                if let Some(timer) = self.recalling.take() {
                    cx.cancel_timer(timer);
                }
                self.recalling = Some(cx.timer(ANNOUNCE_EVERY, |me: &mut Authoring, _, _| {
                    me.recalling = None;
                }));
            }
        }
        let session = cx.read::<Session>();
        let in_flight = session.me().is_some_and(|me| session.in_flight(&me));
        let want = served.filter(|_| in_flight);
        if self.live.as_ref().map(Live::socket) == want {
            return;
        }
        if let Some(live) = self.live.take() {
            live.end(cx);
        }
        if let Some(socket) = want
            && let Some(client) = self.clients.get(&socket)
        {
            tracing::info!(socket, "authoring serves a profile extension in the flight");
            let mut live = Live::start(socket, &client.names, cx);
            live.load(client.bundle.clone(), cx);
            live.panel(client.panel.clone(), &self.panels, cx);
            self.live = Some(live);
        }
    }

    /// The client that sent a command, when it's a `profile-extension` of this core's release.
    fn ours(&mut self, from: &Sender) -> Result<&mut Client, String> {
        if from.component != PROFILE_EXTENSION {
            return Err(
                "only the profile extension's language server sends authoring's commands".into(),
            );
        }
        let client = self
            .clients
            .get_mut(&from.socket)
            .ok_or("authoring hasn't heard this client's hello")?;
        if client.version != messages::VERSION {
            return Err(format!(
                "Dual Input is {} and this extension is {}, so update the one that's behind",
                messages::VERSION,
                client.version
            ));
        }
        Ok(client)
    }

    fn open(me: &mut Authoring, from: Sender, open: Open, cx: &mut Cx) -> Result<(), String> {
        let client = me.ours(&from)?;
        client.window = Some(open.window);
        client.names = open.names;
        let bundle = open.bundle;
        if bundle.is_some() {
            client.bundle.clone_from(&bundle);
        }
        let names = client.names.clone();
        if let Some(live) = me.live.as_mut().filter(|l| l.socket() == from.socket) {
            live.open(&names, cx);
            if bundle.is_some() {
                live.load(bundle, cx);
            }
        }
        Ok(())
    }

    fn panel(me: &mut Authoring, from: Sender, panel: Panel, cx: &mut Cx) -> Result<(), String> {
        let client = me.ours(&from)?;
        client.panel = panel.clone();
        if let Some(live) = me.live.as_mut().filter(|l| l.socket() == from.socket) {
            live.panel(panel, &me.panels, cx);
        }
        Ok(())
    }

    /// A Run, which the command's answer says only that the core took; its result, a refusal
    /// among them, shows in the slice.
    fn run(me: &mut Authoring, from: Sender, run: wire::Run, cx: &mut Cx) -> Result<(), String> {
        me.ours(&from)?;
        if me.served() != Some(from.socket) {
            return Err("another VS Code window has the sim".into());
        }
        me.runs += 1;
        let outcome = match me.live.as_mut() {
            Some(live) => live.run(me.runs, &run, cx),
            None => Outcome::Refused {
                why: "you're not in a session's flight".into(),
            },
        };
        tracing::info!(run = me.runs, entry = run.entry, ?outcome, "a Run");
        me.last = Some(RunResult {
            run: me.runs,
            entry: run.entry,
            outcome,
        });
        Ok(())
    }

    fn bundle_read(me: &mut Authoring, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        if let Some(live) = me.live.as_mut() {
            live.bundle_read(job, result, cx);
        }
    }

    /// The session's profile loaded, as at each save's reload in a test session, so the open
    /// text's bundle is checked against it again.
    fn profile_loaded(me: &mut Authoring, _: &ProfileLoaded, cx: &mut Cx) {
        if let Some(live) = me.live.as_mut() {
            live.profile_loaded(cx);
        }
    }

    fn on_variables(me: &mut Authoring, event: VariablesEvent, cx: &mut Cx) {
        if let Some(live) = me.live.as_mut() {
            live.got(&event, cx);
        }
    }

    /// The sim drew a frame, which carries on a Run's later steps and watches for its revert.
    /// Authoring's own connection carries only this subscription.
    fn on_sim(me: &mut Authoring, event: SimEvent, cx: &mut Cx) {
        let Some(live) = me.live.as_mut() else {
            return;
        };
        match event {
            SimEvent::Frame { call, .. } if call == live.frames() => {
                let Some((run, outcome)) = live.frame(cx) else {
                    return;
                };
                if let Some(last) = me.last.as_mut().filter(|l| l.run == run) {
                    tracing::info!(run, ?outcome, "a Run's value came back");
                    last.outcome = outcome;
                }
            }
            SimEvent::Lost => {
                tracing::info!("authoring's connection to the sim was lost and opens again");
            }
            _ => {}
        }
    }

    /// The slice `authoring`.
    fn slice(me: &Authoring, view: &View) -> AuthoringSlice {
        let client = me.served().and_then(|s| me.clients.get(&s));
        let live = me.live.as_ref();
        AuthoringSlice {
            window: client.and_then(|c| c.window.clone()),
            status: status(live, view),
            names: match (live, client) {
                (Some(live), _) => live
                    .names
                    .opened()
                    .iter()
                    .map(|o| Watched {
                        name: o.text.clone(),
                        got: match (live.names.shown(o), unheld(o.name.as_ref(), me, view)) {
                            (wire::Got::Waiting, Some(key)) => wire::Got::Error {
                                error: format!("no panel holds `{key}`"),
                            },
                            (got, _) => got,
                        },
                    })
                    .collect(),
                (None, Some(client)) => waiting(&client.names),
                (None, None) => Vec::new(),
            },
            run: match client.map(|c| &c.panel) {
                Some(Panel::Run { entry, .. }) => Some(RunState {
                    entry: entry.clone(),
                    seen: live.map_or(wire::Seen::Values { values: Vec::new() }, |l| l.seen(entry)),
                    preview: live
                        .and_then(Live::preview)
                        .cloned()
                        .unwrap_or(wire::Preview::Waiting),
                }),
                _ => None,
            },
            last: me.last.clone(),
            panels: match client.map(|c| &c.panel) {
                Some(Panel::Picker { .. }) => me
                    .panels
                    .iter()
                    .map(|p| CockpitPanel {
                        name: p.name.clone(),
                        instruments: p.instruments.clone(),
                    })
                    .collect(),
                _ => Vec::new(),
            },
        }
    }
}

/// The status line's facts.
fn status(live: Option<&Live>, view: &View) -> Status {
    let session = view.read::<Session>();
    let me = session.me();
    let pf = session.pf();
    let in_flight = me.is_some_and(|me| session.in_flight(&me));
    let aware = view.read::<SimAwareness>();
    let aircraft = aware.aircraft.as_ref().map(|a| a.path.clone());
    // The facts' title is of the aircraft they name, which the sim service reads after the load
    // that set `aircraft`, so a title the facts hold for the aircraft before shows as none.
    let title = view
        .read::<SimService>()
        .aircraft_facts()
        .filter(|f| {
            aware.stage.in_a_flight() && f.aircraft.as_ref().map(|a| &a.path) == aircraft.as_ref()
        })
        .and_then(|f| f.title.clone());
    Status {
        version: messages::VERSION.into(),
        session: session.held(),
        in_flight,
        aircraft,
        title,
        uncovered: in_flight && matches!(session.key(PIN), Some(None)),
        profile: view
            .read::<Profiles>()
            .loaded()
            .map(|loaded| SessionProfile {
                maker: loaded.shown.maker.clone(),
                name: loaded.shown.name.clone(),
                hash: messages::hex(&loaded.pin.hash),
                local: loaded.pin.local,
            }),
        crew: session.members().len() > 1,
        flying: me.is_some() && me == pf,
        pilot_flying: pf.map(|pf| session.name_of(&pf)),
        bundle: live.map_or_else(wire::BundleState::default, |l| l.bundle_state().clone()),
    }
}

/// The key of an `instrument()` no open panel's `hello` names, once every panel has been
/// answered, which `clients` does as the profile loads, and since every panel stays while a
/// client is served, every panel the cockpit has is open then. A panel told `none` before a
/// client was served comes back only once it hears the recall's announcement, and until its
/// `hello` arrives, a key it holds would read as no panel's, so the mark waits one announcement
/// period, 2s, after the latest recall.
fn unheld<'n>(name: Option<&'n Name>, me: &Authoring, view: &View) -> Option<&'n str> {
    let Some(Name::Instrument { key, .. }) = name else {
        return None;
    };
    if me.recalling.is_some() {
        return None;
    }
    let held = me
        .panels
        .iter()
        .any(|p| p.instruments.iter().any(|i| key_names(key, i)));
    (view.read::<Profiles>().loaded().is_some() && !held).then_some(key.as_str())
}

/// The names a client's open files name, each once, before this pilot is in the flight.
fn waiting(names: &[OpenName]) -> Vec<Watched> {
    let mut out: Vec<Watched> = Vec::new();
    for n in names {
        if !out.iter().any(|w| w.name == n.name) {
            out.push(Watched {
                name: n.name.clone(),
                got: wire::Got::Waiting,
            });
        }
    }
    out
}

/// A value as the slice and the commands carry it.
pub(crate) fn shown(value: &Value) -> wire::Value {
    match value {
        Value::Number(n) => wire::Value::Number(*n),
        Value::Text(t) => wire::Value::Text(t.clone()),
    }
}

pub(crate) fn value_of(value: &wire::Value) -> Value {
    match value {
        wire::Value::Number(n) => Value::Number(*n),
        wire::Value::Text(t) => Value::Text(t.clone()),
    }
}
