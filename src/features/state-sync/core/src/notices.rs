//! The notification for a control that couldn't sync: one card once per entry for each load, and
//! several in a row as one, worded as the banner's decision has it
//! (record/areas/interface/decisions.md, "The banner carries what a pilot must see without the
//! EFB").

use std::collections::BTreeSet;
use std::time::Duration;

use clients::{Landing, Level, Notification};
use kernel::{Cx, TimerId};
use messages::net::PilotId;
use session::Session;

use crate::StateSync;

/// A card stays 6s, so names that come closer together than this go on one card, which a catch-up
/// behind a dead bus needs, since it can flag many entries in a moment.
const GROUPS: Duration = Duration::from_secs(6);

/// What's been said at this load.
#[derive(Default)]
pub(crate) struct Notices {
    /// Each entry told of, so a second flag on it says nothing more.
    told: BTreeSet<String>,
    /// The names on the card now up.
    group: Vec<String>,
    timer: Option<TimerId>,
}

impl Notices {
    pub(crate) fn couldnt_sync(&mut self, entry: &str, name: &str, from: Option<PilotId>, cx: &Cx) {
        if !self.told.insert(entry.to_string()) {
            return;
        }
        self.group.push(name.to_string());
        if let Some(timer) = self.timer.take() {
            cx.cancel_timer(timer);
        }
        self.timer = Some(cx.timer(GROUPS, ended_group));
        let text = match &self.group[..] {
            [one] => format!("Couldn't sync {one}"),
            all => format!("Couldn't sync {} controls", all.len()),
        };
        let whose = whose(from, cx);
        let (detail, list) = if self.group.len() == 1 {
            (format!("Yours may differ from {whose}."), Vec::new())
        } else {
            (
                format!("Yours may differ from {whose}:"),
                self.group.clone(),
            )
        };
        clients::notify(
            cx,
            "couldnt-sync",
            Notification::new(Level::Warning, text, Landing::Session)
                .detail(detail)
                .list(list)
                .once(),
        );
    }
}

/// Whose cockpit this pilot's may differ from: the sender of the change that couldn't be
/// written, or the pilot flying's for a pilot with no sender, such as one whose entry stopped on
/// its own.
fn whose(from: Option<PilotId>, cx: &Cx) -> String {
    let session = cx.read::<Session>();
    let them = from.or(session.pf()).filter(|p| Some(*p) != session.me());
    match them {
        Some(pilot) => format!("{}'s", session.name_of(&pilot)),
        None => "the crew's".to_string(),
    }
}

fn ended_group(me: &mut StateSync, timer: TimerId, _: &mut Cx) {
    if let Some(live) = me.live.as_mut()
        && live.notices.timer == Some(timer)
    {
        live.notices.timer = None;
        live.notices.group.clear();
    }
}
