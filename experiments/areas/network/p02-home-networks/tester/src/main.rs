//! The Crosscheck network test: the program friends run for node 2.3's probe. The window runs
//! on the main thread; the measurements run on a tokio runtime of their own, and the two share
//! the window's state.
#![windows_subsystem = "windows"]

mod checks;
mod ctx;
mod run;
mod steps;
mod ui;
mod upload;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use eframe::egui;
use tokio::sync::mpsc;
use ui::{Click, Screen, UiHandle};

struct App {
    ui: UiHandle,
    tx: mpsc::UnboundedSender<Click>,
    exit: Arc<AtomicBool>,
    closing: bool,
    shots: Option<Shots>,
}

/// With `P02_SHOTS` set to a folder, saves a PNG of the window whenever the screen changes and
/// every 30s, so we can check the window's copy and layout without someone at the PC.
struct Shots {
    dir: std::path::PathBuf,
    last_screen: Option<Screen>,
    last: std::time::Instant,
    n: u32,
}

impl Shots {
    fn tick(&mut self, ctx: &egui::Context, screen: Screen) {
        if self.last_screen != Some(screen) || self.last.elapsed() > Duration::from_secs(30) {
            self.last_screen = Some(screen);
            self.last = std::time::Instant::now();
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.dir.join("shots.log"))
                .and_then(|mut f| std::io::Write::write_all(&mut f, format!("asked {screen:?}\n").as_bytes()));
        }
        let images: Vec<Arc<egui::ColorImage>> = ctx.input(|i| {
            i.events
                .iter()
                .chain(i.raw.events.iter())
                .filter_map(|e| if let egui::Event::Screenshot { image, .. } = e { Some(image.clone()) } else { None })
                .collect()
        });
        for img in images {
            self.n += 1;
            let file = self.dir.join(format!("{:03}-{:?}.png", self.n, screen));
            let [w, h] = img.size;
            let mut rgba = Vec::with_capacity(w * h * 4);
            for p in &img.pixels {
                rgba.extend_from_slice(&p.to_array());
            }
            if let Ok(f) = std::fs::File::create(&file) {
                let mut enc = png::Encoder::new(std::io::BufWriter::new(f), w as u32, h as u32);
                enc.set_color(png::ColorType::Rgba);
                enc.set_depth(png::BitDepth::Eight);
                if let Ok(mut wr) = enc.write_header() {
                    let _ = wr.write_image_data(&rgba);
                }
            }
        }
    }
}

impl eframe::App for App {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if let Some(s) = self.shots.as_mut() {
            let screen = self.ui.0.lock().unwrap().screen;
            s.tick(ctx, screen);
        }
        if self.exit.load(Ordering::Relaxed) && !self.closing {
            self.closing = true;
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        if ctx.input(|i| i.viewport().close_requested()) && !self.closing {
            let screen = self.ui.0.lock().unwrap().screen;
            match screen {
                Screen::Running => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
                    self.ui.with(|u| u.confirm_close = true);
                }
                Screen::Stopping | Screen::Launching => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
                }
                Screen::Done => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
                    let _ = self.tx.send(Click::CloseNow);
                }
                Screen::Consent => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
                    self.ui.with(|u| u.confirm_quit = true);
                }
                Screen::Resending => {
                    ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
                    let _ = self.tx.send(Click::Quit);
                }
                Screen::Fatal => {}
            }
        }
        ctx.request_repaint_after(Duration::from_millis(250));
    }

    fn clear_color(&self, visuals: &egui::Visuals) -> [f32; 4] {
        visuals.panel_fill.to_normalized_gamma_f32()
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        if let Some(c) = ui::draw(ui, &self.ui) {
            match c {
                Click::ShowFile(p) => {
                    let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", p.display())).spawn();
                }
                Click::StopConfirmed => {
                    self.ui.with(|u| u.confirm_close = false);
                    let _ = self.tx.send(Click::StopConfirmed);
                }
                other => {
                    let _ = self.tx.send(other);
                }
            }
        }
    }
}

fn main() {
    p02_common::install_crypto();
    p02_common::sysmon::tune_process();
    let ui = UiHandle::new();
    let (tx, rx) = mpsc::unbounded_channel();
    let exit = Arc::new(AtomicBool::new(false));
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime");
    {
        let (ui, exit) = (ui.clone(), exit.clone());
        std::thread::spawn(move || rt.block_on(run::app_main(ui, rx, exit)));
    }
    let make = |renderer: eframe::Renderer| eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Crosscheck network test")
            .with_inner_size([720.0, 660.0])
            .with_min_inner_size([560.0, 520.0]),
        renderer,
        ..Default::default()
    };
    let app = |ui: UiHandle, tx: mpsc::UnboundedSender<Click>, exit: Arc<AtomicBool>| -> eframe::AppCreator<'static> {
        let shots = std::env::var_os("P02_SHOTS").map(|d| {
            let dir = std::path::PathBuf::from(d);
            let _ = std::fs::create_dir_all(&dir);
            Shots { dir, last_screen: None, last: std::time::Instant::now(), n: 0 }
        });
        Box::new(move |cc| {
            ui::style(&cc.egui_ctx);
            Ok(Box::new(App { ui, tx, exit, closing: false, shots }))
        })
    };
    // wgpu draws through Direct3D 12 or Vulkan; a PC with neither falls back to OpenGL.
    let first = eframe::run_native("Crosscheck network test", make(eframe::Renderer::Wgpu), app(ui.clone(), tx.clone(), exit.clone()));
    if first.is_err() && !exit.load(Ordering::Relaxed) {
        let _ = eframe::run_native("Crosscheck network test", make(eframe::Renderer::Glow), app(ui, tx, exit));
    }
}
