//! Joining and leaving: Host, Join, the join from the clipboard, Leave, and Quit; the session
//! file; a core that starts and finds one; and when the core exits
//! (record/areas/session/02-units.md, "Joining and leaving" and "The session file").

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use clients::{Clients, SettingChanged};
use kernel::{Cx, Exit, Job, JobId, TimerId};
use messages::backend::{Kind, Older, older};
use messages::hex;
use messages::net::{PilotId, Relay};
use messages::session::{
    self as wire, Attempt, Attempting, Join, MemberEntry, Preflight, Ready, Refused, RefusedWhy,
};
use network::{
    Answer, Asked, BackendAnswered, ConnectionRefused, EndpointBound, Me, Member, Mismatch,
    Network, Refusal,
};
use sim_service::SimAwareness;

use crate::file::{self, SessionFile};
use crate::store::Store;
use crate::{Held, Session, SessionEnded, SessionStarted, control, matching, preflight};

/// A pilot flying who leaves passes control as an ordinary handover, and closes this long
/// after, since a goodbye sent just before a close can be lost, and the leaving core writes
/// the new control value itself (record/areas/network/01-between-machines.md, "Leaving").
const CLOSE_AFTER_PASSING: Duration = Duration::from_secs(1);

/// Host or Join, waiting for the backend's answer.
pub(crate) enum Asking {
    Host { session: String, me: Me },
    Join { code: String, me: Me },
}

impl Asking {
    fn on(&self) -> Attempting {
        match self {
            Asking::Host { .. } => Attempting::Host,
            Asking::Join { .. } => Attempting::Join,
        }
    }

    fn code(&self) -> Option<String> {
        match self {
            Asking::Host { .. } => None,
            Asking::Join { code, .. } => Some(code.clone()),
        }
    }
}

impl Session {
    /// The Host or Join running on this PC, as the apps show it.
    pub(crate) fn attempt(&self) -> Option<Attempt> {
        if let Some(asking) = &self.asking {
            return Some(Attempt {
                on: asking.on(),
                dialing: false,
                code: asking.code(),
            });
        }
        self.held
            .as_ref()
            .filter(|h| h.attempting())
            .map(|h| Attempt {
                on: if h.opening {
                    Attempting::Host
                } else {
                    Attempting::Join
                },
                dialing: h.dialing,
                code: h.dialing.then(|| h.code.clone()),
            })
    }

    /// The session can't reach anyone, so it ends: a Host or Join stops there, and the start card
    /// says why. A core back from a restart has no start card waiting, so only its log says it.
    pub(crate) fn cannot_open(&mut self, cx: &mut Cx) {
        let Some(held) = &self.held else {
            return;
        };
        let on = if held.opening {
            Attempting::Host
        } else {
            Attempting::Join
        };
        tracing::warn!("the session's connection can't open, so the session ends");
        self.refused = Some(refused(on, RefusedWhy::NoConnection));
        self.leave(cx, false);
    }
}

/// A refusal with nothing to fill in.
fn refused(on: Attempting, why: RefusedWhy) -> Refused {
    Refused {
        on,
        why,
        theirs: None,
        yours: None,
        until: None,
    }
}

/// How the apps name what the backend refused. Two builds of one version, as only development
/// has, and a refusal the backend words itself, such as a signature it couldn't match, are
/// nothing a pilot can act on, so they read as our servers not working, with the cause in the log.
fn refused_by_backend(on: Attempting, refusal: &Refusal) -> Refused {
    let versions = |why, theirs: &String| Refused {
        theirs: Some(theirs.clone()),
        yours: Some(messages::VERSION.into()),
        ..refused(on, why)
    };
    match refusal {
        Refusal::NoSuchCode => refused(on, RefusedWhy::NoCode),
        Refusal::OtherVersion(Older::Mine, theirs) => versions(RefusedWhy::YouOlder, theirs),
        Refusal::OtherVersion(Older::Theirs, theirs) => versions(RefusedWhy::HostOlder, theirs),
        Refusal::TooManyWrongCodes(until) => Refused {
            until: Some(until.clone()),
            ..refused(on, RefusedWhy::TooMany)
        },
        Refusal::OtherHash | Refusal::Other(_) => refused(on, RefusedWhy::Servers),
    }
}

