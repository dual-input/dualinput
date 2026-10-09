//! p07's QuickJS host. For each sample, it serializes the `FromCore` message
//! with serde_json, hands it to the plugin's `onMessage` in QuickJS-ng as an
//! object (through the engine's own JSON parser), takes the `ToCore` object the
//! plugin returns back through the engine's JSON stringifier, parses that with
//! serde_json, and compares it with the reply the sample expects. It prints one
//! `SAMPLE` line per sample, then the x86_64 build's data-slot layout:
//!
//!   p07-quickjs.exe <plugin bundle>

use p07_messages::{samples, ToCore};
use rquickjs::{Context, Function, Object, Runtime, Value};

fn main() {
    let bundle_path = std::env::args().nth(1).expect("usage: p07-quickjs <plugin bundle>");
    let bundle = std::fs::read_to_string(&bundle_path).expect("read the plugin bundle");
    let version = unsafe { std::ffi::CStr::from_ptr(rquickjs::qjs::JS_GetVersion()) }.to_string_lossy().into_owned();
    println!("ENGINE {}", serde_json::json!({ "quickjs": version }));

    let rt = Runtime::new().unwrap();
    let ctx = Context::full(&rt).unwrap();
    ctx.with(|ctx| {
        ctx.eval::<(), _>(bundle.as_str()).expect("evaluate the plugin bundle");
        let plugin: Object = ctx.globals().get("pluginBundle").expect("pluginBundle global");
        let on_message: Function = plugin.get("onMessage").expect("onMessage export");

        for (i, (message, expected)) in samples().into_iter().enumerate() {
            let sent = serde_json::to_string(&message).unwrap();
            let arg: Value = ctx.json_parse(sent.clone()).expect("QuickJS parses serde_json's text");
            let reply: Value = match on_message.call((arg,)) {
                Ok(v) => v,
                Err(e) => {
                    let detail = ctx.catch().into_exception().map(|x| x.to_string()).unwrap_or_else(|| e.to_string());
                    println!("SAMPLE {}", serde_json::json!({ "i": i, "sent": sent, "error": detail }));
                    continue;
                }
            };
            let text = ctx.json_stringify(reply).unwrap().map(|s| s.to_string().unwrap()).unwrap_or_default();
            let parsed: Result<ToCore, _> = serde_json::from_str(&text);
            let (matches, error) = match &parsed {
                Ok(got) => (got == &expected, None),
                Err(e) => (false, Some(e.to_string())),
            };
            println!(
                "SAMPLE {}",
                serde_json::json!({
                    "i": i,
                    "sent": sent,
                    "reply": text,
                    "expected": serde_json::to_string(&expected).unwrap(),
                    "matches": matches,
                    "error": error,
                })
            );
        }
    });

    println!("LAYOUT {}", serde_json::json!({ "target": "x86_64", "layout": p07_slots::layout() }));
}
