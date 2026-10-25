//! Walking a model's behavior files the way the sim's template language reads them, to find
//! each animation's code and each node's visibility code with every template parameter and
//! macro of the aircraft's own expanded (documented, [Model Behaviors
//! Parameters](https://docs.flightsimulator.com/msfs2024/retail/content-configuration/models/modelbehaviors/usingbehaviours/model-behaviors-parameters/)
//! and [Program Template XML
//! Properties](https://docs.flightsimulator.com/msfs2024/retail/content-configuration/models/modelbehaviors/program-template-xml-properties/)).
//!
//! A template the aircraft's own files define is walked with the parameters its use gives.
//! One they don't define is the sim's own, whose body stays out, so its use is a leaf, and
//! the leaf's `ANIM_NAME` and `ANIM_CODE`, or its `VISIBILITY_CODE`, are what this walk finds:
//! the Baron hands its animation code to the sim's `ASOBO_GT_Anim_Code`, `ASOBO_GT_Switch_Code`,
//! and four more, and its visibility code to `ASOBO_GT_Visibility_Code` (read in
//! bksq-aircraft-baronpro 0.1.1, its three behavior files).

use std::collections::BTreeMap;

use crate::xml::Element;

/// How deep templates may use templates, against one that uses itself.
const DEEPEST: u32 = 32;
/// A loop with no `To` stops here, as the sim's does (documented, same page).
const MOST_LOOPS: i64 = 64;

/// An animation's code, by the glTF animation it drives.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Animation {
    pub(crate) name: String,
    pub(crate) code: String,
    /// The frame the code's value counts up to, `ANIM_LENGTH`, 100 unless given.
    pub(crate) length: f32,
}

/// A node's visibility code, by the node's name.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Visibility {
    pub(crate) node: String,
    pub(crate) code: String,
}

#[derive(Debug, Default)]
pub(crate) struct Found {
    pub(crate) animations: Vec<Animation>,
    pub(crate) visibility: Vec<Visibility>,
}

/// Walks the components of `files`, each a behavior file's root, with the templates and
/// macros every one of them defines.
pub(crate) fn walk(files: &[Element]) -> Found {
    let mut templates = BTreeMap::new();
    let mut macros = BTreeMap::new();
    let mut top = Vec::new();
    for root in files {
        for container in root.elements() {
            // A model file holds its behaviors in `<Behaviors>`, a template file in
            // `<ModelBehaviors>`.
            let items: Vec<&Element> = match container.name.as_str() {
                "ModelInfo" => container
                    .elements()
                    .filter(|e| e.name == "Behaviors")
                    .flat_map(|b| b.elements())
                    .collect(),
                _ => container.elements().collect(),
            };
            for item in items {
                match item.name.as_str() {
                    "Template" => {
                        if let Some(name) = item.attr("Name") {
                            templates.entry(name.to_ascii_lowercase()).or_insert(item);
                        }
                    }
                    "Macro" => {
                        if let Some(name) = item.attr("Name") {
                            macros.insert(name.to_ascii_lowercase(), item.text());
                        }
                    }
                    "Component" => top.push(item),
                    _ => {}
                }
            }
        }
    }
    let mut walker = Walker {
        templates,
        macros,
        frames: vec![Vec::new()],
        saved: BTreeMap::new(),
        found: Found::default(),
        depth: 0,
    };
    for component in top {
        walker.item(component, None);
    }
    walker.found
}

struct Walker<'d> {
    templates: BTreeMap<String, &'d Element>,
    macros: BTreeMap<String, String>,
    /// The parameters in scope: one frame for each component and each use of a template,
    /// the newest last, each holding its parameters, the newest last.
    frames: Vec<Vec<(String, String)>>,
    saved: BTreeMap<String, Vec<(String, String)>>,
    found: Found,
    depth: u32,
}

impl<'d> Walker<'d> {
    fn lookup(&self, name: &str) -> Option<&str> {
        self.lookup_at(name).map(|(_, v)| v)
    }

