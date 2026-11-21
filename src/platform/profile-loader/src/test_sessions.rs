//! Test sessions: an author's core offers each new local bundle that covers the session's
//! aircraft to the pilot flying, whose loader pins it, after preflight too, and every core in the
//! flight reloads it. Once a local pin lands, the pilot flying's core sends the bundle to every
//! member that lacks it, and again at each member's `LinkUp`, since no site holds it, and each
//! core keeps it in its cache (record/areas/profiles/02-units.md, "Test sessions").

use std::collections::BTreeMap;

use clients::{Landing, Level, Notification};
use kernel::{Cx, Job, JobId};
use messages::net::PilotId;
use messages::profiles::{BUNDLES, Bundle, LocalBundle, MemberBundle, Pin, Runs, TestProfile};
use messages::{hex, unhex};
use network::{LinkUp, Sender, To};
use session::{Session, WriteKeys};

use crate::{PIN, Profiles, cache};

#[derive(Default)]
pub(crate) struct Test {
    /// Each read of a local bundle's bytes on its way, by its job.
    reading: BTreeMap<JobId, Reading>,
    /// The local pin whose bundle the crew has been sent: by this core, as the pilot flying that
    /// pinned it, or by another core that flew as this one saw it pinned, so a pass of control
    /// sends nothing again.
    sent: Option<[u8; 32]>,
    /// The pin key's value as last seen, to see it change: `None` before the key holds one, and
    /// `Some(None)` while no profile covers the aircraft.
    last: Option<Option<Pin>>,
    /// A local pin that replaced another, until every member in the flight has loaded it and the
    /// banner has said so.
    notice: Option<Pin>,
}

enum Reading {
    /// A new bundle of this core's own, to offer.
    Fresh,
    /// The pinned bundle, to keep in the cache and send to `to`.
    Send { hash: [u8; 32], to: Vec<PilotId> },
}

/// Runs at the edge on a local bundle's bytes: their hash, and the bytes.
fn hashed(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    postcard::to_stdvec(&(profile_engine::hash(&bytes), bytes)).map_err(|e| e.to_string())
}

/// Reads each bundle that changed in this core's local folder during the session and covers the
/// session's aircraft, other than the pinned one, to offer it.
pub(crate) fn offer(me: &mut Profiles, cx: &mut Cx) {
    let fresh = me.local.take_fresh();
    let Some(aircraft) = me.aircraft.clone() else {
        return;
    };
    let pinned = cx
        .read::<Session>()
        .key(PIN)
        .flatten()
        .map(|p| hex(&p.hash));
    for bundle in fresh {
        if !bundle.covers(&aircraft) || pinned.as_ref() == Some(&bundle.hash) {
            continue;
        }
        let job = cx.job(
            Job::read(me.local.path(&bundle.file)).then(hashed),
            read_back,
        );
        me.test.reading.insert(job, Reading::Fresh);
    }
}

fn read_back(me: &mut Profiles, job: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
    let Some(reading) = me.test.reading.remove(&job) else {
        return;
    };
    let got = result.and_then(|bytes| {
        postcard::from_bytes::<(String, Vec<u8>)>(&bytes).map_err(|e| e.to_string())
    });
    let (hash, bytes) = match got {
        Ok((hash, bytes)) => (hash, bytes),
        Err(why) => {
            return tracing::warn!(why, "couldn't read a local bundle to send it");
        }
    };
    let Some(read) = unhex::<32>(&hash) else {
        return;
    };
    match reading {
        Reading::Fresh => offered(me, read, bytes, cx),
        Reading::Send { hash: wanted, .. } if wanted != read => tracing::warn!(
            wanted = hex(&wanted),
            read = hash,
            "the local folder's file changed before the pinned bundle in it was sent, so it waits for the next pin"
        ),
        Reading::Send { to, .. } => {
            tracing::info!(
                hash,
                members = to.len(),
                "the pinned local bundle goes to the members who lack it"
            );
            cache::keep(me, &hash, bytes.clone(), cx);
            for member in to {
                let bundle = LocalBundle {
                    hash: read,
                    bytes: bytes.clone(),
                    offer: None,
                };
                network::send(cx, BUNDLES, To::Member(member), &bundle);
            }
        }
    }
    me.update(cx);
}

