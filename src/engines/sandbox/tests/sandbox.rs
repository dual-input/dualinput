// The sandbox's own cases, with no core and no sim (record/areas/build/02-testing.md, "The
// sandbox's cases"). Tests run off the core's loop, so they may start the thread a deep stack
// needs and read the clock, which the root's clippy.toml forbids only the loop.
#![allow(clippy::disallowed_methods)]

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

use sandbox::rquickjs::{Ctx, Function, Object, Value};
use sandbox::{CHECKS, Failed, Sandbox};
use serde::Deserialize;

/// The loop thread's stack, so a test's calls have the room below them a core's have. `STACK`
/// in src/apps/core/src/run.rs sets the loop's, so change both together.
const LOOP_STACK: usize = 16 * 1024 * 1024;

fn on_loop_stack<R: Send + 'static>(f: impl FnOnce() -> R + Send + 'static) -> R {
    std::thread::Builder::new()
        .stack_size(LOOP_STACK)
        .spawn(f)
        .expect("the test should start its thread")
        .join()
        .expect("the test's thread should finish")
}

/// Runs a script as one call, and gives what it returned as text, or how it failed.
fn run(sandbox: &mut Sandbox, script: &str) -> Result<String, Failed> {
    sandbox.call(|ctx| {
        let v: Value = ctx.eval(script)?;
        Ok(v.get::<sandbox::rquickjs::Coerced<String>>()?.0)
    })
}

#[derive(Debug, Deserialize, PartialEq)]
struct Global {
    #[serde(rename = "type")]
    kind: String,
    own: Vec<String>,
    prototype: Vec<String>,
}

/// Every global by its string name, with its type, its own properties, and its prototype's,
/// a symbol among them by its text, as `Symbol(Symbol.iterator)`: the walk p03 made, which
/// sandbox.json keeps (record/areas/profiles/log.md, 2026-10-24). It runs in a function of its
/// own, so it leaves no global behind.
const WALK: &str = r#"
(() => {
  const names = (o) => Object.getOwnPropertyNames(o).concat(Object.getOwnPropertySymbols(o).map(String))
  const isObject = (v) => v !== null && (typeof v === "object" || typeof v === "function")
  return Object.getOwnPropertyNames(globalThis).map((name) => {
    const d = Object.getOwnPropertyDescriptor(globalThis, name)
    const v = d && "value" in d ? d.value : undefined
    const p = typeof v === "function" ? v.prototype : undefined
    return { name, type: typeof v, own: isObject(v) ? names(v) : [], prototype: isObject(p) ? names(p) : [] }
  })
})()
"#;

/// Level 1 of the profile format types write functions by sandbox.json's list, so a member the
/// context lacks would pass a write function's type check and fail its write, and one the list
/// lacks would be refused though the sandbox runs it (record/areas/profiles/log.md, 2026-10-24).
#[test]
fn the_context_defines_exactly_what_sandbox_json_lists() {
    let listed: BTreeMap<String, Global> =
        serde_json::from_str(include_str!("../../profile-engine/javascript/sandbox.json"))
            .expect("sandbox.json should read");
    let walked = Sandbox::new()
        .call(|ctx| {
            let globals: Vec<Object> = ctx.eval(WALK)?;
            globals
                .iter()
                .map(|g| Ok((g.get("name")?, g.get("type")?, g.get("own")?, g.get("prototype")?)))
                .collect::<sandbox::rquickjs::Result<Vec<(String, String, Vec<String>, Vec<String>)>>>()
        })
        .expect("the walk should run");
    let found: BTreeMap<String, Global> = walked
        .into_iter()
        .map(|(name, kind, own, prototype)| {
            (
                name,
                Global {
                    kind,
                    own,
                    prototype,
                },
            )
        })
        .collect();

    let mut differences = Vec::new();
    for name in listed.keys().filter(|n| !found.contains_key(*n)) {
        differences.push(format!("the context lacks {name}"));
    }
    for name in found.keys().filter(|n| !listed.contains_key(*n)) {
        differences.push(format!(
            "the context defines {name}, which sandbox.json doesn't list"
        ));
    }
    for (name, want) in &listed {
        let Some(got) = found.get(name) else { continue };
        if want.kind != got.kind {
            differences.push(format!(
                "{name} is a {}, where sandbox.json has a {}",
                got.kind, want.kind
            ));
        }
        for (part, want, got) in [
            ("", &want.own, &got.own),
            (".prototype", &want.prototype, &got.prototype),
        ] {
            for m in want.iter().filter(|m| !got.contains(m)) {
                differences.push(format!("{name}{part} lacks {m}"));
            }
            for m in got.iter().filter(|m| !want.contains(m)) {
                differences.push(format!(
                    "{name}{part} defines {m}, which sandbox.json doesn't list"
                ));
            }
        }
    }
    assert!(
        differences.is_empty(),
        "the sandbox's context and src/engines/profile-engine/javascript/sandbox.json differ; once the \
         context is right, bring the list to it and run node tools/javascript-types.ts:\n{}",
        differences.join("\n")
    );
}

