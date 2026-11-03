//! The desktop app's one window, and what its page asks of this side. A window costs about 70 MB while it lives and gives it
//! back once destroyed, and a hidden one keeps it, so closing it destroys it (measured on our development machine, 2026-10-18,
//! record/areas/install/log.md). It opens hidden and shows once its page has said how tall it is, so a pilot sees neither a white
//! frame nor a jump.

use std::path::PathBuf;
use std::sync::Mutex;

use messages::desktop::{DesktopState, ToDesktop};
use serde::Serialize;
use tauri::window::Color;
use tauri::{
    AppHandle, LogicalSize, Manager, State, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::sync::{mpsc, watch};

use crate::usage::{self, History, Line, Sampler, Usage};

/// The window's one label, by which a second open finds the first.
const WINDOW: &str = "main";
/// The window's width, which the page fills. `WIDTH` in src/platform/desktop-shell/dev/main.tsx names the same one, so change
/// both together.
const WIDTH: f64 = 400.0;
/// What stays clear of a screen's height, for its taskbar.
const SCREEN_MARGIN: f64 = 60.0;
/// The session file, which the core writes in the data folder while a session is held. `NAME` in
/// src/platform/session/src/file.rs names the same file, so change both together.
const SESSION_FILE: &str = "session.json";

/// What the window shows.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Screen {
    Main,
    Quit,
    Welcome,
}

impl Screen {
    fn name(self) -> &'static str {
        match self {
            Screen::Main => "main",
            Screen::Quit => "quit",
            Screen::Welcome => "welcome",
        }
    }
}

/// What the window's page reads from this side, which Tauri holds for the app's life.
pub struct Shared {
    pub sampler: Mutex<Sampler>,
    pub history: Option<History>,
    pub screen: Mutex<Screen>,
    pub state: watch::Receiver<DesktopState>,
    pub asks: mpsc::UnboundedSender<ToDesktop>,
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
    sim_has_run: bool,
}

/// `%APPDATA%\DualInput`, the core's data folder, where the session file is.
fn data_folder() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|data| PathBuf::from(data).join("DualInput"))
}

/// Whether the sim has written its `UserCfg.opt`, which names the packages folders our add-on goes in: Steam's, then the
/// Microsoft Store's. `USER_CFGS` in src/platform/sim-service/src/aircraft.rs and `userCfgs` in tools/lib/install.ts name the
/// same files, so change all three together.
fn sim_has_run() -> bool {
    let steam = std::env::var_os("APPDATA")
        .map(|data| PathBuf::from(data).join(r"Microsoft Flight Simulator 2024\UserCfg.opt"));
    let store = std::env::var_os("LOCALAPPDATA").map(|data| {
        PathBuf::from(data)
            .join(r"Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt")
    });
    [steam, store]
        .into_iter()
        .flatten()
        .any(|file| file.exists())
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
        .center()
        .visible(false)
        .theme(Some(Theme::Dark))
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
    View {
        screen: shared.screen.lock().map_or(Screen::Main, |screen| *screen),
        usage: figures,
        desktop: shared.state.borrow().clone(),
        sim_running: usage::sim_running(&usage::running()),
        session_held: data_folder().is_some_and(|folder| folder.join(SESSION_FILE).exists()),
        sim_has_run: sim_has_run(),
    }
}

#[tauri::command]
pub fn ask(ask: ToDesktop, shared: State<'_, Shared>) {
    let _ = shared.asks.send(ask);
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

/// TODO: when stage 15 has the app hold the core, send the session crate's Quit first.
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
