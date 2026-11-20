//! The input thread: a hidden window that receives Raw Input in sink mode, which gets a copy
//! of input whatever window is in front and sits in no program's input path, as our probe
//! p08's helper registered keyboards, joysticks, and gamepads
//! (record/areas/core/04-core-helper.md, "Raw Input"). Only what a want asks for crosses to
//! the core, so no recording or bug report holds what the pilot typed into another program.

mod buttons;
mod keys;
mod mouse;
mod windows_of;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, mpsc};

use messages::core_helper::{FromHelper, Input as Bound, WantId, Wants};
use windows::Win32::Devices::HumanInterfaceDevice::{
    HID_USAGE_PAGE_BUTTON, HIDP_STATUS_SUCCESS, HidD_GetProductString, HidP_GetUsages, HidP_Input,
    PHIDP_PREPARSED_DATA,
};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, WPARAM};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyNameTextW;
use windows::Win32::UI::Input::{
    GetRawInputData, GetRawInputDeviceInfoW, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RID_INPUT, RIDEV_DEVNOTIFY, RIDEV_INPUTSINK, RIDEV_REMOVE, RIDI_DEVICENAME, RIDI_PREPARSEDDATA,
    RIM_TYPEHID, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DispatchMessageW, GIDC_ARRIVAL, GetMessageW, MSG, PostThreadMessageW,
    RI_KEY_BREAK, RI_KEY_E0, RI_MOUSE_LEFT_BUTTON_DOWN, RI_MOUSE_LEFT_BUTTON_UP,
    RI_MOUSE_RIGHT_BUTTON_DOWN, RI_MOUSE_RIGHT_BUTTON_UP, RI_MOUSE_WHEEL, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_APP, WM_INPUT, WM_INPUT_DEVICE_CHANGE,
};
use windows::core::{PCWSTR, w};

use crate::clock;
use crate::pipe::Out;
use buttons::Buttons;
use keys::Keys;
use mouse::{MouseState, Report};

/// The thread message that tells the input thread its wants changed.
const WANTS_CHANGED: u32 = WM_APP;

/// The Generic Desktop page's usages (documented, HID Usage Tables 1.5): the mouse, joysticks,
/// gamepads, keyboards, and multi-axis controllers.
const GENERIC_DESKTOP: u16 = 1;
const MOUSE: u16 = 2;
const KEYS_AND_BUTTONS: [u16; 4] = [4, 5, 6, 8];

/// What the input thread carries out of the wants.
#[derive(Clone, Default, PartialEq)]
struct InputWants {
    bindings: Vec<(u16, Bound)>,
    next_press: bool,
    mouse: bool,
}

/// The input thread, from the main thread's side.
pub struct Input {
    thread: u32,
    wants: Arc<Mutex<InputWants>>,
}

impl Input {
    pub fn start(out: Out) -> Input {
        let wants = Arc::new(Mutex::new(InputWants::default()));
        let (started, thread) = mpsc::channel();
        let shared = wants.clone();
        std::thread::Builder::new()
            .name("input".into())
            .spawn(move || {
                // A thread has no message queue until it makes its first window, and a post
                // to a thread with none fails, so the thread's ID goes out only once its window
                // is made (documented, PostThreadMessageW).
                let reader = Reader::new(out.clone(), shared);
                // SAFETY: GetCurrentThreadId takes nothing and can't fail.
                let _ = started.send(unsafe { GetCurrentThreadId() });
                match reader {
                    Ok(mut reader) => reader.run(),
                    Err(error) => {
                        for want in [WantId::NextPress, WantId::Mouse] {
                            out.send(FromHelper::Failed {
                                want,
                                error: format!("the input window didn't open: {error}"),
                            });
                        }
                    }
                }
            })
            .expect("the input thread should start");
        Input {
            thread: thread.recv().unwrap_or(0),
            wants,
        }
    }