/// A new local bundle of this core's own, read: kept in the cache, then pinned, on the pilot
/// flying's core, or offered to the pilot flying.
fn offered(me: &mut Profiles, hash: [u8; 32], bytes: Vec<u8>, cx: &mut Cx) {
    cache::keep(me, &hex(&hash), bytes.clone(), cx);
    let session = cx.read::<Session>();
    let (Some(mine), Some(pf)) = (session.me(), session.pf()) else {
        return;
    };
    if pf == mine {
        pin_new(me, hash, mine, cx);
    } else {
        tracing::info!(
            hash = hex(&hash),
            "this pilot's new local bundle goes to the pilot flying"
        );
        let bundle = LocalBundle {
            hash,
            bytes,
            offer: Some(mine),
        };
        network::send(cx, BUNDLES, To::Member(pf), &bundle);
    }
}

/// A local bundle from another member, which the cache keeps: a member's new one, which the
/// pilot flying pins, and another core passes on to the pilot flying, as when control passed
/// while it was on its way; or the pinned one, which this core lacked.
pub(crate) fn on_bundle(me: &mut Profiles, from: Sender, bundle: LocalBundle, cx: &mut Cx) {
    let LocalBundle { hash, bytes, offer } = bundle;
    cache::keep(me, &hex(&hash), bytes.clone(), cx);
    if let Some(author) = offer {
        let session = cx.read::<Session>();
        let (mine, pf) = (session.me(), session.pf());
        if mine.is_some() && pf == mine {
            pin_new(me, hash, author, cx);
        } else if let Some(pf) = pf
            && pf != from.pilot
        {
            tracing::info!(
                hash = hex(&hash),
                "a crewmate's new local bundle goes on to the pilot flying"
            );
            let bundle = LocalBundle {
                hash,
                bytes,
                offer: Some(author),
            };
            network::send(cx, BUNDLES, To::Member(pf), &bundle);
        }
    }
    me.update(cx);
}

/// On the pilot flying's core, pins a new local bundle from `author`'s local folder, after
/// preflight too. The bundle goes to the crew once the pin lands, in `send_pinned`.
fn pin_new(me: &mut Profiles, hash: [u8; 32], author: PilotId, cx: &mut Cx) {
    if cx.read::<Session>().key(PIN).flatten().map(|p| p.hash) == Some(hash) {
        return;
    }
    let pin = Pin {
        hash,
        local: true,
        from: Some(author),
    };
    tracing::info!(
        hash = hex(&hash),
        from = hex(&author),
        "the pilot flying pinned a new local bundle, for a test session"
    );
    me.asked = Some((cx.now(), Some(pin)));
    cx.ask(WriteKeys::one(PIN, &Some(pin)));
}

/// Once a local pin lands, the pilot flying's core sends its bundle to every member but itself and
/// its author, and keeps it in its cache. A core that sees the pin land while another flies only
/// notes it, since that core's pilot flying sent it.
pub(crate) fn send_pinned(me: &mut Profiles, cx: &mut Cx) {
    let session = cx.read::<Session>();
    let Some(Some(pin)) = session.key(PIN) else {
        return;
    };
    if !pin.local || me.test.sent == Some(pin.hash) {
        return;
    }
    if session.me().is_none() || session.pf() != session.me() {
        me.test.sent = Some(pin.hash);
        return;
    }
    let to: Vec<PilotId> = session
        .members()
        .into_iter()
        .filter(|m| Some(*m) != session.me() && Some(*m) != pin.from)
        .collect();
    if send(me, pin.hash, to, cx) {
        me.test.sent = Some(pin.hash);
    }
}

