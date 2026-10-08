//! p04's V8 host. It runs the plugin and the 100 write functions in V8 through
//! the v8 crate (rusty_v8), with a heap limit, a counting ArrayBuffer allocator,
//! and a watchdog thread as its time limit, and prints what each costs and
//! whether each limit held. p04-embedded-engine.mjs starts it and reads its lines:
//!
//!   p04-v8.exe <dist folder>
//!   p04-v8.exe <dist folder> default-allocator
//!   p04-v8.exe <dist folder> terminate <script> <ms>
//!
//! The second form only runs the buffer runaway in an isolate with the heap limit
//! and V8's default allocator, to show what the heap limit alone lets through.
//! The third runs one script with the watchdog armed for <ms> and a 512 MB heap,
//! and says whether termination stopped it.
//!
//! P04_V8_FLAGS passes V8 flags, such as --no-turbofan, and P04_TRACE prints a
//! line on stderr each time the near-heap-limit callback or the watchdog fires.

use std::alloc::Layout;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use p04_common::*;

thread_local! {
    static SINK: RefCell<Sink> = RefCell::new(Sink::default());
    static STORE: RefCell<HashMap<String, f64>> = RefCell::new(HashMap::new());
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dist = args.next().expect("usage: p04-v8 <dist folder> [default-allocator | terminate <script> <ms>]");
    let mode = args.next();
    let script = args.next();
    let limit_ms: u64 = args.next().and_then(|v| v.parse().ok()).unwrap_or(20);
    if !cap_process_memory() {
        emit("WARNING", &Json::new().str("warning", "no process memory cap").done());
    }
    let engine = std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || match mode.as_deref() {
            Some("default-allocator") => default_allocator(&dist),
            Some("terminate") => terminate(&script.expect("terminate needs a script"), limit_ms),
            _ => run(&dist),
        })
        .unwrap();
    if engine.join().is_err() {
        std::process::exit(101);
    }
}

fn init_platform() -> f64 {
    let t = Instant::now();
    if let Ok(flags) = std::env::var("P04_V8_FLAGS") {
        v8::V8::set_flags_from_string(&flags);
    }
    v8::V8::initialize_platform(v8::new_default_platform(0, false).make_shared());
    v8::V8::initialize();
    ms(t.elapsed())
}

