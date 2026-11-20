//! The network's requests to the backend: a host's code, a joiner's lookup, each member's
//! entry and its renewal every 10 minutes, a leave, and the lookup a core back from a restart
//! makes when no member answers it (record/areas/network/02-units.md, "Requests the session
//! crate makes").
//!
//! Every request but a lookup is signed with the session's endpoint key, which the network
//! draws at Host or Join. Ed25519 signing reads neither a clock nor randomness, so it runs on
//! the loop and a replay signs the same bytes again.

use std::time::Duration;

use clients::Clients;
use ed25519_dalek::{Signer, SigningKey};
use kernel::{Cx, Fetch, Fetched, Job, JobId, Method, Moment, TimerId};
use messages::backend::{
    Created, ENDPOINT_HEADER, Entry, Kind, LEAVE, LOOKUP, Leave, LookedUp, Lookup, MEMBERS,
    NewSession, Older, Refused, Renew, SESSIONS, SIGNATURE_HEADER,
};
use messages::net::{EndpointId, PilotId, Relay};
use messages::{hex, unhex};
use serde::Serialize;

use crate::{Member, Network};

/// The setting that holds the relays a session this core hosts runs through, whose default
/// each release compiles in from src/relays/relays.toml.
pub const RELAYS: &str = "network.relays";
/// The development setting that sends everything through the relays, which two cores on one
/// PC need to cross a relay at all (record/areas/network/01-between-machines.md, "Two cores
/// on one PC").
pub const RELAYS_ONLY: &str = "network.relays-only";
/// The development setting that names the backend, which the bench points at its own.
pub const BACKEND: &str = "network.backend";
/// The backend every release talks to. The Worker's route in src/backend/wrangler.jsonc names the
/// same host, so change both together.
pub(crate) const BACKEND_URL: &str = "https://api.dualinput.app";

include!(concat!(env!("OUT_DIR"), "/relays.rs"));

/// The relays each release compiles in, which the relay list's setting starts as.
pub(crate) fn default_relays() -> Vec<Relay> {
    DEFAULT_RELAYS
        .iter()
        .map(|&(url, token, cap)| Relay {
            url: url.into(),
            token: token.into(),
            cap,
        })
        .collect()
}

const ANSWER_WITHIN: Duration = Duration::from_secs(10);
pub(crate) const RENEW_EVERY: Duration = Duration::from_secs(10 * 60);
/// A core back from a restart dials the crew in its session file, and looks the code up
/// only when none of them has answered by then.
const CHECK_AFTER: Duration = Duration::from_secs(10);

/// This core's pilot as the session crate gives them, which the network makes a member entry
/// of with the endpoint ID.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Me {
    pub pilot: PilotId,
    pub name: String,
    pub kind: Kind,
}

/// Asks the backend for a code for a session this core hosts.
pub struct Host {
    pub session: String,
    pub me: Me,
}

/// Looks an invite code up.
pub struct Join {
    pub code: String,
    pub me: Me,
}

/// Which request an answer is to: the session crate's Host or Join, or the network's own
/// check after a restart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Asked {
    Host,
    Join,
    Check,
}

/// The backend answered, or didn't within 10s.
pub struct BackendAnswered {
    pub asked: Asked,
    pub answer: Answer,
}