    pub fn set(&self, wants: &Wants) {
        *self.wants.lock().unwrap_or_else(|p| p.into_inner()) = InputWants {
            bindings: wants.bindings.clone(),
            next_press: wants.next_press,
            mouse: wants.mouse,
        };
        // The thread reads the wants as it starts its message loop, so wants set before then
        // aren't lost, and each post after tells it to read them again.
        // SAFETY: PostThreadMessageW posts to a thread by its ID, which outlives the helper.
        let _ = unsafe { PostThreadMessageW(self.thread, WANTS_CHANGED, WPARAM(0), LPARAM(0)) };
    }
}

/// A flight-hardware device Raw Input names by its handle.
struct Device {
    vendor: u16,
    product: u16,
    /// Its product's name, or its IDs where it gives none.
    name: String,
    preparsed: Vec<u8>,
}

struct Reader {
    out: Out,
    shared: Arc<Mutex<InputWants>>,
    window: HWND,
    wants: InputWants,
    /// Whether the next press is still to be reported: it's armed when the core turns it on,
    /// and reports once.
    armed: bool,
    keys_registered: bool,
    mouse_registered: bool,
    keys: Keys,
    buttons: Buttons,
    mouse: MouseState,
    devices: BTreeMap<isize, Option<Device>>,
    /// The bindings whose press crossed, so their release crosses too.
    pressed: BTreeSet<u16>,
    sim: windows_of::SimWindow,
}

