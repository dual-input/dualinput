//! What the apps see of the session: its slice, and each sharing card's switch, which claims
//! its role's key (record/areas/interface/01-apps.md, "Slices and commands";
//! record/areas/interface/decisions.md, "Traffic and ATC audio are shared apart, each by a
//! switch of its own").

use kernel::{Cx, Verdict, View};
use messages::net::PilotId;
use messages::session::{self as wire, Role, SessionSlice, Share, SliceMember};

use crate::{Ready, Session, WriteKeys};
use messages::hex;

/// The slice `session`.
pub(crate) fn build(me: &Session, view: &View) -> SessionSlice {
    let attempt = me.attempt();
    let refused = me.refused.clone();
    let Some(held) = me.held.as_ref().filter(|h| !h.attempting()) else {
        return SessionSlice {
            attempt,
            refused,
            ..SessionSlice::default()
        };
    };
    let colors = me.colors();
    let members = me
        .members()
        .into_iter()
        .map(|pilot| {
            let ready = me.member_key(wire::READY, &pilot).unwrap_or_default();
            SliceMember {
                pilot: hex(&pilot),
                name: me
                    .member_key(wire::MEMBER, &pilot)
                    .map(|e| e.name)
                    .unwrap_or_default(),
                color: colors.get(&pilot).copied().unwrap_or(0),
                status: me.member_key(wire::STATUS, &pilot).unwrap_or_default(),
                in_flight: me.in_flight(&pilot),
                ready: ready.ready,
                without: ready.without.iter().map(|p| hex(p)).collect(),
            }
        })
        .collect();
    SessionSlice {
        held: true,
        code: Some(held.code.clone()),
        me: Some(hex(&held.me)),
        pf: me.pf().map(|p| hex(&p)),
        members,
        preflight: me.preflight(),
        differences: me.differences(),
        ready: reasons(view.verdict::<Ready>()),
        share: reasons(view.verdict::<WriteKeys>()),
        roles: me
            .declared
            .iter()
            .filter_map(|(&key, declared)| {
                Some(Role {
                    key,
                    label: declared.label?.to_string(),
                    holder: holder(me, key).map(|p| hex(&p)),
                })
            })
            .collect(),
        attempt,
        refused,
    }
}

/// A verdict as the slice shows it: why not, empty when allowed.
fn reasons(verdict: Option<Verdict>) -> Option<Vec<String>> {
    verdict.map(|v| match v {
        Verdict::Allowed => Vec::new(),
        Verdict::Denied(reasons) => reasons,
    })
}

/// The member a role's key names.
fn holder(me: &Session, key: u16) -> Option<PilotId> {
    me.held
        .as_ref()?
        .store
        .get(key, None)?
        .value
        .as_deref()
        .and_then(crate::decode::<Option<PilotId>>)
        .flatten()
}

/// The sharing cards' switches as this pilot would turn them on now: every role's key naming
/// this pilot, which the kernel keeps a verdict on, so a switch says why not before it's
/// touched. A guard refuses a role's key whether the request writes it alone or with others, so
/// one verdict serves every switch.
pub(crate) fn build_share(me: &Session, _: &View) -> Option<WriteKeys> {
    let mine = me.me()?;
    let writes: Vec<(u16, Option<Vec<u8>>)> = me
        .declared
        .iter()
        .filter(|(_, d)| d.names_member)
        .map(|(&key, _)| (key, Some(crate::encode(&Some(mine)))))
        .collect();
    (!writes.is_empty()).then_some(WriteKeys { writes })
}

/// `session.share`: on claims the role's key for this pilot, from whoever holds it, and off
/// releases it if this pilot holds it.
pub(crate) fn share(me: &mut Session, args: Share, cx: &mut Cx) -> Result<(), String> {
    let Some(mine) = me.me() else {
        return Err("There's no session".into());
    };
    if !me.declared.get(&args.key).is_some_and(|d| d.names_member) {
        return Err(format!("No feature has a role with the key {}", args.key));
    }
    let value = if args.on {
        if let Some(Verdict::Denied(reasons)) = cx.verdict::<WriteKeys>() {
            return Err(reasons.join(". "));
        }
        Some(crate::encode(&Some(mine)))
    } else if holder(me, args.key) == Some(mine) {
        None
    } else {
        return Ok(());
    };
    cx.ask(WriteKeys {
        writes: vec![(args.key, value)],
    });
    Ok(())
}
