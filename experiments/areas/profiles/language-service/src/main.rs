// p04's host: writes the 58P's TypeScript program as the profile builder makes it, and runs
// TypeScript's language service on it inside QuickJS-ng, printing one line per result for
// p04-language-service.mjs to read.
//
//   p04-language-service dump <profiles folder> <profile path> <program.json>
//   p04-language-service run <typescript.js> <program.json> <runs>

use std::path::PathBuf;
use std::time::Instant;

use profile_engine::{Files, LEVEL, program, source};
use rquickjs::{CatchResultExt, Context, Function, Object, Runtime};

const SERVICE: &str = include_str!("service.js");

// QuickJS-ng as rquickjs builds it has no `Intl`, and TypeScript sorts completions with
// `new Intl.Collator(locale, { numeric: true, ... }).compare`, so completion failed with
// "Intl is not defined". This stand-in compares by code unit, which orders names as Node's
// collator does only where case and digits agree.
const INTL: &str = "var Intl = { Collator: function () { return { compare: function (a, b) { return a < b ? -1 : a > b ? 1 : 0; } }; } };";

// The profile builder's thread and QuickJS-ng limit (src/engines/profile-build/src/lib.rs).
const STACK: usize = 8 * 1024 * 1024;

struct Disk(PathBuf);

impl Files for Disk {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(self.0.join(path)).ok()
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args[1].as_str() {
        "dump" => dump(&args[2], &args[3], &args[4]),
        "run" => {
            let (ts, json, runs) = (args[2].clone(), args[3].clone(), args[4].clone());
            std::thread::Builder::new()
                .stack_size(STACK)
                .spawn(move || run(&ts, &json, runs.parse().expect("runs")))
                .expect("thread")
                .join()
                .expect("join");
        }
        other => panic!("unknown command {other}"),
    }
}

fn dump(profiles: &str, path: &str, out: &str) {
    let src = source(&Disk(PathBuf::from(profiles)), path).unwrap_or_else(|r| panic!("{r}"));
    let p = program(&src, LEVEL);
    let mut files = serde_json::Map::new();
    let mut roots = Vec::new();
    for f in std::iter::once(&p.declarations).chain(&p.files) {
        let name = format!("/{}", f.name);
        files.insert(name.clone(), f.text.clone().into());
        roots.push(name);
    }
    let json = serde_json::json!({ "roots": roots, "files": files, "scripts": p.scripts.len() });
    std::fs::write(out, json.to_string()).expect("write program.json");
    println!("DUMPED {} files, {} scripts", roots.len(), p.scripts.len());
}

fn run(ts: &str, program: &str, runs: u32) {
    let ts = std::fs::read_to_string(ts).expect("typescript.js");
    let program = std::fs::read_to_string(program).expect("program.json");
    let rt = Runtime::new().expect("runtime");
    rt.set_max_stack_size(STACK - 1024 * 1024);
    let ctx = Context::full(&rt).expect("context");
    ctx.with(|ctx| {
        let t = Instant::now();
        if let Err(e) = ctx.eval::<(), _>(ts.as_str()).catch(&ctx) {
            println!("ERROR load {e}");
            return;
        }
        println!("LOAD {:.1}", t.elapsed().as_secs_f64() * 1e3);
        if let Err(e) = ctx.eval::<(), _>(INTL).catch(&ctx) {
            println!("ERROR intl {e}");
            return;
        }
        if let Err(e) = ctx.eval::<(), _>(SERVICE).catch(&ctx) {
            println!("ERROR service {e}");
            return;
        }
        let start = Instant::now();
        let now = Function::new(ctx.clone(), move || start.elapsed().as_secs_f64() * 1e3)
            .expect("now");
        let p04: Object = ctx.globals().get("p04").expect("p04");
        let measure: Function = p04.get("measure").expect("measure");
        match measure.call::<_, String>((program, now, runs)).catch(&ctx) {
            Ok(json) => println!("RESULT {json}"),
            Err(e) => println!("ERROR measure {e}"),
        }
    });
    println!("MEMORY {}", rt.memory_usage().malloc_size);
}