impl Reader {
    fn new(out: Out, shared: Arc<Mutex<InputWants>>) -> windows::core::Result<Reader> {
        // Raw Input in sink mode delivers to a window, though this one never shows, nor
        // takes the focus.
        // SAFETY: a STATIC window of no size, owned by this thread, with static strings.
        let window = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!("Dual Input's core helper"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                None,
                None,
                None,
                None,
            )?
        };
        Ok(Reader {
            out,
            shared,
            window,
            wants: InputWants::default(),
            armed: false,
            keys_registered: false,
            mouse_registered: false,
            keys: Keys::default(),
            buttons: Buttons::default(),
            mouse: MouseState::default(),
            devices: BTreeMap::new(),
            pressed: BTreeSet::new(),
            sim: windows_of::SimWindow::default(),
        })
    }

    fn run(&mut self) {
        self.wants_changed();
        let mut message = MSG::default();
        // SAFETY: GetMessageW fills `message` for this thread's window and thread messages.
        while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
            match message.message {
                WANTS_CHANGED => self.wants_changed(),
                WM_INPUT => self.input(HRAWINPUT(message.lParam.0 as _)),
                WM_INPUT_DEVICE_CHANGE => {
                    // A device that arrives sets its buttons again with its first report,
                    // and so does one that comes back.
                    let device = message.lParam.0;
                    if message.wParam.0 == GIDC_ARRIVAL as usize {
                        self.devices.remove(&device);
                    }
                    self.buttons.forget(device);
                }
                _ => {}
            }
            // SAFETY: `message` came from GetMessageW.
            unsafe { DispatchMessageW(&message) };
        }
    }

    fn wants_changed(&mut self) {
        let wants = self
            .shared
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        if wants.next_press && !self.wants.next_press {
            self.armed = true;
        }
        if !wants.next_press {
            self.armed = false;
        }
        self.wants = wants;
        let keys = !self.wants.bindings.is_empty() || self.wants.next_press;
        if keys != self.keys_registered {
            match self.register(&KEYS_AND_BUTTONS, keys) {
                Ok(()) => {
                    self.keys_registered = keys;
                    // A key released, or a button moved, while nothing read them would
                    // otherwise look held, or cross as a press, once they're read again.
                    if !keys {
                        self.keys = Keys::default();
                        self.buttons = Buttons::default();
                        self.pressed.clear();
                    }
                }
                Err(error) => {
                    let error =
                        format!("Raw Input refused the keyboards and flight hardware: {error}");
                    for (binding, _) in &self.wants.bindings {
                        self.out.send(FromHelper::Failed {
                            want: WantId::Binding(*binding),
                            error: error.clone(),
                        });
                    }
                    if self.wants.next_press {
                        self.out.send(FromHelper::Failed {
                            want: WantId::NextPress,
                            error,
                        });
                    }
                }
            }
        }
        if self.wants.mouse != self.mouse_registered {
            match self.register(&[MOUSE], self.wants.mouse) {
                Ok(()) => {
                    self.mouse_registered = self.wants.mouse;
                    if !self.wants.mouse {
                        self.mouse = MouseState::default();
                    }
                }
                Err(error) => self.out.send(FromHelper::Failed {
                    want: WantId::Mouse,
                    error: format!("Raw Input refused the mouse: {error}"),
                }),
            }
        }
        self.pressed
            .retain(|binding| self.wants.bindings.iter().any(|(b, _)| b == binding));
    }

    fn register(&self, usages: &[u16], on: bool) -> windows::core::Result<()> {
        let devices: Vec<RAWINPUTDEVICE> = usages
            .iter()
            .map(|&usage| RAWINPUTDEVICE {
                usUsagePage: GENERIC_DESKTOP,
                usUsage: usage,
                dwFlags: if on {
                    RIDEV_INPUTSINK | RIDEV_DEVNOTIFY
                } else {
                    RIDEV_REMOVE
                },
                hwndTarget: if on { self.window } else { HWND::default() },
            })
            .collect();
        // SAFETY: the slice holds whole RAWINPUTDEVICEs of the size given.
        unsafe {
            windows::Win32::UI::Input::RegisterRawInputDevices(
                &devices,
                size_of::<RAWINPUTDEVICE>() as u32,
            )
        }
    }

    fn input(&mut self, handle: HRAWINPUT) {
        let at = clock::now();
        let header = size_of::<RAWINPUTHEADER>() as u32;
        let mut size = 0;
        // SAFETY: with no buffer, GetRawInputData writes the size it needs.
        unsafe { GetRawInputData(handle, RID_INPUT, None, &mut size, header) };
        // u64s, so the buffer is aligned for RAWINPUT.
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        // SAFETY: the buffer holds `size` bytes, as GetRawInputData asked.
        let read = unsafe {
            GetRawInputData(
                handle,
                RID_INPUT,
                Some(buffer.as_mut_ptr().cast()),
                &mut size,
                header,
            )
        };
        if read != size || (size as usize) < size_of::<RAWINPUTHEADER>() {
            return;
        }
        // SAFETY: GetRawInputData wrote a RAWINPUT of `size` bytes into the aligned buffer.
        let raw = unsafe { &*(buffer.as_ptr() as *const RAWINPUT) };
        match raw.header.dwType {
            t if t == RIM_TYPEKEYBOARD.0 => {
                // SAFETY: a keyboard's report holds a RAWKEYBOARD.
                let k = unsafe { raw.data.keyboard };
                // Windows sends a fake key, 0xFF, with some keys' sequences.
                if k.VKey != 0xff {
                    let key = (k.MakeCode, u32::from(k.Flags) & RI_KEY_E0 != 0);
                    let down = u32::from(k.Flags) & RI_KEY_BREAK == 0;
                    self.key(key, down, at);
                }
            }
            t if t == RIM_TYPEHID.0 => self.hid(raw, &buffer, size as usize, at),
            t if t == RIM_TYPEMOUSE.0 => {
                // SAFETY: a mouse's report holds a RAWMOUSE.
                let m = unsafe { raw.data.mouse };
                // SAFETY: the button flags are the union's 16-bit pair.
                let (flags, data) = unsafe {
                    (
                        u32::from(m.Anonymous.Anonymous.usButtonFlags),
                        m.Anonymous.Anonymous.usButtonData as i16,
                    )
                };
                // A tablet or remote desktop reports absolute places, which aren't counts.
                let relative = m.usFlags.0 & 1 == 0;
                let report = Report {
                    left_down: flags & RI_MOUSE_LEFT_BUTTON_DOWN != 0,
                    left_up: flags & RI_MOUSE_LEFT_BUTTON_UP != 0,
                    right_down: flags & RI_MOUSE_RIGHT_BUTTON_DOWN != 0,
                    right_up: flags & RI_MOUSE_RIGHT_BUTTON_UP != 0,
                    wheel: if flags & RI_MOUSE_WHEEL != 0 {
                        i32::from(data)
                    } else {
                        0
                    },
                    dx: if relative { m.lLastX } else { 0 },
                    dy: if relative { m.lLastY } else { 0 },
                };
                self.mouse(report, at);
            }
            _ => {}
        }
    }

    fn key(&mut self, key: keys::Key, down: bool, at: u64) {
        if !self.keys.changes(key, down) {
            return;
        }
        let input = Bound::Key {
            scan: key.0,
            extended: key.1,
        };
        // While a pilot binds, a press acts on nothing else, or pressing the key already bound
        // to keep it would take control mid-flight. Its release finds no press that crossed.
        if down && self.armed {
            if self.keys.binds(key) {
                self.armed = false;
                self.out.send(FromHelper::NextPress {
                    input,
                    name: key_name(key),
                    at,
                });
            }
            return;
        }
        // A bound key counts only while a window of the sim is in front, its main window or
        // a popped-out display, so a key typed in another program takes nothing (user,
        // 2026-10-17), though a release whose press crossed always crosses.
        let in_sim = windows_of::sim_in_front();
        self.press(&input, down, in_sim, at);
    }

    fn press(&mut self, input: &Bound, down: bool, counts: bool, at: u64) {
        for (binding, bound) in &self.wants.bindings {
            if bound != input {
                continue;
            }
            let crossed = if down {
                counts && self.pressed.insert(*binding)
            } else {
                self.pressed.remove(binding)
            };
            if crossed {
                self.out.send(FromHelper::Press {
                    binding: *binding,
                    down,
                    at,
                });
            }
        }
    }

    fn hid(&mut self, raw: &RAWINPUT, buffer: &[u64], size: usize, at: u64) {
        let handle = raw.header.hDevice.0 as isize;
        let Some(device) = self
            .devices
            .entry(handle)
            .or_insert_with(|| device(raw.header.hDevice))
        else {
            return;
        };
        // SAFETY: a HID report holds a RAWHID, whose reports follow its two counts.
        let hid = unsafe { raw.data.hid };
        let report_size = hid.dwSizeHid as usize;
        let reports = hid.dwCount as usize;
        let start = std::mem::offset_of!(RAWINPUT, data) + 8;
        if report_size == 0 || start + report_size * reports > size {
            return;
        }
        // SAFETY: `buffer` holds `size` bytes, and the reports lie within them.
        let bytes = unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), size) };
        let mut changes = Vec::new();
        for r in 0..reports {
            let mut report = bytes[start + r * report_size..start + (r + 1) * report_size].to_vec();
            let mut usages = [0u16; 128];
            let mut count = usages.len() as u32;
            // SAFETY: the preparsed data is the device's, and the report is one of its own.
            let status = unsafe {
                HidP_GetUsages(
                    HidP_Input,
                    HID_USAGE_PAGE_BUTTON,
                    None,
                    usages.as_mut_ptr(),
                    &mut count,
                    PHIDP_PREPARSED_DATA(device.preparsed.as_ptr() as isize),
                    &mut report,
                )
            };
            if status != HIDP_STATUS_SUCCESS {
                continue;
            }
            let down = usages[..count as usize].iter().copied();
            changes.extend(self.buttons.report(handle, down));
        }
        let (vendor, product, name) = (device.vendor, device.product, device.name.clone());
        for change in changes {
            let input = Bound::Button {
                vendor,
                product,
                button: change.button,
            };
            // As for a key: while a pilot binds, a press acts on nothing else.
            if change.down && self.armed {
                self.armed = false;
                self.out.send(FromHelper::NextPress {
                    input,
                    name: format!("{name} button {}", change.button),
                    at,
                });
                continue;
            }
            // A bound button counts whatever is in front, since nobody types on a yoke.
            self.press(&input, change.down, true, at);
        }
    }

    fn mouse(&mut self, report: Report, at: u64) {
        let kinds = self.mouse.report(report, at);
        if kinds.is_empty() {
            return;
        }
        let place = self.sim.place_if_in_front();
        for kind in kinds {
            if !mouse::crosses(&kind, place.as_ref().map(|p| (p.x, p.y))) {
                continue;
            }
            let (x, y, width, height) = place
                .as_ref()
                .map_or((0.0, 0.0, 0, 0), |p| (p.x, p.y, p.width, p.height));
            self.out.send(FromHelper::Mouse {
                kind,
                x,
                y,
                width,
                height,
                at,
            });
        }
    }
}

