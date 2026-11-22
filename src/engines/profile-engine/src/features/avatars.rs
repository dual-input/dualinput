//! Avatars' module: the `seats` block, where each seated figure sits, and the `location` and
//! `deadband` fields of an entry, where the figure's hand reaches for a change no click made
//! (record/areas/profiles/01-format-and-delivery.md, "Seats" and "State entries").

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::blocks::{Field, field, profile_only};
use crate::bundle::{Out, scalar};
use crate::check::Checker;
use crate::features::{self, Module};
use crate::tree::{Key, Kind, Node};

pub(crate) const MODULE: Module = Module {
    blocks: &[profile_only(
        "seats",
        1,
        "Where each seated figure sits, by the seat's key",
    )],
    state_fields: &[
        profile_only(
            "location",
            1,
            "Where the control is, [x, y, z] in meters from the aircraft's reference point, x left, y up, z forward, or a map from variant ID to a point, for the figure's hand",
        ),
        field(
            "deadband",
            1,
            "With a location, the smallest change of the entry's number, in its own units, that brings the hand",
        ),
    ],
    event_fields: &[profile_only(
        "location",
        1,
        "Where the control is, [x, y, z] in meters from the aircraft's reference point, or a map from variant ID to a point, for the figure's hand",
    )],
    check_block,
    check_field,
    emit_block,
    emit_fields,
    items: |_| SEAT,
    schema,
};

/// The fields of one seat.
const SEAT: &[Field] = &[
    profile_only("name", 1, "The seat's name, which a pilot reads").with_required(),
    profile_only(
        "hip",
        1,
        "Where the figure's hip sits, [x, y, z] in meters from the aircraft's reference point",
    )
    .with_required(),
    profile_only(
        "knees",
        1,
        "Where the knees are, [up, forward] in meters from the hip, in the seat's own frame",
    )
    .with_required(),
    profile_only(
        "feet",
        1,
        "Where the feet are, [up, forward] in meters from the hip, in the seat's own frame",
    )
    .with_required(),
    profile_only(
        "eye",
        1,
        "Where the eyes are, [up, forward] in meters from the hip, in the seat's own frame",
    )
    .with_required(),
    profile_only(
        "facing",
        1,
        "Which way the seat faces, in degrees from the nose, positive to the right, 0 unless given",
    ),
    profile_only(
        "take_radius",
        1,
        "How near its eye the camera takes the seat, in meters, 0.4 unless given",
    ),
    profile_only("only", 1, "The variant IDs the seat applies to"),
];

/// Avatars' blocks of a profile.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Blocks {
    pub seats: Vec<Seat>,
}

/// A seat, in meters, in the frame a `location` uses.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Seat {
    /// Its ID, which a pose carries.
    pub key: String,
    pub name: String,
    pub hip: [f64; 3],
    /// `[up, forward]` from the hip, in the seat's own frame.
    pub knees: [f64; 2],
    pub feet: [f64; 2],
    pub eye: [f64; 2],
    /// Degrees from the nose, positive to the right.
    pub facing: f64,
    pub take_radius: Option<f64>,
    pub only: Vec<String>,
}

/// Avatars' fields of an entry.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct EntryFields {
    pub location: Option<Location>,
    pub deadband: Option<f64>,
}

/// Where a control is: one point for every variant, or a point for each variant that has the
/// control there, where a variant missing from the map gets no location.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Location {
    Everywhere([f64; 3]),
    ByVariant(Vec<(String, [f64; 3])>),
}

impl Location {
    pub fn at(&self, variant: &str) -> Option<[f64; 3]> {
        match self {
            Location::Everywhere(p) => Some(*p),
            Location::ByVariant(points) => {
                points.iter().find(|(v, _)| v == variant).map(|(_, p)| *p)
            }
        }
    }
}

impl Blocks {
    pub(crate) fn resolve(&self, variant: &str) -> Blocks {
        Blocks {
            seats: self
                .seats
                .iter()
                .filter(|s| s.only.is_empty() || s.only.iter().any(|o| o == variant))
                .cloned()
                .collect(),
        }
    }
}

fn check_block(c: &mut Checker, _: &Key, node: &Node) {
    let Some(seats) = c.map(node, "`seats`") else {
        return;
    };
    for (key, value) in seats {
        if let Some(seat) = seat(c, key, value) {
            c.profile.features.avatars.seats.push(seat);
        }
    }
}

fn seat(c: &mut Checker, key: &Key, node: &Node) -> Option<Seat> {
    let fields = c.map(node, "A seat")?;
    let mut seat = Seat {
        key: key.text.clone(),
        name: String::new(),
        hip: [0.0; 3],
        knees: [0.0; 2],
        feet: [0.0; 2],
        eye: [0.0; 2],
        facing: 0.0,
        take_radius: None,
        only: Vec::new(),
    };
    let mut given = Vec::new();
    for (k, value) in fields {
        let Some(field) = c.field(SEAT, k, false, "field of a seat") else {
            continue;
        };
        given.push(field.key);
        match field.key {
            "name" => seat.name = c.text(value, "`name`").unwrap_or_default(),
            "hip" => seat.hip = point::<3>(c, value, "`hip`", "[x, y, z]")?,
            "knees" => seat.knees = point::<2>(c, value, "`knees`", "[up, forward]")?,
            "feet" => seat.feet = point::<2>(c, value, "`feet`", "[up, forward]")?,
            "eye" => seat.eye = point::<2>(c, value, "`eye`", "[up, forward]")?,
            "facing" => seat.facing = c.number(value, "`facing`").unwrap_or(0.0),
            "take_radius" => {
                let r = c.number(value, "`take_radius`")?;
                if r <= 0.0 {
                    c.error(
                        &value.at,
                        "type",
                        "`take_radius` is a number of meters above 0",
                    );
                    return None;
                }
                seat.take_radius = Some(r);
            }
            "only" => {
                for item in Checker::items(value) {
                    if let Some(id) = c.text(item, "Each of `only`'s variants") {
                        c.variants_named.push((id.clone(), item.at.clone()));
                        seat.only.push(id);
                    }
                }
            }
            _ => unreachable!("every field of a seat is read above"),
        }
    }
    let missing: Vec<String> = SEAT
        .iter()
        .filter(|f| f.required && !given.contains(&f.key))
        .map(|f| format!("`{}`", f.key))
        .collect();
    if !missing.is_empty() {
        c.error(
            &key.at,
            "required",
            format!("The seat `{}` needs {}", key.text, missing.join(" and ")),
        );
        return None;
    }
    Some(seat)
}

