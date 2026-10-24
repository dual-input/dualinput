//! What the clients crate holds for the apps alone: the banner's slice, the command for a
//! click on a notification outside its action, and the command that brings the desktop app
//! forward, with the start of the desktop app's program it asks of the core's edge
//! (record/areas/interface/01-apps.md, "Slices and commands").

use kernel::Cx;
use messages::clients::{EfbAppOrder, NotificationClicked, component};
use serde::Serialize;
use serde_json::Value;

use crate::{Clients, To, UNIT};

/// Asks the core's edge to start the desktop app's program from the core's own folder. Its
/// one running copy for the core's data folder opens its window, or, with none running, the
/// program starts with its window open (record/areas/install/01-installing-and-updating.md,
/// "One program from login").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct StartDesktopApp;

impl Clients {
    /// Whether a banner page's socket is open, for the slice `banner`.
    pub(crate) fn banner_open(&self) -> bool {
        self.sockets
            .values()
            .any(|c| c.component() == component::BANNER)
    }

    /// `NOTIFICATION_CLICKED`, from any client: the EFB app opens the EFB onto our app.
    pub(crate) fn notification_clicked(
        &mut self,
        socket: u64,
        args: Value,
        cx: &mut Cx,
    ) -> Result<(), String> {
        let NotificationClicked { id } =
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
                "a notification was clicked outside its action, so the EFB app opens the EFB onto our app"
            );
        }
        match serde_json::to_value(EfbAppOrder::OpenEfb) {
            Ok(body) => Clients::send_unit(
                self,
                (To::Component(component::EFB_APP.into()), UNIT.into(), body),
                cx,
            ),
            Err(error) => tracing::error!(%error, "the EFB app's order didn't encode as JSON"),
        }
        Ok(())
    }

    /// `BRING_DESKTOP_FORWARD`, from any client: the core starts the desktop app's program
    /// whether or not a desktop app is connected, and the desktop app gets no message for it.
    pub(crate) fn bring_desktop_forward(
        &mut self,
        socket: u64,
        args: Value,
        cx: &mut Cx,
    ) -> Result<(), String> {
        serde_json::from_value::<()>(args)
            .map_err(|e| format!("its arguments didn't read: {e}"))?;
        tracing::info!(
            from = self.component_of(socket),
            desktop_apps = self.connected(component::DESKTOP),
            "a client asked for the desktop app, so the core starts its program, whose running copy opens its window"
        );
        cx.out(StartDesktopApp);
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
