//! The profile builder: a profile and its modules merged, type-checked and compiled with
//! TypeScript 6.0.3's own compiler inside QuickJS-ng, the bundle's level worked out, and the
//! bundle read back. The builder program runs it, in CI and as the profile extension's language
//! server, and the core never links it, so `typescript.js` never ships to pilots
//! (record/areas/profiles/02-units.md, "The builder").
//!
//! The compiler runs through rquickjs itself, not through the sandbox, whose limits and
//! missing clock are for profiles' scripts, not for our own compiler.
//!
//! `Service` runs TypeScript's language service for the profile extension's server in a runtime
//! of its own beside the `Compiler`'s, so a request in a script never waits behind a check or a
//! build (record/areas/profiles/03-the-extension.md, "TypeScript in two runtimes").

use profile_engine::{
    Compiled, Diagnostic, Files, LEVEL, Program, ProgramPlace, Report, Shown, TypeError, Variant,
    check, hash, place, program, read, source, write,
};
use rquickjs::{CatchResultExt, Context, Function, Module, Runtime};
use serde::Deserialize;

/// TypeScript 6.0.3's compiler, from the npm package the root's package.json names
/// `typescript-6`, so its bytes are the ones the lockfile pins.
const TYPESCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../node_modules/typescript-6/lib/typescript.js"
));
const DRIVER: &str = include_str!("driver.js");
const SERVICE: &str = include_str!("service.js");

/// The stack of the thread a `Compiler` or a `Service` runs on. TypeScript's checker recurses
/// deeply, and QuickJS-ng throws a stack overflow at its own limit, which has to sit below the
/// thread's, or the thread dies first; a check of 300 write functions passed on a thread of 1 MB
/// (record/areas/profiles/log.md, 2026-10-16).
pub const STACK: usize = 8 * 1024 * 1024;

/// The most memory a build may take, the budget's 128 MB, past which QuickJS-ng throws, so a
/// build that grows past it fails rather than slowing every other build (record/areas/profiles/
/// 02-units.md, "Budgets"). A `Service` takes the same limit; one held 43 MB once it had
/// answered the 58P's requests (record/areas/profiles/log.md, 2026-11-22).
pub const MEMORY: usize = 128 * 1024 * 1024;

/// A QuickJS-ng runtime of its own, with `typescript.js` and our scripts loaded.
struct Js {
    runtime: Runtime,
    context: Context,
}

impl Js {
    /// Loads each of `scripts`, by its name for the message if it fails.
    fn load(scripts: &[(&str, &str)]) -> Js {
        let runtime = Runtime::new().expect("QuickJS-ng should start a runtime");
        runtime.set_memory_limit(MEMORY);
        runtime.set_max_stack_size(STACK - 1024 * 1024);
        let context = Context::full(&runtime).expect("QuickJS-ng should make a context");
        context.with(|ctx| {
            for (name, script) in scripts {
                ctx.eval::<(), _>(*script)
                    .catch(&ctx)
                    .unwrap_or_else(|e| panic!("{name} should load: {e}"));
            }
        });
        Js { runtime, context }
    }

    fn memory(&self) -> usize {
        usize::try_from(self.runtime.memory_usage().malloc_size).unwrap_or(0)
    }

    /// Calls a function of the global `object` with a JSON argument, and returns its JSON.
    fn call(&mut self, object: &str, function: &str, json: String) -> Result<String, String> {
        self.context.with(|ctx| {
            let object: rquickjs::Object = ctx
                .globals()
                .get(object)
                .unwrap_or_else(|_| panic!("our scripts should define {object}"));
            let f: Function = object
                .get(function)
                .unwrap_or_else(|_| panic!("our scripts should define {function}"));
            f.call::<_, String>((json,))
                .catch(&ctx)
                .map_err(|e| e.to_string())
        })
    }
}

/// `typescript.js` in a QuickJS-ng runtime of its own. Make one on a thread whose stack is
/// `STACK`, and use it on that thread alone.
pub struct Compiler {
    js: Js,
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
        Compiler {
            js: Js::load(&[("typescript.js", TYPESCRIPT), ("driver.js", DRIVER)]),
        }
    }

    /// The memory the runtime holds, in bytes.
    pub fn memory(&self) -> usize {
        self.js.memory()
    }

    /// Calls one of driver.js's functions with a JSON argument, and returns its JSON.
    fn call(&mut self, function: &str, json: String) -> Result<String, String> {
        self.js.call("dualInputBuild", function, json)
    }

    /// TypeScript's diagnostics on the program, with an error at each name a script declares
    /// that Dual Input gives every script, or the compiler's own failure, such as running out of
    /// memory, as one error.
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

/// TypeScript 6.0.3's language service on one profile's program, in a QuickJS-ng runtime of its
/// own, for an editor's requests inside a script. Make one on a thread whose stack is `STACK`,
/// and use it on that thread alone. A request runs to its end: TypeScript drops its whole type
/// checker when one is canceled, and the next request builds it again
/// (record/areas/profiles/03-the-extension.md, "TypeScript in two runtimes").
///
/// Each place it takes is in one of the program's files, which `Program::to_program` gives for a
/// place in a script.
pub struct Service {
    js: Js,
}

