//! Each level's files: its JSON Schema, which an editor's YAML support completes a profile's
//! fields from, and its declarations, the whole world a profile's scripts are type-checked
//! against. The builder's `levels` command writes them into `levels/<n>/`, where they're
//! committed, and a release freezes them (record/areas/profiles/02-units.md, "Levels").

use serde_json::{Map, Value, json};

use crate::blocks::{self, Field};
use crate::features::{self, Module};
use crate::names::Allowed;

/// Each part of the declarations, with the level it came in at.
///
/// TypeScript checks with `noLib`, so these are the scripts' whole world. Level 1's first part
/// is the JavaScript the sandbox runs, which tools/javascript-types.ts generates from
/// TypeScript's own libraries and the globals javascript/sandbox.json lists, so a script that
/// names something the sandbox lacks, such as `Date` or `Math.random`, fails its type check
/// (record/areas/architecture/02-code-map.md, "One loop").
///
/// `PRELUDE` in src/engines/sync-engine/src/script.rs defines at run time what the second part
/// declares, so change both together.
const DECLARATIONS: &[(u32, &str)] = &[
    (1, include_str!("../javascript/javascript.d.ts")),
    (
        1,
        r#"// Names, which say what something in the sim is, and never act.
interface Variable {
  readonly __name: "variable";
}
interface Event {
  readonly __name: "event";
}
/** An event with `value` among its values, where the written value goes. */
interface ValueEvent {
  readonly __name: "value-event";
}
interface Value {
  readonly __name: "value";
}
/** In a K: event's values, the place the written value goes. */
declare const value: Value;

/** An L: variable, in its unit, Number when left out. */
declare function L(name: string, unit?: string): Variable;
/** An A: variable, with its index in the name, in its unit. */
declare function A(name: string, unit: string): Variable;
/** An input event. */
declare function B(name: string): Event;
/** A K: event, with the values it sends after the one a write passes. */
declare function K(name: string, ...values: number[]): Event;
declare function K(name: string, ...values: (number | Value)[]): ValueEvent;
/** An H: event. */
declare function H(name: string): Event;

/** The spacing of a chain's actions. */
type Pace = "1 frame" | `${number} frames` | `${number}ms`;

/** One action, which a chain can repeat and space out. */
interface Chain {
  /** Sends the action this many times, at the aircraft's pace. */
  repeat(times: number): Chain;
  /** Sets the spacing for this chain. */
  every(pace: Pace): Chain;
}

/** Hands the engine one action: a variable set to the value. */
declare function write(target: Variable, value: number | string): Chain;
/** Hands the engine one action: the name's own values, or the value, then the name's. */
declare function write(target: Event, value?: number | string): Chain;
/** Hands the engine one action: the name's values, with the function's own value where `value` marks. */
declare function write(target: ValueEvent): Chain;
"#,
    ),
];

pub fn declarations(level: u32) -> String {
    DECLARATIONS
        .iter()
        .filter(|(at, _)| *at <= level)
        .map(|(_, text)| *text)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Which file a schema is for. An editor picks one by the file's folder, as the builder takes a
/// file in `profiles/aircraft/` as a profile and one it imports as a module, so a module's schema
/// leaves out what only a profile holds (record/areas/profiles/02-units.md, "Levels").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Schema {
    Profile,
    Module,
}

impl Schema {
    /// The schema's file in `levels/<n>/`.
    pub fn file_name(self) -> &'static str {
        match self {
            Schema::Profile => "profile.json",
            Schema::Module => "module.json",
        }
    }
}