/// QuickJS-ng seeds `Math.random` from the wall clock, and nothing runs the jobs
/// `queueMicrotask` queues (record/areas/plugins/01-plugins.md, "The sandbox").
#[test]
fn a_call_to_math_random_or_queue_microtask_fails() {
    let mut sandbox = Sandbox::new();
    for (script, error) in [
        ("Math.random()", "TypeError"),
        ("queueMicrotask(() => {})", "ReferenceError"),
    ] {
        let got = run(&mut sandbox, script);
        assert!(
            matches!(&got, Err(Failed::Threw(e)) if e.starts_with(error)),
            "{script}: {got:?}"
        );
    }
}

/// TypeScript refuses an async function in a write function, but a script can still make one
/// from a string through `eval`, or reach `Array.fromAsync`, which the context defines.
/// Without QuickJS-ng's `Promise` intrinsic, either left an object behind that aborted the
/// process when the sandbox was dropped, so this test's own process would end there; with it,
/// a promise never settles, since nothing runs its jobs (record/areas/plugins/log.md,
/// 2026-10-24).
#[test]
fn an_async_function_runs_to_its_first_await_and_the_sandbox_drops() {
    let mut sandbox = Sandbox::new();
    let made = "globalThis.at = 'started'; eval('(async () => { at = \"ran\"; await 1; at = \"resumed\" })')(); typeof Array.fromAsync([1]).then";
    assert_eq!(run(&mut sandbox, made).as_deref(), Ok("function"));
    assert_eq!(run(&mut sandbox, "at").as_deref(), Ok("ran"));
    assert_eq!(
        run(&mut sandbox, "typeof Promise").as_deref(),
        Ok("undefined")
    );
    drop(sandbox);
}

/// A runaway call stops at the time limit, which no `catch` or `finally` sees, and the next
/// call runs, with the stopped call's changes to the context kept, as they are in a replay
/// (record/decisions/046-sandbox-runtimes-and-limits.md).
#[test]
fn an_endless_loop_stops_at_the_time_limit_and_the_next_call_runs() {
    on_loop_stack(|| {
        let mut sandbox = Sandbox::new();
        let stopped = run(
            &mut sandbox,
            "globalThis.where = 'started'; try { for (;;) {} } catch (e) { where = 'caught' } finally { where = 'finally' }",
        );
        assert_eq!(stopped, Err(Failed::TimeLimit));
        assert_eq!(sandbox.checks(), CHECKS);
        assert_eq!(run(&mut sandbox, "where").as_deref(), Ok("started"));
        assert_eq!(
            sandbox.checks(),
            0,
            "the check that stopped the call starts QuickJS-ng's count of ticks again, so a short call after it makes none"
        );
    });
}

/// A call whose own code catches the error the time limit throws, as a host function calling
/// back into JS might, still stopped there.
#[test]
fn a_call_stopped_at_the_time_limit_fails_though_its_caller_caught_the_error() {
    on_loop_stack(|| {
        let mut sandbox = Sandbox::new();
        let got = sandbox.call(|ctx| {
            let _ = ctx.eval::<(), _>("for (;;) {}");
            Ok(())
        });
        assert_eq!(got, Err(Failed::TimeLimit));
    });
}

/// A runaway allocation stops at the memory limit, and the next call runs
/// (record/decisions/046-sandbox-runtimes-and-limits.md).
#[test]
fn a_runaway_allocation_stops_at_the_memory_limit_and_the_next_call_runs() {
    on_loop_stack(|| {
        let mut sandbox = Sandbox::new();
        // Each runaway keeps what it allocates in a function's locals, as a write function
        // does, so the memory is free again once the call has failed.
        for (runaway, script) in [
            (
                "a growing array",
                "(() => { const hold = []; for (;;) hold.push(new Array(1024).fill(hold.length)) })()",
            ),
            (
                "small objects, after which the error itself doesn't fit",
                "(() => { let last = null; for (;;) last = { next: last } })()",
            ),
            (
                "a regex whose stack outgrows the limit",
                "(() => new RegExp('^(?:' + '('.repeat(16) + 'a' + ')'.repeat(16) + ')*$').test('a'.repeat(1 << 18)))()",
            ),
        ] {
            assert_eq!(
                run(&mut sandbox, script),
                Err(Failed::MemoryLimit),
                "{runaway}"
            );
            assert_eq!(
                run(&mut sandbox, "6 * 7").as_deref(),
                Ok("42"),
                "after {runaway}"
            );
        }
    });
}