fn run(dist: &str) {
    let bundles = Bundles::read(dist);
    let t0 = Instant::now();
    let platform_ms = init_platform();

    let budget = Arc::new(Budget::default());
    let allocator = unsafe { v8::new_rust_allocator(Arc::into_raw(budget.clone()), &BUDGET) };
    let params = v8::CreateParams::default().heap_limits(0, MEMORY_LIMIT).array_buffer_allocator(allocator);
    let isolate = &mut v8::Isolate::new(params);
    let guard = Box::into_raw(Box::new(HeapGuard { handle: isolate.thread_safe_handle(), hits: AtomicU32::new(0) }));
    isolate.add_near_heap_limit_callback(near_heap_limit, guard as *mut c_void);
    let watchdog = Watchdog::start(isolate.thread_safe_handle());

    v8::scope!(let hs, isolate);
    let context = v8::Context::new(hs, Default::default());
    let scope = &mut v8::ContextScope::new(hs, context);
    install(scope);
    let isolate_ms = ms(t0.elapsed()) - platform_ms;
    let mut evals = vec![];
    for src in [&bundles.plugin, &bundles.writers, &bundles.runaway] {
        let t = Instant::now();
        if let Err(e) = eval(scope, src) {
            return emit("FAILED", &Json::new().str("error", &e).done());
        }
        evals.push(ms(t.elapsed()));
    }
    let startup_ms = ms(t0.elapsed());
    emit(
        "READY",
        &Json::new()
            .str("engine", "V8")
            .str("version", v8::V8::get_version())
            .num("startup_ms", startup_ms)
            .num("platform_ms", platform_ms)
            .num("isolate_and_context_ms", isolate_ms)
            .num("eval_plugin_ms", evals[0])
            .num("eval_writers_ms", evals[1])
            .num("eval_runaway_ms", evals[2])
            .raw("heap", &heap(scope))
            .raw("memory", &memory().json())
            .done(),
    );

    if !wait_for("IDLE") {
        return;
    }
    emit("IDLE", &memory().json());
    if !wait_for("GO") {
        return;
    }

    emit("PLUGIN", &plugin(scope).unwrap_or_else(|e| Json::new().str("error", &e).done()));

    emit("FRAMES_READY", "{}");
    if !wait_for("BEGIN") {
        return;
    }
    let before = SINK.with(|s| *s.borrow());
    let (mut errors, mut last_error) = (0, String::new());
    let run = {
        v8::scope!(let hs, scope);
        let (writers, writer) = handles(hs);
        run_frames(|f| {
            watchdog.arm(TIME_LIMIT);
            frame(hs, &writers, writer, f, &mut errors, &mut last_error);
            if watchdog.disarm() {
                hs.cancel_terminate_execution();
            }
        })
    };
    let frames = run.json(&SINK.with(|s| s.borrow().since(&before)), errors);
    emit("FRAMES", &format!("{},\"last_error\":{:?},\"heap\":{},\"memory\":{}}}", &frames[..frames.len() - 1], last_error, heap(scope), memory().json()));
    if !wait_for("CONTINUE") {
        return;
    }

    let reference = check(scope, &watchdog);
    emit("CHECK", &reference.0.json());

    for (test, name, arg, limit) in RUNAWAYS {
        emit("START", &Json::new().str("test", test).done());
        let (threw, error, took, fired) = {
            v8::scope!(let hs, scope);
            let f = v8::Local::<v8::Function>::try_from(eval_value(hs, &format!("runawayBundle.{name}"))).unwrap();
            v8::tc_scope!(let tc, hs);
            let a = v8::Number::new(tc, arg).into();
            let recv = v8::undefined(tc).into();
            let t = Instant::now();
            watchdog.arm(limit);
            let r = f.call(tc, recv, &[a]);
            let fired = watchdog.disarm();
            let took = ms(t.elapsed());
            match r {
                Some(v) => (false, format!("returned {}", v.to_rust_string_lossy(tc)), took, fired),
                None => (true, exception(tc), took, fired),
            }
        };
        // Termination unwinds every JavaScript frame, and the isolate runs no
        // more script until the host cancels it.
        scope.cancel_terminate_execution();
        let hits = unsafe { &*guard }.hits.swap(0, Ordering::SeqCst);
        scope.low_memory_notification();
        if hits > 0 {
            // The callback raised the limit to let termination land; this puts
            // it back, and a removed callback has to be added again.
            scope.remove_near_heap_limit_callback(near_heap_limit, MEMORY_LIMIT);
            scope.add_near_heap_limit_callback(near_heap_limit, guard as *mut c_void);
        }
        let (after, after_errors) = check(scope, &watchdog);
        emit(
            "TEST",
            &Json::new()
                .str("test", test)
                .bool("threw", threw)
                .str("error", &error)
                .num("ms", took)
                .bool("watchdog_fired", fired)
                .int("heap_limit_hits", hits as u64)
                .int("buffer_refusals", budget.refused.swap(0, Ordering::SeqCst) as u64)
                .bool("host_ok", after == reference.0 && after_errors == 0)
                .raw("check", &after.json())
                .raw("heap", &heap(scope))
                .raw("memory", &memory().json())
                .done(),
        );
    }
    emit("DONE", &memory().json());
}

/// The buffer runaway in an isolate with the same heap limit and V8's default
/// ArrayBuffer allocator, which counts nothing against the heap limit.
fn default_allocator(dist: &str) {
    let bundles = Bundles::read(dist);
    init_platform();
    let params = v8::CreateParams::default().heap_limits(0, MEMORY_LIMIT);
    let isolate = &mut v8::Isolate::new(params);
    v8::scope!(let hs, isolate);
    let context = v8::Context::new(hs, Default::default());
    let scope = &mut v8::ContextScope::new(hs, context);
    eval(scope, &bundles.runaway).unwrap();
    let before = memory();
    let t = Instant::now();
    let result = {
        v8::tc_scope!(let tc, scope);
        let code = v8::String::new(tc, &format!("runawayBundle.allocBuffers({BUFFER_MB})")).unwrap();
        match v8::Script::compile(tc, code, None).and_then(|s| s.run(tc)) {
            Some(v) => format!("returned {}", v.to_rust_string_lossy(tc)),
            None => exception(tc),
        }
    };
    emit(
        "DEFAULT_ALLOCATOR",
        &Json::new()
            .str("result", &result)
            .num("ms", ms(t.elapsed()))
            .raw("heap", &heap(scope))
            .raw("before", &before.json())
            .raw("after", &memory().json())
            .done(),
    );
}

