//! The session's messages: the session channel, which carries the session's keys between
//! cores; the key, its writers, and its stamp, which every feature's own keys use; the
//! session crate's own keys; the match check's items; and the session crate's slice,
//! commands, and setting (record/areas/session/02-units.md).

use std::marker::PhantomData;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::backend::Kind;
use crate::net::{Channel, Delivery, EndpointId, PilotId};
use crate::sim::{Aircraft, Ending, Location, Stage};

/// The session channel: each core's keys, all of them in each connection's first message,
/// and each change after, on a stream above every other
/// (record/areas/network/01-between-machines.md, "Channels").
pub const CHANNEL: Channel<Keys> = Channel::new(2, Delivery::Stream, u8::MAX);

/// Who may write a key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Writer {
    /// Each member writes its own copy, such as `READY`.
    Member,
    /// Any member writes it, and the stamp settles two writes, such as active pause.
    Anyone,
    /// Only the pilot flying writes it, and the session crate drops a value from anyone else,
    /// such as the simulation rate or `PREFLIGHT`.
    PilotFlying,
}

/// A session key: a number no other key has, its value's type, its writer, and whether its
/// value names a member, which makes it a role's key. The platform clears a role's key when
/// the member it names leaves the session. A test in tests/keys.rs fails on two keys with
/// one number, as one on two channels does.
pub struct Key<T> {
    pub number: u16,
    pub writer: Writer,
    pub names_member: bool,
    value: PhantomData<fn() -> T>,
}

impl<T> Key<T> {
    pub const fn new(number: u16, writer: Writer) -> Key<T> {
        Key {
            number,
            writer,
            names_member: false,
            value: PhantomData,
        }
    }
}

impl Key<Option<PilotId>> {
    /// A role's key, whose value names the member who holds the role, or nobody.
    pub const fn role(number: u16, writer: Writer) -> Key<Option<PilotId>> {
        Key {
            number,
            writer,
            names_member: true,
            value: PhantomData,
        }
    }
}

impl<T> Clone for Key<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Key<T> {}

/// The control value: a generation, raised by every change of pilot flying, and the pilot
/// flying's ID (record/areas/network/01-between-machines.md, "Control").
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Control {
    pub generation: u64,
    pub pf: PilotId,
}

impl Control {
    /// Whether this value comes after `other`: a higher generation, or of one generation, the
    /// one naming the lower pilot ID, so every machine settles two changes made at once the
    /// same way.
    pub fn outranks(&self, other: &Control) -> bool {
        (self.generation, std::cmp::Reverse(self.pf))
            > (other.generation, std::cmp::Reverse(other.pf))
    }
}

/// What every key's value carries: the control value its writer held, a number one past the
/// highest its writer has seen on that key, and the writer's pilot ID.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamp {
    pub control: Control,
    pub n: u64,
    pub writer: PilotId,
}

impl Stamp {
    /// Whether a value under this stamp replaces one under `other`: control values first, as
    /// control orders them, then the numbers, with the lower pilot ID winning a tie.
    pub fn outranks(&self, other: &Stamp) -> bool {
        if self.control != other.control {
            return self.control.outranks(&other.control);
        }
        (self.n, std::cmp::Reverse(self.writer)) > (other.n, std::cmp::Reverse(other.writer))
    }
}

/// One key's value, in postcard, or `None` once it's cleared, as a role's key whose holder
/// left.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyValue {
    pub key: u16,
    pub stamp: Stamp,
    pub value: Option<Vec<u8>>,
}

/// A message on the session channel: the control value this core holds, if it knows one,
/// and the keys it sends.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Keys {
    pub control: Option<Control>,
    pub values: Vec<KeyValue>,
}

/// A member's entry, which it writes once, as it first takes part in the session.
pub const MEMBER: Key<MemberEntry> = Key::new(1, Writer::Member);
/// A member's sim and its links, which it writes on each change.
pub const STATUS: Key<Status> = Key::new(2, Writer::Member);
/// A member's Ready during preflight, and the members it goes without.
pub const READY: Key<Ready> = Key::new(3, Writer::Member);
/// A member's value for each item of the match check.
pub const MATCH: Key<MatchValues> = Key::new(4, Writer::Member);
/// The session's aircraft and preflight's phase, which the pilot flying's core writes.
pub const PREFLIGHT: Key<Preflight> = Key::new(5, Writer::PilotFlying);

/// A member's entry: its display name, kind, and endpoint ID. Its pilot ID is the stamp's
/// writer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberEntry {
    pub name: String,
    pub kind: Kind,
    pub endpoint: EndpointId,
}

/// A member's sim, as its own sim awareness has it, and its link to each other member.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct Status {
    pub stage: Stage,
    pub aircraft: Option<Aircraft>,
    /// The aircraft's `A:TITLE`, which names it to the crew, such as "L1011-500 Cabin w/
    /// Lounge", once the sim service has read it.
    pub title: Option<String>,
    /// `Pause_EX1`'s flags, 0 when unpaused.
    pub pause: u32,
    /// How its last run of the sim ended.
    pub ended: Option<Ending>,
    /// Each other member's pilot ID, as 32 hex digits, and this member's link to it.
    pub links: Vec<(String, Link)>,
}

/// A member's link to another, as its own network sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "session/")]
pub enum Link {
    Up,
    Lost,
    /// The other member left the session.
    Left,
}

/// A member's Ready, and the members it goes without, each by pilot ID.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ready {
    pub ready: bool,
    pub without: Vec<PilotId>,
}

/// A member's value for each item of the match check, by the item's number, each in
/// postcard.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchValues {
    pub items: Vec<(u16, Vec<u8>)>,
}

