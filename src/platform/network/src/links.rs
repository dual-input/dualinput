//! Each member's link: one state machine per member, up while a connection whose first
//! message passed carries something at least every 5s, lost after 5s of silence, when the core
//! closes the connection and redials every 2s, and out after 30 minutes without one
//! (record/areas/network/01-between-machines.md, "The link between two cores";
//! record/areas/network/02-units.md, "Links").

use std::collections::BTreeMap;
use std::time::Duration;

use clients::Level;
use kernel::{Cx, Input, TimerId};
use messages::net::{Command, EndpointId, Event, HEARTBEAT, Header, Heartbeat, Path, codes};

use crate::hooks::{Opened, Received, Sender};
use crate::{LinkLost, LinkUp, Member, MemberLeft, MemberOut, Network, edge};

pub(crate) const HEARTBEAT_EVERY: Duration = Duration::from_secs(1);
/// Starting values, which v1's recordings tune: 5s sits above the 2s a dead direct path
/// takes to give way to the relay (record/areas/network/01-between-machines.md, "The link
/// between two cores").
const LOST_AFTER: Duration = Duration::from_secs(5);
/// Every dial still running when a link returns connects, so a core runs one at a time and
/// starts a new one every 2s in place of the last.
const REDIAL_EVERY: Duration = Duration::from_secs(2);
const OUT_AFTER: Duration = Duration::from_secs(30 * 60);

/// What one of the network's timers is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TimerFor {
    Heard(messages::net::PilotId),
    Dial(messages::net::PilotId),
    Out(messages::net::PilotId),
}

pub(crate) struct Link {
    pub(crate) member: Member,
    pub(crate) conn: Option<u64>,
    /// Whether the link was up before under the member's current restart count.
    up_before: bool,
    last_heard: u64,
    timers: Vec<TimerId>,
}

impl Link {
    fn new(member: Member) -> Link {
        Link {
            member,
            conn: None,
            up_before: false,
            last_heard: 0,
            timers: Vec::new(),
        }
    }

    /// Cancels the link's timers, and forgets what each was for.
    pub(crate) fn stop(&mut self, cx: &Cx, timer_for: &mut BTreeMap<TimerId, TimerFor>) {
        for timer in self.timers.drain(..) {
            cx.cancel_timer(timer);
            timer_for.remove(&timer);
        }
    }
}

pub(crate) struct Conn {
    endpoint: EndpointId,
    /// Whether this core dialed it.
    dialed: bool,
    /// Its first message's sender, once that passed.
    from: Option<Sender>,
    /// Each stream's bytes that aren't a whole frame yet.
    pending: BTreeMap<u16, Vec<u8>>,
    /// Frames that came on other streams before the first message passed, in arrival order,
    /// since QUIC keeps no order across streams.
    held: Vec<(u16, Vec<u8>)>,
    /// The last heartbeat received on it: its send stamp, and its input's stamp.
    pub(crate) echo: Heartbeat,
    pub(crate) path: Option<Path>,
}

impl Network {
    /// Starts a lost link to a member this core holds no link to; one it holds keeps its own.
    pub(crate) fn add_link(&mut self, member: Member, cx: &Cx) {
        if self.links.contains_key(&member.pilot) {
            return;
        }
        let mut link = Link::new(member);
        link.timers
            .push(self.timer(cx, OUT_AFTER, TimerFor::Out(member.pilot)));
        self.links.insert(member.pilot, link);
        self.dial(member.pilot, cx);
    }

    fn timer(&mut self, cx: &Cx, after: Duration, purpose: TimerFor) -> TimerId {
        let id = cx.timer(after, Network::fired);
        self.timer_for.insert(id, purpose);
        id
    }

    /// Dials a lost link's member, and again in 2s while it stays lost.
    fn dial(&mut self, pilot: messages::net::PilotId, cx: &Cx) {
        let Some(link) = self.links.get(&pilot) else {
            return;
        };
        if link.conn.is_some() {
            return;
        }
        if self.endpoint.is_some() {
            cx.out(Command::Dial {
                endpoint: link.member.endpoint,
            });
            self.ping(cx);
        }
        let timer = self.timer(cx, REDIAL_EVERY, TimerFor::Dial(pilot));
        if let Some(link) = self.links.get_mut(&pilot) {
            link.timers.push(timer);
        }
    }

    fn fired(me: &mut Network, id: TimerId, cx: &mut Cx) {
        let Some(purpose) = me.timer_for.remove(&id) else {
            return;
        };
        for link in me.links.values_mut() {
            link.timers.retain(|t| *t != id);
        }
        match purpose {
            TimerFor::Dial(pilot) => me.dial(pilot, cx),
            TimerFor::Heard(pilot) => me.heard_check(pilot, cx),
            TimerFor::Out(pilot) => {
                if let Some(mut link) = me.links.remove(&pilot) {
                    tracing::info!(
                        "a member had no connection for 30 minutes, so the network counts them out"
                    );
                    link.stop(cx, &mut me.timer_for);
                    cx.raise(MemberOut { member: pilot });
                }
            }
        }
    }