/// One script with the watchdog armed and a heap large enough that only
/// termination can stop it in time. If termination never lands, V8 ends the
/// process at the heap limit with a fatal out-of-memory error.
fn terminate(script: &str, limit_ms: u64) {
    init_platform();
    let params = v8::CreateParams::default().heap_limits(0, 512 << 20);
    let isolate = &mut v8::Isolate::new(params);
    let watchdog = Watchdog::start(isolate.thread_safe_handle());
    v8::scope!(let hs, isolate);
    let context = v8::Context::new(hs, Default::default());
    let scope = &mut v8::ContextScope::new(hs, context);
    let t = Instant::now();
    watchdog.arm(Duration::from_millis(limit_ms));
    let result = eval(scope, script);
    let fired = watchdog.disarm();
    let took = ms(t.elapsed());
    emit(
        "TERMINATE",
        &Json::new()
            .str("result", &result.err().unwrap_or_else(|| "returned".into()))
            .num("ms", took)
            .bool("watchdog_fired", fired)
            .raw("heap", &heap(scope))
            .done(),
    );
}

fn set_fn(scope: &mut v8::PinScope, obj: v8::Local<v8::Object>, name: &str, cb: impl v8::MapFnTo<v8::FunctionCallback>) {
    let f = v8::Function::new(scope, cb).unwrap();
    let k = v8::String::new(scope, name).unwrap();
    obj.set(scope, k.into(), f.into());
}

/// Puts `host` (for the plugin) and the writer (for the write functions) in the
/// global scope, each method a Rust function.
fn install(scope: &mut v8::PinScope) {
    let global = scope.get_current_context().global(scope);
    let host = v8::Object::new(scope);
    set_fn(scope, host, "read", host_read);
    set_fn(scope, host, "write", host_write);
    let k = v8::String::new(scope, "host").unwrap();
    global.set(scope, k.into(), host.into());

    let writer = v8::Object::new(scope);
    set_fn(scope, writer, "k", writer_k);
    set_fn(scope, writer, "l", writer_l);
    set_fn(scope, writer, "b", writer_b);
    set_fn(scope, writer, "h", writer_h);
    let k = v8::String::new(scope, "__writer").unwrap();
    global.set(scope, k.into(), writer.into());
}

fn num(scope: &mut v8::PinScope, args: &v8::FunctionCallbackArguments, i: i32) -> f64 {
    args.get(i).number_value(scope).unwrap_or(f64::NAN)
}

fn host_read(scope: &mut v8::PinScope, args: v8::FunctionCallbackArguments, mut rv: v8::ReturnValue) {
    let name = args.get(0).to_rust_string_lossy(scope);
    rv.set_double(STORE.with(|s| s.borrow().get(&name).copied().unwrap_or(0.0)));
}

fn host_write(scope: &mut v8::PinScope, args: v8::FunctionCallbackArguments, _rv: v8::ReturnValue) {
    let name = args.get(0).to_rust_string_lossy(scope);
    let v = num(scope, &args, 1);
    STORE.with(|s| s.borrow_mut().insert(name, v));
}

fn writer_k(scope: &mut v8::PinScope, args: v8::FunctionCallbackArguments, _rv: v8::ReturnValue) {
    let name = args.get(0).to_rust_string_lossy(scope);
    let n = (args.length() - 1).clamp(0, 2) as usize;
    let mut vals = [0.0; 2];
    for (i, v) in vals.iter_mut().enumerate().take(n) {
        *v = num(scope, &args, i as i32 + 1);
    }
    SINK.with(|s| s.borrow_mut().record(&name, &vals[..n]));
}