/// How deep a recursion goes before its `RangeError`, which a script can catch and so return.
const RECURSE: &str = "(() => { let depth = 0; const down = () => { depth++; down() }; try { down() } catch (e) { if (!(e instanceof RangeError)) throw e } return depth })()";

/// Runs `f` about `kb` KB deeper in the Rust stack than its caller.
#[inline(never)]
fn deeper<R>(kb: usize, f: &mut dyn FnMut() -> R) -> R {
    let pad = std::hint::black_box([0u8; 1024]);
    let r = if kb == 0 { f() } else { deeper(kb - 1, f) };
    std::hint::black_box(&pad);
    r
}

/// QuickJS-ng sets its stack limit from the stack pointer where the runtime was made, so
/// without the pin a recursion's depth at its `RangeError` would turn on how deep in the Rust
/// stack each call came from, which a replay doesn't repeat (record/areas/plugins/
/// 01-plugins.md, "Cases for the bench").
#[test]
fn a_recursion_stops_at_the_same_depth_from_two_depths_of_the_rust_stack() {
    on_loop_stack(|| {
        let depth = |sandbox: &mut Sandbox| -> u32 {
            run(sandbox, RECURSE)
                .expect("the recursion should return its depth")
                .parse()
                .expect("a depth")
        };
        // A run: one sandbox made near the thread's top, called there, then 256 KB deeper.
        let mut live = Sandbox::new();
        let shallow = depth(&mut live);
        let deep = deeper(256, &mut || depth(&mut live));
        // A replay: a sandbox made 512 KB deeper, called there, then at the top.
        let mut replay = deeper(512, &mut Sandbox::new);
        let replayed_deep = deeper(512, &mut || depth(&mut replay));
        let replayed_shallow = depth(&mut replay);
        // 1 MB held 68 calls in a debug build and 296 in a release one.
        assert!(shallow > 50, "a recursion of {shallow}");
        assert_eq!(
            [deep, replayed_deep, replayed_shallow],
            [shallow; 3],
            "each call should stop at the same depth"
        );
    });
}

/// A run's calls: compiling functions, calls of every kind of work QuickJS-ng counts ticks
/// for, a call stopped at the time limit, and calls after it, the first of which reads where
/// the stopped call got to.
const CALLS: [&str; 7] = [
    "globalThis.step = (n) => { let x = 0; for (let i = 0; i < n; i++) x = (x + i * 7) % 1013; return x }; 'compiled'",
    "step(10)",
    "step(123456)",
    "[5, 3, 9, 1].map((n) => step(n * 1000)).filter((n) => n % 2).length",
    "/(a+)+$/.test('a'.repeat(18) + 'b')",
    "globalThis.reached = 0; for (;;) reached++",
    "reached",
];

/// QuickJS-ng's tick counter carries over from call to call, so where a call's first check
/// lands turns on every call into the context before it; a replay makes the same calls, so
/// each of its calls makes the same checks, and the stopped call stops at the same tick
/// (record/areas/plugins/01-plugins.md, "Cases for the bench").
#[test]
fn a_run_and_two_replays_count_the_same_checks_in_each_call() {
    let calls = || -> Vec<(Result<String, Failed>, u32)> {
        let mut sandbox = Sandbox::new();
        CALLS
            .iter()
            .map(|script| (run(&mut sandbox, script), sandbox.checks()))
            .collect()
    };
    let live = on_loop_stack(calls);
    assert_eq!(live[5], (Err(Failed::TimeLimit), CHECKS), "{live:?}");
    assert!(live[2].1 > 1, "step(123456) should cross checks: {live:?}");
    for replay in [on_loop_stack(calls), on_loop_stack(calls)] {
        assert_eq!(replay, live);
    }
}

/// A failed write function reaches the log as its error and where it was thrown, and a thrown
/// value that isn't an error as its text.
#[test]
fn a_throw_reads_as_its_error_and_its_place() {
    let mut sandbox = Sandbox::new();
    let got = run(&mut sandbox, "const f = () => null.x; f()");
    let Err(Failed::Threw(text)) = got else {
        panic!("{got:?}")
    };
    assert!(
        text.starts_with("TypeError: cannot read property 'x' of null"),
        "{text}"
    );
    assert!(text.contains("at f"), "{text}");
    assert_eq!(
        run(&mut sandbox, "throw 'a string'"),
        Err(Failed::Threw("a string".into()))
    );
}