impl Moment for BackendAnswered {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Answer {
    Created {
        code: String,
    },
    /// The session, with each member renewed within the last 30 minutes.
    Found {
        session: String,
        relays: Vec<Relay>,
        crew: Vec<Entry>,
    },
    Refused(Refusal),
    /// No answer within 10s, or a fetch that got none.
    NoAnswer(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    NoSuchCode,
    /// The session's host runs another version, whose is older, and the host's version.
    OtherVersion(Older, String),
    OtherHash,
    /// When the next hour begins, in UTC, and its wrong codes count from none.
    TooManyWrongCodes(String),
    /// Any other answer, such as a signature the backend refused, in its words.
    Other(String),
}

/// The endpoint ID a session's endpoint key gives: the public half of the key, as iroh's
/// endpoint ID is its secret key's Ed25519 public key.
pub fn endpoint_id(key: &[u8; 32]) -> EndpointId {
    SigningKey::from_bytes(key).verifying_key().to_bytes()
}

/// A member entry's pilot ID and endpoint ID, as `open` takes a crew member, or `None` for
/// an entry whose hex doesn't read. A member's restart count comes only with its first
/// message, so it starts at 0.
pub fn member(entry: &Entry) -> Option<Member> {
    Some(Member {
        pilot: unhex(&entry.pilot)?,
        restart: 0,
        endpoint: unhex(&entry.endpoint)?,
    })
}

/// What each of the network's jobs is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum JobFor {
    Ask(Asked),
    Renew,
    Leave,
}

#[derive(Default)]
pub(crate) struct Backend {
    /// The session's endpoint key, drawn at Host or Join, which the session crate writes into
    /// its session file. A `SigningKey` holds its public half, so a signed request costs one
    /// curve multiplication, the signature's, where working the public half out again for the
    /// entry and the header would make three, a third of a joiner's first `LinkUp` on an
    /// unoptimized build (measured, 2026-10-23, record/areas/session/log.md, "2026-10-23: An
    /// unoptimized bench build sat close enough to a handler's 1ms for a pause of the PC's to
    /// cross it, so the bench builds optimized").
    pub(crate) key: Option<SigningKey>,
    pub(crate) me: Option<Me>,
    /// Whether the backend lists this core's entry: a host's is listed with its code, and
    /// any other core posts its own at its first `LinkUp`.
    pub(crate) listed: bool,
    pub(crate) relays: Vec<Relay>,
    asking: Option<(Asked, JobId, TimerId)>,
    pub(crate) jobs: Vec<(JobId, JobFor)>,
    pub(crate) renew: Option<TimerId>,
    pub(crate) check: Option<TimerId>,
}

/// Asks the backend for a code for the session this core hosts, answering in
/// `BackendAnswered`.
pub fn host(cx: &Cx, host: Host) {
    cx.call(Network::host, host);
}

/// Looks a code up, answering in `BackendAnswered`.
pub fn join(cx: &Cx, join: Join) {
    cx.call(Network::join, join);
}

/// Stops waiting for the backend's answer to Host or Join, so `BackendAnswered` doesn't come.
pub fn cancel(cx: &Cx) {
    cx.call(Network::cancel_ask, ());
}

impl Network {
    /// The session's endpoint key, once Host or Join drew it.
    pub fn key(&self) -> Option<[u8; 32]> {
        self.backend.key.as_ref().map(SigningKey::to_bytes)
    }

    fn host(me: &mut Network, host: Host, cx: &mut Cx) {
        let key = SigningKey::from_bytes(&cx.random_bytes::<32>());
        let body = NewSession {
            session: host.session,
            relays: cx
                .read::<Clients>()
                .setting_as::<Vec<Relay>>(RELAYS)
                .unwrap_or_default(),
            host: entry(&host.me, &key),
            version: messages::VERSION.into(),
            hash: messages::HASH.into(),
        };
        tracing::info!("the network asks the backend for a code");
        me.ask(Asked::Host, SESSIONS, &body, Some(&key), cx);
        me.backend.key = Some(key);
    }

    fn join(me: &mut Network, join: Join, cx: &mut Cx) {
        me.backend.key = Some(SigningKey::from_bytes(&cx.random_bytes::<32>()));
        tracing::info!("the network looks an invite code up");
        me.look_up(Asked::Join, join.code.to_ascii_uppercase(), cx);
    }

    fn look_up(&mut self, asked: Asked, code: String, cx: &Cx) {
        let body = Lookup {
            code,
            version: messages::VERSION.into(),
            hash: messages::HASH.into(),
        };
        self.ask(asked, LOOKUP, &body, None, cx);
    }

    /// Sends a request whose answer the session crate waits for, in place of any it was
    /// still waiting for.
    fn ask(
        &mut self,
        asked: Asked,
        path: &str,
        body: &impl Serialize,
        key: Option<&SigningKey>,
        cx: &Cx,
    ) {
        if let Some((_, job, timer)) = self.backend.asking.take() {
            cx.cancel_job(job);
            cx.cancel_timer(timer);
            self.backend.jobs.retain(|(j, _)| *j != job);
        }
        let job = self.post(path, body, key, JobFor::Ask(asked), cx);
        let timer = cx.timer(ANSWER_WITHIN, Network::no_answer);
        self.backend.asking = Some((asked, job, timer));
    }