/// The session's aircraft, set by the pilot flying's core, and preflight's phase.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct Preflight {
    pub aircraft: Option<Aircraft>,
    pub phase: Phase,
}

/// Where preflight stands, which every core follows from the pilot flying's
/// (record/areas/session/02-units.md, "Preflight").
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "session/")]
pub enum Phase {
    /// The session has no aircraft yet.
    #[default]
    NoAircraft,
    /// The pilot flying is in a flight on the ground, and every core holds its aircraft
    /// while its pilot is in the flight.
    Running,
    /// Every counted member is ready, and the pilot flying's 3s timer runs.
    Countdown,
    /// The flight has started, and stays started for the rest of the session.
    Ended,
}

/// An item of the match check: a number no other item has, and its value's type, which its
/// owner hands the session crate whenever the value changes.
pub struct MatchItem<T> {
    pub number: u16,
    value: PhantomData<fn() -> T>,
}

impl<T> MatchItem<T> {
    pub const fn new(number: u16) -> MatchItem<T> {
        MatchItem {
            number,
            value: PhantomData,
        }
    }
}

impl<T> Clone for MatchItem<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for MatchItem<T> {}

/// The aircraft's package and where it's installed, the session crate's own item.
pub const PACKAGE: MatchItem<Installed> = MatchItem::new(1);
/// The aircraft's version, the session crate's own item.
pub const VERSION: MatchItem<Installed> = MatchItem::new(2);
/// The aircraft's livery, `A:LIVERY NAME`, the session crate's own item.
pub const LIVERY: MatchItem<Option<String>> = MatchItem::new(3);

/// The package that holds the loaded aircraft, where it's installed, and its version where
/// its `manifest.json` has one. A streamed copy keeps no package on disk to name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Installed {
    pub package: Option<String>,
    pub location: Location,
    pub version: Option<String>,
}

/// The session crate's slice of client state.
pub const SLICE: &str = "session";

/// The slice `session`. Each pilot ID in it is 32 hex digits.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct SessionSlice {
    /// Whether this core holds a session.
    pub held: bool,
    /// The session's invite code, once the backend has given one.
    pub code: Option<String>,
    /// This pilot's ID.
    pub me: Option<String>,
    /// The pilot flying, once this core knows the control value.
    pub pf: Option<String>,
    /// This pilot first, then the others in the order they joined.
    pub members: Vec<SliceMember>,
    pub preflight: Preflight,
    /// The match check's differences, among the members in the flight.
    pub differences: Vec<Difference>,
    /// Why Ready can't be clicked now, empty when it can, or `None` outside a session.
    pub ready: Option<Vec<String>>,
    /// Why "Share my traffic and ATC" can't be turned on now, empty when it can.
    pub share: Option<Vec<String>>,
    /// The role keys this pilot can claim, each with its label and its holder.
    pub roles: Vec<Role>,
}

/// A member as the slice shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct SliceMember {
    pub pilot: String,
    pub name: String,
    pub status: Status,
    pub in_flight: bool,
    pub ready: bool,
    /// Whom this member goes without.
    pub without: Vec<String>,
}

/// One difference the match check found, in its item's words.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct Difference {
    pub item: u16,
    pub level: Severity,
    pub words: String,
}

/// How much a difference matters: an error says something will likely go wrong, and a
/// warning that it might. Neither stops the flight (record/areas/product/03-v1-scope.md,
/// "Preflight match check").
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "session/")]
pub enum Severity {
    Warning,
    Error,
}

/// A role's key, as the switch shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct Role {
    pub key: u16,
    /// In its feature's words.
    pub label: String,
    pub holder: Option<String>,
}

/// The session crate's commands, which any client sends.
pub mod command {
    /// Starts a session this pilot hosts. It takes no arguments.
    pub const HOST: &str = "session.host";
    /// Joins a session by its code, with a `Join`.
    pub const JOIN: &str = "session.join";
    /// The EFB app's code box was selected: the core reads the clipboard, and joins with the
    /// code it holds, if it holds one. It takes no arguments.
    pub const JOIN_FROM_CLIPBOARD: &str = "session.join-from-clipboard";
    /// Leaves the session. It takes no arguments.
    pub const LEAVE: &str = "session.leave";
    /// Leaves the session if one is held, then quits Dual Input. It takes no arguments.
    pub const QUIT: &str = "session.quit";
    /// Ready, or un-ready, during preflight, with a `SetReady`.
    pub const READY: &str = "session.ready";
    /// Goes without a counted member who dropped out, with a `GoWithout`.
    pub const GO_WITHOUT: &str = "session.go-without";
    /// "Share my traffic and ATC": claims every role's key for this pilot, or releases each
    /// this pilot holds, with a `Share`.
    pub const SHARE: &str = "session.share";
}

/// `session.join`'s arguments.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct Join {
    pub code: String,
}

/// `session.ready`'s arguments.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct SetReady {
    pub on: bool,
}

/// `session.go-without`'s arguments: the member's pilot ID.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct GoWithout {
    pub member: String,
}

/// `session.share`'s arguments.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "session/")]
pub struct Share {
    pub on: bool,
}

/// The display name setting, the name the crew sees, which Host and Join need.
pub const NAME: &str = "session.name";

/// The most characters a display name holds. Each place the apps name a pilot has room for a
/// short name, and Windows holds an account's name to the same 20, so a username fits as it is
/// (record/areas/interface/decisions.md, "A display name runs to 20 characters").
pub const NAME_MAX_CHARACTERS: u32 = 20;