    /// The parameter's value, and the frame it's in, counted from the oldest. Names compare
    /// ignoring case, as the sim's do: the Baron's needle template sets `COMPLEXCONSTANTC`
    /// and its code reads `#ComplexConstantC#` (read in bksq-aircraft-baronpro 0.1.1,
    /// BaronProfessional_Templates.xml, `BKSQ_NEEDLE_TEMPLATE`).
    fn lookup_at(&self, name: &str) -> Option<(usize, &str)> {
        self.frames.iter().enumerate().rev().find_map(|(i, frame)| {
            frame
                .iter()
                .rev()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| (i, v.as_str()))
        })
    }

    fn expand(&self, text: &str) -> String {
        let params = |name: &str| self.lookup(name);
        let macros = |name: &str| {
            self.macros
                .get(&name.to_ascii_lowercase())
                .map(String::as_str)
        };
        msfs_rpn::expand(text, &params, &macros)
    }

    fn set(&mut self, name: String, value: String) {
        if let Some(frame) = self.frames.last_mut() {
            frame.push((name, value));
        }
    }

    /// One element in a body: a component, a template's use, parameters, or a program's
    /// condition, switch, or loop. Anything else, such as a sound event or an update
    /// script, poses nothing.
    fn item(&mut self, e: &'d Element, node: Option<&str>) {
        match e.name.as_str() {
            "Component" => {
                let own = e.attr("Node").map(|n| self.expand(n));
                let node = own.as_deref().or(node).map(str::to_string);
                self.frames.push(Vec::new());
                self.body(e, node.as_deref());
                self.frames.pop();
            }
            "UseTemplate" => self.use_template(e, node),
            "Parameters" | "DefaultTemplateParameters" => {
                let default = e.name == "DefaultTemplateParameters"
                    || e.attr("Type")
                        .is_some_and(|t| t.eq_ignore_ascii_case("Default"));
                self.parameters(e, default);
            }
            "Condition" => {
                let holds = self.condition(e);
                self.branch(e, holds, node, &|w, x, n| w.item(x, n));
            }
            "Switch" => {
                if let Some(case) = self.switch(e) {
                    self.body(case, node);
                }
            }
            "Loop" => self.repeat(e, node, &|w, x, n| w.body(x, n)),
            "SaveParameters" => self.save(e),
            "LoadParameters" => {
                if let Some(saved) = e.attr("ID").and_then(|id| self.saved.get(id)).cloned() {
                    for (k, v) in saved {
                        self.set(k, v);
                    }
                }
            }
            "RemoveSavedParameters" => {
                if let Some(id) = e.attr("ID") {
                    self.saved.remove(id);
                }
            }
            _ => {}
        }
    }

    fn body(&mut self, e: &'d Element, node: Option<&str>) {
        for child in e.elements() {
            self.item(child, node);
        }
    }

    /// A condition's body when it holds: its `<True>`, or, with neither `<True>` nor
    /// `<False>`, everything in it but its `<Test>`; and its `<False>` when it doesn't.
    fn branch(
        &mut self,
        e: &'d Element,
        holds: bool,
        node: Option<&str>,
        each: &dyn Fn(&mut Self, &'d Element, Option<&str>),
    ) {
        let has_branches = e.child("True").is_some() || e.child("False").is_some();
        let picked = if holds { "True" } else { "False" };
        for child in e.elements() {
            if has_branches {
                if child.name == picked {
                    for x in child.elements() {
                        each(self, x, node);
                    }
                }
            } else if holds && child.name != "Test" {
                each(self, child, node);
            }
        }
    }

    fn use_template(&mut self, e: &'d Element, node: Option<&str>) {
        let name = e.attr("Name").map(|n| self.expand(n)).unwrap_or_default();
        // The parameters a use gives read in the scope of the use, before any of them is set.
        let mut given = Vec::new();
        for p in e.elements() {
            given.push((self.expand(&p.name), self.expand(&p.text())));
        }
        self.frames.push(given);
        match self.templates.get(&name.to_ascii_lowercase()).copied() {
            Some(template) if self.depth < DEEPEST => {
                self.depth += 1;
                self.body(template, node);
                self.depth -= 1;
            }
            Some(_) => {}
            None => self.leaf(node),
        }
        self.frames.pop();
    }

    /// A use of one of the sim's templates. Its `ANIM_CODE` counts only from the frame that
    /// gave its `ANIM_NAME` or a nearer one, so a push button, which names its animation and
    /// runs its own code, never takes an `ANIM_CODE` an outer template meant for another.
    fn leaf(&mut self, node: Option<&str>) {
        if let Some((name_at, name)) = self.lookup_at("ANIM_NAME")
            && let Some((code_at, code)) = self.lookup_at("ANIM_CODE")
            && code_at >= name_at
        {
            let length = self
                .lookup("ANIM_LENGTH")
                .and_then(|l| l.trim().parse::<f32>().ok())
                .filter(|l| *l > 0.0)
                .unwrap_or(100.0);
            let animation = Animation {
                name: name.trim().to_string(),
                code: code.to_string(),
                length,
            };
            if !self
                .found
                .animations
                .iter()
                .any(|a| a.name.eq_ignore_ascii_case(&animation.name))
            {
                self.found.animations.push(animation);
            }
        }
        // A visibility code counts only from the use's own parameters, so a template's use
        // inside a component never takes one an outer template set for its own node.
        let own = self.frames.last().and_then(|f| {
            f.iter()
                .rev()
                .find(|(k, _)| k.eq_ignore_ascii_case("VISIBILITY_CODE"))
                .map(|(_, v)| v.clone())
        });
        if let Some(code) = own {
            let target = self.lookup("NODE_ID").map(str::to_string);
            if let Some(node) = target.as_deref().or(node) {
                let visibility = Visibility {
                    node: node.trim().to_string(),
                    code,
                };
                if !self
                    .found
                    .visibility
                    .iter()
                    .any(|v| v.node.eq_ignore_ascii_case(&visibility.node))
                {
                    self.found.visibility.push(visibility);
                }
            }
        }
    }

    /// `<Parameters>`: each parameter its children set, read before any is set, then set in
    /// the current frame; a default one only when no frame holds it already.
    fn parameters(&mut self, e: &'d Element, default: bool) {
        let mut set = Vec::new();
        self.gather_parameters(e, &mut set);
        for (name, value) in set {
            if default && self.lookup(&name).is_some() {
                continue;
            }
            self.set(name, value);
        }
    }

    fn gather_parameters(&mut self, e: &'d Element, out: &mut Vec<(String, String)>) {
        for p in e.elements() {
            match p.name.as_str() {
                "Condition" => {
                    let holds = self.condition(p);
                    let mut inner = Vec::new();
                    let has_branches = p.child("True").is_some() || p.child("False").is_some();
                    let picked = if holds { "True" } else { "False" };
                    for c in p.elements() {
                        if has_branches && c.name == picked {
                            self.gather_parameters(c, &mut inner);
                        } else if !has_branches && holds && c.name != "Test" {
                            self.gather_one(c, &mut inner);
                        }
                    }
                    out.extend(inner);
                }
                _ => self.gather_one(p, out),
            }
        }
    }

    fn gather_one(&mut self, p: &'d Element, out: &mut Vec<(String, String)>) {
        let name = self.expand(&p.name);
        let raw = self.expand(&p.text());
        let value = match p.attr("Process") {
            Some(kind) if kind.eq_ignore_ascii_case("Param") => {
                self.lookup(raw.trim()).unwrap_or_default().to_string()
            }
            Some(kind) if kind.eq_ignore_ascii_case("Macro") => self
                .macros
                .get(&raw.trim().to_ascii_lowercase())
                .map(|m| self.expand(m))
                .unwrap_or_default(),
            Some(kind) if kind.eq_ignore_ascii_case("Int") => {
                format!("{}", evaluate(&raw).trunc())
            }
            Some(kind) if kind.eq_ignore_ascii_case("Float") => {
                format!("{}", (evaluate(&raw) * 1e6).round() / 1e6)
            }
            _ => raw,
        };
        out.push((name, value));
    }

    fn save(&mut self, e: &'d Element) {
        let Some(id) = e.attr("ID").map(str::to_string) else {
            return;
        };
        let mut set = Vec::new();
        self.gather_parameters(e, &mut set);
        let append = e.attr("Append");
        let entry = self.saved.entry(id).or_default();
        match append {
            None => *entry = set,
            Some(a) if a.eq_ignore_ascii_case("Default") => {
                for (k, v) in set {
                    if !entry.iter().any(|(e, _)| *e == k) {
                        entry.push((k, v));
                    }
                }
            }
            Some(_) => {
                for (k, v) in set {
                    entry.retain(|(e, _)| *e != k);
                    entry.push((k, v));
                }
            }
        }
    }

    /// A `<Condition>`'s result, from its attributes or its `<Test>`.
    fn condition(&self, e: &Element) -> bool {
        if let Some(test) = e.child("Test") {
            return test.elements().next().is_some_and(|t| self.test(t));
        }
        self.attr_check(e)
    }

    /// A check written in attributes, on a `<Condition>`, a `<Case>`, or an `<Arg>`.
    fn attr_check(&self, e: &Element) -> bool {
        let valid = |name: &str| {
            self.lookup(&self.expand(name)).is_some_and(|v| {
                let v = v.trim();
                !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false")
            })
        };
        if let Some(name) = e.attr("Valid") {
            return valid(name);
        }
        if let Some(name) = e.attr("NotEmpty") {
            return self
                .lookup(&self.expand(name))
                .is_some_and(|v| !v.trim().is_empty());
        }
        if let Some(name) = e.attr("Check") {
            let value = self.lookup(&self.expand(name));
            if let Some(m) = e.attr("Match") {
                return value.is_some_and(|v| v.trim() == self.expand(m).trim());
            }
            if let Some(d) = e.attr("Different") {
                return value.is_none_or(|v| v.trim() != self.expand(d).trim());
            }
            return value.is_some();
        }
        if let Some(id) = e.attr("CheckSavedParameters") {
            return self.saved.contains_key(id);
        }
        if let Some(code) = e.attr("EvaluateAsBool") {
            return evaluate(&self.expand(code)) != 0.0;
        }
        false
    }

    fn test(&self, e: &Element) -> bool {
        let mut args = e.elements();
        match e.name.as_str() {
            "And" => {
                let (a, b) = (args.next(), args.next());
                a.is_some_and(|a| self.test(a)) && b.is_some_and(|b| self.test(b))
            }
            "Or" => {
                let (a, b) = (args.next(), args.next());
                a.is_some_and(|a| self.test(a)) || b.is_some_and(|b| self.test(b))
            }
            "Not" => !args.next().is_some_and(|a| self.test(a)),
            "Arg" => self.attr_check(e),
            "Greater" | "Lower" | "GreaterOrEqual" | "LowerOrEqual" | "Equal" => {
                let (Some(a), Some(b)) = (args.next(), args.next()) else {
                    return false;
                };
                let (a, b) = (self.operand(a), self.operand(b));
                match e.name.as_str() {
                    "Greater" => a > b,
                    "Lower" => a < b,
                    "GreaterOrEqual" => a >= b,
                    "LowerOrEqual" => a <= b,
                    _ => a == b,
                }
            }
            "StringEqual" => {
                let (Some(a), Some(b)) = (args.next(), args.next()) else {
                    return false;
                };
                self.text_operand(a) == self.text_operand(b)
            }
            _ => false,
        }
    }

    /// A number in a test: a literal, or the parameter a `<Number>` or `<Value>` names.
    fn operand(&self, e: &Element) -> f64 {
        let text = self.expand(&e.text());
        let text = text.trim();
        if let Ok(n) = text.parse::<f64>() {
            return n;
        }
        if e.name == "Arg" {
            return if self.attr_check(e) { 1.0 } else { 0.0 };
        }
        self.lookup(text)
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0.0)
    }

    fn text_operand(&self, e: &Element) -> String {
        let text = self.expand(&e.text());
        match e.name.as_str() {
            "Text" | "Constant" => text,
            _ => self.lookup(text.trim()).unwrap_or(&text).to_string(),
        }
    }

    fn switch(&self, e: &'d Element) -> Option<&'d Element> {
        let param = e.attr("Param").map(|p| {
            self.lookup(&self.expand(p))
                .map(|v| v.trim().to_string())
                .unwrap_or_default()
        });
        for case in e.elements().filter(|c| c.name == "Case") {
            let holds = match &param {
                Some(v) => case
                    .attr("Value")
                    .is_some_and(|c| self.expand(c).trim() == v),
                None => self.attr_check(case),
            };
            if holds {
                return Some(case);
            }
        }
        e.child("Default")
    }

    /// A `<Loop>`: its `<Do>` once for each value its `<Setup>` counts through, with its
    /// parameter set to it, then its `<Then>`.
    fn repeat(
        &mut self,
        e: &'d Element,
        node: Option<&str>,
        each: &dyn Fn(&mut Self, &'d Element, Option<&str>),
    ) {
        let Some(setup) = e.child("Setup") else {
            return;
        };
        let read = |name: &str| {
            setup
                .child(name)
                .and_then(|c| self.expand(&c.text()).trim().parse::<i64>().ok())
        };
        let param = setup
            .child("Param")
            .map(|p| self.expand(&p.text()).trim().to_string());
        let from = read("From").unwrap_or(0);
        let inc = read("Inc").unwrap_or(1);
        let to = read("To");
        if inc == 0 {
            return;
        }
        let mut i = from;
        let mut count = 0;
        loop {
            if let Some(to) = to {
                if (inc > 0 && i > to) || (inc < 0 && i < to) {
                    break;
                }
            } else if count >= MOST_LOOPS {
                break;
            }
            self.frames.push(Vec::new());
            if let Some(p) = &param {
                self.set(p.clone(), i.to_string());
            }
            let goes_on = setup
                .child("While")
                .is_none_or(|w| w.elements().next().is_some_and(|t| self.test(t)));
            if !goes_on {
                self.frames.pop();
                break;
            }
            if let Some(body) = e.child("Do") {
                each(self, body, node);
            }
            self.frames.pop();
            i += inc;
            count += 1;
            if count >= i64::from(u16::MAX) {
                break;
            }
        }
        if let Some(then) = e.child("Then") {
            each(self, then, node);
        }
    }
}

/// Code a parameter's `Process` runs, with no variable to read.
fn evaluate(code: &str) -> f64 {
    msfs_rpn::compile(code)
        .map(|p| p.run(&mut msfs_rpn::Scratch::default(), &|_| 0.0))
        .unwrap_or(0.0)
}
