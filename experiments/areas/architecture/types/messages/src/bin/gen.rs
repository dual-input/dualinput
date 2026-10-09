//! p07's generator: writes TypeScript for the messages with ts-rs or specta, or
//! the samples as serde_json writes them. typeshare runs as its own command-line
//! tool, which reads this crate's source instead of running it.
//!
//!   p07-gen ts-rs <out dir>          ts-rs's defaults: u64 is bigint
//!   p07-gen ts-rs-number <out dir>   ts-rs with large integers as number
//!   p07-gen specta <out dir>         specta-typescript, with specta-serde's Format
//!   p07-gen specta-phases <out dir>  the same with PhasesFormat, which allows a
//!                                    field that's sometimes left out
//!
//! Built with the `specta-number` feature, specta takes each u64 as a number.
//!   p07-gen samples <out file>       each sample's message and expected reply, as JSON

use std::path::PathBuf;

use p07_messages::{samples, FromCore, ToCore};
use ts_rs::TS;

fn main() {
    let mut args = std::env::args().skip(1);
    let which = args.next().expect("generator");
    let out = PathBuf::from(args.next().expect("output path"));
    let result: Result<(), String> = match which.as_str() {
        "ts-rs" | "ts-rs-number" => {
            let mut cfg = ts_rs::Config::new().with_out_dir(&out);
            if which == "ts-rs-number" {
                cfg = cfg.with_large_int("number");
            }
            FromCore::export_all(&cfg).and_then(|_| ToCore::export_all(&cfg)).map_err(|e| e.to_string())
        }
        "specta" | "specta-phases" => {
            let types = specta::Types::default().register::<FromCore>().register::<ToCore>();
            std::fs::create_dir_all(&out).unwrap();
            let ts = specta_typescript::Typescript::default();
            let file = out.join("index.ts");
            let exported = if which == "specta" {
                ts.export_to(file, &types, specta_serde::Format)
            } else {
                ts.export_to(file, &types, specta_serde::PhasesFormat)
            };
            exported.map_err(|e| e.to_string())
        }
        "samples" => {
            let list: Vec<_> = samples()
                .into_iter()
                .map(|(m, r)| serde_json::json!({ "message": serde_json::to_value(&m).unwrap(), "reply": serde_json::to_value(&r).unwrap(), "text": serde_json::to_string(&m).unwrap() }))
                .collect();
            std::fs::write(&out, serde_json::to_string_pretty(&list).unwrap()).map_err(|e| e.to_string())
        }
        other => Err(format!("unknown generator {other}")),
    };
    match result {
        Ok(()) => println!("OK {which}"),
        Err(e) => {
            println!("FAILED {which}: {e}");
            std::process::exit(2);
        }
    }
}
