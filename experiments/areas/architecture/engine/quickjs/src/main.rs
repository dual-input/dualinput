//! p04's QuickJS host. It runs the plugin and the 100 write functions in
//! QuickJS-ng through rquickjs, with the runtime's memory limit and an interrupt
//! handler as its time limit, and prints what each costs and whether each limit
//! held. p04-embedded-engine.mjs starts it and reads its lines:
//!
//!   p04-quickjs.exe <dist folder>

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ffi::CStr;
use std::rc::Rc;
use std::time::Instant;

use p04_common::*;
use rquickjs::function::{Opt, This};
use rquickjs::{Array, Context, Ctx, Function, Object, Runtime, Value};

type Shared<T> = Rc<RefCell<T>>;

/// The interrupt handler stops a call once this instant has passed.
type Deadline = Rc<Cell<Option<Instant>>>;

fn main() {
    let dist = std::env::args().nth(1).expect("usage: p04-quickjs <dist folder>");
    if !cap_process_memory() {
        emit("WARNING", &Json::new().str("warning", "no process memory cap").done());
    }
    let engine = std::thread::Builder::new().stack_size(STACK).spawn(move || run(&dist)).unwrap();
    if engine.join().is_err() {
        std::process::exit(101);
    }
}

fn run(dist: &str) {
    let bundles = Bundles::read(dist);
    let version = unsafe { CStr::from_ptr(rquickjs::qjs::JS_GetVersion()) }.to_string_lossy().into_owned();
    let sink: Shared<Sink> = Default::default();
    let store: Shared<HashMap<String, f64>> = Default::default();
    let deadline: Deadline = Default::default();

    let t0 = Instant::now();
    let rt = Runtime::new().unwrap();
    rt.set_memory_limit(MEMORY_LIMIT);
    let d = deadline.clone();
    rt.set_interrupt_handler(Some(Box::new(move || d.get().is_some_and(|t| Instant::now() >= t))));
    let ctx = Context::full(&rt).unwrap();
    let context_ms = ms(t0.elapsed());
    let evals = ctx.with(|ctx| -> Result<Vec<f64>, String> {
        install(&ctx, &sink, &store).map_err(|e| describe(&ctx, e))?;
        let mut evals = vec![];
        for src in [&bundles.plugin, &bundles.writers, &bundles.runaway] {
            let t = Instant::now();
            ctx.eval::<(), _>(src.as_str()).map_err(|e| describe(&ctx, e))?;
            evals.push(ms(t.elapsed()));
        }
        Ok(evals)
    });
    let startup_ms = ms(t0.elapsed());
    let evals = match evals {
        Ok(e) => e,
        Err(e) => return emit("FAILED", &Json::new().str("error", &e).done()),
    };
    emit(
        "READY",
        &Json::new()
            .str("engine", "QuickJS-ng")
            .str("version", &version)
            .num("startup_ms", startup_ms)
            .num("runtime_and_context_ms", context_ms)
            .num("eval_plugin_ms", evals[0])
            .num("eval_writers_ms", evals[1])
            .num("eval_runaway_ms", evals[2])
            .raw("heap", &heap(&rt))
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

    emit("PLUGIN", &ctx.with(|ctx| plugin(&ctx, &store).unwrap_or_else(|e| Json::new().str("error", &describe(&ctx, e)).done())));

    emit("FRAMES_READY", "{}");
    if !wait_for("BEGIN") {
        return;
    }
    let before = *sink.borrow();
    let mut errors = 0;
    let mut last_error = String::new();
    let run = ctx.with(|ctx| {
        let (writers, writer) = handles(&ctx);
        run_frames(|f| {
            deadline.set(Some(Instant::now() + TIME_LIMIT));
            frame(&ctx, &writers, &writer, f, &mut errors, &mut last_error);
            deadline.set(None);
        })
    });
    let frames = run.json(&sink.borrow().since(&before), errors);
    emit("FRAMES", &format!("{},\"last_error\":{:?},\"heap\":{},\"memory\":{}}}", &frames[..frames.len() - 1], last_error, heap(&rt), memory().json()));
    if !wait_for("CONTINUE") {
        return;
    }

    let reference = ctx.with(|ctx| check(&ctx, &sink, &deadline));
    emit("CHECK", &reference.0.json());

    for (test, name, arg, limit) in RUNAWAYS {
        emit("START", &Json::new().str("test", test).done());
        let (threw, error, took) = ctx.with(|ctx| {
            let f: Function = ctx.globals().get::<_, Object>("runawayBundle").unwrap().get(name).unwrap();
            let t = Instant::now();
            deadline.set(Some(t + limit));
            let r = f.call::<_, Value>((arg,));
            deadline.set(None);
            let took = ms(t.elapsed());
            let out = match r {
                Ok(v) => (false, format!("returned {v:?}"), took),
                Err(e) => (true, describe(&ctx, e), took),
            };
            ctx.run_gc();
            out
        });
        let (after, after_errors) = ctx.with(|ctx| check(&ctx, &sink, &deadline));
        emit(
            "TEST",
            &Json::new()
                .str("test", test)
                .bool("threw", threw)
                .str("error", &error)
                .num("ms", took)
                .bool("host_ok", after == reference.0 && after_errors == 0)
                .raw("check", &after.json())
                .raw("heap", &heap(&rt))
                .raw("memory", &memory().json())
                .done(),
        );
    }
    emit("DONE", &memory().json());
}

/// Puts `host` (for the plugin) and the writer (for the write functions) in the
/// global scope, each method a Rust closure.
fn install<'js>(ctx: &Ctx<'js>, sink: &Shared<Sink>, store: &Shared<HashMap<String, f64>>) -> rquickjs::Result<()> {
    let globals = ctx.globals();

    let host = Object::new(ctx.clone())?;
    let s = store.clone();
    host.set("read", Function::new(ctx.clone(), move |name: String| -> f64 { s.borrow().get(&name).copied().unwrap_or(0.0) })?)?;
    let s = store.clone();
    host.set("write", Function::new(ctx.clone(), move |name: String, v: f64| { s.borrow_mut().insert(name, v); })?)?;
    globals.set("host", host)?;

    let writer = Object::new(ctx.clone())?;
    let s = sink.clone();
    writer.set(
        "k",
        Function::new(ctx.clone(), move |name: String, a: Opt<f64>, b: Opt<f64>| {
            let v = [a.0, b.0];
            let n = v.iter().take_while(|x| x.is_some()).count();
            let mut vals = [0.0; 2];
            for i in 0..n {
                vals[i] = v[i].unwrap();
            }
            s.borrow_mut().record(&name, &vals[..n]);
        })?,
    )?;
    let s = sink.clone();
    writer.set("l", Function::new(ctx.clone(), move |name: String, v: f64, _unit: String| s.borrow_mut().record(&name, &[v]))?)?;
    let s = sink.clone();
    writer.set("b", Function::new(ctx.clone(), move |name: String, v: f64| s.borrow_mut().record(&name, &[v]))?)?;
    let s = sink.clone();
    writer.set("h", Function::new(ctx.clone(), move |name: String| s.borrow_mut().record(&name, &[]))?)?;
    globals.set("__writer", writer)?;
    Ok(())
}

