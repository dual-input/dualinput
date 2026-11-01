//! The profile builder: a profile and its modules merged, type-checked and compiled with
//! TypeScript 6.0.3's own compiler inside QuickJS-ng, the bundle's level worked out, and the
//! bundle read back. The builder program, CI, and later the IDE run it, and the core never
//! links it, so `typescript.js` never ships to pilots (record/areas/profiles/02-units.md,
//! "The builder").
//!
//! The compiler runs through rquickjs itself, not through the sandbox, whose limits and
//! missing clock are for profiles' scripts, not for our own compiler.

use profile_engine::{
    Compiled, Diagnostic, Files, LEVEL, Program, Report, TypeError, Variant, check, hash, place,
    program, read, source, write,
};
use rquickjs::{CatchResultExt, Context, Function, Module, Runtime};

/// TypeScript 6.0.3's compiler, from the npm package the root's package.json names
/// `typescript-6`, so its bytes are the ones the lockfile pins.
const TYPESCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../node_modules/typescript-6/lib/typescript.js"
));
const DRIVER: &str = include_str!("driver.js");

/// The stack of the thread a `Compiler` runs on. TypeScript's checker recurses deeply, and
/// QuickJS-ng throws a stack overflow at its own limit, which has to sit below the thread's, or
/// the thread dies first; a check of 300 write functions passed on a thread of 1 MB
/// (record/areas/profiles/log.md, 2026-10-16).
pub const STACK: usize = 8 * 1024 * 1024;

/// The most memory a build may take, the budget's 128 MB, past which QuickJS-ng throws, so a
/// build that grows past it fails rather than slowing every other build (record/areas/profiles/
/// 02-units.md, "Budgets").
pub const MEMORY: usize = 128 * 1024 * 1024;

/// `typescript.js` in a QuickJS-ng runtime of its own. Make one on a thread whose stack is
/// `STACK`, and use it on that thread alone.
pub struct Compiler {
    runtime: Runtime,
    context: Context,
}

impl Default for Compiler {
    fn default() -> Compiler {
        Compiler::new()
    }
}

impl Compiler {
    /// Loads the compiler, which took about 240ms on our development machine
    /// (record/areas/profiles/log.md, 2026-10-16).
    pub fn new() -> Compiler {
        let runtime = Runtime::new().expect("QuickJS-ng should start a runtime");
        runtime.set_memory_limit(MEMORY);
        runtime.set_max_stack_size(STACK - 1024 * 1024);
        let context = Context::full(&runtime).expect("QuickJS-ng should make a context");
        context.with(|ctx| {
            ctx.eval::<(), _>(TYPESCRIPT)
                .catch(&ctx)
                .unwrap_or_else(|e| panic!("typescript.js should load: {e}"));
            ctx.eval::<(), _>(DRIVER)
                .catch(&ctx)
                .unwrap_or_else(|e| panic!("driver.js should load: {e}"));
        });
        Compiler { runtime, context }
    }

    /// The memory the runtime holds, in bytes.
    pub fn memory(&self) -> usize {
        usize::try_from(self.runtime.memory_usage().malloc_size).unwrap_or(0)
    }

    /// Calls one of driver.js's functions with a JSON argument, and returns its JSON.
    fn call(&mut self, function: &str, json: String) -> Result<String, String> {
        self.context.with(|ctx| {
            let driver: rquickjs::Object = ctx
                .globals()
                .get("dualInputBuild")
                .expect("driver.js should define dualInputBuild");
            let f: Function = driver.get(function).expect("driver.js should define it");
            f.call::<_, String>((json,))
                .catch(&ctx)
                .map_err(|e| e.to_string())
        })
    }

    /// TypeScript's diagnostics on the program, or the compiler's own failure, such as running
    /// out of memory, as one error.
    pub fn check(&mut self, program: &Program) -> Result<Vec<TypeError>, String> {
        let mut files = serde_json::Map::new();
        let mut roots = Vec::new();
        for f in std::iter::once(&program.declarations).chain(&program.files) {
            files.insert(f.name.clone(), f.text.clone().into());
            roots.push(f.name.clone());
        }
        let json = serde_json::json!({ "roots": roots, "files": files }).to_string();
        let found = self.call("check", json)?;
        serde_json::from_str(&found).map_err(|e| format!("the compiler's answer didn't read: {e}"))
    }

    /// Every script compiled at ES2020, the one target for every level, so the syntax a
    /// released core parses never changes.
    pub fn compile(&mut self, program: &Program) -> Result<Compiled, String> {
        let json = serde_json::to_string(&program.scripts).expect("text should encode");
        let out = self.call("compile", json)?;
        let outputs: Vec<Option<String>> = serde_json::from_str(&out)
            .map_err(|e| format!("the compiler's answer didn't read: {e}"))?;
        let scripts = outputs
            .iter()
            .enumerate()
            .map(|(i, o)| {
                o.as_deref()
                    .and_then(|o| unwrap(i, o))
                    .ok_or_else(|| format!("compiled script {i} lost its wrapping: {o:?}"))
            })
            .collect::<Result<_, _>>()?;
        Ok(Compiled { scripts })
    }
}