impl Default for Service {
    fn default() -> Service {
        Service::new()
    }
}

/// One of TypeScript's completions.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Completion {
    pub label: String,
    /// TypeScript's kind, such as `property`, `function`, or `keyword`.
    pub kind: String,
    /// The text an editor sorts the list by.
    pub sort_text: String,
}

/// What TypeScript says of one completion, which an editor shows for the one it selects.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct CompletionDetails {
    /// Its declaration, as `(property) battery_1: number`.
    pub detail: String,
    /// Its doc comment, which is an entry's `name:` for a key of `state`.
    pub documentation: String,
}

/// What a hover shows.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct QuickInfo {
    /// The declaration, as `function write(target: Variable, value: number | string): Chain`.
    pub display: String,
    pub documentation: String,
}

/// The signatures of the call the place is in.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct SignatureHelp {
    pub signatures: Vec<Signature>,
    /// The signature TypeScript picks for the arguments so far, from 0.
    pub active_signature: usize,
    /// The argument the place is in, from 0.
    pub active_parameter: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Signature {
    /// The whole signature, as `write(target: Variable, value: number | string): Chain`, which
    /// holds each parameter's label.
    pub label: String,
    pub documentation: String,
    pub parameters: Vec<Parameter>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Parameter {
    /// The parameter as the signature writes it, as `target: Variable`.
    pub label: String,
    pub documentation: String,
}

impl Service {
    /// Loads TypeScript and its language service, with no program yet.
    pub fn new() -> Service {
        Service {
            js: Js::load(&[
                ("typescript.js", TYPESCRIPT),
                ("driver.js", DRIVER),
                ("service.js", SERVICE),
            ]),
        }
    }

    /// The memory the runtime holds, in bytes.
    pub fn memory(&self) -> usize {
        self.js.memory()
    }

    fn call<T: for<'de> Deserialize<'de>>(
        &mut self,
        function: &str,
        json: String,
    ) -> Result<T, String> {
        let out = self.js.call("dualInputService", function, json)?;
        serde_json::from_str(&out)
            .map_err(|e| format!("the language service's answer didn't read: {e}"))
    }

    /// Holds `program`'s files, its declarations and each variant's, in place of the ones it
    /// held. A file whose text is the same keeps what TypeScript built from it, as the
    /// declarations do, which every profile at a level shares.
    pub fn set_program(&mut self, program: &Program) -> Result<(), String> {
        let files: Vec<(&str, &str)> = std::iter::once(&program.declarations)
            .chain(&program.files)
            .map(|f| (f.name.as_str(), f.text.as_str()))
            .collect();
        let json = serde_json::to_string(&files).expect("text should encode");
        self.call::<()>("set", json)
    }

    fn at(at: &ProgramPlace) -> String {
        serde_json::to_string(at).expect("a place should encode")
    }

    /// The completions at a place, without their details, which `completion_details` gives for
    /// the one an editor shows. The details of all 183 keys of the 58P's `state` took 410ms, and
    /// the list 5.5ms, in a release build on our development machine on 2026-11-22.
    pub fn completions(&mut self, at: &ProgramPlace) -> Result<Vec<Completion>, String> {
        self.call("completions", Self::at(at))
    }

    /// The details of the completion `label` at a place, if TypeScript has it there.
    pub fn completion_details(
        &mut self,
        at: &ProgramPlace,
        label: &str,
    ) -> Result<Option<CompletionDetails>, String> {
        let mut json = serde_json::to_value(at).expect("a place should encode");
        json["label"] = label.into();
        self.call("completionDetails", json.to_string())
    }

    /// What a hover at a place shows, if there's anything there.
    pub fn quick_info(&mut self, at: &ProgramPlace) -> Result<Option<QuickInfo>, String> {
        self.call("quickInfo", Self::at(at))
    }

    /// The signatures of the call a place is in, if it's in one.
    pub fn signature_help(&mut self, at: &ProgramPlace) -> Result<Option<SignatureHelp>, String> {
        self.call("signatureHelp", Self::at(at))
    }
}

/// A bundle, built from a profile and its modules.
#[derive(Debug, Default)]
pub struct Built {
    /// `None` when the report holds an error.
    pub bundle: Option<Vec<u8>>,
    pub hash: Option<String>,
    pub level: Option<u32>,
    pub covers: Vec<Variant>,
    /// What the EFB app shows of it, once it's built.
    pub shown: Option<Shown>,
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
        shown: Some(Shown::of(&profile)),
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
            "maker: M\nname: A\nmaturity: stable\naircraft:\n  variants:\n    a: x\nstate:\n  x:\n    name: X\n    watch: L('X')\n    write: |\n      (value) => write(L('X'), value)\n",
        );
        let p = program(&source(&profile, "p.yaml").expect("loads"), LEVEL);
        let broken = Compiled {
            scripts: vec!["(value) => {".into()],
        };
        let report = parses(&p, &broken);
        let e = report.errors().next().expect("an error");
        assert_eq!((e.code.as_str(), e.at.line), ("quickjs", 12), "{report}");
        let fine = Compiled {
            scripts: vec!["(value) => write(L('X'), value)".into()],
        };
        assert!(parses(&p, &fine).diagnostics.is_empty());
    }
}
