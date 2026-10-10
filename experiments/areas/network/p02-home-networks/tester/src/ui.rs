//! The window: its state, which the runner updates, and the screens drawn from it.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use eframe::egui::{self, Color32, RichText};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Screen {
    Launching,
    Consent,
    Running,
    Stopping,
    Done,
    Resending,
    Fatal,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StepState {
    Waiting,
    Active,
    Done,
    Skipped,
}

#[derive(Clone, Debug)]
pub struct Step {
    pub title: &'static str,
    pub detail: &'static str,
    pub planned_s: f64,
    pub state: StepState,
    pub started: Option<Instant>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Upload {
    NotYet,
    Sending { bytes: u64 },
    Sent,
    Failed { file: PathBuf },
}

pub struct UiState {
    pub screen: Screen,
    pub launch_line: String,
    pub steps: Vec<Step>,
    pub action: String,
    pub notes: Vec<String>,
    pub summary: Option<String>,
    pub upload: Upload,
    pub serving_until: Option<Instant>,
    pub confirm_close: bool,
    pub confirm_quit: bool,
    pub fatal: Option<String>,
    pub ctx: Option<egui::Context>,
}

#[derive(Clone)]
pub struct UiHandle(pub Arc<Mutex<UiState>>);

/// The steps as the window lists them; the planned lengths drive the progress bar.
pub fn plan() -> Vec<Step> {
    let s = |title, detail, planned_s| Step { title, detail, planned_s, state: StepState::Waiting, started: None };
    vec![
        s(
            "Checking your router",
            "Asking public STUN servers and our servers which public address and port your router gives this PC, whether it lets in packets from addresses this PC hasn't contacted, how long it keeps an unused port open, and whether it opens a port when asked (UPnP, NAT-PMP, PCP).",
            30.0,
        ),
        s(
            "Full upload for 1 minute",
            "Uploading as fast as your connection allows to our server for 1 minute, while timing a stream of session-sized packets beside it, to measure how much a busy upload delays them.",
            130.0,
        ),
        s(
            "Connecting to peers",
            "Opening 40 fresh connections, to copies of this program behind three kinds of simulated router on our server and to a copy on another tester's computer, and timing how long each takes to reach a direct link.",
            480.0,
        ),
        s(
            "Losing the direct link",
            "Blocking the direct link to a copy on our server in the middle of a session, and timing how long the connection takes to move to the relay server and back.",
            420.0,
        ),
        s(
            "Through the relay servers",
            "Sending session-sized traffic to another tester's computer through our relay servers in Frankfurt and New York, with 0%, 1%, and 3% of packets dropped, and with short outages.",
            1260.0,
        ),
        s("Sending the results", "Compressing the results file and uploading it to our server.", 45.0),
    ]
}

impl UiHandle {
    pub fn new() -> UiHandle {
        UiHandle(Arc::new(Mutex::new(UiState {
            screen: Screen::Launching,
            launch_line: "Opening network connections…".into(),
            steps: plan(),
            action: String::new(),
            notes: Vec::new(),
            summary: None,
            upload: Upload::NotYet,
            serving_until: None,
            confirm_close: false,
            confirm_quit: false,
            fatal: None,
            ctx: None,
        })))
    }

    pub fn with<R>(&self, f: impl FnOnce(&mut UiState) -> R) -> R {
        let mut g = self.0.lock().unwrap();
        let r = f(&mut g);
        if let Some(c) = &g.ctx {
            c.request_repaint();
        }
        r
    }

    pub fn screen(&self, s: Screen) {
        self.with(|u| u.screen = s);
    }

    pub fn step(&self, i: usize) {
        self.with(|u| {
            for (k, st) in u.steps.iter_mut().enumerate() {
                if k < i && st.state == StepState::Active {
                    st.state = StepState::Done;
                }
            }
            u.steps[i].state = StepState::Active;
            u.steps[i].started = Some(Instant::now());
            u.action.clear();
        });
    }

    pub fn finish_step(&self, i: usize, skipped: bool) {
        self.with(|u| u.steps[i].state = if skipped { StepState::Skipped } else { StepState::Done });
    }

    pub fn action(&self, a: impl Into<String>) {
        let a = a.into();
        self.with(|u| u.action = a);
    }