/// The 100 write functions in name order, and the writer they're called with.
fn handles<'js>(ctx: &Ctx<'js>) -> (Vec<Function<'js>>, Object<'js>) {
    let list: Array = ctx.eval("Object.keys(writersBundle).sort().map((k) => writersBundle[k])").unwrap();
    let writers: Vec<Function> = list.iter::<Function>().map(|f| f.unwrap()).collect();
    assert_eq!(writers.len(), WRITERS);
    (writers, ctx.globals().get("__writer").unwrap())
}

/// One frame: every write function called once with its value for the frame.
fn frame<'js>(ctx: &Ctx<'js>, writers: &[Function<'js>], writer: &Object<'js>, f: u32, errors: &mut u64, last: &mut String) {
    for (i, w) in writers.iter().enumerate() {
        if let Err(e) = w.call::<_, ()>((input(f, i), writer.clone())) {
            *errors += 1;
            *last = describe(ctx, e);
        }
    }
}

/// Runs frames 0 to CHECK_FRAMES unpaced and returns what crossed into the
/// host, which matches across runs only if every write function still works.
fn check<'js>(ctx: &Ctx<'js>, sink: &Shared<Sink>, deadline: &Deadline) -> (Sink, u64) {
    let (writers, writer) = handles(ctx);
    let before = *sink.borrow();
    let (mut errors, mut last) = (0, String::new());
    for f in 0..CHECK_FRAMES {
        deadline.set(Some(Instant::now() + TIME_LIMIT));
        frame(ctx, &writers, &writer, f, &mut errors, &mut last);
        deadline.set(None);
    }
    let delta = sink.borrow().since(&before);
    (delta, errors)
}

/// Checks the plugin's values and write methods, then times 1,000 calls of each.
fn plugin<'js>(ctx: &Ctx<'js>, store: &Shared<HashMap<String, f64>>) -> rquickjs::Result<String> {
    let p: Object = ctx.globals().get::<_, Object>("pluginBundle")?.get("plugin")?;
    let exports: Function = p.get("exports")?;
    let write: Object = p.get("write")?;
    let range: Function = write.get("radar_range")?;
    let tilt: Function = write.get("radar_tilt")?;

    range.call::<_, ()>((This(write.clone()), 45.0))?;
    tilt.call::<_, ()>((This(write.clone()), -20.0))?;
    let values: Object = exports.call((This(p.clone()),))?;
    let range_nm: f64 = values.get("radar_range")?;
    let tilt_deg: f64 = values.get("radar_tilt")?;
    let ok = range_nm == 40.0 && tilt_deg == -15.0 && store.borrow().get("RADAR_RANGE_INDEX") == Some(&2.0);

    let n = 1000;
    let t = Instant::now();
    for _ in 0..n {
        let _: Object = exports.call((This(p.clone()),))?;
    }
    let exports_us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
    let t = Instant::now();
    for i in 0..n {
        range.call::<_, ()>((This(write.clone()), (i % 400) as f64))?;
    }
    let write_us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
    Ok(Json::new().bool("ok", ok).num("range_nm", range_nm).num("tilt_deg", tilt_deg).num("exports_us", exports_us).num("write_us", write_us).done())
}

fn heap(rt: &Runtime) -> String {
    let u = rt.memory_usage();
    Json::new().mb("malloc_mb", u.malloc_size as usize).mb("used_mb", u.memory_used_size as usize).done()
}

fn describe(ctx: &Ctx, e: rquickjs::Error) -> String {
    if let rquickjs::Error::Exception = e {
        let v = ctx.catch();
        if let Some(ex) = v.as_exception() {
            let name = ex.get::<_, Option<String>>("name").ok().flatten().unwrap_or_default();
            return format!("{name}: {}", ex.message().unwrap_or_default());
        }
        return format!("thrown {v:?}");
    }
    e.to_string()
}
