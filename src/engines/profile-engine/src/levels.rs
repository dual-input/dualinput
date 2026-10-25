//! Each level's files: its JSON Schema, which an editor's YAML support completes a profile's
//! fields from, and its declarations, the whole world a profile's scripts are type-checked
//! against. The builder's `levels` command writes them into `levels/<n>/`, where they're
//! committed, and a release freezes them (record/areas/profiles/02-units.md, "Levels").

use serde_json::{Map, Value, json};

use crate::blocks::{self, Field};
use crate::features::{self, Module};

/// Each part of the declarations, with the level it came in at.
///
/// TypeScript checks with `noLib`, so these are the scripts' whole world. Level 1's first part
/// is the JavaScript the sandbox runs, which tools/javascript-types.ts generates from
/// TypeScript's own libraries and the globals javascript/sandbox.json lists, so a script that
/// names something the sandbox lacks, such as `Date` or `Math.random`, fails its type check
/// (record/areas/architecture/02-code-map.md, "One loop").
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

/// The level's JSON Schema, from the format's tables, as pretty JSON with a final line break.
pub fn schema(level: u32) -> String {
    let fields = |table: &[Field], each: &dyn Fn(&str) -> Value| -> Map<String, Value> {
        table
            .iter()
            .filter(|f| f.level <= level)
            .map(|f| {
                let mut v = each(f.key);
                if let Value::Object(o) = &mut v {
                    o.insert("description".into(), json!(f.about));
                }
                (f.key.to_string(), v)
            })
            .collect()
    };
    let object = |props: Map<String, Value>| json!({ "type": "object", "additionalProperties": false, "properties": props });
    let name = json!({ "type": "string", "pattern": r"^\s*(L|A|B|K|H|instrument)\s*\(.*\)\s*$" });
    let name_or_names = json!({ "anyOf": [name, { "type": "array", "items": name }] });
    let text_or_texts = json!({ "anyOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }] });
    let range =
        json!({ "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 });
    let pace =
        json!({ "type": "string", "pattern": r"^(1 frame|[1-9][0-9]* frames|[1-9][0-9]*ms)$" });
    let steps = object(fields(blocks::STEPS, &|key| match key {
        "inc" | "dec" => name.clone(),
        "step" => json!({ "type": "number", "exclusiveMinimum": 0 }),
        "wrap" => json!({ "type": "boolean" }),
        "range" => range.clone(),
        "pace" => pace.clone(),
        _ => json!({}),
    }));
    let toggle = object(fields(blocks::TOGGLE, &|_| name.clone()));
    let count = object(fields(blocks::COUNT, &|key| match key {
        "step" => json!({ "type": "number", "exclusiveMinimum": 0 }),
        "wrap" => json!({ "type": "boolean" }),
        "range" => range.clone(),
        _ => name.clone(),
    }));
    let write = json!({ "anyOf": [{ "type": "string" }, toggle, steps] });
    // Each feature's blocks or fields of one kind, `of` picking which, after the format's own.
    let with_features = |own: Map<String, Value>, of: fn(&Module) -> &'static [Field]| {
        let mut all = own;
        for m in features::MODULES {
            all.extend(fields(of(m), &|key| (m.schema)(key)));
        }
        all
    };
    let entry = |table: &[Field], of: fn(&Module) -> &'static [Field]| {
        object(with_features(
            fields(table, &|key| match key {
                "name" => json!({ "type": "string" }),
                "watch" => json!({ "anyOf": [name.clone(), count.clone()] }),
                "write" => write.clone(),
                "default" => json!({ "type": "number" }),
                "owner" => json!({ "enum": ["pilot_flying", "shared"] }),
                "only" => text_or_texts.clone(),
                "ignore" => name_or_names.clone(),
                _ => json!({}),
            }),
            of,
        ))
    };
    let entries = |table: &[Field], of: fn(&Module) -> &'static [Field]| {
        json!({
            "type": "object",
            "propertyNames": { "pattern": "^[a-z][a-z0-9_]*$" },
            "additionalProperties": entry(table, of),
        })
    };
    let aircraft = object(fields(blocks::AIRCRAFT, &|key| match key {
        "variants" => {
            json!({ "type": "object", "minProperties": 1, "additionalProperties": text_or_texts.clone() })
        }
        _ => pace.clone(),
    }));
    let top = object(with_features(
        fields(blocks::TOP, &|key| match key {
            "authors" => json!({ "type": "string" }),
            "aircraft" => aircraft.clone(),
            "import" => text_or_texts.clone(),
            "state" => entries(blocks::STATE_ENTRY, |m| m.state_fields),
            "events" => entries(blocks::EVENT_ENTRY, |m| m.event_fields),
            _ => json!({}),
        }),
        |m| m.blocks,
    ));
    let mut schema = json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": format!("A Dual Input profile, at level {level} of the format"),
    });
    if let (Value::Object(s), Value::Object(t)) = (&mut schema, top) {
        s.extend(t);
    }
    let mut text = serde_json::to_string_pretty(&schema).expect("a schema should encode");
    text.push('\n');
    text
}