    pub fn note(&self, n: impl Into<String>) {
        let n = n.into();
        self.with(|u| {
            if !u.notes.contains(&n) {
                u.notes.push(n)
            }
        });
    }
}

/// The share of the planned run that's behind us, counting the active step by its elapsed time
/// up to 95% of its plan, so the bar never claims a step is done before it is.
fn progress(u: &UiState) -> (f32, f64) {
    let total: f64 = u.steps.iter().map(|s| s.planned_s).sum();
    let mut done = 0.0;
    let mut left = 0.0;
    for s in &u.steps {
        match s.state {
            StepState::Done | StepState::Skipped => done += s.planned_s,
            StepState::Active => {
                let e = s.started.map(|t| t.elapsed().as_secs_f64()).unwrap_or(0.0).min(s.planned_s * 0.95);
                done += e;
                left += s.planned_s - e;
            }
            StepState::Waiting => left += s.planned_s,
        }
    }
    ((done / total) as f32, left)
}

fn minutes(secs: f64) -> String {
    let m = (secs / 60.0).ceil() as u64;
    match m {
        0 | 1 => "About 1 minute left".into(),
        m => format!("About {m} minutes left"),
    }
}

pub enum Click {
    Start,
    Quit,
    StopConfirmed,
    CloseNow,
    ShowFile(PathBuf),
    RunAgain,
}

/// Text sizes and contrast for the whole window, set once at startup; light or dark follows
/// Windows' setting.
pub fn style(ctx: &egui::Context) {
    use egui::{FontFamily, FontId, TextStyle};
    ctx.all_styles_mut(|s| {
        s.text_styles = [
            (TextStyle::Heading, FontId::new(24.0, FontFamily::Proportional)),
            (TextStyle::Body, FontId::new(15.0, FontFamily::Proportional)),
            (TextStyle::Button, FontId::new(15.0, FontFamily::Proportional)),
            (TextStyle::Small, FontId::new(12.5, FontFamily::Proportional)),
            (TextStyle::Monospace, FontId::new(13.0, FontFamily::Monospace)),
        ]
        .into();
        s.spacing.button_padding = egui::vec2(16.0, 7.0);
        // Body text a step below white, so the title and the section labels stand out.
        let fg = if s.visuals.dark_mode { Color32::from_gray(196) } else { Color32::from_gray(50) };
        s.visuals.widgets.noninteractive.fg_stroke.color = fg;
    });
}

fn muted(ui: &egui::Ui) -> Color32 {
    if ui.visuals().dark_mode { Color32::from_gray(140) } else { Color32::from_gray(110) }
}

fn bright(ui: &egui::Ui) -> Color32 {
    if ui.visuals().dark_mode { Color32::from_gray(250) } else { Color32::from_gray(10) }
}

fn accent(ui: &egui::Ui) -> Color32 {
    if ui.visuals().dark_mode { Color32::from_rgb(120, 175, 230) } else { Color32::from_rgb(0, 90, 160) }
}

/// A rounded card a shade off the background, with a small colored label, so each part of a
/// screen reads as one block.
fn card(ui: &mut egui::Ui, label: &str, body: impl FnOnce(&mut egui::Ui)) {
    let fill = if ui.visuals().dark_mode { Color32::from_gray(36) } else { Color32::from_gray(242) };
    egui::Frame::new()
        .fill(fill)
        .corner_radius(8.0)
        .inner_margin(egui::Margin::symmetric(16, 12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            if !label.is_empty() {
                ui.label(RichText::new(label).size(12.5).strong().color(accent(ui)));
                ui.add_space(2.0);
            }
            body(ui);
        });
}

fn primary(text: &str) -> egui::Button<'static> {
    egui::Button::new(RichText::new(text).color(Color32::WHITE).strong())
        .fill(Color32::from_rgb(0, 110, 180))
        .min_size(egui::vec2(160.0, 36.0))
}

fn secondary(text: &str) -> egui::Button<'static> {
    egui::Button::new(RichText::new(text)).min_size(egui::vec2(96.0, 36.0))
}

fn heading(ui: &mut egui::Ui, t: &str) {
    ui.add_space(4.0);
    ui.label(RichText::new(t).heading().color(bright(ui)));
    ui.add_space(2.0);
}

/// A bullet whose wrapped lines stay indented under its first line.
fn bullet(ui: &mut egui::Ui, t: &str) {
    ui.horizontal_top(|ui| {
        ui.add_space(6.0);
        ui.label("•");
        ui.vertical(|ui| {
            ui.label(t);
        });
    });
}