/// A key's name to show it by, in the keyboard's own layout.
fn key_name((scan, extended): keys::Key) -> String {
    let lparam = (i32::from(scan) << 16) | (i32::from(extended) << 24);
    let mut name = [0u16; 64];
    // SAFETY: GetKeyNameTextW writes at most the buffer's length.
    let length = unsafe { GetKeyNameTextW(lparam, &mut name) };
    match length {
        n if n > 0 => String::from_utf16_lossy(&name[..n as usize]),
        _ => format!("key {scan:#04x}{}", if extended { " (E0)" } else { "" }),
    }
}

/// A HID device's IDs, name, and preparsed data, or `None` for a device without them.
fn device(handle: HANDLE) -> Option<Device> {
    let path = device_info(handle, RIDI_DEVICENAME)?;
    let path: Vec<u16> = path
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|&c| c != 0)
        .collect();
    let text = String::from_utf16_lossy(&path).to_uppercase();
    // A device's name is a path such as \\?\HID#VID_044F&PID_B10A&..., as p08 read it.
    let id = |key: &str| {
        let at = text.find(key)? + key.len();
        u16::from_str_radix(text.get(at..at + 4)?, 16).ok()
    };
    let vendor = id("VID_")?;
    let product = id("PID_")?;
    let preparsed = device_info(handle, RIDI_PREPARSEDDATA)?;
    let name = product_name(&path).unwrap_or_else(|| format!("{vendor:04X}:{product:04X}"));
    Some(Device {
        vendor,
        product,
        name,
        preparsed,
    })
}