/// How the apps name what a crewmate's core refused: in the words of the backend's refusal for
/// the same difference, since the two stop one join. A close names no version, so it reads as two
/// builds of one version do.
fn refused_by_crew(why: &Mismatch) -> Refused {
    let refusal = match why {
        Mismatch::Code => Refusal::NoSuchCode,
        Mismatch::Version(Some(theirs)) => {
            Refusal::OtherVersion(older(messages::VERSION, theirs), theirs.clone())
        }
        Mismatch::Version(None) | Mismatch::Hash => Refusal::OtherHash,
    };
    refused_by_backend(Attempting::Join, &refusal)
}

/// The session file's write: the core opens its links only once the file holds what it last
/// wrote, so a core that crashes in between starts again under the restart count it saved.
#[derive(Default)]
pub(crate) struct FileState {
    writing: Option<JobId>,
    again: bool,
    opened: bool,
}

/// The name the crew sees, which Host and Join need.
fn name(cx: &Cx) -> Result<String, String> {
    let name = cx
        .read::<Clients>()
        .setting_as::<String>(wire::NAME)
        .unwrap_or_default();
    let name = name.trim();
    if name.is_empty() {
        return Err("Set the name your crew sees first".into());
    }
    Ok(name.to_string())
}

/// The color the pilot picked, by its place in the palette, or none while it's `automatic`.
fn color(cx: &Cx) -> Option<u8> {
    let color = cx
        .read::<Clients>()
        .setting_as::<String>(wire::COLOR)
        .unwrap_or_default();
    wire::PALETTE
        .iter()
        .position(|c| *c == color)
        .map(|at| at as u8)
}

/// The pilot changed their name or color: their entry says so at once, so the crew's names,
/// heads, and figures follow, and the session file keeps it for a core that restarts. An
/// emptied name keeps the last, since a member always has one.
pub(crate) fn setting_changed(me: &mut Session, changed: &SettingChanged, cx: &mut Cx) {
    if changed.key != wire::NAME && changed.key != wire::COLOR {
        return;
    }
    let (name, color) = (name(cx), color(cx));
    let Some(held) = &mut me.held else {
        return;
    };
    if let Ok(name) = name {
        held.name = name;
    }
    held.color = color;
    let entry = entry_of(held);
    me.write(wire::MEMBER, Some(&entry), cx);
    write_file(me, cx);
}

fn entry_of(held: &Held) -> MemberEntry {
    MemberEntry {
        name: held.name.clone(),
        color: held.color,
        kind: Kind::Crew,
        endpoint: network::endpoint_id(&held.key),
    }
}

fn me_now(cx: &Cx) -> Result<Me, String> {
    Ok(Me {
        pilot: cx.new_id().into_bytes(),
        name: name(cx)?,
        kind: Kind::Crew,
    })
}

fn free(me: &Session) -> Result<(), String> {
    if me.held.is_some() {
        return Err("You're already in a session".into());
    }
    if me.asking.is_some() {
        return Err("A session is already starting".into());
    }
    Ok(())
}

/// `session.host`: draws the session's ID and this pilot's, and asks the backend for a code.
pub(crate) fn host(me: &mut Session, (): (), cx: &mut Cx) -> Result<(), String> {
    free(me)?;
    let my = me_now(cx)?;
    let session = cx.new_id().to_string();
    tracing::info!(session, "this pilot hosts a session");
    // A refusal speaks of the attempt it refused, so the next attempt clears it.
    me.refused = None;
    me.asking = Some(Asking::Host {
        session: session.clone(),
        me: my.clone(),
    });
    network::host(cx, network::Host { session, me: my });
    Ok(())
}