pub fn draw(ui: &mut egui::Ui, h: &UiHandle) -> Option<Click> {
    let mut click = None;
    let mut u = h.0.lock().unwrap();
    if u.ctx.is_none() {
        u.ctx = Some(ui.ctx().clone());
    }
    let muted = muted(ui);
    let fill = ui.visuals().panel_fill;
    let rect = ui.max_rect();
    ui.painter().rect_filled(rect, 0.0, fill);
    egui::Frame::new().inner_margin(egui::Margin::symmetric(32, 24)).show(ui, |ui| {
        ui.set_max_width(660.0);
        ui.spacing_mut().item_spacing.y = 7.0;
        match u.screen {
            Screen::Launching => {
                heading(ui, "Crosscheck network test");
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label(&u.launch_line);
                });
            }
            Screen::Consent => {
                heading(ui, "Crosscheck network test");
                ui.label(RichText::new("About 40 minutes. Nothing to do once it starts.").size(16.0).color(bright(ui)));
                ui.add_space(14.0);
                card(ui, "WHILE IT RUNS", |ui| {
                    bullet(ui, "Keeps this PC awake. Closing this window stops the test.");
                    bullet(ui, "Uses your full upload speed for about 1 minute at the start. The rest of the time, the load on your PC and connection is very low.");
                    bullet(ui, "Connects to our relay servers and to copies of this program on our servers and other testers' computers.");
                });
                ui.add_space(10.0);
                card(ui, "WHEN IT'S DONE, IT UPLOADS ONE FILE TO OUR SERVER WITH", |ui| {
                    bullet(ui, "Measurements: connection times, delays, and losses");
                    bullet(ui, "Your network: wired or Wi-Fi, link speed, Wi-Fi signal, IPv6 addresses, and any network change, sleep, or resume");
                    bullet(ui, "This PC: CPU and memory load, and Windows version");
                    bullet(ui, "Your public IP address and the kind of router you're behind");
                });
                ui.add_space(8.0);
                ui.label(RichText::new("Nothing else leaves this PC: no files, names, or browsing history.").size(13.5).color(muted));
                ui.add_space(18.0);
                ui.horizontal(|ui| {
                    if ui.add(primary("Start the test")).clicked() {
                        click = Some(Click::Start);
                    }
                    ui.add_space(8.0);
                    if ui.add(secondary("Quit")).clicked() {
                        u.confirm_quit = true;
                    }
                });
            }
            Screen::Running | Screen::Stopping => {
                heading(ui, "Crosscheck network test");
                let (p, left) = progress(&u);
                ui.add(egui::ProgressBar::new(p).desired_height(18.0));
                ui.label(RichText::new(if u.screen == Screen::Stopping { "Stopping and sending what was measured so far…".to_string() } else { minutes(left) }).color(muted));
                ui.add_space(10.0);
                for (i, s) in u.steps.iter().enumerate() {
                    let (mark, color) = match s.state {
                        StepState::Done => ("✔", Color32::from_rgb(60, 160, 90)),
                        StepState::Active => ("▶", ui.visuals().strong_text_color()),
                        StepState::Skipped => ("–", muted),
                        StepState::Waiting => ("○", muted),
                    };
                    if s.state == StepState::Active {
                        ui.add_space(2.0);
                        card(ui, "", |ui| {
                            ui.horizontal(|ui| {
                                ui.label(RichText::new(mark).color(accent(ui)));
                                ui.label(RichText::new(format!("{}. {}", i + 1, s.title)).size(16.0).color(bright(ui)));
                            });
                            ui.add_space(2.0);
                            ui.label(s.detail);
                            if !u.action.is_empty() {
                                ui.add_space(2.0);
                                ui.label(RichText::new(&u.action).size(13.5).color(accent(ui)));
                            }
                        });
                        ui.add_space(2.0);
                    } else {
                        ui.horizontal(|ui| {
                            ui.add_space(16.0);
                            ui.label(RichText::new(mark).color(color));
                            let t = RichText::new(format!("{}. {}", i + 1, s.title));
                            ui.label(if s.state == StepState::Waiting { t.color(muted) } else { t });
                        });
                    }
                }
                notes(ui, &u.notes);
                ui.add_space(14.0);
                ui.label(RichText::new("Keep this window open. You can use your PC as usual, though large downloads or uploads will skew the measurements.").size(13.5).color(muted));
            }
            Screen::Done => {
                heading(ui, "Done. Thank you.");
                ui.add_space(8.0);
                card(ui, "RESULTS", |ui| {
                    if let Some(s) = &u.summary {
                        ui.label(s);
                    }
                    upload_status(ui, &u.upload, &mut click);
                });
                notes(ui, &u.notes);
                if let Some(until) = u.serving_until {
                    let left = until.saturating_duration_since(Instant::now());
                    ui.add_space(10.0);
                    card(ui, "STILL HELPING", |ui| {
                        ui.label(format!(
                            "This program stays open as a peer for other testers for up to {} more, at very low load, then closes itself.",
                            hm(left)
                        ));
                    });
                    ui.add_space(12.0);
                    if ui.add(secondary("Close now")).clicked() {
                        click = Some(Click::CloseNow);
                    }
                }
            }
            Screen::Resending => {
                heading(ui, "Crosscheck network test");
                match &u.upload {
                    Upload::Sent => {
                        ui.label("The results from your last test reached our server. Thank you.");
                        ui.add_space(12.0);
                        ui.horizontal(|ui| {
                            if ui.add(primary("Close")).clicked() {
                                click = Some(Click::Quit);
                            }
                            if ui.add(secondary("Run the test again")).clicked() {
                                click = Some(Click::RunAgain);
                            }
                        });
                    }
                    other => {
                        ui.label("Sending the results from your last test, which didn't reach our server then.");
                        upload_status(ui, other, &mut click);
                        if matches!(other, Upload::Failed { .. }) {
                            ui.add_space(8.0);
                            if ui.add(secondary("Close")).clicked() {
                                click = Some(Click::Quit);
                            }
                        }
                    }
                }
            }
            Screen::Fatal => {
                heading(ui, "Crosscheck network test");
                ui.label(u.fatal.clone().unwrap_or_default());
                ui.add_space(12.0);
                if ui.add(secondary("Close")).clicked() {
                    click = Some(Click::Quit);
                }
            }
        }
    });
    if u.confirm_close {
        egui::Modal::new(egui::Id::new("confirm_close")).show(ui.ctx(), |ui| {
            ui.set_max_width(380.0);
            ui.label(RichText::new("Stop the test?").strong().size(17.0));
            ui.label("It sends what it has measured so far to our server, then closes.");
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if ui.add(primary("Keep running")).clicked() {
                    u.confirm_close = false;
                }
                if ui.add(secondary("Stop and send")).clicked() {
                    click = Some(Click::StopConfirmed);
                }
            });
        });
    }
    // Quitting before the test starts asks first, so a stray click doesn't end it.
    if u.confirm_quit {
        egui::Modal::new(egui::Id::new("confirm_quit")).show(ui.ctx(), |ui| {
            ui.set_max_width(380.0);
            ui.label(RichText::new("Quit without running the test?").strong().size(17.0));
            ui.label("Nothing is sent, and the program closes.");
            ui.add_space(10.0);
            ui.horizontal(|ui| {
                if ui.add(primary("Go back")).clicked() {
                    u.confirm_quit = false;
                }
                if ui.add(secondary("Quit")).clicked() {
                    u.confirm_quit = false;
                    click = Some(Click::Quit);
                }
            });
        });
    }
    click
}