/// The level's JSON Schema for one kind of file, from the format's tables, as pretty JSON with a
/// final line break. It requires the fields the tables mark required, takes in each field the
/// kinds of name the checker takes there, and leaves to the checker the checks that depend on
/// another field, such as `wrap: true` needing `range`.
pub fn schema(level: u32, file: Schema) -> String {
    let module = file == Schema::Module;
    let kept = |f: &&Field| f.level <= level && !(module && f.profile_only);
    let fields = |table: &[Field], each: &dyn Fn(&Field) -> Value| -> Map<String, Value> {
        table
            .iter()
            .filter(kept)
            .map(|f| {
                let mut v = each(f);
                if let Value::Object(o) = &mut v {
                    o.insert("description".into(), json!(f.about));
                }
                (f.key.to_string(), v)
            })
            .collect()
    };
    let required = |table: &[Field]| -> Vec<&str> {
        table
            .iter()
            .filter(kept)
            .filter(|f| f.required)
            .map(|f| f.key)
            .collect()
    };
    let object = |props: Map<String, Value>, required: &[&str]| {
        let mut o = json!({ "type": "object", "additionalProperties": false, "properties": props });
        if !required.is_empty() {
            o["required"] = json!(required);
        }
        o
    };
    // A name made by one of the calls the checker's rule takes there.
    let name = |allowed: Allowed| {
        let calls: Vec<&str> = allowed.calls().iter().map(|c| c.word()).collect();
        json!({ "type": "string", "pattern": format!(r"^\s*({})\s*\(.*\)\s*$", calls.join("|")) })
    };
    let event_name = name(Allowed::Event);
    let variable_name = name(Allowed::Variable);
    let ignored = name(Allowed::Ignore);
    let name_or_names = json!({ "anyOf": [ignored, { "type": "array", "items": ignored }] });
    let text_or_texts = json!({ "anyOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }] });
    let range =
        json!({ "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 });
    let pace =
        json!({ "type": "string", "pattern": r"^(1 frame|[1-9][0-9]* frames|[1-9][0-9]*ms)$" });
    let steps = object(
        fields(blocks::STEPS, &|f| match f.key {
            "inc" | "dec" => event_name.clone(),
            "step" => json!({ "type": "number", "exclusiveMinimum": 0 }),
            "wrap" => json!({ "type": "boolean" }),
            "range" => range.clone(),
            "pace" => pace.clone(),
            _ => json!({}),
        }),
        &required(blocks::STEPS),
    );
    let toggle = object(
        fields(blocks::TOGGLE, &|_| event_name.clone()),
        &required(blocks::TOGGLE),
    );
    let mut count = object(
        fields(blocks::COUNT, &|f| match f.key {
            "step" => json!({ "type": "number", "exclusiveMinimum": 0 }),
            "wrap" => json!({ "type": "boolean" }),
            "range" => range.clone(),
            "count" => variable_name.clone(),
            _ => event_name.clone(),
        }),
        &required(blocks::COUNT),
    );
    count["anyOf"] = json!(["inc", "dec", "set", "count"].map(|f| json!({ "required": [f] })));
    // A state entry's write is a name, a function, or `none`, or a map that toggles or steps; an
    // event entry's is a name or a function alone, since an event has no value of the cockpit's
    // to compare or step from.
    let state_write = json!({ "anyOf": [{ "type": "string" }, toggle, steps] });
    let event_write = json!({ "type": "string", "not": { "pattern": r"^\s*none\s*$" } });
    // Each feature's blocks or fields of one kind, `of` picking which, after the format's own.
    let with_features = |own: Map<String, Value>, of: fn(&Module) -> &'static [Field]| {
        let mut all = own;
        for m in features::MODULES {
            all.extend(fields(of(m), &|f| (m.schema)(f.key)));
        }
        all
    };
    let entry = |table: &[Field], of: fn(&Module) -> &'static [Field], event: bool| {
        object(
            with_features(
                fields(table, &|f| match f.key {
                    "name" | "description" => json!({ "type": "string" }),
                    "watch" if event => name(Allowed::EventWatch),
                    "watch" => json!({ "anyOf": [name(Allowed::StateWatch), count.clone()] }),
                    "write" if event => event_write.clone(),
                    "write" => state_write.clone(),
                    "default" => json!({ "type": "number" }),
                    "owner" => json!({ "enum": f.words }),
                    "only" => text_or_texts.clone(),
                    "ignore" => name_or_names.clone(),
                    _ => json!({}),
                }),
                of,
            ),
            &required(table),
        )
    };
    let entries = |table: &[Field], of: fn(&Module) -> &'static [Field], event: bool| {
        json!({
            "type": "object",
            "propertyNames": { "pattern": "^[a-z][a-z0-9_]*$" },
            "additionalProperties": entry(table, of, event),
        })
    };
    let aircraft = object(
        fields(blocks::AIRCRAFT, &|f| match f.key {
            "variants" => {
                json!({ "type": "object", "minProperties": 1, "additionalProperties": text_or_texts.clone() })
            }
            _ => pace.clone(),
        }),
        &required(blocks::AIRCRAFT),
    );
    // A module holds no top-level block that's required, since each is a profile's alone.
    let top = object(
        with_features(
            fields(blocks::TOP, &|f| match f.key {
                "maker" | "name" | "authors" => json!({ "type": "string" }),
                "status" => json!({ "enum": f.words }),
                "aircraft" => aircraft.clone(),
                "import" => text_or_texts.clone(),
                "state" => entries(blocks::STATE_ENTRY, |m| m.state_fields, false),
                "events" => entries(blocks::EVENT_ENTRY, |m| m.event_fields, true),
                _ => json!({}),
            }),
            |m| m.blocks,
        ),
        &required(blocks::TOP),
    );
    let what = match file {
        Schema::Profile => "profile",
        Schema::Module => "module",
    };
    let mut schema = json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": format!("A Dual Input {what}, at level {level} of the format"),
    });
    if let (Value::Object(s), Value::Object(t)) = (&mut schema, top) {
        s.extend(t);
    }
    let mut text = serde_json::to_string_pretty(&schema).expect("a schema should encode");
    text.push('\n');
    text
}
