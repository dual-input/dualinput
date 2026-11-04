//! A behavior file as a tree, which the template walk visits again for each use of a
//! template. quick-xml reads it, since the Comanche's `A2A_Templates.xml` puts a template's
//! parameter inside an element's name, which a strict reader refuses, and two of the
//! Bonanza's template files hold several root elements (read in a2a-aircraft-pa24 2.1.3 and
//! bksq-aircraft-bonanzapro 0.1.1, record/areas/avatars/results/
//! 2026-10-17-aircraft-model-research.txt).

use quick_xml::Reader;
use quick_xml::events::Event;

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Element {
    pub(crate) name: String,
    pub(crate) attrs: Vec<(String, String)>,
    pub(crate) children: Vec<Child>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Child {
    Element(Element),
    Text(String),
}

impl Element {
    /// An attribute's value, by its name compared ignoring case, since the Baron writes a
    /// component's node both as `Node` and as `NODE` (read in bksq-aircraft-baronpro 0.1.1,
    /// BaronProfessional_Base_INT.xml).
    pub(crate) fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub(crate) fn elements(&self) -> impl Iterator<Item = &Element> {
        self.children.iter().filter_map(|c| match c {
            Child::Element(e) => Some(e),
            Child::Text(_) => None,
        })
    }

    /// The first child element named `name`.
    pub(crate) fn child(&self, name: &str) -> Option<&Element> {
        self.elements().find(|e| e.name == name)
    }

    /// Its text, its children's text joined in order, which is how a parameter's value reads.
    pub(crate) fn text(&self) -> String {
        let mut out = String::new();
        for c in &self.children {
            match c {
                Child::Text(t) => out.push_str(t),
                Child::Element(e) => out.push_str(&e.text()),
            }
        }
        out
    }
}

/// How deep elements may nest, against a file whose depth would overflow the stack of whatever
/// walks or drops its tree, which ends the core.
const DEEPEST: usize = 256;

/// The file's root elements, under one element with no name.
pub(crate) fn parse(text: &str) -> Result<Element, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut reader = Reader::from_str(text);
    reader.config_mut().check_end_names = false;
    let mut open: Vec<Element> = vec![Element::default()];
    loop {
        let event = reader
            .read_event()
            .map_err(|e| format!("at byte {}: {e}", reader.buffer_position()))?;
        match event {
            Event::Start(_) if open.len() > DEEPEST => {
                return Err(format!(
                    "at byte {}: elements nest more than {DEEPEST} deep",
                    reader.buffer_position()
                ));
            }
            Event::Start(e) => open.push(element(&e)),
            Event::Empty(e) => {
                open.push(element(&e));
                close(&mut open);
            }
            Event::End(_) => close(&mut open),
            Event::Text(t) => push_text(&mut open, &t.xml10_content()),
            Event::CData(t) => push_text(&mut open, &t.xml10_content()),
            Event::GeneralRef(r) => {
                let resolved = match r.resolve_char_ref() {
                    Ok(Some(c)) => c.to_string(),
                    _ => match r.xml10_content().as_ref() {
                        "lt" => "<".into(),
                        "gt" => ">".into(),
                        "amp" => "&".into(),
                        "apos" => "'".into(),
                        "quot" => "\"".into(),
                        other => format!("&{other};"),
                    },
                };
                push_text(&mut open, &resolved);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    while open.len() > 1 {
        close(&mut open);
    }
    Ok(open.pop().unwrap_or_default())
}

fn element(e: &quick_xml::events::BytesStart<'_>) -> Element {
    let mut element = Element {
        name: e.name().as_ref().to_string(),
        ..Element::default()
    };
    for attr in e.attributes().flatten() {
        let value = attr
            .normalized_value(quick_xml::XmlVersion::default())
            .map(|v| v.into_owned())
            .unwrap_or_else(|_| attr.value.to_string());
        element.attrs.push((attr.key.as_ref().to_string(), value));
    }
    element
}

fn close(open: &mut Vec<Element>) {
    if open.len() < 2 {
        return;
    }
    if let (Some(done), Some(parent)) = (open.pop(), open.last_mut()) {
        parent.children.push(Child::Element(done));
    }
}

fn push_text(open: &mut [Element], text: &str) {
    if let Some(top) = open.last_mut() {
        match top.children.last_mut() {
            Some(Child::Text(t)) => t.push_str(text),
            _ => top.children.push(Child::Text(text.to_string())),
        }
    }
}