/// `session.join`: draws this pilot's ID, and looks the code up.
pub(crate) fn join(me: &mut Session, args: Join, cx: &mut Cx) -> Result<(), String> {
    free(me)?;
    let code = args.code.trim().to_ascii_uppercase();
    if code.is_empty() {
        return Err("Enter the session's code".into());
    }
    let my = me_now(cx)?;
    tracing::info!(code, "this pilot joins a session");
    me.refused = None;
    me.asking = Some(Asking::Join {
        code: code.clone(),
        me: my.clone(),
    });
    network::join(cx, network::Join { code, me: my });
    Ok(())
}

/// `session.join-from-clipboard`: the EFB app's code box was selected, so the core reads the
/// clipboard as a job, which hands up only an invite code, and joins with it at once
/// (record/areas/recording/01-recording-and-bug-reports.md, "The clipboard").
pub(crate) fn join_from_clipboard(me: &mut Session, (): (), cx: &mut Cx) -> Result<(), String> {
    free(me)?;
    name(cx)?;
    me.clipboard = Some(cx.job(Job::invite_code(), clipboard_read));
    Ok(())
}

fn clipboard_read(me: &mut Session, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    if me.clipboard.take() != Some(job) {
        return;
    }
    match result.map(String::from_utf8) {
        Ok(Ok(code)) if !code.is_empty() => {
            if let Err(why) = join(me, Join { code }, cx) {
                tracing::info!(why, "the code on the clipboard didn't join");
            }
        }
        Ok(_) => tracing::info!("the clipboard holds no invite code"),
        Err(error) => tracing::warn!(error, "the clipboard couldn't be read"),
    }
}

/// `session.cancel`: stops the Host or Join running on this PC. No other pilot hears of it, since
/// the backend lists a joiner only at its first link, and a host whose code never reached anyone
/// lapses from the backend in 30 minutes.
pub(crate) fn cancel(me: &mut Session, (): (), cx: &mut Cx) -> Result<(), String> {
    if me.asking.take().is_some() {
        tracing::info!("this pilot cancelled while the backend hadn't answered");
        network::cancel(cx);
        me.settle(cx);
        return Ok(());
    }
    if me.held.as_ref().is_some_and(|h| h.attempting()) {
        tracing::info!("this pilot cancelled a Host or Join that hadn't finished");
        me.leave(cx, false);
        return Ok(());
    }
    Err("No Host or Join is running".into())
}

/// `session.copy-code`: the session card's Copy, which writes the invite code to the clipboard
/// as a job.
pub(crate) fn copy_code(me: &mut Session, (): (), cx: &mut Cx) -> Result<(), String> {
    let Some(held) = &me.held else {
        return Err("There's no session".into());
    };
    cx.job(
        Job::copy_text(held.code.clone()),
        |_: &mut Session, _: JobId, result: Result<Vec<u8>, String>, _: &mut Cx| {
            if let Err(error) = result {
                tracing::warn!(error, "the invite code couldn't be copied");
            }
        },
    );
    Ok(())
}

