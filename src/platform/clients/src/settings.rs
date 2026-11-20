//! The pilot's settings, which the core keeps in `settings.json` in its data folder, since it
//! needs them while no app is open, as for a pilot flying in VR (decision 016;
//! record/areas/core/02-clients-and-panel-bridge.md, "What a unit registers and calls").

use std::collections::BTreeMap;

use kernel::{Cx, Job, JobId};
use messages::clients::{SetSetting, Setting};
use serde_json::Value;

use crate::hooks::SettingDef;
use crate::{Clients, SettingChanged};

/// The settings' file in the core's data folder, whose bytes come with the core's first input.
/// `SETTINGS_FILE` in src/apps/desktop/src/places.rs names the same file, so change both
/// together.
pub(crate) const FILE: &str = "settings.json";

#[derive(Default)]
pub(crate) struct Settings {
    registered: BTreeMap<&'static str, SettingDef>,
    /// What the file held and what commands set since, a key no unit registered among them,
    /// so a feature deleted and restored finds its values.
    stored: BTreeMap<String, Value>,
    /// Whether a write of the file is out, and whether another change came since it went.
    writing: bool,
    again: bool,
    /// Whether the file the core started with didn't read, in which case no change writes it,
    /// since a write would hold only what changed and lose every other value in it.
    unreadable: bool,
}

impl Settings {
    pub(crate) fn register(&mut self, key: &'static str, setting: SettingDef) {
        assert!(
            setting.kind.fits(&setting.default),
            "setting {key}'s default should fit its type"
        );
        assert!(
            self.registered.insert(key, setting).is_none(),
            "setting {key} should be registered once"
        );
    }

    /// The stored value when it fits the setting's type, or its default.
    pub(crate) fn value(&self, key: &str) -> Option<&Value> {
        let setting = self.registered.get(key)?;
        Some(
            self.stored
                .get(key)
                .filter(|v| setting.kind.fits(v))
                .unwrap_or(&setting.default),
        )
    }

    /// The slice `settings`: every setting but the development ones, by key.
    pub(crate) fn slice(&self) -> Vec<Setting> {
        self.registered
            .iter()
            .filter(|(_, s)| !s.development)
            .map(|(&key, s)| Setting {
                key: key.to_string(),
                label: s.label.to_string(),
                kind: s.kind.clone(),
                value: self.value(key).cloned().unwrap_or(Value::Null),
                default: s.default.clone(),
                part_only: s.part_only,
            })
            .collect()
    }

    fn file(&self) -> Vec<u8> {
        let mut text = serde_json::to_string_pretty(&self.stored).unwrap_or_else(|_| "{}".into());
        text.push('\n');
        text.into_bytes()
    }
}

impl Clients {
    pub(crate) fn settings_file(me: &mut Clients, bytes: Option<&[u8]>, _: &mut Cx) {
        let Some(bytes) = bytes else {
            return;
        };
        match serde_json::from_slice::<BTreeMap<String, Value>>(bytes) {
            Ok(stored) => me.settings.stored = stored,
            Err(error) => {
                tracing::warn!(%error, "settings.json didn't read, so every setting takes its default, and no change is kept until the file reads");
                me.settings.unreadable = true;
                return;
            }
        }
        for (key, setting) in &me.settings.registered {
            if let Some(value) = me.settings.stored.get(*key)
                && !setting.kind.fits(value)
            {
                tracing::warn!(key, %value, default = %setting.default, "a stored setting doesn't fit its type, so it takes its default");
            }
        }
    }

    /// `SET_SETTING`, from any client.
    pub(crate) fn set_setting(&mut self, args: Value, cx: &mut Cx) -> Result<(), String> {
        let SetSetting { key, value } =
            serde_json::from_value(args).map_err(|e| format!("its arguments didn't read: {e}"))?;
        let Some(setting) = self.settings.registered.get(key.as_str()) else {
            return Err(format!("no setting is named {key}"));
        };
        if setting.development {
            return Err(format!(
                "{key} is a development setting, which changes only in settings.json"
            ));
        }
        if self.settings.unreadable {
            return Err("settings.json didn't read as the core started, so no setting changes until it's fixed or deleted while the core is stopped".into());
        }
        if !setting.kind.fits(&value) {
            return Err(format!("{value} doesn't fit {key}"));
        }
        if self.settings.value(&key) == Some(&value) {
            return Ok(());
        }
        tracing::info!(key, %value, "a setting changed");
        self.settings.stored.insert(key.clone(), value);
        self.write_settings(cx);
        cx.raise(SettingChanged { key });
        Ok(())
    }

    /// Writes the whole file again, as a job. The edge runs several jobs at once, so a
    /// change made while a write is out waits for that write's result, and two writes never
    /// land in the wrong order.
    fn write_settings(&mut self, cx: &Cx) {
        if self.settings.writing {
            self.settings.again = true;
            return;
        }
        self.settings.writing = true;
        cx.job(
            Job::write(FILE, self.settings.file()),
            Clients::settings_written,
        );
    }

    fn settings_written(me: &mut Clients, _: JobId, result: Result<Vec<u8>, String>, cx: &mut Cx) {
        if let Err(error) = result {
            tracing::error!(
                error,
                "settings.json couldn't be written, so the last change is lost at the core's next start"
            );
        }
        me.settings.writing = false;
        if std::mem::take(&mut me.settings.again) {
            me.write_settings(cx);
        }
    }
}
