// A tray app with an egui window, for p02, as tauri-tray is for p01. The probe
// passes the port of its WebSocket server as the only argument; a thread of this
// program connects to it and takes one command per message: open, hide, show,
// or close, answering each with "ok".
//
// eframe's window owns the thread's message loop while it's open, and run_native
// returns once the window closes, so between windows this program pumps the
// thread's messages itself, which the tray icon's hidden window needs too.

#![windows_subsystem = "windows"]

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use eframe::egui;
use egui_plot::{Line, Plot, PlotPoints};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tray_icon::{Icon, TrayIconBuilder};
use tungstenite::Message;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, PostThreadMessageW, ShowWindow, TranslateMessage, MSG, SW_HIDE, SW_SHOW, WM_APP,
};

enum Command {
    Open,
    Close,
}

type Request = (Command, Sender<String>);

// What the socket's thread needs to reach the window: its context, to wake its
// loop, and its handle, to hide and show it, since a hidden egui window may get
// no update() to act on a command in.
#[derive(Default)]
struct Window {
    context: Mutex<Option<egui::Context>>,
    hwnd: AtomicIsize,
}

struct App {
    requests: Arc<Mutex<Receiver<Request>>>,
    points: Vec<[f64; 2]>,
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        while let Ok((command, reply)) = self.requests.lock().expect("the lock isn't poisoned").try_recv() {
            let answer = match command {
                Command::Open => "error: open already".to_string(),
                Command::Close => {
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                    "ok".to_string()
                }
            };
            let _ = reply.send(answer);
        }
        egui::CentralPanel::default().show(ui, |ui| {
            ui.heading("p02: egui tray");
            Plot::new("frame-times").show(ui, |plot| {
                plot.line(Line::new("frame time", PlotPoints::from(self.points.clone())));
            });
        });
    }
}

// A static series, so the window has a graph to draw and nothing that moves.
fn points() -> Vec<[f64; 2]> {
    (0..600).map(|i| { let x = i as f64 / 10.0; [x, 16.7 + 2.0 * (x * 0.7).sin() + (x * 3.1).cos()] }).collect()
}

fn open(window: &Arc<Window>, requests: &Arc<Mutex<Receiver<Request>>>) {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_title("p02: egui tray").with_inner_size([480.0, 360.0]),
        run_and_return: true,
        ..Default::default()
    };
    let w = window.clone();
    let requests = requests.clone();
    let result = eframe::run_native(
        "p02-egui-tray",
        options,
        Box::new(move |cc| {
            *w.context.lock().expect("the lock isn't poisoned") = Some(cc.egui_ctx.clone());
            if let Ok(handle) = cc.window_handle() {
                if let RawWindowHandle::Win32(h) = handle.as_raw() {
                    w.hwnd.store(h.hwnd.get(), Ordering::SeqCst);
                }
            }
            Ok(Box::new(App { requests, points: points() }))
        }),
    );
    let _ = result;
    *window.context.lock().expect("the lock isn't poisoned") = None;
    window.hwnd.store(0, Ordering::SeqCst);
}

fn main() {
    let port: u16 = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(0);
    let rgba: Vec<u8> = (0..16 * 16).flat_map(|_| [0x74, 0xd4, 0xff, 0xff]).collect();
    let icon = Icon::from_rgba(rgba, 16, 16).expect("a 16 by 16 RGBA icon should be valid");
    let _tray = TrayIconBuilder::new().with_icon(icon).with_tooltip("p02: egui tray").build().expect("the tray icon should build");

    let main_thread = unsafe { GetCurrentThreadId() };
    let window = Arc::new(Window::default());
    let (send, receive) = channel::<Request>();
    let requests = Arc::new(Mutex::new(receive));

    if port != 0 {
        let window = window.clone();
        std::thread::spawn(move || {
            let Ok((mut ws, _)) = tungstenite::connect(format!("ws://127.0.0.1:{port}/?from=egui-tray")) else { return };
            while let Ok(message) = ws.read() {
                let Message::Text(text) = message else { continue };
                let hwnd = window.hwnd.load(Ordering::SeqCst);
                let answer = match text.as_str() {
                    "hide" | "show" if hwnd == 0 => "error: no window".to_string(),
                    "hide" | "show" => {
                        let how = if text.as_str() == "hide" { SW_HIDE } else { SW_SHOW };
                        unsafe { ShowWindow(hwnd as _, how) };
                        "ok".to_string()
                    }
                    "open" | "close" => {
                        let (reply, answer) = channel();
                        let command = if text.as_str() == "open" { Command::Open } else { Command::Close };
                        if send.send((command, reply)).is_err() { break }
                        // Whichever loop runs wakes: the window's, through its context,
                        // or this program's own, through a message to its thread.
                        if let Some(context) = window.context.lock().expect("the lock isn't poisoned").as_ref() { context.request_repaint() }
                        unsafe { PostThreadMessageW(main_thread, WM_APP, 0, 0) };
                        answer.recv_timeout(Duration::from_secs(5)).unwrap_or_else(|_| "no answer in 5s".to_string())
                    }
                    other => format!("unknown command {other}"),
                };
                if ws.send(Message::Text(answer.into())).is_err() { break }
            }
        });
    }

    let mut msg: MSG = unsafe { std::mem::zeroed() };
    while unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) } > 0 {
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let next = requests.lock().expect("the lock isn't poisoned").try_recv();
        if let Ok((command, reply)) = next {
            match command {
                Command::Open => {
                    let _ = reply.send("ok".to_string());
                    open(&window, &requests);
                }
                Command::Close => { let _ = reply.send("error: no window".to_string()); }
            }
        }
    }
}
