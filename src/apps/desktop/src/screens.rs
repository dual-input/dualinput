//! The desktop app's one window, and what its page asks of this side. A window costs 73 MB to 114 MB while it lives and gives
//! it back once destroyed, and a hidden one keeps it, so closing it destroys it (measured on our development machine, 2026-10-18,
//! record/areas/install/log.md, and 2026-11-04, record/areas/interface/log.md). It opens hidden and shows once its page has said
//! how tall it is, so a pilot sees neither a white frame nor a jump.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use messages::desktop::{DesktopState, ToDesktop};
use serde::Serialize;
use tauri::window::Color;
use tauri::{
    AppHandle, LogicalSize, Manager, State, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::sync::{mpsc, watch};

use crate::jobs::Event;
use crate::usage::{self, History, Line, Sampler, Usage};
use crate::{places, processes};

/// The window's one label, by which a second open finds the first.
const WINDOW: &str = "main";
/// The window's width, which the page fills. `WIDTH` in src/platform/desktop-shell/dev/main.tsx names the same one, so change
/// both together.
const WIDTH: f64 = 400.0;
/// What stays clear of a screen's height, for its taskbar.
const SCREEN_MARGIN: f64 = 60.0;

/// What the window shows.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Screen {
    Main,
    Quit,
    Welcome,
}

impl Screen {
    pub fn name(self) -> &'static str {
        match self {
            Screen::Main => "main",
            Screen::Quit => "quit",
            Screen::Welcome => "welcome",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        [Screen::Main, Screen::Quit, Screen::Welcome]
            .into_iter()
            .find(|screen| screen.name() == name)
    }
}

/// What the window's page reads from this side, which Tauri holds for the app's life.
pub struct Shared {
    pub sampler: Mutex<Sampler>,
    pub history: Option<History>,
    pub screen: Mutex<Screen>,
    pub state: watch::Receiver<DesktopState>,
    pub jobs: mpsc::UnboundedSender<Event>,
    /// Whether the firewall's fix runs, from its ask until the rules are read again, which the welcome waits on.
    pub fixing_firewall: AtomicBool,
}

impl Shared {
    /// Hands an ask, from the window or the EFB app, to the jobs. The welcome takes the rule still missing with no fix running
    /// for a declined UAC prompt, and reads the view again once its ask returns, so a fix is marked running here, before the
    /// jobs loop takes the ask. A fix asked while one runs goes nowhere.
    pub fn ask(&self, ask: ToDesktop) {
        if matches!(ask, ToDesktop::FixFirewall)
            && self.fixing_firewall.swap(true, Ordering::Relaxed)
        {
            return;
        }
        let _ = self.jobs.send(Event::Asked(ask));
    }
}

/// All the page shows, which it reads again every few seconds while it's open.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    screen: Screen,
    usage: Usage,
    desktop: DesktopState,
    sim_running: bool,
    session_held: bool,
    fixing_firewall: bool,
}

/// Opens the window on `screen`, or brings forward the one that's open and turns it there.
pub fn open(app: &AppHandle, screen: Screen) {
    let shared = app.state::<Shared>();
    if let Ok(mut held) = shared.screen.lock() {
        *held = screen;
    }
    if let Some(window) = app.get_webview_window(WINDOW) {
        // The page's global is the one way in that asks for no permission, since it has no capability file.
        let _ = window.eval(format!("window.dualInputShow('{}')", screen.name()));
        // Focus alone leaves a minimized window where it is (read in tao 0.37.2, window.rs).
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let mut builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
        // What the taskbar shows, since the page draws the title bar, with each screen's title.
        .title("Dual Input")
        .inner_size(WIDTH, 640.0)
        .resizable(false)
        .decorations(false)
        .shadow(true)
        .visible(false)
        .theme(Some(Theme::Dark))
        // The kit's `background`, for the moment before the page draws. tools/lib/desktop-pages.ts and
        // src/packages/ui/palette/palette.ts name the same color, so change all three together.
        .background_color(Color(10, 10, 10, 255));
    // WebView2's data goes beside Velopack's folder, so an uninstall deletes it too
    // (record/areas/install/01-installing-and-updating.md, "On disk").
    if let Ok(local) = app.path().local_data_dir() {
        builder = builder.data_directory(local.join("DualInput").join("webview"));
    }
    match builder.build() {
        Ok(_) => {
            if let Some(history) = &shared.history {
                history.add(Line::WindowOpened { at: usage::now() });
            }
        }
        Err(error) => crate::log::line(&format!("the window didn't open: {error}")),
    }
}

#[tauri::command]
pub fn view(shared: State<'_, Shared>) -> View {
    let now = usage::now();
    let mut figures = shared
        .history
        .as_ref()
        .map_or_else(Usage::default, |history| history.read(now));
    figures.now = now;
    // The file holds a sample a minute, and what's newest is the end of the chart: this window, as it opens.
    if let Ok(sampler) = shared.sampler.lock() {
        figures.samples.push(sampler.peek(now));
    }
    // The welcome takes the rule missing with no fix running for a declined prompt, and the jobs write the rules' state
    // before they clear the flag, so the flag is read first: a cleared flag then comes with the state written before it.
    let fixing_firewall = shared.fixing_firewall.load(Ordering::Acquire);
    View {
        screen: shared.screen.lock().map_or(Screen::Main, |screen| *screen),
        usage: figures,
        desktop: shared.state.borrow().clone(),
        sim_running: processes::sim_runs(),
        session_held: places::session_held(),
        fixing_firewall,
    }
}

#[tauri::command]
pub fn ask(ask: ToDesktop, shared: State<'_, Shared>) {
    shared.ask(ask);
}

/// Sizes the window to its page, as far as the screen lets it, shows it the first time, and answers the height it took, so a
/// page taller than that knows to scroll.
#[tauri::command]
pub fn fit(window: WebviewWindow, height: f64) -> f64 {
    let most = window
        .current_monitor()
        .ok()
        .flatten()
        .map_or(f64::MAX, |monitor| {
            monitor.size().height as f64 / monitor.scale_factor() - SCREEN_MARGIN
        });
    let shown = height.min(most);
    let _ = window.set_size(LogicalSize::new(WIDTH, shown));
    if !window.is_visible().unwrap_or(true) {
        // Only now, since centering for any other height could put a tall window's title bar above the screen.
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
    }
    shown
}

/// Moves the window with the mouse until the button comes up, as a press on Windows' own title bar does.
#[tauri::command]
pub fn drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
pub fn close(window: WebviewWindow) {
    let _ = window.destroy();
}

/// Quit anyway: the core leaves any session and exits before the app ends, so the crew sees a leave rather than a lost link.
#[tauri::command]
pub fn quit(shared: State<'_, Shared>) {
    let _ = shared.jobs.send(Event::Quit);
}