fn writer_l(scope: &mut v8::PinScope, args: v8::FunctionCallbackArguments, _rv: v8::ReturnValue) {
    let name = args.get(0).to_rust_string_lossy(scope);
    let v = num(scope, &args, 1);
    // QuickJS's host converts the unit too, so both pay for the same strings.
    std::hint::black_box(args.get(2).to_rust_string_lossy(scope));
    SINK.with(|s| s.borrow_mut().record(&name, &[v]));
}

fn writer_b(scope: &mut v8::PinScope, args: v8::FunctionCallbackArguments, _rv: v8::ReturnValue) {
    let name = args.get(0).to_rust_string_lossy(scope);
    let v = num(scope, &args, 1);
    SINK.with(|s| s.borrow_mut().record(&name, &[v]));
}

fn writer_h(scope: &mut v8::PinScope, args: v8::FunctionCallbackArguments, _rv: v8::ReturnValue) {
    let name = args.get(0).to_rust_string_lossy(scope);
    SINK.with(|s| s.borrow_mut().record(&name, &[]));
}

fn eval(scope: &mut v8::PinScope, src: &str) -> Result<(), String> {
    v8::tc_scope!(let tc, scope);
    let code = v8::String::new(tc, src).unwrap();
    match v8::Script::compile(tc, code, None).and_then(|s| s.run(tc)) {
        Some(_) => Ok(()),
        None => Err(exception(tc)),
    }
}

fn eval_value<'s>(scope: &mut v8::PinScope<'s, '_>, src: &str) -> v8::Local<'s, v8::Value> {
    let code = v8::String::new(scope, src).unwrap();
    v8::Script::compile(scope, code, None).unwrap().run(scope).unwrap()
}

fn exception(tc: &mut v8::PinnedRef<'_, v8::TryCatch<v8::HandleScope>>) -> String {
    if tc.has_terminated() {
        return "terminated by the host".into();
    }
    match tc.exception() {
        Some(e) => e.to_rust_string_lossy(tc),
        None => "no exception".into(),
    }
}

/// The 100 write functions in name order, and the writer they're called with.
fn handles<'s>(scope: &mut v8::PinScope<'s, '_>) -> (Vec<v8::Local<'s, v8::Function>>, v8::Local<'s, v8::Object>) {
    let list = eval_value(scope, "Object.keys(writersBundle).sort().map((k) => writersBundle[k])");
    let list = v8::Local::<v8::Array>::try_from(list).unwrap();
    let writers: Vec<_> = (0..list.length())
        .map(|i| v8::Local::<v8::Function>::try_from(list.get_index(scope, i).unwrap()).unwrap())
        .collect();
    assert_eq!(writers.len(), WRITERS);
    let writer = v8::Local::<v8::Object>::try_from(eval_value(scope, "__writer")).unwrap();
    (writers, writer)
}

/// One frame: every write function called once with its value for the frame,
/// each call in its own TryCatch, as a host would to keep one failing entry
/// from stopping the rest.
fn frame<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    writers: &[v8::Local<'s, v8::Function>],
    writer: v8::Local<'s, v8::Object>,
    f: u32,
    errors: &mut u64,
    last: &mut String,
) {
    v8::scope!(let hs, scope);
    let recv: v8::Local<v8::Value> = v8::undefined(hs).into();
    for (i, w) in writers.iter().enumerate() {
        v8::tc_scope!(let tc, hs);
        let v = v8::Number::new(tc, input(f, i)).into();
        if w.call(tc, recv, &[v, writer.into()]).is_none() {
            *errors += 1;
            *last = exception(tc);
        }
    }
}

