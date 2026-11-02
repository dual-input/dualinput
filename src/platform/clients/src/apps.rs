//! What the clients crate holds for the apps alone: the banner's slice, and the command for a
//! click on a notification outside its action (record/areas/interface/01-apps.md, "Slices and
//! commands").

use kernel::{Cx, Job, JobId};
use messages::clients::{DISCORD_INVITE, EfbAppOrder, NotificationClicked, component};
use serde_json::Value;

use crate::{Clients, To, UNIT};

impl Clients {
    /// Whether a banner page's socket is open, for the slice `banner`.
    pub(crate) fn banner_open(&self) -> bool {
        self.sockets
            .values()
            .any(|c| c.component() == component::BANNER)
    }

    /// `OPEN_DISCORD`, from any client.
    pub(crate) fn open_discord(&mut self, cx: &Cx) -> Result<(), String> {
        cx.job(
            Job::open_link(DISCORD_INVITE),
            |_: &mut Clients, _: JobId, result: Result<Vec<u8>, String>, _: &mut Cx| {
                if let Err(error) = result {
                    tracing::warn!(%error, "our Discord couldn't be opened");
                }
            },
        );
        Ok(())
    }

    /// `NOTIFICATION_CLICKED`, from any client: the EFB app opens the EFB onto our app.
    pub(crate) fn notification_clicked(
        &mut self,
        socket: u64,
        args: Value,
        cx: &mut Cx,
    ) -> Result<(), String> {
        let NotificationClicked { id, landing } =
            serde_json::from_value(args).map_err(|e| format!("its arguments didn't read: {e}"))?;
        let from = self.component_of(socket);
        let efb_apps = self.connected(component::EFB_APP);
        // A notification that cleared as the click came still opens the EFB, since the pilot
        // asked to look (user, 2026-10-24).
        let up = self.notifications.contains_key(&id);
        if efb_apps == 0 {
            tracing::info!(
                id,
                up,
                from,
                "a notification was clicked outside its action, but no EFB app is connected to open the EFB"
            );
        } else {
            tracing::info!(
                id,
                up,
                from,
                ?landing,
                "a notification was clicked outside its action, so the EFB app opens the EFB onto our app"
            );
        }
        match serde_json::to_value(EfbAppOrder::OpenEfb { landing, id }) {
            Ok(body) => Clients::send_unit(
                self,
                (To::Component(component::EFB_APP.into()), UNIT.into(), body),
                cx,
            ),
            Err(error) => tracing::error!(%error, "the EFB app's order didn't encode as JSON"),
        }
        Ok(())
    }

    /// How many clients of `component` have said hello.
    fn connected(&self, component: &str) -> usize {
        self.sockets
            .values()
            .filter(|c| c.component() == component)
            .count()
    }
}