/// The backend answered Host, Join, or the network's own lookup after a restart.
pub(crate) fn answered(me: &mut Session, answered: &BackendAnswered, cx: &mut Cx) {
    match (answered.asked, &answered.answer) {
        (Asked::Host, Answer::Created { code }) => {
            let Some(Asking::Host { session, me: my }) = me.asking.take() else {
                return;
            };
            let relays = cx
                .read::<Clients>()
                .setting_as::<Vec<Relay>>(network::RELAYS)
                .unwrap_or_default();
            tracing::info!(code, "the session started with its code");
            start(
                me,
                session,
                code.clone(),
                my,
                0,
                relays,
                BTreeMap::new(),
                true,
                cx,
            );
        }
        (
            Asked::Join,
            Answer::Found {
                session,
                relays,
                crew,
            },
        ) => {
            let Some(Asking::Join { code, me: my }) = me.asking.take() else {
                return;
            };
            let crew = crew
                .iter()
                .filter_map(network::member)
                .filter(|m| m.pilot != my.pilot)
                .map(|m| (m.pilot, m.endpoint))
                .collect();
            tracing::info!(code, "the session the code names was found");
            start(
                me,
                session.clone(),
                code,
                my,
                0,
                relays.clone(),
                crew,
                false,
                cx,
            );
        }
        (Asked::Host | Asked::Join, Answer::Refused(why)) => {
            let Some(asking) = me.asking.take() else {
                return;
            };
            tracing::info!(?why, "the backend refused the session");
            me.refused = Some(refused_by_backend(asking.on(), why));
        }
        (Asked::Host | Asked::Join, Answer::NoAnswer(why)) => {
            let Some(asking) = me.asking.take() else {
                return;
            };
            tracing::warn!(why, "the backend didn't answer");
            // The network holds this answer for its check, so `internet` is what it found just
            // now.
            let offline = cx.read::<Network>().internet() == Some(false);
            let why = if offline {
                RefusedWhy::Offline
            } else {
                RefusedWhy::Servers
            };
            me.refused = Some(refused(asking.on(), why));
        }
        // The network looks the code up when no member answered a core back from a restart:
        // a session no member other than this core still holds is over. A core back alone has
        // no other member, and listed itself again as it opened, so its session is over only
        // once the code finds no session.
        (Asked::Check, answer) => {
            let mine = me.me();
            let alone = me.held.as_ref().is_some_and(|h| h.crew.is_empty());
            let still_held = match answer {
                Answer::Found { crew, .. } => {
                    alone
                        || crew
                            .iter()
                            .filter_map(network::member)
                            .any(|m| Some(m.pilot) != mine)
                }
                Answer::Refused(Refusal::NoSuchCode) => false,
                _ => true,
            };
            if !still_held {
                tracing::info!("no other member holds the session any more, so it ended");
                // A join still reaching the crew was found by a code that has since lapsed.
                if me.held.as_ref().is_some_and(|h| h.dialing) {
                    me.refused = Some(refused(Attempting::Join, RefusedWhy::NoCode));
                }
                me.leave(cx, false);
            }
        }
        _ => {}
    }
}

/// A connection was refused. A join still reaching the crew stops there, and the start card says
/// why. A session under way has no start card, so there the network's log holds it.
pub(crate) fn connection_refused(me: &mut Session, refused: &ConnectionRefused, cx: &mut Cx) {
    if !me.held.as_ref().is_some_and(|h| h.dialing) {
        return;
    }
    tracing::info!(why = ?refused.why, "a connection was refused, so the join stops");
    me.refused = Some(refused_by_crew(&refused.why));
    me.leave(cx, false);
}

/// The session's endpoint bound, so a Host has what it needs to show as a session.
pub(crate) fn endpoint_bound(me: &mut Session, _: &EndpointBound, _: &mut Cx) {
    if let Some(held) = &mut me.held {
        held.opening = false;
    }
}

/// The core started and found a session file: it raises the restart count, writes it, and
/// dials the crew it holds, as a late joiner, or with no crew, takes control as a host does
/// (record/areas/network/01-between-machines.md, "A session file after a long outage").
pub(crate) fn session_file(me: &mut Session, bytes: Option<&[u8]>, cx: &mut Cx) {
    let Some(bytes) = bytes else {
        return;
    };
    let Some(saved) = SessionFile::decode(bytes) else {
        return tracing::warn!("the session file didn't read, so no session continues");
    };
    let (Some(pilot), Some(key)) = (saved.pilot(), saved.key()) else {
        return tracing::warn!("the session file holds no pilot ID or key it can read");
    };
    let restart = saved.restart + 1;
    tracing::info!(
        code = saved.code,
        restart,
        "the core found a session file, so it comes back to the session"
    );
    let crew = saved.crew().into_iter().collect();
    let my = Me {
        pilot,
        name: saved.name.clone(),
        kind: Kind::Crew,
    };
    start_with(
        me,
        Start {
            session: saved.session,
            code: saved.code,
            me: my,
            color: saved.color,
            restart,
            key,
            relays: saved.relays,
            crew,
            host: false,
            run: saved.run,
        },
        cx,
    );
}

