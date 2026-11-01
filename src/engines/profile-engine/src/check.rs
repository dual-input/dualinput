//! The checker: one walk over a profile's files that builds the checked profile and reports
//! every mistake it finds, each at its place, as the core, CI, and the IDE all run it
//! (record/areas/profiles/01-format-and-delivery.md, "What fails a load").
//!
//! It walks the files' own trees rather than deserializing them, since whether a field may be
//! used turns on its level, which serde's "unknown field" can't say.

use std::collections::BTreeMap;

use crate::blocks::{self, Field};
use crate::features::{self, EntryFields, Module};
use crate::format::{
    Aircraft, Count, EventEntry, Maturity, Owner, Pace, Profile, StateEntry, Steps, Variant, Watch,
    Write,
};
use crate::names::{self, Name};
use crate::report::{Diagnostic, Place, Report};
use crate::tree::{Kind, Node, Text};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    /// A profile and its modules as an author wrote them, whose scripts are TypeScript.
    Source,
    /// A bundle, with its modules merged in and its scripts compiled to JavaScript.
    Bundle,
}

/// One of a profile's files, the profile first, then its modules in the order they're imported.
pub(crate) struct File<'a> {
    pub(crate) root: &'a Node,
    pub(crate) module: bool,
}

/// A write function, and where it sits.
#[derive(Clone, Debug)]
pub(crate) struct Script {
    pub(crate) event: bool,
    /// Its entry's place in `state` or `events`.
    pub(crate) entry: usize,
    pub(crate) text: Text,
}

pub(crate) struct Checked {
    pub(crate) profile: Profile,
    pub(crate) scripts: Vec<Script>,
}

/// Where each entry's parts sit, for the checks across entries.
struct Placed {
    key: String,
    at: Place,
    event: bool,
    watches: Vec<(Name, Place)>,
    only: Vec<(String, Place)>,
    ignore: Vec<(Name, Place)>,
}

pub(crate) fn check(files: &[File], level: u32, mode: Mode) -> (Checked, Report) {
    let mut c = Checker {
        level,
        mode,
        report: Report::default(),
        profile: Profile {
            name: String::new(),
            maturity: Maturity::Experimental,
            authors: None,
            aircraft: Aircraft::default(),
            state: Vec::new(),
            events: Vec::new(),
            features: features::Blocks::default(),
        },
        scripts: Vec::new(),
        placed: Vec::new(),
        module: false,
        variants_named: Vec::new(),
    };
    for file in files {
        c.top(file);
    }
    c.across();
    c.report.sort();
    (
        Checked {
            profile: c.profile,
            scripts: c.scripts,
        },
        c.report,
    )
}

/// The walk, which a feature's module checks its blocks and fields through.
pub(crate) struct Checker {
    level: u32,
    mode: Mode,
    report: Report,
    pub(crate) profile: Profile,
    scripts: Vec<Script>,
    placed: Vec<Placed>,
    /// Whether the file being walked is a module.
    module: bool,
    /// Each variant ID a feature's field named, which must be one of the profile's.
    pub(crate) variants_named: Vec<(String, Place)>,
}

/// A stepping write's map, read before the entry's watch says whether it's counted.
struct StepsAt {
    at: Place,
    inc: Option<Name>,
    dec: Option<Name>,
    step: f64,
    wrap: Option<(bool, Place)>,
    range: Option<((f64, f64), Place)>,
    pace: Option<Pace>,
}

enum WriteAt {
    Ready(Write),
    Steps(StepsAt),
}

impl Checker {
    pub(crate) fn error(&mut self, at: &Place, code: &str, message: impl Into<String>) {
        self.report
            .push(Diagnostic::error(at.clone(), code, message));
    }