    /// 5s after the link last heard from its member: lost, unless something came since.
    fn heard_check(&mut self, pilot: messages::net::PilotId, cx: &Cx) {
        let now = cx.now();
        let Some(link) = self.links.get(&pilot) else {
            return;
        };
        let Some(conn) = link.conn else { return };
        let due = link.last_heard + LOST_AFTER.as_micros() as u64;
        if now < due {
            let timer = self.timer(cx, Duration::from_micros(due - now), TimerFor::Heard(pilot));
            if let Some(link) = self.links.get_mut(&pilot) {
                link.timers.push(timer);
            }
            return;
        }
        tracing::info!(
            conn,
            "nothing came on a member's connection for 5s, so the link is lost"
        );
        self.close(conn, codes::LOST, cx);
        self.lose(pilot, cx);
    }

    /// The link has no connection now: it raises `LinkLost` and redials.
    fn lose(&mut self, pilot: messages::net::PilotId, cx: &Cx) {
        let Some(link) = self.links.get_mut(&pilot) else {
            return;
        };
        link.conn = None;
        link.stop(cx, &mut self.timer_for);
        let out = self.timer(cx, OUT_AFTER, TimerFor::Out(pilot));
        if let Some(link) = self.links.get_mut(&pilot) {
            link.timers.push(out);
        }
        cx.raise(LinkLost { member: pilot });
        self.dial(pilot, cx);
    }

    fn close(&mut self, conn: u64, code: u32, cx: &Cx) {
        self.conns.remove(&conn);
        cx.out(Command::Close { conn, code });
    }

    /// The transport's input.
    pub(crate) fn event(me: &mut Network, input: &Input, cx: &mut Cx) {
        let Some(event) = edge::decode(&input.bytes) else {
            return tracing::error!("an input from the transport didn't decode");
        };
        match event {
            Event::Bound(Ok(endpoint)) => {
                tracing::info!("the network's endpoint is bound");
                me.endpoint = Some(endpoint);
                clients::clear_notification(cx, "bind");
                let lost: Vec<_> = me
                    .links
                    .iter()
                    .filter(|(_, l)| l.conn.is_none())
                    .map(|(p, _)| *p)
                    .collect();
                for link in lost.iter().filter_map(|p| me.links.get(p)) {
                    cx.out(Command::Dial {
                        endpoint: link.member.endpoint,
                    });
                }
                if !lost.is_empty() {
                    me.ping(cx);
                }
            }
            Event::Bound(Err(error)) => {
                tracing::error!(error, "the network's endpoint didn't bind");
                clients::notify(
                    cx,
                    "bind",
                    Level::Trouble,
                    &format!("Dual Input couldn't open its connection to other pilots: {error}"),
                    None,
                );
            }
            Event::Connected {
                conn,
                endpoint,
                dialed,
            } => {
                tracing::info!(conn, dialed, "a connection to another core opened");
                me.conns.insert(
                    conn,
                    Conn {
                        endpoint,
                        dialed,
                        from: None,
                        pending: BTreeMap::new(),
                        held: Vec::new(),
                        echo: Heartbeat::default(),
                        path: None,
                    },
                );
                if let Some(opener) = &me.opener {
                    cx.call_handler(&opener.handler, Opened { conn });
                }
            }
            Event::Stream {
                conn,
                channel,
                bytes,
            } => me.stream(conn, channel, bytes, cx),
            Event::OneOff {
                conn,
                channel,
                bytes,
            } => me.one_off(conn, channel, bytes, cx),
            Event::Closed { conn, code } => {
                let closed = me.conns.remove(&conn);
                // A close can overtake the first message the other side sent before it, so the
                // refused side shows the refusal from the close too, under the same notification
                // its own check raises. A refused connection never joined a link, so this comes
                // before the link is looked up.
                if let Ok(
                    refused @ (codes::WRONG_CODE | codes::WRONG_VERSION | codes::WRONG_HASH),
                ) = code
                {
                    let why = match refused {
                        codes::WRONG_CODE => "it holds another session's code",
                        codes::WRONG_VERSION => "it runs another version of Dual Input",
                        _ => "its build's messages differ from this one's",
                    };
                    clients::notify(
                        cx,
                        "refused",
                        Level::Warning,
                        &format!("Another pilot's PC refused this one's connection: {why}"),
                        None,
                    );
                }
                // A member can leave on a connection whose first message hasn't passed yet, which
                // no link holds, so a leave finds its link by the member's endpoint too.
                let leave = matches!(code, Ok(codes::LEAVE | codes::QUIT));
                let Some((&pilot, _)) = me.links.iter().find(|(_, l)| {
                    l.conn == Some(conn)
                        || (leave
                            && l.conn.is_none()
                            && closed
                                .as_ref()
                                .is_some_and(|c| c.endpoint == l.member.endpoint))
                }) else {
                    return;
                };
                match code {
                    Ok(codes::LEAVE | codes::QUIT) => {
                        tracing::info!(conn, "a member left the session");
                        if let Some(mut link) = me.links.remove(&pilot) {
                            link.stop(cx, &mut me.timer_for);
                        }
                        cx.raise(MemberLeft { member: pilot });
                    }
                    code => {
                        tracing::info!(
                            conn,
                            ?code,
                            "a member's connection closed, so the link is lost"
                        );
                        me.lose(pilot, cx);
                    }
                }
            }
            Event::Path { conn, path } => {
                tracing::info!(conn, ?path, "a connection's path changed");
                if let Some(c) = me.conns.get_mut(&conn) {
                    c.path = Some(path);
                }
            }
            Event::Stats {
                conn,
                sent,
                lost,
                rtt_us,
                cwnd,
            } => {
                tracing::debug!(conn, sent, lost, rtt_us, cwnd, "a connection's stats")
            }
        }
    }