/// How long the time limit lets each kind of runaway run, which the plugins' log records, in a
/// release build, since the core runs one, on our development machine with nothing else busy.
/// `CHECKS` is set so a write function's own endless loop stops in about 100ms, and a run after
/// a QuickJS-ng update shows whether it still does (record/areas/plugins/log.md, 2026-10-24):
///
///   cargo test -p sandbox --release --test sandbox -- --ignored --nocapture time_limit
#[test]
#[ignore = "a timing, measured by hand in a release build"]
fn the_time_limit_stops_a_write_functions_endless_loop_in_about_100ms() {
    // Each the body of a write function given 1, which the sync engine calls as a function, so
    // its variables are locals rather than globals that each pass looks up by name.
    const RUNAWAYS: [(&str, &str); 11] = [
        (
            "a write function that steps past its value",
            "let at = 0; while (at !== value) { write(K('X')); at += 2 }",
        ),
        (
            "a write function that writes forever",
            "for (;;) write(K('X'))",
        ),
        ("an empty loop", "for (;;) {}"),
        ("a loop that counts", "let i = 0; for (;;) i = (i + 1) | 0"),
        (
            "a loop that reads and writes an object",
            "const s = { a: 0 }; while (s.a !== -1) s.a = (s.a + 3) % 7",
        ),
        (
            "a loop that calls a function",
            "const f = (x) => x + 1; let i = 0; for (;;) i = f(i)",
        ),
        ("a loop that calls the host", "for (;;) host(value)"),
        (
            "a loop that builds objects",
            "for (;;) ({ a: 1, b: [2, 3] })",
        ),
        (
            "a loop that slices a string",
            "let s = 'x'.repeat(64); for (;;) s = (s + 'y').slice(1)",
        ),
        (
            "a regex that backtracks",
            "/(a+)+$/.test('a'.repeat(40) + 'b')",
        ),
        (
            "a loop that catches running out of memory",
            "const kept = []; for (;;) { try { kept.push(new Array(1024).fill(0)) } catch (e) {} }",
        ),
    ];
    let runs = on_loop_stack(|| {
        RUNAWAYS
            .iter()
            .map(|(name, body)| {
                let script = format!("((value) => {{ {body} }})(1)");
                let mut times: Vec<Duration> = (0..5)
                    .map(|_| {
                        let mut sandbox = Sandbox::new();
                        sandbox
                            .call(stand_ins)
                            .expect("the host's functions should install");
                        let started = Instant::now();
                        let got = run(&mut sandbox, &script);
                        let took = started.elapsed();
                        assert_eq!(got, Err(Failed::TimeLimit), "{name}");
                        took
                    })
                    .collect();
                times.sort();
                (*name, times[times.len() / 2])
            })
            .collect::<Vec<_>>()
    });
    for (name, took) in &runs {
        let ms = took.as_secs_f64() * 1e3;
        println!(
            "TIME LIMIT\t{name}\t{ms:.1}ms at {CHECKS} checks\t{:.2}µs a check",
            ms * 1e3 / f64::from(CHECKS)
        );
    }
    for (name, took) in &runs[..2] {
        let ms = took.as_secs_f64() * 1e3;
        assert!((50.0..200.0).contains(&ms), "{name} ran {ms:.1}ms");
    }
}

/// Stand-ins for what a write function calls: `host(v)`, which keeps a number, and `K(name)` and
/// `write(target)`, which each build an object, as the sync engine's name calls and the chain
/// `write()` returns do, with `write()` keeping its target's name.
fn stand_ins<'js>(ctx: &Ctx<'js>) -> sandbox::rquickjs::Result<()> {
    let kept = Rc::new(RefCell::new(Vec::<f64>::new()));
    let host = Function::new(ctx.clone(), move |v: f64| kept.borrow_mut().push(v))?;
    let k = Function::new(
        ctx.clone(),
        |ctx: Ctx<'js>, name: String| -> sandbox::rquickjs::Result<Object<'js>> {
            let target = Object::new(ctx)?;
            target.set("name", name)?;
            Ok(target)
        },
    )?;
    let written = Rc::new(RefCell::new(Vec::<String>::new()));
    let write = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'js>, target: Object<'js>| -> sandbox::rquickjs::Result<Object<'js>> {
            written.borrow_mut().push(target.get("name")?);
            Object::new(ctx)
        },
    )?;
    let globals = ctx.globals();
    globals.set("host", host)?;
    globals.set("K", k)?;
    globals.set("write", write)
}