#[allow(clippy::too_many_arguments)]
fn start(
    me: &mut Session,
    session: String,
    code: String,
    my: Me,
    restart: u32,
    relays: Vec<Relay>,
    crew: BTreeMap<PilotId, messages::net::EndpointId>,
    host: bool,
    cx: &mut Cx,
) {
    let Some(key) = cx.read::<network::Network>().key() else {
        return tracing::error!("the backend answered, but the network holds no endpoint key");
    };
    let run = cx
        .read::<SimAwareness>()
        .run
        .map(|r| (r.process, r.created));
    start_with(
        me,
        Start {
            session,
            code,
            me: my,
            color: color(cx),
            restart,
            key,
            relays,
            crew,
            host,
            run,
        },
        cx,
    );
}

struct Start {
    session: String,
    code: String,
    me: Me,
    color: Option<u8>,
    restart: u32,
    key: [u8; 32],
    relays: Vec<Relay>,
    crew: BTreeMap<PilotId, messages::net::EndpointId>,
    host: bool,
    run: Option<(u32, u64)>,
}

/// The session starts for this core: its own keys, `SessionStarted`, the announcement, and
/// the session file, after which the network opens it.
fn start_with(me: &mut Session, start: Start, cx: &mut Cx) {
    // A core back from a restart returns to a session the pilot joined long ago, so it's no
    // attempt, whoever answers its dials.
    let dialing = !start.host && start.restart == 0 && !start.crew.is_empty();
    // A core back from a restart learns who flies from the crew's first message, and a file with
    // no crew has nobody to send one, so without this it would never set the session's aircraft.
    // A member leaves the file's crew only when it leaves the session, so no other member holds
    // it, and nobody else can fly. So the core takes control again, as a host does, and preflight
    // starts over: none in the air, and Ready again on the ground.
    let alone = start.restart > 0 && start.crew.is_empty();
    me.held = Some(Held {
        dialing,
        opening: start.host,
        id: start.session,
        code: start.code,
        me: start.me.pilot,
        name: start.me.name,
        color: start.color,
        restart: start.restart,
        key: start.key,
        relays: start.relays,
        store: Store::default(),
        control: None,
        others: BTreeMap::new(),
        left: BTreeSet::new(),
        crew: start.crew,
        flight: BTreeMap::new(),
        was_in: BTreeSet::new(),
        away: BTreeMap::new(),
        ended_seen: false,
        // A core flagged as restarted passes control on at the first message that reaches it
        // while it holds a control value, taking that message for the crew's. A core back alone
        // already holds the value it made, so the flag would hand control to the first joiner
        // already in the flight.
        restarted: start.restart > 0 && !alone,
        file: FileState::default(),
        run: start.run,
        countdown: None,
        hold: false,
        ground: None,
        leaving: None,
        joined: 0,
    });
    let entry = me.held.as_ref().map(entry_of);
    me.write(wire::MEMBER, entry.as_ref(), cx);
    me.write(wire::READY, Some(&Ready::default()), cx);
    matching::write_mine(me, cx);
    // The host is the pilot flying when a session starts, and so is a core back alone.
    if start.host || alone {
        if alone {
            tracing::info!("this core is back alone in its session, so it takes control again");
        }
        control::make(me, start.me.pilot, cx);
        me.write(wire::PREFLIGHT, Some(&Preflight::default()), cx);
    }
    cx.raise(SessionStarted);
    sim_service::announce(cx, true);
    sim_service::aircraft_awareness(cx, true);
    write_file(me, cx);
    me.settle(cx);
}

