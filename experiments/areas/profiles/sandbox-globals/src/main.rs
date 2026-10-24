// p03's host: makes a QuickJS-ng context the way the sandbox's design makes one, the base
// objects and of rquickjs's intrinsics Eval and RegExp alone, deletes Math.random and
// queueMicrotask as the design does, and prints, as JSON, every global with its own
// properties and its prototype's, for p03-sandbox-globals.mjs to read.

use rquickjs::context::intrinsic::{Eval, RegExp};
use rquickjs::{CatchResultExt, Context, Runtime};

const WALK: &str = r#"
delete Math.random;
delete globalThis.queueMicrotask;
var names = function (o) { return Object.getOwnPropertyNames(o).concat(Object.getOwnPropertySymbols(o).map(String)).sort(); };
var out = {};
names(globalThis).forEach(function (name) {
  var d = Object.getOwnPropertyDescriptor(globalThis, name);
  var v = d && "value" in d ? d.value : undefined;
  var entry = { type: typeof v };
  if (v !== null && (typeof v === "object" || typeof v === "function")) {
    entry.own = names(v);
    if (typeof v === "function" && v.prototype && (typeof v.prototype === "object" || typeof v.prototype === "function")) entry.prototype = names(v.prototype);
  }
  out[String(name)] = entry;
});
var tried = {};
[["a regex literal", "/a+/.test('caa')"], ["JSON", "typeof JSON"], ["a generator", "(function* () { yield 1 })().next().value"],
 ["for of over an array", "(function () { var n = 0; for (var x of [1, 2]) n += x; return n })()"], ["spread", "Math.max(...[1, 5, 3])"],
 ["Symbol.iterator", "typeof [][Symbol.iterator]"], ["BigInt", "typeof BigInt"], ["Math.random", "typeof Math.random"]].forEach(function (t) {
  try { tried[t[0]] = String(eval(t[1])) } catch (e) { tried[t[0]] = "threw " + e }
});
"#;

fn main() {
    let runtime = Runtime::new().expect("runtime");
    let context = Context::custom::<(Eval, RegExp)>(&runtime).expect("context");
    context.with(|ctx| {
        // The context may lack JSON, so the walk's result comes out through rquickjs's objects.
        let walked: rquickjs::Result<()> = ctx.eval(WALK);
        if let Err(e) = walked.catch(&ctx) {
            println!("ERROR {e}");
            return;
        }
        let out: rquickjs::Object = ctx.globals().get("out").expect("out");
        let tried: rquickjs::Object = ctx.globals().get("tried").expect("tried");
        let mut globals: Vec<String> = out.keys::<String>().map(|k| k.expect("a key")).collect();
        globals.sort();
        for name in globals {
            let entry: rquickjs::Object = out.get(name.as_str()).expect("an entry");
            let kind: String = entry.get("type").expect("type");
            let list = |key: &str| -> String {
                entry
                    .get::<_, Option<Vec<String>>>(key)
                    .expect("a list")
                    .map(|l| l.join(" "))
                    .unwrap_or_default()
            };
            println!("GLOBAL {name} {kind}");
            println!("  OWN {}", list("own"));
            println!("  PROTOTYPE {}", list("prototype"));
        }
        for key in tried.keys::<String>() {
            let key = key.expect("a key");
            let value: String = tried.get(key.as_str()).expect("a value");
            println!("TRIED {key}: {value}");
        }
    });
}