fn hm(d: Duration) -> String {
    let m = d.as_secs().div_ceil(60);
    match (m / 60, m % 60) {
        (0, m) => format!("{m} min"),
        (1, 0) => "1 hour".into(),
        (h, 0) => format!("{h} hours"),
        (h, m) => format!("{h} h {m} min"),
    }
}

fn notes(ui: &mut egui::Ui, notes: &[String]) {
    if notes.is_empty() {
        return;
    }
    ui.add_space(10.0);
    for n in notes {
        ui.label(RichText::new(n).italics());
    }
}

fn upload_status(ui: &mut egui::Ui, up: &Upload, click: &mut Option<Click>) {
    match up {
        Upload::NotYet => {}
        Upload::Sending { bytes } => {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label(format!("Uploading the results file ({:.1} MB) to our server…", *bytes as f64 / 1e6));
            });
        }
        Upload::Sent => {
            ui.label("The results file reached our server.");
        }
        Upload::Failed { file } => {
            ui.label("The results file couldn't reach our server. This program will try again the next time you open it.");
            ui.label("If you'd rather send it yourself, the file is here:");
            ui.horizontal_wrapped(|ui| {
                ui.monospace(file.display().to_string());
            });
            if ui.add(secondary("Show the file")).clicked() {
                *click = Some(Click::ShowFile(file.clone()));
            }
        }
    }
}