/// Writes the session file as the session stands, after which the first write opens the
/// network.
pub(crate) fn write_file(me: &mut Session, cx: &Cx) {
    let Some(held) = &mut me.held else {
        return;
    };
    if held.file.writing.is_some() {
        held.file.again = true;
        return;
    }
    let saved = SessionFile {
        session: held.id.clone(),
        code: held.code.clone(),
        pilot: hex(&held.me),
        name: held.name.clone(),
        color: held.color,
        restart: held.restart,
        run: held.run,
        key: hex(&held.key),
        relays: held.relays.clone(),
        crew: held
            .crew
            .iter()
            .map(|(pilot, endpoint)| (hex(pilot), hex(endpoint)))
            .collect(),
    };
    held.file.writing = Some(cx.job(Job::write(file::NAME, saved.encode()), file_written));
}

fn file_written(me: &mut Session, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    if me.delete_after.take_if(|j| *j == job).is_some() {
        // A session started since then writes the file itself.
        if me.held.is_none() {
            delete_file(cx);
        }
        return;
    }
    let Some(held) = &mut me.held else {
        return;
    };
    if held.file.writing != Some(job) {
        return;
    }
    held.file.writing = None;
    if let Err(error) = result {
        tracing::error!(error, "the session file didn't write");
        // The first write opens the links, so they stay shut without it.
        if !held.file.opened {
            me.cannot_open(cx);
        }
        return;
    }
    if !held.file.opened {
        held.file.opened = true;
        let open = network::Open {
            code: held.code.clone(),
            me: Me {
                pilot: held.me,
                name: held.name.clone(),
                kind: Kind::Crew,
            },
            restart: held.restart,
            key: held.key,
            relays: held.relays.clone(),
            crew: held
                .crew
                .iter()
                .map(|(&pilot, &endpoint)| Member {
                    pilot,
                    restart: 0,
                    endpoint,
                })
                .collect(),
        };
        network::open(cx, open);
    }
    if std::mem::take(&mut held.file.again) {
        write_file(me, cx);
    }
}

impl Session {
    /// Leave: un-readies during preflight, passes control if this pilot holds it, and closes
    /// each connection, 1s after a pass, as `network::leave` orders it.
    pub(crate) fn leave(&mut self, cx: &mut Cx, quit: bool) {
        let Some(held) = &mut self.held else {
            self.asking = None;
            if quit {
                exit(cx);
            }
            return;
        };
        if let Some((_, quitting)) = &mut held.leaving {
            *quitting |= quit;
            return;
        }
        tracing::info!(quit, "this pilot leaves the session");
        if matches!(
            self.preflight().phase,
            wire::Phase::Running | wire::Phase::Countdown
        ) {
            preflight::unready(self, "this pilot leaves the session", cx);
        }
        // Before preflight ends, control goes to the other member even out of the flight, so
        // someone remains to finish preflight; after, nobody in the flight ends the session.
        let anyone = self.preflight().phase != wire::Phase::Ended;
        if control::pass_on(self, anyone, cx) {
            let timer = cx.timer(
                CLOSE_AFTER_PASSING,
                |me: &mut Session, timer: TimerId, cx| {
                    let Some(quit) = me
                        .held
                        .as_ref()
                        .and_then(|h| h.leaving)
                        .filter(|(t, _)| *t == timer)
                        .map(|(_, quit)| quit)
                    else {
                        return;
                    };
                    me.close(cx, quit);
                },
            );
            if let Some(held) = &mut self.held {
                held.leaving = Some((timer, quit));
            }
        } else {
            self.close(cx, quit);
        }
    }

    /// Quit, from any client: leaves the session if one is held, says `bye`, and exits.
    pub(crate) fn quit(&mut self, cx: &mut Cx) {
        tracing::info!("this pilot quits Dual Input");
        self.quitting = true;
        self.leave(cx, true);
    }

    fn close(&mut self, cx: &mut Cx, quit: bool) {
        network::leave(cx, quit);
        self.end(cx);
        if quit {
            exit(cx);
        }
    }