/// `N` numbers, written as a list, `form` saying their order.
fn point<const N: usize>(c: &mut Checker, node: &Node, what: &str, form: &str) -> Option<[f64; N]> {
    if let Kind::Seq(items) = &node.kind
        && items.len() == N
    {
        let mut out = [0.0; N];
        for (slot, item) in out.iter_mut().zip(items) {
            let Kind::Number(n) = item.kind else {
                break;
            };
            *slot = n;
        }
        if items.iter().all(|i| matches!(i.kind, Kind::Number(_))) {
            return Some(out);
        }
    }
    c.error(
        &node.at,
        "point",
        format!("{what} is {N} numbers, {form}, in meters"),
    );
    None
}

fn check_field(c: &mut Checker, key: &Key, node: &Node, fields: &mut features::EntryFields) {
    match key.text.as_str() {
        "location" => {
            fields.avatars.location = match &node.kind {
                Kind::Map(points) => {
                    let mut by = Vec::new();
                    for (variant, point_node) in points {
                        c.variants_named
                            .push((variant.text.clone(), variant.at.clone()));
                        if let Some(p) = point::<3>(c, point_node, "A location", "[x, y, z]") {
                            by.push((variant.text.clone(), p));
                        }
                    }
                    Some(Location::ByVariant(by))
                }
                _ => point::<3>(c, node, "`location`", "[x, y, z]").map(Location::Everywhere),
            };
        }
        "deadband" => {
            if let Some(d) = c.number(node, "`deadband`") {
                if d < 0.0 {
                    c.error(
                        &node.at,
                        "type",
                        "`deadband` is a change of the entry's number, 0 or above",
                    );
                } else {
                    fields.avatars.deadband = Some(d);
                }
            }
        }
        _ => unreachable!("every field avatars adds to an entry is read above"),
    }
}

fn emit_block(_: &str, blocks: &features::Blocks, out: &mut Out) {
    let seats = &blocks.avatars.seats;
    if seats.is_empty() {
        return;
    }
    out.line(0, "seats:");
    for s in seats {
        out.line(1, &format!("{}:", scalar(&s.key)));
        out.line(2, &format!("name: {}", scalar(&s.name)));
        out.line(2, &format!("hip: {}", list(&s.hip)));
        out.line(2, &format!("knees: {}", list(&s.knees)));
        out.line(2, &format!("feet: {}", list(&s.feet)));
        out.line(2, &format!("eye: {}", list(&s.eye)));
        if s.facing != 0.0 {
            out.line(2, &format!("facing: {}", s.facing));
        }
        if let Some(r) = s.take_radius {
            out.line(2, &format!("take_radius: {r}"));
        }
        if !s.only.is_empty() {
            out.line(2, "only:");
            for o in &s.only {
                out.line(3, &format!("- {}", scalar(o)));
            }
        }
    }
}

fn emit_fields(fields: &features::EntryFields, out: &mut Out) {
    match &fields.avatars.location {
        Some(Location::Everywhere(p)) => out.line(2, &format!("location: {}", list(p))),
        Some(Location::ByVariant(points)) => {
            out.line(2, "location:");
            for (v, p) in points {
                out.line(3, &format!("{}: {}", scalar(v), list(p)));
            }
        }
        None => {}
    }
    if let Some(d) = fields.avatars.deadband {
        out.line(2, &format!("deadband: {d}"));
    }
}

fn list(values: &[f64]) -> String {
    let items: Vec<String> = values.iter().map(|v| v.to_string()).collect();
    format!("[{}]", items.join(", "))
}

fn schema(key: &str) -> Value {
    let vec = |n: usize| json!({ "type": "array", "items": { "type": "number" }, "minItems": n, "maxItems": n });
    match key {
        "seats" => {
            let mut props = serde_json::Map::new();
            for f in SEAT {
                let mut v = match f.key {
                    "name" => json!({ "type": "string" }),
                    "hip" => vec(3),
                    "knees" | "feet" | "eye" => vec(2),
                    "facing" => json!({ "type": "number" }),
                    "take_radius" => json!({ "type": "number", "exclusiveMinimum": 0 }),
                    _ => {
                        json!({ "anyOf": [{ "type": "string" }, { "type": "array", "items": { "type": "string" } }] })
                    }
                };
                if let Value::Object(o) = &mut v {
                    o.insert("description".into(), json!(f.about));
                }
                props.insert(f.key.into(), v);
            }
            let required: Vec<&str> = SEAT.iter().filter(|f| f.required).map(|f| f.key).collect();
            json!({
                "type": "object",
                "additionalProperties": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": required,
                    "properties": props,
                },
            })
        }
        "location" => {
            json!({ "anyOf": [vec(3), { "type": "object", "additionalProperties": vec(3) }] })
        }
        "deadband" => json!({ "type": "number", "minimum": 0 }),
        _ => json!({}),
    }
}