/// Runs frames 0 to CHECK_FRAMES unpaced and returns what crossed into the
/// host, which matches across runs only if every write function still works.
fn check(scope: &mut v8::PinScope, watchdog: &Watchdog) -> (Sink, u64) {
    v8::scope!(let hs, scope);
    let (writers, writer) = handles(hs);
    let before = SINK.with(|s| *s.borrow());
    let (mut errors, mut last) = (0, String::new());
    for f in 0..CHECK_FRAMES {
        watchdog.arm(TIME_LIMIT);
        frame(hs, &writers, writer, f, &mut errors, &mut last);
        if watchdog.disarm() {
            hs.cancel_terminate_execution();
        }
    }
    (SINK.with(|s| s.borrow().since(&before)), errors)
}

fn get<'s>(scope: &mut v8::PinScope<'s, '_>, obj: v8::Local<'s, v8::Object>, key: &str) -> v8::Local<'s, v8::Value> {
    let k = v8::String::new(scope, key).unwrap();
    obj.get(scope, k.into()).unwrap()
}

/// Checks the plugin's values and write methods, then times 1,000 calls of each.
fn plugin(scope: &mut v8::PinScope) -> Result<String, String> {
    v8::scope!(let hs, scope);
    let p = v8::Local::<v8::Object>::try_from(eval_value(hs, "pluginBundle.plugin")).unwrap();
    let exports = v8::Local::<v8::Function>::try_from(get(hs, p, "exports")).unwrap();
    let write = v8::Local::<v8::Object>::try_from(get(hs, p, "write")).unwrap();
    let range = v8::Local::<v8::Function>::try_from(get(hs, write, "radar_range")).unwrap();
    let tilt = v8::Local::<v8::Function>::try_from(get(hs, write, "radar_tilt")).unwrap();

    let a = v8::Number::new(hs, 45.0).into();
    range.call(hs, write.into(), &[a]).ok_or("radar_range threw")?;
    let a = v8::Number::new(hs, -20.0).into();
    tilt.call(hs, write.into(), &[a]).ok_or("radar_tilt threw")?;
    let values = v8::Local::<v8::Object>::try_from(exports.call(hs, p.into(), &[]).ok_or("exports threw")?).unwrap();
    let range_nm = get(hs, values, "radar_range").number_value(hs).unwrap_or(f64::NAN);
    let tilt_deg = get(hs, values, "radar_tilt").number_value(hs).unwrap_or(f64::NAN);
    let ok = range_nm == 40.0 && tilt_deg == -15.0 && STORE.with(|s| s.borrow().get("RADAR_RANGE_INDEX") == Some(&2.0));

    let n = 1000;
    let t = Instant::now();
    for _ in 0..n {
        v8::scope!(let s, hs);
        v8::tc_scope!(let tc, s);
        exports.call(tc, p.into(), &[]).ok_or("exports threw")?;
    }
    let exports_us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
    let t = Instant::now();
    for i in 0..n {
        v8::scope!(let s, hs);
        v8::tc_scope!(let tc, s);
        let a = v8::Number::new(tc, (i % 400) as f64).into();
        range.call(tc, write.into(), &[a]).ok_or("radar_range threw")?;
    }
    let write_us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
    Ok(Json::new().bool("ok", ok).num("range_nm", range_nm).num("tilt_deg", tilt_deg).num("exports_us", exports_us).num("write_us", write_us).done())
}

fn heap(scope: &mut v8::PinScope) -> String {
    let s = scope.get_heap_statistics();
    Json::new()
        .mb("used_mb", s.used_heap_size())
        .mb("total_mb", s.total_heap_size())
        .mb("limit_mb", s.heap_size_limit())
        .mb("external_mb", s.external_memory())
        .done()
}

/// Stops a call that runs past its deadline, from a thread of its own, because
/// V8 checks for termination only when another thread asks for it.
struct Watchdog {
    shared: Arc<(Mutex<WatchState>, Condvar)>,
}

#[derive(Default)]
struct WatchState {
    deadline: Option<Instant>,
    fired: bool,
}