/// A member's link came up, as it joins or comes back: the pilot flying's core sends it a pinned
/// local bundle, since no site holds it.
pub(crate) fn link_up(me: &mut Profiles, up: &LinkUp, cx: &mut Cx) {
    let session = cx.read::<Session>();
    if session.me().is_none() || session.pf() != session.me() {
        return;
    }
    if let Some(Some(pin)) = session.key(PIN)
        && pin.local
        && !send(me, pin.hash, vec![up.member.pilot], cx)
    {
        tracing::warn!(
            hash = hex(&pin.hash),
            "the pilot flying holds the pinned local bundle in neither its cache nor its local folder, so a member whose link came up can't get it"
        );
    }
    me.update(cx);
}

/// Reads a local bundle from the cache, or else the local folder, to keep it in the cache and
/// send it to `to`, and says whether either holds it.
fn send(me: &mut Profiles, hash: [u8; 32], to: Vec<PilotId>, cx: &mut Cx) -> bool {
    let Some(path) = me.held_path(&hex(&hash)) else {
        return false;
    };
    let job = cx.job(Job::read(path).then(hashed), read_back);
    me.test.reading.insert(job, Reading::Send { hash, to });
    true
}

/// The banner says once that every member in the flight has loaded a local pin that replaced
/// another (record/areas/interface/decisions.md, "A test session shows the bundle each PC runs").
pub(crate) fn notice(me: &mut Profiles, cx: &mut Cx) {
    let session = cx.read::<Session>();
    if !session.held() {
        me.test = Test::default();
        return;
    }
    let pin = session.key(PIN);
    if me.test.last != pin {
        let before = std::mem::replace(&mut me.test.last, pin);
        me.test.notice = match (before, pin) {
            (Some(Some(old)), Some(Some(new))) if new.local && new.hash != old.hash => Some(new),
            _ => None,
        };
    }
    let Some(new) = me.test.notice else {
        return;
    };
    let flying: Vec<PilotId> = session
        .members()
        .into_iter()
        .filter(|m| session.in_flight(m))
        .collect();
    let loaded = |m: &PilotId| matches!(me.value_of(session, m), Some(Bundle::Loaded(p)) if p.hash == new.hash);
    if flying.is_empty() || !flying.iter().all(loaded) {
        return;
    }
    me.test.notice = None;
    let whose = match new.from {
        Some(from) if Some(from) == session.me() => "Your profile edit".to_string(),
        Some(from) => format!("{}'s profile edit", session.name_of(&from)),
        None => "A profile edit".to_string(),
    };
    let pcs = if flying.len() == 2 {
        "both PCs"
    } else {
        "every PC"
    };
    tracing::info!(
        hash = hex(&new.hash),
        "every member in the flight loaded the new local bundle"
    );
    let mut said = Notification::new(
        Level::Information,
        format!("{whose} is loaded on {pcs}"),
        Landing::Session,
    );
    said.detail = Some(format!("Profile {}", messages::profiles::short(&new.hash)));
    said.pilot = new.from.map(|p| hex(&p));
    said.once = true;
    clients::notify(cx, "edit", said);
}

/// The slice's test profile: the pinned bundle while it's a local one, and what each member in
/// the flight runs.
pub(crate) fn slice(me: &Profiles, session: &Session) -> Option<TestProfile> {
    let pin = session.key(PIN).flatten().filter(|p| p.local)?;
    let members = session
        .members()
        .into_iter()
        .filter(|m| session.in_flight(m))
        .filter_map(|m| {
            let runs = match me.value_of(session, &m)? {
                Bundle::Loaded(p) => Runs::Loaded {
                    hash: messages::profiles::short(&p.hash),
                },
                Bundle::Loading => Runs::Loading,
                Bundle::Unavailable => Runs::Missing,
                Bundle::NoProfile => return None,
            };
            Some(MemberBundle {
                pilot: hex(&m),
                runs,
            })
        })
        .collect();
    Some(TestProfile {
        hash: messages::profiles::short(&pin.hash),
        from: pin.from.map(|p| hex(&p)),
        members,
    })
}