    /// The session ended for this core: its hold, its awareness of the aircraft, and its
    /// file go, and the core says so.
    fn end(&mut self, cx: &mut Cx) {
        preflight::set_hold(self, false, cx);
        let Some(held) = self.held.take() else {
            return;
        };
        if let Some(timer) = held.countdown {
            cx.cancel_timer(timer);
        }
        tracing::info!(code = held.code, "the session ended for this core");
        // The pool runs jobs at once, so a delete started beside a write still running, such
        // as the one a member's leave starts in the same input, could land first, and the
        // write's rename would put the file back for the next start to find.
        match held.file.writing {
            Some(write) => self.delete_after = Some(write),
            None => delete_file(cx),
        }
        sim_service::aircraft_awareness(cx, false);
        sim_service::announce(cx, false);
        crate::members::clear_notifications(&held, cx);
        cx.raise(SessionEnded);
        self.settle(cx);
    }
}

/// The core exits once the sim has closed and no session is held, whatever the desktop app has
/// open (record/areas/session/02-units.md, its note on the desktop app). A core that started with
/// no sim waits for one, so only a sim that ran and closed counts.
pub(crate) fn check_exit(me: &mut Session, cx: &mut Cx) {
    if me.held.is_some() || me.asking.is_some() || me.quitting {
        return;
    }
    let awareness = cx.read::<SimAwareness>();
    if awareness.stage != messages::sim::Stage::Closed || awareness.ended.is_none() {
        return;
    }
    tracing::info!("the sim closed and no session is held, so the core exits");
    me.quitting = true;
    exit(cx);
}

fn delete_file(cx: &Cx) {
    cx.job(
        Job::delete(file::NAME),
        |_: &mut Session, _: JobId, result: Result<Vec<u8>, String>, _: &mut Cx| {
            if let Err(error) = result {
                tracing::warn!(error, "the session file couldn't be deleted");
            }
        },
    );
}

/// Says `bye` to every client, so the apps tell this exit from a crash, and puts out the
/// exit.
fn exit(cx: &Cx) {
    clients::bye(cx);
    cx.out(Exit);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_names_whose_version_is_older_and_when_the_pause_ends() {
        let you_older = refused_by_backend(
            Attempting::Join,
            &Refusal::OtherVersion(Older::Mine, "0.3.0".into()),
        );
        assert_eq!(you_older.why, RefusedWhy::YouOlder);
        assert_eq!(you_older.theirs.as_deref(), Some("0.3.0"));
        assert_eq!(you_older.yours.as_deref(), Some(messages::VERSION));
        let host_older = refused_by_backend(
            Attempting::Join,
            &Refusal::OtherVersion(Older::Theirs, "0.1.0".into()),
        );
        assert_eq!(host_older.why, RefusedWhy::HostOlder);
        let too_many = refused_by_backend(
            Attempting::Join,
            &Refusal::TooManyWrongCodes("2026-11-01T15:00:00.000Z".into()),
        );
        assert_eq!(too_many.why, RefusedWhy::TooMany);
        assert_eq!(too_many.until.as_deref(), Some("2026-11-01T15:00:00.000Z"));
    }

    #[test]
    fn a_refusal_no_pilot_can_act_on_reads_as_our_servers() {
        for refusal in [Refusal::OtherHash, Refusal::Other("bad signature".into())] {
            assert_eq!(
                refused_by_backend(Attempting::Host, &refusal).why,
                RefusedWhy::Servers
            );
        }
    }

    #[test]
    fn a_refused_connection_takes_the_words_of_the_backends_refusal() {
        assert_eq!(refused_by_crew(&Mismatch::Code).why, RefusedWhy::NoCode);
        let newer = refused_by_crew(&Mismatch::Version(Some("99.0.0".into())));
        assert_eq!(newer.why, RefusedWhy::YouOlder);
        assert_eq!(newer.theirs.as_deref(), Some("99.0.0"));
        assert_eq!(newer.yours.as_deref(), Some(messages::VERSION));
        assert_eq!(
            refused_by_crew(&Mismatch::Version(Some("0.0.0".into()))).why,
            RefusedWhy::HostOlder
        );
        for why in [Mismatch::Version(None), Mismatch::Hash] {
            assert_eq!(refused_by_crew(&why).why, RefusedWhy::Servers);
        }
    }
}
