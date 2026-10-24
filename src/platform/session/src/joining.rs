//! Joining and leaving: Host, Join, the join from the clipboard, Leave, and Quit; the session
//! file; a core that starts and finds one; and when the core exits
//! (record/areas/session/02-units.md, "Joining and leaving" and "The session file").

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use clients::{ClientJoined, ClientLeft, Clients, Level};
use kernel::{Cx, Exit, Job, JobId, TimerId};
use messages::backend::{Kind, Older};
use messages::clients::component;
use messages::hex;
use messages::net::{PilotId, Relay};
use messages::session::{self as wire, Join, MemberEntry, Preflight, Ready};
use network::{Answer, Asked, BackendAnswered, Me, Member, Refusal};
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
    clients::clear_notification(cx, "refused");
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
    clients::clear_notification(cx, "refused");
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
            let code = match me.asking.take() {
                Some(Asking::Join { code, .. }) => code,
                _ => String::new(),
            };
            let text = match why {
                Refusal::NoSuchCode => format!("No session has the code {code}"),
                Refusal::OtherVersion(Older::Mine) => "Your Dual Input is older than the session's. Update Dual Input, then join again".into(),
                Refusal::OtherVersion(Older::Theirs) => "The session runs an older Dual Input than yours. Its host updates Dual Input and starts a new session".into(),
                Refusal::OtherHash => "The session runs another build of Dual Input".into(),
                Refusal::TooManyWrongCodes => "Too many wrong codes came from this connection. Wait an hour, then try again".into(),
                Refusal::Other(words) => format!("The backend refused: {words}"),
            };
            tracing::info!(text, "the backend refused the session");
            clients::notify(cx, "refused", Level::Warning, &text, None);
        }
        (Asked::Host | Asked::Join, Answer::NoAnswer(why)) => {
            me.asking = None;
            tracing::warn!(why, "the backend didn't answer");
            clients::notify(
                cx,
                "refused",
                Level::Warning,
                "Dual Input's server didn't answer. Check your connection, then try again",
                None,
            );
        }
        // The network looks the code up when no member answered a core back from a restart:
        // a session no member other than this core still holds is over.
        (Asked::Check, answer) => {
            let mine = me.me();
            let held_by_others = match answer {
                Answer::Found { crew, .. } => crew
                    .iter()
                    .filter_map(network::member)
                    .any(|m| Some(m.pilot) != mine),
                Answer::Refused(Refusal::NoSuchCode) => false,
                _ => true,
            };
            if !held_by_others {
                tracing::info!("no other member holds the session any more, so it ended");
                me.leave(cx, false);
            }
        }
        _ => {}
    }
}

/// The core started and found a session file: it raises the restart count, writes it, and
/// dials the crew it holds, as a late joiner (record/areas/network/01-between-machines.md, "A
/// session file after a long outage").
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
    me.held = Some(Held {
        id: start.session,
        code: start.code,
        me: start.me.pilot,
        name: start.me.name.clone(),
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
        ended_seen: false,
        restarted: start.restart > 0,
        file: FileState::default(),
        run: start.run,
        countdown: None,
        hold: false,
        ground: None,
        leaving: None,
        joined: 0,
    });
    let entry = MemberEntry {
        name: start.me.name,
        kind: Kind::Crew,
        endpoint: network::endpoint_id(&start.key),
    };
    me.write(wire::MEMBER, Some(&entry), cx);
    me.write(wire::READY, Some(&Ready::default()), cx);
    matching::write_mine(me, cx);
    // The host is the pilot flying when a session starts.
    if start.host {
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
        return tracing::error!(
            error,
            "the session file didn't write, so the session's links stay shut"
        );
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

pub(crate) fn client_joined(me: &mut Session, joined: &ClientJoined, cx: &mut Cx) {
    if joined.component == component::DESKTOP {
        me.desktops.insert(joined.socket);
    }
    me.settle(cx);
}

pub(crate) fn client_left(me: &mut Session, left: &ClientLeft, cx: &mut Cx) {
    me.desktops.remove(&left.socket);
    me.settle(cx);
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

/// The core exits once the sim has closed, no session is held, and no desktop app is
/// connected (record/areas/architecture/01-spine.md, "What moves them"). A core that started
/// with no sim waits for one, so only a sim that ran and closed counts.
pub(crate) fn check_exit(me: &mut Session, cx: &mut Cx) {
    if me.held.is_some() || me.asking.is_some() || me.quitting || !me.desktops.is_empty() {
        return;
    }
    let awareness = cx.read::<SimAwareness>();
    if awareness.stage != messages::sim::Stage::Closed || awareness.ended.is_none() {
        return;
    }
    tracing::info!(
        "the sim closed, no session is held, and no desktop app is connected, so the core exits"
    );
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