    fn post(
        &mut self,
        path: &str,
        body: &impl Serialize,
        key: Option<&SigningKey>,
        purpose: JobFor,
        cx: &Cx,
    ) -> JobId {
        let body = serde_json::to_vec(body).expect("serde_json should write a backend request");
        let mut headers = vec![("content-type".into(), "application/json".into())];
        if let Some(key) = key {
            headers.push((ENDPOINT_HEADER.into(), hex(&key.verifying_key().to_bytes())));
            headers.push((SIGNATURE_HEADER.into(), hex(&key.sign(&body).to_bytes())));
        }
        let fetch = Fetch {
            method: Method::Post,
            url: format!("{}{path}", backend_url(cx)),
            headers,
            body,
            keep: Vec::new(),
        };
        let job = cx.job(Job::fetch(fetch), Network::job_done);
        self.backend.jobs.push((job, purpose));
        job
    }

    fn no_answer(me: &mut Network, timer: TimerId, cx: &mut Cx) {
        let Some((asked, job, _)) = me.backend.asking.take_if(|(_, _, t)| *t == timer) else {
            return;
        };
        cx.cancel_job(job);
        me.backend.jobs.retain(|(j, _)| *j != job);
        tracing::warn!(?asked, "the backend didn't answer within 10s");
        let answer = Answer::NoAnswer("the backend didn't answer within 10s".into());
        me.answered(asked, answer, cx);
    }

    fn cancel_ask(me: &mut Network, (): (), cx: &mut Cx) {
        if let Some((_, job, timer)) = me.backend.asking.take() {
            cx.cancel_job(job);
            cx.cancel_timer(timer);
            me.backend.jobs.retain(|(j, _)| *j != job);
        }
        me.drop_held_answer();
    }

    /// Tells the session crate how the backend answered, once a check has found what this PC
    /// reaches when it gave a Host or a Join no answer.
    fn answered(&mut self, asked: Asked, answer: Answer, cx: &Cx) {
        let answered = BackendAnswered { asked, answer };
        if asked != Asked::Check && matches!(answered.answer, Answer::NoAnswer(_)) {
            self.hold_for_reach(answered, cx);
        } else {
            cx.raise(answered);
        }
    }

    fn job_done(me: &mut Network, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        let Some(at) = me.backend.jobs.iter().position(|(j, _)| *j == job) else {
            return;
        };
        let (_, purpose) = me.backend.jobs.remove(at);
        let fetched = result.and_then(|bytes| {
            Fetched::decode(&bytes).ok_or_else(|| "a fetch's result didn't read".to_string())
        });
        match purpose {
            JobFor::Ask(asked) => {
                if let Some((_, _, timer)) = me.backend.asking.take() {
                    cx.cancel_timer(timer);
                }
                let answer = answer(asked, fetched);
                if asked == Asked::Host && matches!(answer, Answer::Created { .. }) {
                    me.backend.listed = true;
                }
                tracing::info!(?asked, ?answer, "the backend answered");
                me.answered(asked, answer, cx);
            }
            JobFor::Renew | JobFor::Leave => match fetched {
                Ok(f) if f.status == 200 => {}
                Ok(f) => tracing::warn!(
                    status = f.status,
                    error = refused(&f),
                    ?purpose,
                    "the backend refused a member's request"
                ),
                Err(error) => tracing::warn!(
                    error,
                    ?purpose,
                    "a member's request got no answer from the backend"
                ),
            },
        }
    }

    /// Posts this core's entry, which lists or renews it, and again in 10 minutes.
    pub(crate) fn renew(&mut self, cx: &Cx) {
        // A joiner lists itself at its first `LinkUp`, so it renews only once it has.
        if !self.backend.listed {
            return;
        }
        let (Some(key), Some(my), Some(open)) = (
            self.backend.key.clone(),
            self.backend.me.clone(),
            &self.session,
        ) else {
            return;
        };
        let body = Renew {
            code: open.code.clone(),
            member: entry(&my, &key),
        };
        self.post(MEMBERS, &body, Some(&key), JobFor::Renew, cx);
        if let Some(timer) = self.backend.renew.take() {
            cx.cancel_timer(timer);
        }
        self.backend.renew = Some(cx.timer(RENEW_EVERY, |me: &mut Network, _, cx| me.renew(cx)));
    }

    /// Tells the backend this core left, if it lists this core, as it doesn't list a joiner who
    /// cancels before its first `LinkUp`.
    pub(crate) fn tell_leave(&mut self, cx: &Cx) {
        let (Some(key), Some(open), true) =
            (self.backend.key.clone(), &self.session, self.backend.listed)
        else {
            return;
        };
        let body = Leave {
            code: open.code.clone(),
            endpoint: hex(&key.verifying_key().to_bytes()),
        };
        self.post(LEAVE, &body, Some(&key), JobFor::Leave, cx);
    }