impl Watchdog {
    fn start(handle: v8::IsolateHandle) -> Watchdog {
        let shared = Arc::new((Mutex::new(WatchState::default()), Condvar::new()));
        let s = shared.clone();
        std::thread::spawn(move || {
            let (lock, cv) = &*s;
            let mut st = lock.lock().unwrap();
            loop {
                match st.deadline {
                    None => st = cv.wait(st).unwrap(),
                    Some(d) => {
                        let now = Instant::now();
                        if now >= d {
                            if std::env::var_os("P04_TRACE").is_some() {
                                eprintln!("watchdog fired");
                            }
                            handle.terminate_execution();
                            st.fired = true;
                            st.deadline = None;
                        } else {
                            st = cv.wait_timeout(st, d - now).unwrap().0;
                        }
                    }
                }
            }
        });
        Watchdog { shared }
    }

    fn arm(&self, limit: Duration) {
        let (lock, cv) = &*self.shared;
        let mut st = lock.lock().unwrap();
        st.deadline = Some(Instant::now() + limit);
        st.fired = false;
        cv.notify_one();
    }

    /// Says whether the watchdog fired. It may fire after the script returned
    /// and before this call, and then the host still has to cancel the
    /// termination, or the next call would stop at once.
    fn disarm(&self) -> bool {
        let (lock, _) = &*self.shared;
        let mut st = lock.lock().unwrap();
        st.deadline = None;
        std::mem::take(&mut st.fired)
    }
}

struct HeapGuard {
    handle: v8::IsolateHandle,
    hits: AtomicU32,
}

/// V8 calls this when the heap nears its limit. Without it, V8 ends the process
/// with a fatal out-of-memory error. It asks for termination, and raises the
/// limit so the script can run to the point where termination stops it.
unsafe extern "C" fn near_heap_limit(data: *mut c_void, current: usize, _initial: usize) -> usize {
    let guard = unsafe { &*(data as *const HeapGuard) };
    let hits = guard.hits.fetch_add(1, Ordering::SeqCst) + 1;
    if std::env::var_os("P04_TRACE").is_some() {
        eprintln!("near_heap_limit hit {hits}, limit {} MB", current >> 20);
    }
    guard.handle.terminate_execution();
    current + MEMORY_LIMIT
}

/// Counts the bytes of every ArrayBuffer and refuses one that would take the
/// total past MEMORY_LIMIT, because V8 keeps ArrayBuffer memory outside its
/// heap and the heap limit doesn't count it.
#[derive(Default)]
struct Budget {
    used: AtomicUsize,
    refused: AtomicU32,
}

impl Budget {
    fn reserve(&self, len: usize) -> bool {
        if self.used.fetch_add(len, Ordering::SeqCst) + len > MEMORY_LIMIT {
            self.used.fetch_sub(len, Ordering::SeqCst);
            self.refused.fetch_add(1, Ordering::SeqCst);
            return false;
        }
        true
    }
}

fn layout(len: usize) -> Layout {
    Layout::from_size_align(len.max(1), 16).unwrap()
}

unsafe extern "C" fn budget_allocate(b: &Budget, len: usize) -> *mut c_void {
    if !b.reserve(len) {
        return std::ptr::null_mut();
    }
    let p = unsafe { std::alloc::alloc_zeroed(layout(len)) };
    if p.is_null() {
        b.used.fetch_sub(len, Ordering::SeqCst);
    }
    p as *mut c_void
}

unsafe extern "C" fn budget_allocate_uninitialized(b: &Budget, len: usize) -> *mut c_void {
    if !b.reserve(len) {
        return std::ptr::null_mut();
    }
    let p = unsafe { std::alloc::alloc(layout(len)) };
    if p.is_null() {
        b.used.fetch_sub(len, Ordering::SeqCst);
    }
    p as *mut c_void
}

unsafe extern "C" fn budget_free(b: &Budget, data: *mut c_void, len: usize) {
    if !data.is_null() {
        unsafe { std::alloc::dealloc(data as *mut u8, layout(len)) };
        b.used.fetch_sub(len, Ordering::SeqCst);
    }
}

unsafe extern "C" fn budget_drop(b: *const Budget) {
    drop(unsafe { Arc::from_raw(b) });
}

static BUDGET: v8::RustAllocatorVtable<Budget> = v8::RustAllocatorVtable {
    allocate: budget_allocate,
    allocate_uninitialized: budget_allocate_uninitialized,
    free: budget_free,
    drop: budget_drop,
};