    fn heard(&mut self, from: Sender, conn: u64, cx: &Cx) {
        if let Some(link) = self.links.get_mut(&from.pilot)
            && link.conn == Some(conn)
        {
            link.last_heard = cx.now();
        }
    }

    fn stream(&mut self, conn: u64, channel: u16, bytes: Vec<u8>, cx: &mut Cx) {
        let Some(c) = self.conns.get_mut(&conn) else {
            return;
        };
        let pending = c.pending.entry(channel).or_default();
        pending.extend(bytes);
        let mut frames = Vec::new();
        while pending.len() >= 4 {
            let length =
                u32::from_le_bytes([pending[0], pending[1], pending[2], pending[3]]) as usize;
            if pending.len() < 4 + length {
                break;
            }
            frames.push(pending[4..4 + length].to_vec());
            pending.drain(..4 + length);
        }
        for frame in frames {
            // A refusal, or the link keeping another connection, closes this one, and the
            // frames after its first message belong to no connection.
            let Some(c) = self.conns.get(&conn) else {
                return;
            };
            match c.from {
                Some(from) => {
                    self.heard(from, conn, cx);
                    self.deliver(from, channel, frame, cx);
                }
                None if self.opener.as_ref().is_some_and(|o| o.channel == channel) => {
                    self.first_message(conn, frame, cx);
                }
                None => {
                    if let Some(c) = self.conns.get_mut(&conn) {
                        c.held.push((channel, frame));
                    }
                }
            }
        }
    }

    fn one_off(&mut self, conn: u64, channel: u16, bytes: Vec<u8>, cx: &mut Cx) {
        // Until the first message has passed, nothing else from the connection applies, and
        // QUIC can deliver one-off packets before the first stream data.
        let Some(from) = self.conns.get(&conn).and_then(|c| c.from) else {
            return;
        };
        self.heard(from, conn, cx);
        if channel == HEARTBEAT.number {
            return self.heartbeat_in(conn, from, &bytes, cx);
        }
        self.deliver(from, channel, bytes, cx);
    }

    fn deliver(&self, from: Sender, channel: u16, bytes: Vec<u8>, cx: &Cx) {
        match self.channels.get(&channel) {
            Some(registered) => cx.call_handler(&registered.handler, Received { from, bytes }),
            // Such as a plugin's channel, which exists only where that plugin runs.
            None => tracing::trace!(
                channel,
                "a message on a channel no unit registered was dropped"
            ),
        }
    }

    /// A heartbeat, with the send stamp the transport added after it: an exchange for the
    /// sender's clock offset, and the echo this core's next heartbeat carries.
    fn heartbeat_in(&mut self, conn: u64, from: Sender, bytes: &[u8], cx: &Cx) {
        let Ok((heartbeat, rest)) = postcard::take_from_bytes::<Heartbeat>(bytes) else {
            return;
        };
        let Some(stamp) = rest
            .get(..8)
            .and_then(|s| s.try_into().ok())
            .map(u64::from_le_bytes)
        else {
            return;
        };
        let received = cx.now();
        if heartbeat.echo_sent != 0 {
            self.offsets
                .entry((from.pilot, from.restart))
                .or_default()
                .exchange(
                    heartbeat.echo_sent,
                    heartbeat.echo_received,
                    stamp,
                    received,
                );
        }
        if let Some(c) = self.conns.get_mut(&conn) {
            c.echo = Heartbeat {
                echo_sent: stamp,
                echo_received: received,
            };
        }
    }