    /// Clears what the session held, once it's left.
    pub(crate) fn forget(&mut self, cx: &Cx) {
        for timer in [self.backend.renew.take(), self.backend.check.take()]
            .into_iter()
            .flatten()
        {
            cx.cancel_timer(timer);
        }
        if let Some((_, job, timer)) = self.backend.asking.take() {
            cx.cancel_job(job);
            cx.cancel_timer(timer);
        }
        // A leave's own request goes on after the session's gone.
        let (jobs, others): (Vec<_>, Vec<_>) = std::mem::take(&mut self.backend.jobs)
            .into_iter()
            .partition(|(_, p)| *p == JobFor::Leave);
        for (job, _) in others {
            cx.cancel_job(job);
        }
        self.backend = Backend {
            jobs,
            ..Backend::default()
        };
    }

    /// Starts the check that looks the code up, 10s after a core opens a session with a
    /// crew, unless a link comes up first.
    pub(crate) fn start_check(&mut self, cx: &Cx) {
        self.backend.check = Some(cx.timer(CHECK_AFTER, |me: &mut Network, _, cx| {
            me.backend.check = None;
            let none_up = me.links.values().all(|l| l.conn.is_none());
            if let (true, Some(open)) = (none_up, &me.session) {
                tracing::info!("no member answered within 10s, so the network looks the code up");
                let code = open.code.clone();
                me.look_up(Asked::Check, code, cx);
            }
        }));
    }

    pub(crate) fn link_came_up(&mut self, cx: &Cx) {
        if let Some(timer) = self.backend.check.take() {
            cx.cancel_timer(timer);
        }
        // A member answered, so a restart's lookup still running answers nothing the session
        // crate should act on.
        if let Some((Asked::Check, job, timer)) = self.backend.asking {
            cx.cancel_job(job);
            cx.cancel_timer(timer);
            self.backend.jobs.retain(|(j, _)| *j != job);
            self.backend.asking = None;
        }
        if !self.backend.listed {
            self.backend.listed = true;
            self.renew(cx);
        }
    }
}

pub(crate) fn backend_url(cx: &Cx) -> String {
    cx.read::<Clients>()
        .setting_as::<String>(BACKEND)
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| BACKEND_URL.into())
        .trim_end_matches('/')
        .to_string()
}

fn entry(me: &Me, key: &SigningKey) -> Entry {
    Entry {
        pilot: hex(&me.pilot),
        name: me.name.clone(),
        kind: me.kind,
        endpoint: hex(&key.verifying_key().to_bytes()),
    }
}

fn answer(asked: Asked, fetched: Result<Fetched, String>) -> Answer {
    let fetched = match fetched {
        Ok(f) => f,
        Err(error) => return Answer::NoAnswer(error),
    };
    if fetched.status != 200 {
        return Answer::Refused(Refusal::Other(refused(&fetched)));
    }
    let unreadable = || Answer::Refused(Refusal::Other("the backend's answer didn't read".into()));
    match asked {
        Asked::Host => match serde_json::from_slice::<Created>(&fetched.body) {
            Ok(created) => Answer::Created { code: created.code },
            Err(_) => unreadable(),
        },
        Asked::Join | Asked::Check => match serde_json::from_slice::<LookedUp>(&fetched.body) {
            Ok(LookedUp::Found {
                session,
                relays,
                crew,
            }) => Answer::Found {
                session,
                relays,
                crew,
            },
            Ok(LookedUp::NoSuchCode) => Answer::Refused(Refusal::NoSuchCode),
            Ok(LookedUp::OtherVersion { older, theirs }) => {
                Answer::Refused(Refusal::OtherVersion(older, theirs))
            }
            Ok(LookedUp::OtherHash) => Answer::Refused(Refusal::OtherHash),
            Ok(LookedUp::TooManyWrongCodes { until }) => {
                Answer::Refused(Refusal::TooManyWrongCodes(until))
            }
            Err(_) => unreadable(),
        },
    }
}

/// A refusal's words: the backend's `error`, or the status when the body has none.
fn refused(fetched: &Fetched) -> String {
    serde_json::from_slice::<Refused>(&fetched.body)
        .map(|r| r.error)
        .unwrap_or_else(|_| format!("the backend answered with status {}", fetched.status))
}