fn device_info(
    handle: HANDLE,
    command: windows::Win32::UI::Input::RAW_INPUT_DEVICE_INFO_COMMAND,
) -> Option<Vec<u8>> {
    let mut size = 0;
    // SAFETY: with no buffer, GetRawInputDeviceInfoW writes the size it needs, in bytes for
    // preparsed data and in characters for a name.
    unsafe { GetRawInputDeviceInfoW(Some(handle), command, None, &mut size) };
    if size == 0 {
        return None;
    }
    let bytes = if command == RIDI_DEVICENAME {
        size as usize * 2
    } else {
        size as usize
    };
    let mut buffer = vec![0u8; bytes];
    // SAFETY: the buffer holds what GetRawInputDeviceInfoW asked for.
    let read = unsafe {
        GetRawInputDeviceInfoW(
            Some(handle),
            command,
            Some(buffer.as_mut_ptr().cast()),
            &mut size,
        )
    };
    (read != u32::MAX).then_some(buffer)
}

/// The product's name a HID device gives, such as "Saitek Pro Flight Throttle Quadrant".
fn product_name(path: &[u16]) -> Option<String> {
    let mut wide: Vec<u16> = path.to_vec();
    wide.push(0);
    // SAFETY: opening a HID device with no access reads only its strings, and the handle
    // is closed below.
    let file = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
    }
    .ok()?;
    let mut name = [0u16; 128];
    // SAFETY: HidD_GetProductString writes at most the buffer's size in bytes.
    let ok =
        unsafe { HidD_GetProductString(file, name.as_mut_ptr().cast(), (name.len() * 2) as u32) };
    // SAFETY: the handle came from CreateFileW above.
    let _ = unsafe { CloseHandle(file) };
    if !ok {
        return None;
    }
    let length = name.iter().position(|&c| c == 0).unwrap_or(name.len());
    let name = String::from_utf16_lossy(&name[..length]).trim().to_string();
    (!name.is_empty()).then_some(name)
}
