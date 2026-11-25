//! The check of what this PC reaches, which the header and a refused Host or Join read:
//! it asks the backend and each relay at once, and runs from the core's start whether or not a
//! session is held, and again at each dial while a link is lost
//! (record/areas/network/02-units.md, "What the pilot sees, and settings").
//!
//! Our servers run on two providers, so none of them answering means the PC is offline rather than
//! all of them down, and the check needs no third party's server to tell the two apart.

use std::collections::BTreeMap;
use std::time::Duration;

use clients::Clients;
use kernel::{Cx, Fetch, Fetched, Job, JobId, Method, Started, TimerId};
use messages::net::{Relay, Servers};

use crate::Network;
use crate::backend::{BackendAnswered, RELAYS, backend_url};

/// A server that hasn't answered by then counts as not answering.
const ANSWER_WITHIN: Duration = Duration::from_secs(2);
/// How long the next check waits while every server answers, which a pilot flying for hours
/// makes about 180 requests of the backend's in 3 hours.
const CHECK_EVERY: Duration = Duration::from_secs(60);
/// How long it waits after a check that found a server not answering, so the header sees it
/// come back within a few seconds.
const CHECK_AGAIN: Duration = Duration::from_secs(5);
/// What the backend answers any method but POST with, whatever the path, with no database behind
/// it. Only our Worker answers so: a captive portal fails HTTPS, and Cloudflare's own error page
/// for a Worker that's down has another status. `refuse(405, ...)` in src/backend/src/index.ts
/// answers it, so change both together.
const BACKEND_ANSWERS: u16 = 405;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Server {
    Backend,
    Relay,
}

struct Running {
    jobs: BTreeMap<JobId, Server>,
    timer: TimerId,
    backend: bool,
    relay: bool,
}

#[derive(Default)]
pub(crate) struct Reach {
    running: Option<Running>,
    /// The next check's timer, while none runs.
    next: Option<TimerId>,
    /// When the last check ended.
    found_at: Option<u64>,
    pub(crate) internet: Option<bool>,
    pub(crate) servers: Option<Servers>,
    /// The backend gave a Host or a Join no answer, which waits for this check, so the session
    /// crate tells an offline PC from our servers being out of reach by what it found just now.
    holding: Option<BackendAnswered>,
}

impl Network {
    pub(crate) fn started(me: &mut Network, _: &Started, cx: &mut Cx) {
        me.check_reach(cx);
    }

    /// A lost link's dial asks too, except right after a check, since a crewmate gone for 30
    /// minutes dials every 2s, and a check at each would ask every server 900 times.
    pub(crate) fn check_reach_for_dial(&mut self, cx: &Cx) {
        let recent = self
            .reach
            .found_at
            .is_some_and(|at| cx.now() < at + CHECK_AGAIN.as_micros() as u64);
        if !recent {
            self.check_reach(cx);
        }
    }

    /// Asks the backend and every relay, unless a check is running. In a session the relays are
    /// the session's, which a joiner has from the host, and outside one those a session this core
    /// hosts would run through.
    pub(crate) fn check_reach(&mut self, cx: &Cx) {
        if self.reach.running.is_some() {
            return;
        }
        if let Some(timer) = self.reach.next.take() {
            cx.cancel_timer(timer);
        }
        let relays = if self.backend.relays.is_empty() {
            cx.read::<Clients>()
                .setting_as::<Vec<Relay>>(RELAYS)
                .unwrap_or_default()
        } else {
            self.backend.relays.clone()
        };
        let urls = std::iter::once((Server::Backend, format!("{}/", backend_url(cx)))).chain(
            relays.iter().map(|relay| {
                // `/ping` answers with no token (read in iroh-relay 1.3.0,
                // record/areas/network/log.md, "2026-10-16: iroh-relay 1.3.0 builds and runs on
                // Windows, and in dev mode answers on IPv6 loopback only").
                let url = format!("{}/ping", relay.url.trim_end_matches('/'));
                (Server::Relay, url)
            }),
        );
        let jobs = urls
            .map(|(server, url)| {
                let fetch = Fetch {
                    method: Method::Get,
                    url,
                    headers: Vec::new(),
                    body: Vec::new(),
                    keep: Vec::new(),
                };
                (cx.job(Job::fetch(fetch), Network::reach_answered), server)
            })
            .collect();
        self.reach.running = Some(Running {
            jobs,
            timer: cx.timer(ANSWER_WITHIN, |me: &mut Network, _, cx| me.reach_found(cx)),
            backend: false,
            relay: false,
        });
    }

    fn reach_answered(me: &mut Network, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        let Some(running) = &mut me.reach.running else {
            return;
        };
        let Some(server) = running.jobs.remove(&job) else {
            return;
        };
        let status = result
            .ok()
            .and_then(|b| Fetched::decode(&b))
            .map(|f| f.status);
        match server {
            Server::Backend => running.backend |= status == Some(BACKEND_ANSWERS),
            Server::Relay => running.relay |= status == Some(200),
        }
        if running.jobs.is_empty() {
            me.reach_found(cx);
        }
    }

    /// Every server answered or the time ran out, so the check ends, and the next waits.
    fn reach_found(&mut self, cx: &Cx) {
        let Some(running) = self.reach.running.take() else {
            return;
        };
        cx.cancel_timer(running.timer);
        for job in running.jobs.keys() {
            cx.cancel_job(*job);
        }
        self.reach.found_at = Some(cx.now());
        let (backend, relay) = (running.backend, running.relay);
        let internet = Some(backend || relay);
        let servers = Some(if backend && relay {
            Servers::Reachable
        } else {
            Servers::Unreachable
        });
        if internet != self.reach.internet || servers != self.reach.servers {
            tracing::info!(backend, relay, "what this PC reaches changed");
        }
        self.reach.internet = internet;
        self.reach.servers = servers;
        let wait = if servers == Some(Servers::Reachable) {
            CHECK_EVERY
        } else {
            CHECK_AGAIN
        };
        self.reach.next = Some(cx.timer(wait, |me: &mut Network, _: TimerId, cx| {
            me.reach.next = None;
            me.check_reach(cx);
        }));
        if let Some(answered) = self.reach.holding.take() {
            cx.raise(answered);
        }
    }

    /// Holds the backend's lack of an answer to Host or Join for a check to finish.
    pub(crate) fn hold_for_reach(&mut self, answered: BackendAnswered, cx: &Cx) {
        self.reach.holding = Some(answered);
        self.check_reach(cx);
    }

    /// Drops the lack of an answer the check holds, once the pilot has canceled what it was for.
    pub(crate) fn drop_held_answer(&mut self) {
        self.reach.holding = None;
    }
}
