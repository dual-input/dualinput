//! The desktop app: a tray icon from login that does a watcher's jobs, with a window of its own screens the pilot opens from
//! it, and the fixed local port that tells the EFB app about updates and the firewall.

// A release has no console. A debug build keeps one, or its messages would go nowhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod jobs;
mod log;
mod one_app;
mod places;
mod port;
mod processes;
mod screens;
mod start_with_windows;
mod usage;

use std::cell::Cell;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use messages::desktop::{DESKTOP_PORT, DesktopState, Firewall, ToDesktop, Update};
use one_app::{Claim, Request};
use screens::{Screen, Shared};
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, Wry};
use tokio::sync::{mpsc, watch};
use usage::{History, Line, Sampler};
use velopack::VelopackApp;

const USAGE_ITEM: &str = "usage";
const SETTINGS_ITEM: &str = "settings";
const QUIT_ITEM: &str = "quit";
/// The development setting that names another port for the EFB app's link, so the bench's app runs beside a pilot's.
const PORT_SETTING: &str = "desktop.port";

/// The tray icon, and the menu's usage line for the samples to keep current. Quit opens the window's ask rather than ending the
/// app, so a pilot sees what it costs first.
fn tray(app: &AppHandle, first_line: &str) -> tauri::Result<MenuItem<Wry>> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("tauri.conf.json names an icon");
    let usage_line = MenuItemBuilder::with_id(USAGE_ITEM, first_line).build(app)?;
    let settings = MenuItemBuilder::with_id(SETTINGS_ITEM, "Settings…").build(app)?;
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
            USAGE_ITEM | SETTINGS_ITEM => screens::open(app, Screen::Main),
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
        let mut sample_again = jobs::every(usage::SAMPLE_EVERY);
        // An interval's first tick comes at once, and a first sample would read next to nothing.
        sample_again.tick().await;
        let mut until_trim = usage::TRIM_EVERY;
        loop {
            sample_again.tick().await;
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

/// Serves the local port, and hands what the EFB app asks to the jobs. If another program holds the port, the EFB app shows
/// no update, and a developer's second desktop app runs without the server.
fn serve_port(app: AppHandle, hear: watch::Receiver<DesktopState>) {
    let port = places::setting(PORT_SETTING)
        .and_then(|value| value.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .unwrap_or(DESKTOP_PORT);
    let (asks, mut asked) = mpsc::unbounded_channel::<ToDesktop>();
    tauri::async_runtime::spawn(async move {
        while let Some(ask) = asked.recv().await {
            app.state::<Shared>().ask(ask);
        }
    });
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => port::serve(listener, hear, asks).await,
            Err(error) => log::line(&format!(
                "the local port {port} is held, so this app runs without it: {error}"
            )),
        }
    });
}

/// The program's arguments: `--tray`, from the Run value at login and after an update; `--data <folder>`, a development
/// core's data folder; `--start-sim <program>`, after an update that closed the sim; and `--fix-firewall`, for the elevated
/// copy.
struct Args {
    tray: bool,
    data: Option<PathBuf>,
    start_sim: Option<PathBuf>,
    fix_firewall: bool,
}

fn args() -> Args {
    let mut found = Args {
        tray: false,
        data: None,
        start_sim: None,
        fix_firewall: false,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--tray" => found.tray = true,
            "--data" => found.data = args.next().map(PathBuf::from),
            jobs::START_SIM_FLAG => found.start_sim = args.next().map(PathBuf::from),
            jobs::FIX_FLAG => found.fix_firewall = true,
            _ => {}
        }
    }
    found
}

fn main() {
    let args = args();
    places::set_data_folder(args.data.clone());
    // The elevated copy acts on its flag first, before the check that hands a second start to the running app, since the
    // running app is what started it and waits on it.
    if args.fix_firewall {
        jobs::fix_and_exit();
    }
    // Velopack runs its hooks here, each of which exits once it's done, and says whether this is the first run after an
    // install. Auto-apply is off, since the jobs apply an update only once nothing holds it, and Update.exe would kill the
    // core under a pilot's session (record/areas/install/01-installing-and-updating.md, "The installer and the updater").
    // The log isn't open yet, so the uninstall hook can delete the data folder it's in.
    let first_run = Cell::new(false);
    VelopackApp::build()
        .set_auto_apply_on_startup(false)
        .on_after_install_fast_callback(|_| jobs::installed())
        .on_before_uninstall_fast_callback(|_| jobs::uninstalling())
        .on_first_run(|_| first_run.set(true))
        .run();
    let first_run = first_run.get();
    log::start();
    let request = if first_run {
        Request::Open(Screen::Welcome)
    } else if args.tray || args.start_sim.is_some() {
        Request::Tray
    } else {
        Request::Open(Screen::Main)
    };
    let server = match one_app::claim(places::data_folder(), request) {
        Ok(Claim::First(server)) => Some(server),
        Ok(Claim::Handed) => {
            log::line(&format!(
                "handed {request:?} to the app already running, and exits"
            ));
            return;
        }
        Err(error) => {
            log::line(&format!(
                "the check for a running app failed, so this one runs: {error}"
            ));
            None
        }
    };
    log::line(&format!(
        "Dual Input's desktop app {} starts{}{}",
        env!("CARGO_PKG_VERSION"),
        if first_run { " for the first time" } else { "" },
        if args.tray { " in the tray" } else { "" },
    ));
    let start_sim = args.start_sim;
    // Until the jobs read the rules, a later start takes them as in, so the EFB app shows no firewall trouble for that moment.
    let firewall = if first_run {
        jobs::firewall_now()
    } else {
        Firewall::Allows
    };
    let app = tauri::Builder::default()
        .setup(move |app| {
            let (say, hear) = watch::channel(DesktopState {
                update: Update::Current { checked: None },
                firewall,
                start_with_windows: start_with_windows::state(),
            });
            let (jobs, heard) = mpsc::unbounded_channel();
            let history = Some(History::in_folder(&places::app_folder()));
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
                jobs: jobs.clone(),
                fixing_firewall: AtomicBool::new(false),
            });
            jobs::start(
                app.handle().clone(),
                say,
                jobs::Start { start_sim },
                jobs,
                heard,
            );
            let usage_line = tray(app.handle(), &first_line)?;
            record_usage(app.handle().clone(), usage_line);
            serve_port(app.handle().clone(), hear);
            if let Some(server) = server {
                let handle = app.handle().clone();
                one_app::serve(server, move |request| {
                    if let Request::Open(screen) = request {
                        screens::open(&handle, screen);
                    }
                });
            }
            if let Request::Open(screen) = request {
                screens::open(app.handle(), screen);
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
    // With its last window gone, Tauri exits unless told not to, and a tray app has to outlive its window; an exit with a code,
    // from Quit anyway or an update, still goes through.
    app.run(|_app, event| {
        if let RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
        }
    });
}
