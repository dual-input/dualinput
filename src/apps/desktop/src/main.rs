//! The desktop app: a tray icon from login, with a window of its own screens the pilot opens from it, and the fixed local
//! port that tells the EFB app about updates and the firewall. A window costs about 70 MB while it lives and gives it back
//! once destroyed, and a hidden one keeps it, so closing the window destroys it (measured on our development machine,
//! 2026-10-18, record/areas/install/log.md).

// A release has no console. A debug build keeps one, or its messages would go nowhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod log;
mod port;
mod screens;
mod start_with_windows;
mod usage;

use std::net::Ipv4Addr;
use std::sync::Mutex;
use std::time::Duration;

use messages::desktop::{DESKTOP_PORT, DesktopState, Firewall, ToDesktop, Update};
use screens::{Screen, Shared};
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, Wry};
use tokio::sync::{mpsc, watch};
use usage::{History, Line, Sampler};

const OPEN_ITEM: &str = "open";
const QUIT_ITEM: &str = "quit";
/// The EFB app's note sends a pilot to Windows' startup list to turn this back on, and Windows tells a running program
/// nothing of it, so without this the switch stays wrong until the app next starts (measured on Windows 11, 2026-11-02,
/// record/areas/install/log.md).
const READ_WINDOWS_EVERY: Duration = Duration::from_secs(5);

/// The tray icon, and the menu's usage line for the samples to keep current. Quit opens the window's ask rather than ending the
/// app, so a pilot sees what it costs first. TODO: when stage 15 builds the desktop app's tray, add handing a second start's
/// request to the running app.
fn tray(app: &AppHandle, first_line: &str) -> tauri::Result<MenuItem<Wry>> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("tauri.conf.json names an icon");
    let usage_line = MenuItemBuilder::with_id(OPEN_ITEM, first_line).build(app)?;
    let settings = MenuItemBuilder::with_id(OPEN_ITEM, "Settings…").build(app)?;
    let quit = MenuItemBuilder::with_id(QUIT_ITEM, "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&usage_line)
        .item(&settings)
        .separator()
        .item(&quit)
        .build()?;
    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Dual Input")
        .menu(&menu)
        // A left click opens the window, and a right click the menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_ITEM => screens::open(app, Screen::Main),
            QUIT_ITEM => screens::open(app, Screen::Quit),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                screens::open(tray.app_handle(), Screen::Main);
            }
        })
        .build(app)?;
    Ok(usage_line)
}

/// Takes a sample a minute for the window's charts and the tray menu's line, for as long as the app runs.
fn record_usage(app: AppHandle, usage_line: MenuItem<Wry>) {
    tauri::async_runtime::spawn(async move {
        let shared = app.state::<Shared>();
        let mut every = tokio::time::interval(usage::SAMPLE_EVERY);
        // An interval's first tick comes at once, and a first sample would read next to nothing.
        every.tick().await;
        let mut until_trim = usage::TRIM_EVERY;
        loop {
            every.tick().await;
            let now = usage::now();
            let Ok(sample) = shared.sampler.lock().map(|mut sampler| sampler.take(now)) else {
                return;
            };
            let _ = usage_line.set_text(usage::tray_line(&sample));
            if let Some(history) = &shared.history {
                history.add(Line::Sample(sample));
                until_trim -= 1;
                if until_trim == 0 {
                    history.trim(now);
                    until_trim = usage::TRIM_EVERY;
                }
            }
        }
    });
}

/// Carries out what the EFB app asks, and keeps what it shows of Windows' startup list true. TODO: when the app holds Velopack's updates, the sim's restart, and the firewall rule, carry them out here.
fn ask_handler(say: watch::Sender<DesktopState>) -> mpsc::UnboundedSender<ToDesktop> {
    let (ask, mut asks) = mpsc::unbounded_channel();
    tauri::async_runtime::spawn(async move {
        let mut read_again = tokio::time::interval(READ_WINDOWS_EVERY);
        loop {
            tokio::select! {
                asked = asks.recv() => match asked {
                    Some(ToDesktop::SetStartWithWindows { on }) => {
                        if let Err(error) = start_with_windows::set(on) {
                            log::line(&format!("starting with Windows didn't change: {error}"));
                        }
                    }
                    Some(
                        ToDesktop::CheckForUpdates
                        | ToDesktop::InstallUpdate
                        | ToDesktop::RestartSim
                        | ToDesktop::FixFirewall,
                    ) => {}
                    None => return,
                },
                _ = read_again.tick() => {}
            }
            let now = start_with_windows::state();
            say.send_if_modified(|state| {
                let changed = state.start_with_windows != now;
                state.start_with_windows = now;
                changed
            });
        }
    });
    ask
}

/// Serves the local port. If another program holds it, the EFB app shows no update, and a developer's second desktop app runs without the server.
fn serve_port(hear: watch::Receiver<DesktopState>, asks: mpsc::UnboundedSender<ToDesktop>) {
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, DESKTOP_PORT)).await {
            Ok(listener) => port::serve(listener, hear, asks).await,
            Err(error) => log::line(&format!(
                "the local port {DESKTOP_PORT} is held, so this app runs without it: {error}"
            )),
        }
    });
}

fn main() {
    log::start();
    let tray_only = std::env::args().any(|arg| arg == "--tray");
    // Velopack's Setup.exe starts the app with this after an install (record/areas/interface/decisions.md, "The desktop app
    // shows Velopack's windows and its own figures, and the build designs the rest").
    let first_run = std::env::args().any(|arg| arg == "--first-run");
    log::line(&format!(
        "Dual Input's desktop app {} starts{}",
        env!("CARGO_PKG_VERSION"),
        if tray_only { " in the tray" } else { "" }
    ));
    let app = tauri::Builder::default()
        .setup(move |app| {
            let (say, hear) = watch::channel(DesktopState {
                update: Update::Current { checked: None },
                firewall: Firewall::Allows,
                start_with_windows: start_with_windows::state(),
            });
            let asks = ask_handler(say);
            let history = log::folder().map(|folder| History::in_folder(&folder));
            if let Some(history) = &history {
                history.trim(usage::now());
            }
            let sampler = Sampler::new();
            let first_line = usage::tray_line(&sampler.peek(usage::now()));
            app.manage(Shared {
                sampler: Mutex::new(sampler),
                history,
                screen: Mutex::new(Screen::Main),
                state: hear.clone(),
                asks: asks.clone(),
            });
            let usage_line = tray(app.handle(), &first_line)?;
            record_usage(app.handle().clone(), usage_line);
            serve_port(hear, asks);
            if first_run {
                screens::open(app.handle(), Screen::Welcome);
            } else if !tray_only {
                screens::open(app.handle(), Screen::Main);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            screens::view,
            screens::ask,
            screens::fit,
            screens::drag,
            screens::close,
            screens::quit,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let _ = window.destroy();
            }
        })
        .build(tauri::generate_context!())
        .expect("the Tauri app should build");
    // With its last window gone, Tauri exits unless told not to, and a tray app has to outlive its window; an exit with a code, from the tray's Quit, still goes through.
    app.run(|_app, event| {
        if let RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
        }
    });
}