    /// The field `key` names among `fields`, if this level has it and this file may use it.
    pub(crate) fn field(
        &mut self,
        fields: &'static [Field],
        key: &crate::tree::Key,
        module: bool,
        what: &str,
    ) -> Option<&'static Field> {
        self.field_in(&[fields], key, module, what)
    }

    /// The field `key` names among the format's own `fields` and each feature's that `of`
    /// gives, so a feature's block or field fails above its level or in a module as the
    /// format's own does.
    fn field_with_features(
        &mut self,
        fields: &'static [Field],
        of: fn(&Module) -> &'static [Field],
        key: &crate::tree::Key,
        module: bool,
        what: &str,
    ) -> Option<&'static Field> {
        let mut tables = vec![fields];
        tables.extend(features::MODULES.iter().map(|m| of(m)));
        self.field_in(&tables, key, module, what)
    }

    fn field_in(
        &mut self,
        tables: &[&'static [Field]],
        key: &crate::tree::Key,
        module: bool,
        what: &str,
    ) -> Option<&'static Field> {
        let Some(field) = tables.iter().find_map(|t| blocks::find(t, &key.text)) else {
            let known: Vec<_> = tables
                .iter()
                .flat_map(|t| t.iter())
                .filter(|f| f.level <= self.level && !(module && f.profile_only))
                .map(|f| format!("`{}`", f.key))
                .collect();
            let code = if what == "block" {
                "unknown-block"
            } else {
                "unknown-field"
            };
            self.error(
                &key.at,
                code,
                format!(
                    "`{}` isn't a {what} the format knows; {} {}",
                    key.text,
                    if known.len() == 1 {
                        "the one there is is"
                    } else {
                        "the ones there are"
                    },
                    known.join(", ")
                ),
            );
            return None;
        };
        if field.level > self.level {
            self.error(
                &key.at,
                "above-level",
                format!(
                    "`{}` came in at level {} of the format, above this level, {}",
                    key.text, field.level, self.level
                ),
            );
            return None;
        }
        if module && field.profile_only {
            self.error(
                &key.at,
                "module-only",
                format!(
                    "A module can't hold `{}`, which belongs to each profile",
                    key.text
                ),
            );
            return None;
        }
        Some(field)
    }

    pub(crate) fn map<'n>(
        &mut self,
        node: &'n Node,
        what: &str,
    ) -> Option<&'n [(crate::tree::Key, Node)]> {
        match &node.kind {
            Kind::Map(entries) => Some(entries),
            _ => {
                self.error(
                    &node.at,
                    "type",
                    format!("{what} is a map, not {}", node.what()),
                );
                None
            }
        }
    }

    pub(crate) fn text(&mut self, node: &Node, what: &str) -> Option<String> {
        match &node.kind {
            Kind::Str(t) if !t.text.trim().is_empty() => Some(t.text.clone()),
            Kind::Str(_) => {
                self.error(&node.at, "type", format!("{what} can't be empty"));
                None
            }
            _ => {
                self.error(
                    &node.at,
                    "type",
                    format!("{what} is text, not {}", node.what()),
                );
                None
            }
        }
    }

    pub(crate) fn number(&mut self, node: &Node, what: &str) -> Option<f64> {
        match node.kind {
            Kind::Number(n) => Some(n),
            _ => {
                self.error(
                    &node.at,
                    "type",
                    format!("{what} is a number, not {}", node.what()),
                );
                None
            }
        }
    }

    /// A field that takes a list also takes one item on its own.
    pub(crate) fn items(node: &Node) -> Vec<&Node> {
        match &node.kind {
            Kind::Seq(items) => items.iter().collect(),
            _ => vec![node],
        }
    }

    fn top(&mut self, file: &File) {
        self.module = file.module;
        let Some(entries) = self.map(file.root, "A profile") else {
            return;
        };
        let mut aircraft = false;
        for (key, node) in entries {
            let Some(field) =
                self.field_with_features(blocks::TOP, |m| m.blocks, key, file.module, "block")
            else {
                continue;
            };
            match field.key {
                "name" => {
                    if let Some(name) = self.text(node, "`name`") {
                        self.profile.name = name;
                    }
                }
                "maturity" => match node.str().map(|t| t.text.as_str()) {
                    Some("stable") => self.profile.maturity = Maturity::Stable,
                    Some("experimental") => self.profile.maturity = Maturity::Experimental,
                    _ => self.error(
                        &node.at,
                        "maturity",
                        "`maturity` is `stable` or `experimental`",
                    ),
                },
                "authors" => {
                    let authors = self.text(node, "`authors`");
                    if !file.module {
                        self.profile.authors = authors;
                    }
                }
                "aircraft" => {
                    aircraft = true;
                    self.aircraft(node);
                }
                "import" => {
                    if self.mode == Mode::Bundle {
                        self.error(
                            &key.at,
                            "import",
                            "A bundle has its modules merged in, so it has no `import`",
                        );
                    }
                    for item in Self::items(node) {
                        self.text(item, "Each import");
                    }
                }
                "state" => self.entries(node, false),
                "events" => self.entries(node, true),
                other => match features::owner(other, |m| m.blocks) {
                    Some((m, _)) => (m.check_block)(self, key, node),
                    None => unreachable!("every block in blocks::TOP is read above"),
                },
            }
        }
        if !file.module && !aircraft {
            self.error(
                &file.root.at,
                "required",
                "A profile names the aircraft it covers under `aircraft:`; a file without it is a module, which a profile imports",
            );
        }
        // The EFB app's list of supported aircraft shows every profile by these two, so a
        // profile without them would have no row to show.
        if !file.module {
            for key in ["name", "maturity"] {
                if !entries.iter().any(|(k, _)| k.text == key) {
                    self.error(
                        &file.root.at,
                        "required",
                        format!("A profile needs `{key}`, which the EFB app's list of supported aircraft shows"),
                    );
                }
            }
        }
    }

    fn aircraft(&mut self, node: &Node) {
        let Some(entries) = self.map(node, "`aircraft`") else {
            return;
        };
        let mut covered: BTreeMap<String, Place> = BTreeMap::new();
        for (key, value) in entries {
            let Some(field) = self.field(blocks::AIRCRAFT, key, false, "field of `aircraft`")
            else {
                continue;
            };
            match field.key {
                "variants" => {
                    let Some(variants) = self.map(value, "`variants`") else {
                        continue;
                    };
                    for (id, paths) in variants {
                        let mut variant = Variant {
                            id: id.text.clone(),
                            paths: Vec::new(),
                        };
                        for item in Self::items(paths) {
                            let Some(path) = self.text(item, "A variant's folder or preset") else {
                                continue;
                            };
                            if path.contains('\\') {
                                self.error(
                                    &item.at,
                                    "variant-path",
                                    format!("Write `{path}` with `/`, as the core compares it"),
                                );
                                continue;
                            }
                            let lower = path.to_ascii_lowercase();
                            if let Some(first) = covered.get(&lower) {
                                let message = format!(
                                    "`{path}` is covered by another variant too, at line {}",
                                    first.line
                                );
                                self.error(&item.at, "variant-path", message);
                                continue;
                            }
                            covered.insert(lower, item.at.clone());
                            variant.paths.push(path);
                        }
                        self.profile.aircraft.variants.push(variant);
                    }
                    if variants.is_empty() {
                        self.error(
                            &value.at,
                            "required",
                            "`variants` names at least one variant",
                        );
                    }
                }
                "pace" => self.profile.aircraft.pace = self.pace(value),
                _ => unreachable!("every field in blocks::AIRCRAFT is read above"),
            }
        }
        if self.profile.aircraft.variants.is_empty()
            && !entries.iter().any(|(k, _)| k.text == "variants")
        {
            self.error(&node.at, "required", "`aircraft` names its `variants`");
        }
    }

    fn pace(&mut self, node: &Node) -> Option<Pace> {
        let text = self.text(node, "A pace")?;
        let pace = Pace::parse(&text);
        if pace.is_none() {
            self.error(
                &node.at,
                "pace",
                format!(
                    "`{text}` isn't a pace: write `1 frame`, `<number> frames`, or `<number>ms`"
                ),
            );
        }
        pace
    }

    fn entries(&mut self, node: &Node, event: bool) {
        let block = if event { "`events`" } else { "`state`" };
        let Some(entries) = self.map(node, block) else {
            return;
        };
        for (key, value) in entries {
            let snake = key
                .text
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_lowercase())
                && key
                    .text
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            if !snake {
                self.error(
                    &key.at,
                    "key-form",
                    format!(
                        "`{}` is an entry's key, so it's lowercase snake_case starting with a letter, as `battery_1`",
                        key.text
                    ),
                );
                continue;
            }
            self.entry(key, value, event);
        }
    }

    fn entry(&mut self, key: &crate::tree::Key, node: &Node, event: bool) {
        let Some(fields) = self.map(node, "An entry") else {
            return;
        };
        let (table, of): (_, fn(&Module) -> &'static [Field]) = if event {
            (blocks::EVENT_ENTRY, |m| m.event_fields)
        } else {
            (blocks::STATE_ENTRY, |m| m.state_fields)
        };
        let module = self.module;
        let mut entry_features = EntryFields::default();
        let mut placed = Placed {
            key: key.text.clone(),
            at: key.at.clone(),
            event,
            watches: Vec::new(),
            only: Vec::new(),
            ignore: Vec::new(),
        };
        let mut name = None;
        let mut description = None;
        let mut watch: Option<(Watch, Place)> = None;
        let mut count: Option<CountAt> = None;
        let mut write: Option<(WriteAt, Place)> = None;
        let mut script: Option<Text> = None;
        let mut default: Option<(f64, Place)> = None;
        let mut owner = Owner::Shared;
        for (k, value) in fields {
            let Some(field) = self.field_with_features(table, of, k, module, "field of an entry")
            else {
                continue;
            };
            match field.key {
                "name" => name = self.text(value, "`name`"),
                "description" => description = self.text(value, "`description`"),
                "watch" if event => {
                    if let Some(n) = self.name(value, "`watch`", Allowed::EventWatch, false) {
                        placed.watches.push((n.clone(), value.at.clone()));
                        watch = Some((Watch::Name(n), value.at.clone()));
                    }
                }
                "watch" => {
                    if let Kind::Map(_) = value.kind {
                        count = self.count(value, &mut placed);
                    } else if let Some(n) = self.name(value, "`watch`", Allowed::StateWatch, false)
                    {
                        placed.watches.push((n.clone(), value.at.clone()));
                        watch = Some((Watch::Name(n), value.at.clone()));
                    }
                }
                "write" => {
                    if let Some((w, text)) = self.write(value, event) {
                        script = text;
                        write = Some((w, value.at.clone()));
                    }
                }
                "default" => {
                    if let Some(n) = self.number(value, "`default`") {
                        default = Some((n, value.at.clone()));
                    }
                }
                "owner" => match value.str().map(|t| t.text.as_str()) {
                    Some("pilot_flying") => owner = Owner::PilotFlying,
                    Some("shared") => owner = Owner::Shared,
                    _ => self.error(
                        &value.at,
                        "owner",
                        "`owner` is `pilot_flying`, or `shared`, the default",
                    ),
                },
                "only" => {
                    for item in Self::items(value) {
                        if let Some(id) = self.text(item, "Each of `only`'s variants") {
                            placed.only.push((id, item.at.clone()));
                        }
                    }
                }
                "ignore" => {
                    for item in Self::items(value) {
                        if let Some(n) = self.name(item, "`ignore`", Allowed::Ignore, false) {
                            placed.ignore.push((n, item.at.clone()));
                        }
                    }
                }
                other => match features::owner(other, of) {
                    Some((m, _)) => (m.check_field)(self, k, value, &mut entry_features),
                    None => unreachable!("every field of an entry is read above"),
                },
            }
        }
        let counted = count.is_some();
        if let Some(c) = count {
            match default {
                Some((d, _)) => {
                    watch = Some((
                        Watch::Count(Box::new(Count {
                            default: d,
                            inc: c.inc,
                            dec: c.dec,
                            step: c.step,
                            set: c.set,
                            count: c.count,
                            wrap: c.wrap,
                            range: c.range,
                        })),
                        c.at,
                    ));
                }
                None => self.error(
                    &c.at,
                    "default",
                    "A counting `watch` needs a `default`, the value the shadow starts from, which goes on the pilot flying's preflight checklist",
                ),
            }
        } else if let Some((_, at)) = &default {
            let at = at.clone();
            self.error(
                &at,
                "default",
                "`default` goes only with a `watch` that counts events into a shadow value",
            );
        }
        let write = write.and_then(|(w, _)| self.finish_write(w, counted));
        let missing: Vec<&str> = [
            ("name", name.is_none()),
            ("watch", watch.is_none() && !counted),
            ("write", write.is_none()),
        ]
        .iter()
        .filter(|(f, missing)| *missing && !fields.iter().any(|(k, _)| k.text == *f))
        .map(|(f, _)| *f)
        .collect();
        if !missing.is_empty() {
            let list: Vec<String> = missing.iter().map(|f| format!("`{f}`")).collect();
            self.error(
                &key.at,
                "required",
                format!("`{}` needs {}", key.text, list.join(" and ")),
            );
        }
        let (Some(name), Some((watch, _)), Some(write)) = (name, watch, write) else {
            return;
        };
        let only: Vec<String> = placed.only.iter().map(|(id, _)| id.clone()).collect();
        let ignore: Vec<Name> = placed.ignore.iter().map(|(n, _)| n.clone()).collect();
        let index = if event {
            let Watch::Name(watch) = watch else {
                unreachable!("an event entry's watch is a name")
            };
            self.profile.events.push(EventEntry {
                key: key.text.clone(),
                name,
                watch,
                write,
                only,
                ignore,
                features: entry_features,
            });
            self.profile.events.len() - 1
        } else {
            self.profile.state.push(StateEntry {
                key: key.text.clone(),
                name,
                description,
                watch,
                write,
                owner,
                only,
                ignore,
                features: entry_features,
            });
            self.profile.state.len() - 1
        };
        if let Some(text) = script {
            self.scripts.push(Script {
                event,
                entry: index,
                text,
            });
        }
        self.placed.push(placed);
    }

    fn count(&mut self, node: &Node, placed: &mut Placed) -> Option<CountAt> {
        let fields = self.map(node, "A counting `watch`")?;
        let module = self.module;
        let mut c = CountAt {
            at: node.at.clone(),
            inc: None,
            dec: None,
            step: 1.0,
            set: None,
            count: None,
            wrap: false,
            range: (0.0, 0.0),
        };
        let (mut wrap, mut range) = (false, false);
        for (k, value) in fields {
            let Some(field) = self.field(blocks::COUNT, k, module, "field of a counting `watch`")
            else {
                continue;
            };
            let what = format!("`{}`", field.key);
            match field.key {
                "inc" | "dec" | "set" => {
                    let n = self.name(value, &what, Allowed::Event, false);
                    if let Some(n) = &n {
                        placed.watches.push((n.clone(), value.at.clone()));
                    }
                    match field.key {
                        "inc" => c.inc = n,
                        "dec" => c.dec = n,
                        _ => c.set = n,
                    }
                }
                "count" => {
                    c.count = self.name(value, &what, Allowed::Variable, false);
                    if let Some(n) = &c.count {
                        placed.watches.push((n.clone(), value.at.clone()));
                    }
                }
                "step" => c.step = self.step(value).unwrap_or(1.0),
                "wrap" => {
                    wrap = true;
                    c.wrap = self.wrap(value).unwrap_or(false);
                }
                "range" => {
                    range = true;
                    c.range = self.range(value).unwrap_or((0.0, 0.0));
                }
                _ => unreachable!("every field in blocks::COUNT is read above"),
            }
        }
        if c.inc.is_none() && c.dec.is_none() && c.set.is_none() && c.count.is_none() {
            self.error(
                &node.at,
                "required",
                "A counting `watch` counts at least one of `inc`, `dec`, `set`, or `count`",
            );
        }
        if !wrap || !range {
            self.error(
                &node.at,
                "wrap",
                "A counting `watch` needs `wrap` and `range`, so the count stops, or goes round, where the aircraft's does",
            );
        }
        Some(c)
    }

    fn step(&mut self, node: &Node) -> Option<f64> {
        let n = self.number(node, "`step`")?;
        if n <= 0.0 {
            self.error(&node.at, "type", "`step` is a number above 0");
            return None;
        }
        Some(n)
    }

    fn wrap(&mut self, node: &Node) -> Option<bool> {
        match node.kind {
            Kind::Bool(b) => Some(b),
            _ => {
                self.error(&node.at, "type", "`wrap` is `true` or `false`");
                None
            }
        }
    }

    fn range(&mut self, node: &Node) -> Option<(f64, f64)> {
        if let Kind::Seq(items) = &node.kind
            && let [lo, hi] = items.as_slice()
            && let (Kind::Number(lo), Kind::Number(hi)) = (&lo.kind, &hi.kind)
            && lo < hi
        {
            return Some((*lo, *hi));
        }
        self.error(
            &node.at,
            "range",
            "`range` is the bottom and the top, as `[0, 359]`",
        );
        None
    }

    /// A write as written, and its script's text when it's a function.
    fn write(&mut self, node: &Node, event: bool) -> Option<(WriteAt, Option<Text>)> {
        match &node.kind {
            Kind::Str(t) if t.text.trim() == "none" => {
                if event {
                    self.error(
                        &node.at,
                        "write",
                        "An event entry's `write` says what the other machines do, so it can't be `none`",
                    );
                    return None;
                }
                Some((WriteAt::Ready(Write::None), None))
            }
            Kind::Str(t) if names::looks_like_name(&t.text) => {
                let n = self.name(node, "`write`", Allowed::Write, true)?;
                Some((WriteAt::Ready(Write::Name(n)), None))
            }
            Kind::Str(t) => Some((
                WriteAt::Ready(Write::Function(t.text.clone())),
                Some(t.clone()),
            )),
            // An event has no value of the cockpit's to compare with a wanted one, or to step
            // from, so on an event entry a toggle could only send its event, which a name
            // written on its own does, and a stepping write has nothing to step.
            Kind::Map(fields) if event => {
                let toggle = fields.iter().any(|(k, _)| k.text == "toggle");
                self.error(
                    &node.at,
                    "write",
                    if toggle {
                        "An event entry's `write` sends its event as a name on its own, such as `write: K('TOGGLE_BEACON_LIGHTS')`, since an event has no value to compare before a toggle"
                    } else {
                        "An event entry's `write` can't step, since an event has no value to step from: a value the aircraft keeps out of sight is a state entry that counts into a shadow value, and an event that carries a count of steps takes a write function"
                    },
                );
                None
            }
            Kind::Map(fields) if fields.iter().any(|(k, _)| k.text == "toggle") => {
                let module = self.module;
                let mut toggle = None;
                for (k, value) in fields {
                    if self
                        .field(blocks::TOGGLE, k, module, "field of a `toggle` map")
                        .is_some()
                    {
                        toggle = self.name(value, "`toggle`", Allowed::Event, false);
                    }
                }
                Some((WriteAt::Ready(Write::Toggle(toggle?)), None))
            }
            Kind::Map(fields) => {
                let module = self.module;
                let mut s = StepsAt {
                    at: node.at.clone(),
                    inc: None,
                    dec: None,
                    step: 1.0,
                    wrap: None,
                    range: None,
                    pace: None,
                };
                for (k, value) in fields {
                    let Some(field) =
                        self.field(blocks::STEPS, k, module, "field of a stepping `write`")
                    else {
                        continue;
                    };
                    let what = format!("`{}`", field.key);
                    match field.key {
                        "inc" => s.inc = self.name(value, &what, Allowed::Event, false),
                        "dec" => s.dec = self.name(value, &what, Allowed::Event, false),
                        "step" => s.step = self.step(value).unwrap_or(1.0),
                        "wrap" => s.wrap = self.wrap(value).map(|w| (w, value.at.clone())),
                        "range" => s.range = self.range(value).map(|r| (r, value.at.clone())),
                        "pace" => s.pace = self.pace(value),
                        _ => unreachable!("every field in blocks::STEPS is read above"),
                    }
                }
                if s.inc.is_none() || s.dec.is_none() {
                    self.error(
                        &node.at,
                        "required",
                        "A stepping `write` names both `inc` and `dec`",
                    );
                    return None;
                }
                Some((WriteAt::Steps(s), None))
            }
            _ => {
                self.error(
                    &node.at,
                    "type",
                    format!(
                        "`write` is a name, a map, a function, or `none`, not {}",
                        node.what()
                    ),
                );
                None
            }
        }
    }

    /// A stepping write's rules, once the entry says whether it's counted: a counted entry's
    /// write steps by the count's own `wrap` and `range`, and any other needs `wrap`.
    fn finish_write(&mut self, write: WriteAt, counted: bool) -> Option<Write> {
        let s = match write {
            WriteAt::Ready(w) => return Some(w),
            WriteAt::Steps(s) => s,
        };
        let (inc, dec) = (s.inc?, s.dec?);
        if counted {
            for at in [
                s.wrap.as_ref().map(|w| &w.1),
                s.range.as_ref().map(|r| &r.1),
            ]
            .into_iter()
            .flatten()
            {
                let at = at.clone();
                self.error(
                    &at,
                    "wrap",
                    "A counted entry's write steps by the count's `wrap` and `range`, so it gives neither",
                );
            }
            return Some(Write::Steps(Steps {
                inc,
                dec,
                step: s.step,
                wrap: None,
                range: None,
                pace: s.pace,
            }));
        }
        let Some((wrap, _)) = s.wrap else {
            self.error(
                &s.at,
                "wrap",
                "Does this control go from its top straight back to its bottom, like a heading (`wrap: true`), or stop at its ends (`wrap: false`)?",
            );
            return None;
        };
        if wrap && s.range.is_none() {
            self.error(
                &s.at,
                "range",
                "With `wrap: true`, `range` gives the bottom and the top, so the steps go the shorter way round",
            );
            return None;
        }
        Some(Write::Steps(Steps {
            inc,
            dec,
            step: s.step,
            wrap: Some(wrap),
            range: s.range.map(|(r, _)| r),
            pace: s.pace,
        }))
    }

    fn name(&mut self, node: &Node, what: &str, allowed: Allowed, value_ok: bool) -> Option<Name> {
        let Some(text) = node.str() else {
            self.error(
                &node.at,
                "type",
                format!("{what} is a name, such as `L('X')`, not {}", node.what()),
            );
            return None;
        };
        let name = match names::parse(&text.text) {
            Ok(name) => name,
            Err(e) => {
                self.error(&node.at, "name", e.0);
                return None;
            }
        };
        if let Some(why) = allowed.refuses(&name) {
            self.error(&node.at, "name-kind", format!("{what}: {why}"));
            return None;
        }
        if name.takes_value() && !value_ok {
            self.error(
                &node.at,
                "value-place",
                "Only a `write` that's a name takes `value`, the place the written value goes",
            );
            return None;
        }
        Some(name)
    }

    /// The checks across entries, once every file is read.
    fn across(&mut self) {
        let variants: Vec<String> = self
            .profile
            .aircraft
            .variants
            .iter()
            .map(|v| v.id.clone())
            .collect();
        let placed = std::mem::take(&mut self.placed);
        let mut keys: BTreeMap<&str, &Place> = BTreeMap::new();
        for p in &placed {
            if let Some(first) = keys.get(p.key.as_str()) {
                let message = format!(
                    "`{}` is defined twice, first in {} at line {}, and an entry's key is unique across the profile and its modules",
                    p.key, first.file, first.line
                );
                self.error(&p.at, "key-twice", message);
            } else {
                keys.insert(&p.key, &p.at);
            }
            for (id, at) in &p.only {
                if !variants.contains(id) {
                    let message = format!(
                        "`{id}` isn't one of this profile's variants: {}",
                        variants.join(", ")
                    );
                    self.error(at, "variant-unknown", message);
                }
            }
        }
        for (id, at) in std::mem::take(&mut self.variants_named) {
            if !variants.contains(&id) {
                let message = format!(
                    "`{id}` isn't one of this profile's variants: {}",
                    variants.join(", ")
                );
                self.error(&at, "variant-unknown", message);
            }
        }
        // Each pair of entries watching one name, with the variants both apply to.
        let mut twice: BTreeMap<(Place, String, String), Vec<&str>> = BTreeMap::new();
        for variant in &variants {
            let mut watched: BTreeMap<(char, String), &str> = BTreeMap::new();
            for p in &placed {
                if !p.only.is_empty() && !p.only.iter().any(|(id, _)| id == variant) {
                    continue;
                }
                for (name, at) in &p.watches {
                    let identity = name.identity();
                    if let Some(first) = watched.get(&identity) {
                        twice
                            .entry((at.clone(), first.to_string(), name.to_string()))
                            .or_default()
                            .push(variant);
                    } else {
                        watched.insert(identity, &p.key);
                    }
                }
            }
        }
        for ((at, first, name), on) in twice {
            let on = if on.len() < variants.len() {
                format!(" on {}", on.join(", "))
            } else {
                String::new()
            };
            self.error(
                &at,
                "watch-twice",
                format!(
                    "`{first}` already watches {name}{on}, and one entry whose function writes several targets covers what two would"
                ),
            );
        }
        let state_watches: Vec<(char, String)> = placed
            .iter()
            .filter(|p| !p.event)
            .flat_map(|p| p.watches.iter().map(|(n, _)| n.identity()))
            .collect();
        for p in &placed {
            for (name, at) in &p.ignore {
                if name.kind() == names::Kind::Variable && state_watches.contains(&name.identity())
                {
                    self.report.push(Diagnostic::warning(
                        at.clone(),
                        "ignore-watched",
                        format!(
                            "A state entry watches {name}, so it needs no `ignore`: a value written twice stays the same"
                        ),
                    ));
                }
            }
        }
        self.placed = placed;
    }
}