    fn first_message(&mut self, conn: u64, frame: Vec<u8>, cx: &mut Cx) {
        let Some(my) = self.session.clone() else {
            return;
        };
        // The header's version and hash stay first in every release, so a core of another
        // release is always read far enough to be told why it's refused.
        let (code, reason) = match postcard::take_from_bytes::<Header>(&frame) {
            Err(_) => (
                codes::WRONG_VERSION,
                "its first message didn't read".to_string(),
            ),
            Ok((header, _)) if header.version != messages::VERSION => (
                codes::WRONG_VERSION,
                format!(
                    "it runs Dual Input {}, and this PC {}",
                    header.version,
                    messages::VERSION
                ),
            ),
            Ok((header, _)) if header.hash != messages::HASH => (
                codes::WRONG_HASH,
                "its build's messages differ from this one's".into(),
            ),
            Ok((header, _)) if header.code != my.code => {
                (codes::WRONG_CODE, "it named another session's code".into())
            }
            Ok((header, keys)) => return self.take(conn, header, keys.to_vec(), cx),
        };
        tracing::warn!(conn, code, reason, "the network refused a connection");
        clients::notify(
            cx,
            "refused",
            Level::Warning,
            &format!("Another pilot's connection was refused: {reason}"),
            None,
        );
        self.close(conn, code, cx);
    }

    /// A connection whose first message passed: the link takes it, unless the link's rule
    /// keeps another.
    fn take(&mut self, conn: u64, header: Header, keys: Vec<u8>, cx: &mut Cx) {
        let Some(c) = self.conns.get(&conn) else {
            return;
        };
        let (endpoint, dialed) = (c.endpoint, c.dialed);
        let from = Sender {
            pilot: header.pilot,
            restart: header.restart,
        };
        let member = Member {
            pilot: header.pilot,
            restart: header.restart,
            endpoint,
        };
        let link = self
            .links
            .entry(header.pilot)
            .or_insert_with(|| Link::new(member));
        if let Some(old) = link.conn {
            let old_dialed = self.conns.get(&old).is_none_or(|c| c.dialed);
            let keep_new = if from.restart != link.member.restart {
                // A higher restart count means its pilot's core restarted and dropped the
                // other connection.
                from.restart > link.member.restart
            } else if old_dialed == dialed {
                // A core dials a member only while it holds no connection to them, so of two
                // the same side dialed, the newer stays.
                conn > old
            } else {
                // Of two connections from the same restart, the one the lower endpoint ID
                // dialed stays, which both sides hold, so both keep the same one.
                let mine_lower = self.endpoint.is_some_and(|mine| mine < endpoint);
                dialed == mine_lower
            };
            let (stays, goes, code) = if keep_new {
                let code = if from.restart > link.member.restart {
                    codes::RESTARTED
                } else {
                    codes::OTHER_STAYS
                };
                (conn, old, code)
            } else {
                let code = if from.restart < link.member.restart {
                    codes::RESTARTED
                } else {
                    codes::OTHER_STAYS
                };
                (old, conn, code)
            };
            tracing::info!(
                stays,
                goes,
                "of two connections to one member, the link's rule keeps one"
            );
            self.close(goes, code, cx);
            if stays != conn {
                return;
            }
        }
        let Some(link) = self.links.get_mut(&header.pilot) else {
            return;
        };
        if from.restart != link.member.restart {
            link.up_before = false;
        }
        let again = link.up_before;
        link.member = member;
        link.conn = Some(conn);
        link.up_before = true;
        link.last_heard = cx.now();
        link.stop(cx, &mut self.timer_for);
        let heard = self.timer(cx, LOST_AFTER, TimerFor::Heard(header.pilot));
        if let Some(link) = self.links.get_mut(&header.pilot) {
            link.timers.push(heard);
        }
        let held = match self.conns.get_mut(&conn) {
            Some(c) => {
                c.from = Some(from);
                std::mem::take(&mut c.held)
            }
            None => Vec::new(),
        };
        tracing::info!(conn, again, restart = from.restart, "a member's link is up");
        cx.raise(LinkUp { member, again });
        // A link that came up shows this PC isn't refused, whatever an earlier connection was.
        clients::clear_notification(cx, "refused");
        self.link_came_up(cx);
        if let Some(channel) = self.opener.as_ref().map(|o| o.channel) {
            self.deliver(from, channel, keys, cx);
        }
        for (channel, frame) in held {
            self.deliver(from, channel, frame, cx);
        }
    }
}
