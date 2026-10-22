use std::collections::BTreeMap;

/// The stand-in's aircraft: a table of named variables, each by the name SimConnect takes,
/// such as `IS ALTITUDE FREEZE ON` or `TITLE`. A variable nothing has set reads 0, or empty
/// text.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Aircraft {
    numbers: BTreeMap<String, f64>,
    texts: BTreeMap<String, String>,
}

impl Aircraft {
    pub fn number(&self, name: &str) -> f64 {
        self.numbers.get(name).copied().unwrap_or(0.0)
    }

    pub fn set_number(&mut self, name: &str, value: f64) {
        self.numbers.insert(name.to_string(), value);
    }

    pub fn text(&self, name: &str) -> String {
        self.texts.get(name).cloned().unwrap_or_default()
    }

    pub fn set_text(&mut self, name: &str, value: &str) {
        self.texts.insert(name.to_string(), value.to_string());
    }

    /// Every variable that's been set, with its value as text.
    pub(crate) fn variables(&self) -> Vec<(String, String)> {
        let numbers = self.numbers.iter().map(|(n, v)| (n.clone(), v.to_string()));
        let texts = self.texts.iter().map(|(n, v)| (n.clone(), v.clone()));
        numbers.chain(texts).collect()
    }
}