/// The script the compiler's output holds as script `i`'s constant, as driver.js names it,
/// `const __dualInputScript<i> = (…);`.
fn unwrap(i: usize, output: &str) -> Option<String> {
    let inner = output
        .strip_prefix(&format!("const __dualInputScript{i} = ("))?
        .trim_end_matches('\n')
        .strip_suffix(");")?;
    Some(inner.to_string())
}

/// A bundle, built from a profile and its modules.
#[derive(Debug, Default)]
pub struct Built {
    /// `None` when the report holds an error.
    pub bundle: Option<Vec<u8>>,
    pub hash: Option<String>,
    pub level: Option<u32>,
    pub covers: Vec<Variant>,
    pub report: Report,
}

/// Builds the profile at `path`, from `profiles/`: parses it and its modules, checks it at
/// each level from 1, type-checks it from the lowest level whose fields pass, and takes the
/// lowest that passes both as the bundle's; then compiles every script, checks that QuickJS-ng
/// parses each, writes the bundle, hashes it, and reads it back at its level, so the bytes a
/// core will read pass their level's checks as the source did.
pub fn build(files: &impl Files, path: &str, compiler: &mut Compiler) -> Built {
    let source = match source(files, path) {
        Ok(s) => s,
        Err(report) => return failed(report),
    };
    let passing: Vec<u32> = (1..=LEVEL)
        .filter(|&l| !check(&source, l).has_errors())
        .collect();
    if passing.is_empty() {
        return failed(check(&source, LEVEL));
    }
    let mut chosen = None;
    let mut last_errors = Report::default();
    for &level in &passing {
        let p = program(&source, level);
        let found = match compiler.check(&p) {
            Ok(found) => found,
            Err(e) => return failed(whole(path, "compiler", e)),
        };
        let placed = place(&p, &found);
        if !placed.has_errors() {
            chosen = Some((level, p));
            break;
        }
        last_errors = placed;
    }
    let Some((level, p)) = chosen else {
        return failed(last_errors);
    };
    let mut report = check(&source, level);
    let compiled = match compiler.compile(&p) {
        Ok(c) => c,
        Err(e) => return failed(whole(path, "compiler", e)),
    };
    report.extend(parses(&p, &compiled));
    if report.has_errors() {
        return failed(report);
    }
    let bundle = write(&source, &compiled);
    let profile = match read(&bundle, level) {
        Ok(profile) => profile,
        Err(back) => {
            let mut report = whole(
                path,
                "bundle",
                "The bundle written from this profile failed its own level's checks, a fault of the builder's".into(),
            );
            report.extend(back);
            return failed(report);
        }
    };
    report.sort();
    Built {
        hash: Some(hash(&bundle)),
        bundle: Some(bundle),
        level: Some(level),
        covers: profile.aircraft.variants,
        report,
    }
}

/// An error for each compiled script QuickJS-ng can't parse, found by compiling each in a
/// runtime of its own without running it.
fn parses(p: &Program, compiled: &Compiled) -> Report {
    let mut report = Report::default();
    let runtime = Runtime::new().expect("QuickJS-ng should start a runtime");
    let context = Context::full(&runtime).expect("QuickJS-ng should make a context");
    context.with(|ctx| {
        for (i, js) in compiled.scripts.iter().enumerate() {
            let source = format!("const f = (\n{js}\n);\n");
            if let Err(e) =
                Module::declare(ctx.clone(), format!("script{i}.js"), source).catch(&ctx)
            {
                let at = p
                    .script_place(i)
                    .cloned()
                    .unwrap_or_else(|| profile_engine::Place::new("", 1, 1));
                report.push(Diagnostic::error(
                    at,
                    "quickjs",
                    format!("QuickJS-ng can't parse this script once it's compiled: {e}"),
                ));
            }
        }
    });
    report
}

fn whole(path: &str, code: &str, message: String) -> Report {
    Report {
        diagnostics: vec![Diagnostic::error(
            profile_engine::Place::new(path, 1, 1),
            code,
            message,
        )],
    }
}

fn failed(report: Report) -> Built {
    Built {
        report,
        ..Built::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct One(&'static str);

    impl Files for One {
        fn read(&self, _: &str) -> Option<Vec<u8>> {
            Some(self.0.as_bytes().to_vec())
        }
    }

    /// TypeScript refuses every mistake we found that QuickJS-ng would, so this hands the step
    /// a compiled script that doesn't parse.
    #[test]
    fn a_script_quickjs_ng_cant_parse_fails_at_its_place() {
        let profile = One(
            "name: A\nmaturity: stable\naircraft:\n  variants:\n    a: x\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: |\n      (value) => write(L('X'), value)\n",
        );
        let p = program(&source(&profile, "p.yaml").expect("loads"), LEVEL);
        let broken = Compiled {
            scripts: vec!["(value) => {".into()],
        };
        let report = parses(&p, &broken);
        let e = report.errors().next().expect("an error");
        assert_eq!((e.code.as_str(), e.at.line), ("quickjs", 11), "{report}");
        let fine = Compiled {
            scripts: vec!["(value) => write(L('X'), value)".into()],
        };
        assert!(parses(&p, &fine).diagnostics.is_empty());
    }
}
