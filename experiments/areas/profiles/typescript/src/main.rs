// p02's host: runs TypeScript's own compiler inside QuickJS-ng through
// rquickjs, on one in-memory project, and prints one line per measurement for
// p02-typescript-in-quickjs.mjs to read.
//
//   p02-typescript-host <typescript.js> <project.json> <stack MB> <runs>

use rquickjs::{CatchResultExt, Context, Runtime, Value};
use std::time::Instant;

const DRIVER: &str = include_str!("driver.js");

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let ts = std::fs::read_to_string(&args[1]).expect("typescript.js");
    let project = std::fs::read_to_string(&args[2]).expect("project.json");
    let stack_mb: usize = args[3].parse().expect("stack MB");
    let runs: usize = args[4].parse().expect("runs");
    let stack = stack_mb * 1024 * 1024;
    std::thread::Builder::new()
        .stack_size(stack)
        .spawn(move || run(ts, project, stack, runs))
        .expect("thread")
        .join()
        .expect("join");
}

fn run(ts: String, project: String, stack: usize, runs: usize) {
    let rt = Runtime::new().expect("runtime");
    // QuickJS-ng counts its own stack and throws a stack overflow at this
    // limit, which has to sit below the thread's stack, or the thread dies first.
    rt.set_max_stack_size(stack - 512 * 1024);
    let ctx = Context::full(&rt).expect("context");
    ctx.with(|ctx| {
        let t = Instant::now();
        let loaded: rquickjs::Result<Value> = ctx.eval(ts.into_bytes());
        if let Err(e) = loaded.catch(&ctx) {
            println!("ERROR load {e}");
            return;
        }
        println!("LOAD {:.1}", t.elapsed().as_secs_f64() * 1e3);
        ctx.globals().set("PROJECT", project).expect("PROJECT");
        for i in 1..=runs {
            let t = Instant::now();
            let result: rquickjs::Result<String> = ctx.eval(DRIVER.as_bytes().to_vec());
            match result.catch(&ctx) {
                Ok(json) => {
                    println!("RUN {i} {:.1}", t.elapsed().as_secs_f64() * 1e3);
                    if i == 1 {
                        println!("RESULT {json}");
                    }
                }
                Err(e) => {
                    println!("ERROR run {i} {e}");
                    return;
                }
            }
        }
    });
    println!("MEMORY {}", rt.memory_usage().malloc_size);
}