struct CountAt {
    at: Place,
    inc: Option<Name>,
    dec: Option<Name>,
    step: f64,
    set: Option<Name>,
    count: Option<Name>,
    wrap: bool,
    range: (f64, f64),
}

/// Which names a field takes.
#[derive(Clone, Copy)]
enum Allowed {
    StateWatch,
    EventWatch,
    Write,
    Event,
    Variable,
    Ignore,
}

impl Allowed {
    fn refuses(self, name: &Name) -> Option<String> {
        let refused = match self {
            Allowed::StateWatch => matches!(name, Name::K { .. } | Name::H { .. }),
            Allowed::EventWatch => matches!(name, Name::A { .. } | Name::Instrument { .. }),
            Allowed::Write | Allowed::Ignore => matches!(name, Name::Instrument { .. }),
            Allowed::Event => name.kind() != names::Kind::Event,
            Allowed::Variable => name.kind() != names::Kind::Variable,
        };
        refused.then(|| match self {
            Allowed::StateWatch => format!(
                "a state entry watches a variable, an input event, or an instrument() value, and {name} is an event, which an event entry watches"
            ),
            Allowed::EventWatch => format!(
                "an event entry watches a K:, H:, or B: event, or an L: variable as a pulse, and {name} isn't one"
            ),
            Allowed::Write | Allowed::Ignore => {
                "instrument() can be watched but never written or ignored; write the gauge through its H: events".to_string()
            }
            Allowed::Event => format!("this takes an event, K(), H(), or B(), and {name} isn't one"),
            Allowed::Variable => format!("this takes a variable, L() or A(), and {name} isn't one"),
        })
    }
}
