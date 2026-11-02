//! The desktop app: a tray icon from login, with a window of its own screens the pilot opens from it, and the fixed local
//! port that tells the EFB app about updates and the firewall. A window costs about 70 MB while it lives and gives it back
//! once destroyed, and a hidden one keeps it, so closing the window destroys it (measured on our development machine,
//! 2026-10-18, record/areas/install/log.md).

// A release has no console. A debug build keeps one, or its messages would go nowhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod port;
mod start_with_windows;

use std::net::Ipv4Addr;

use messages::desktop::{DESKTOP_PORT, DesktopState, Firewall, ToDesktop, Update};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::{mpsc, watch};

/// The window's one label, by which a second open finds the first.
const WINDOW: &str = "main";
const OPEN_ITEM: &str = "open";
const QUIT_ITEM: &str = "quit";

/// Opens the window, or brings forward the one that's open.
fn open_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        // Focus alone leaves a minimized window where it is (read in tao 0.37.2, window.rs).
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let mut builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
        .title("Dual Input")
        .inner_size(520.0, 640.0)
        .min_inner_size(420.0, 480.0);
    // WebView2's data goes beside Velopack's folder, so an uninstall deletes it too
    // (record/areas/install/01-installing-and-updating.md, "On disk").
    if let Ok(local) = app.path().local_data_dir() {
        builder = builder.data_directory(local.join("DualInput").join("webview"));
    }
    if let Err(error) = builder.build() {
        eprintln!("the window didn't open: {error}");
    }
}

/// TODO: when stage 15 builds the desktop app's tray, add handing a second start's request to the running app, Quit asking
/// once and sending the session crate's Quit, and the usage line.
fn tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("tauri.conf.json names an icon");
    let settings = MenuItemBuilder::with_id(OPEN_ITEM, "Settings…").build(app)?;
    let quit = MenuItemBuilder::with_id(QUIT_ITEM, "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
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
            OPEN_ITEM => open_window(app),
            QUIT_ITEM => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Carries out what the EFB app asks. TODO: when the app holds Velopack's updates, the sim's restart, and the firewall rule, carry them out here.
fn ask_handler(say: watch::Sender<DesktopState>) -> mpsc::UnboundedSender<ToDesktop> {
    let (ask, mut asks) = mpsc::unbounded_channel();
    tauri::async_runtime::spawn(async move {
        while let Some(asked) = asks.recv().await {
            match asked {
                ToDesktop::SetStartWithWindows { on } => {
                    if let Err(error) = start_with_windows::set(on) {
                        eprintln!("starting with Windows didn't change: {error}");
                    }
                    say.send_modify(|state| state.start_with_windows = start_with_windows::is_on());
                }
                ToDesktop::CheckForUpdates
                | ToDesktop::InstallUpdate
                | ToDesktop::RestartSim
                | ToDesktop::FixFirewall => {}
            }
        }
    });
    ask
}

/// Serves the local port. If another program holds it, the EFB app shows no update, and a developer's second desktop app runs without the server.
fn serve_port() {
    let state = DesktopState {
        update: Update::Current { checked: None },
        firewall: Firewall::Allows,
        start_with_windows: start_with_windows::is_on(),
    };
    let (say, hear) = watch::channel(state);
    let asks = ask_handler(say);
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, DESKTOP_PORT)).await {
            Ok(listener) => port::serve(listener, hear, asks).await,
            Err(error) => eprintln!(
                "the local port {DESKTOP_PORT} is held, so this app runs without it: {error}"
            ),
        }
    });
}

fn main() {
    let tray_only = std::env::args().any(|arg| arg == "--tray");
    let app = tauri::Builder::default()
        .setup(move |app| {
            tray(app.handle())?;
            serve_port();
            if !tray_only {
                open_window(app.handle());
            }
            Ok(())
        })
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
