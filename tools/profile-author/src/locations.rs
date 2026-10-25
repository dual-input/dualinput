//! `locations`: the profile's entries walked one at a time, the author pointing the cursor at
//! each control and marking it with Page Down or skipping it with Page Up, and each mark's
//! cast written as the entry's `location` for the loaded variant
//! (record/areas/avatars/01-avatars.md, "The authoring tool").
//!
//! A mark is a key rather than a click, so walking every entry leaves the cockpit as it was: a
//! click would flip up a guard's cover, push a knob, or engage a starter.

use std::time::Duration;

use aircraft_model::{Hit, Scene};
use profile_engine::features::avatars::Location;
use sim_client::message::{Camera, Message};

use crate::cockpit::{self, Cockpit};
use crate::profile::{self, Block, Entry, Facts, ProfileFile};
use crate::screen::{self, Cursor, Key};
use crate::sim::{Event, Received};
use crate::yaml::{self, Value};

const HELP: &str = "\
Point the cursor at each control in the sim, then:
  Page Down    marks it, and goes to the next entry
  Page Up      skips it, leaving its location as it was
Typed here, each ended with Enter:
  <number>     the deadband of the state entry marked last, in its own units
  back         the entry before
  quit         end; every mark is already written";

/// The entries to walk with `variant` loaded: those `keys` names, or every one, that apply to
/// it.
pub fn walk(facts: &Facts, variant: &str, keys: &[String]) -> Result<Vec<Entry>, String> {
    if let Some(unknown) = keys
        .iter()
        .find(|k| !facts.entries.iter().any(|e| &e.key == *k))
    {
        return Err(format!("the profile has no entry {unknown}"));
    }
    Ok(facts
        .entries
        .iter()
        .filter(|e| e.applies(variant))
        .filter(|e| keys.is_empty() || keys.contains(&e.key))
        .cloned()
        .collect())
}

/// `text` with `point` written as `entry`'s location for `variant`, by the entry as `text`
/// holds it, so a point another variant's walk wrote stays.
pub fn write_location(
    text: &str,
    entry: &Entry,
    variant: &str,
    point: [f64; 3],
) -> Result<String, String> {
    let facts = Facts::read(text)?;
    let now = facts
        .entries
        .iter()
        .find(|e| e.block == entry.block && e.key == entry.key)
        .ok_or_else(|| format!("the profile holds no entry {}", entry.key))?;
    let location = profile::located(now, &facts.variants, variant, point);
    yaml::set(
        text,
        &now.path("location"),
        &profile::location_value(&location),
    )
}

fn shown(location: &Option<Location>, variant: &str) -> String {
    match location.as_ref().and_then(|l| l.at(variant)) {
        Some(p) => format!(
            "at [{}, {}, {}]",
            profile::meters(p[0]),
            profile::meters(p[1]),
            profile::meters(p[2])
        ),
        None => "no location yet".into(),
    }
}

struct Walk {
    cockpit: Cockpit,
    file: ProfileFile,
    variant: String,
    entries: Vec<Entry>,
    at: usize,
    /// The state entry marked last, which a number typed here gives a deadband.
    last: Option<usize>,
    /// The cursor's place at a Page Down, while the camera's answer is on its way.
    asked: Option<Cursor>,
    marked: usize,
    skipped: usize,
}

pub fn run(file: ProfileFile, keys: &[String]) -> Result<(), String> {
    let facts = Facts::read(&file.read()?)?;
    let cockpit = Cockpit::connect()?;
    let variant = facts.variant(&cockpit.aircraft).ok_or_else(|| {
        format!(
            "{} covers none of the loaded aircraft, {}",
            file.path.display(),
            cockpit.aircraft
        )
    })?;
    let entries = walk(&facts, &variant, keys)?;
    println!(
        "variant: {variant}; {}",
        plural(entries.len(), "entry", "entries")
    );
    if entries.is_empty() {
        return Ok(());
    }
    println!("{HELP}");
    let mut walk = Walk {
        cockpit,
        file,
        variant,
        entries,
        at: 0,
        last: None,
        asked: None,
        marked: 0,
        skipped: 0,
    };
    walk.show();
    walk.run()?;
    println!(
        "marked {}, skipped {}, in {}",
        plural(walk.marked, "entry", "entries"),
        walk.skipped,
        walk.file.path.display()
    );
    Ok(())
}

impl Walk {
    fn run(&mut self) -> Result<(), String> {
        while self.at < self.entries.len() {
            match self.cockpit.events.next(Duration::from_secs(1)) {
                Some(Event::Sim(up)) => {
                    let Some(received) = self.cockpit.sim.receive(up)? else {
                        continue;
                    };
                    if self.cockpit.take(&received) {
                        continue;
                    }
                    if let Received::Message(Message::Camera(camera)) = received
                        && let Some(cursor) = self.asked.take()
                    {
                        self.mark(&camera, &cursor);
                    }
                }
                Some(Event::Key {
                    sim_in_front: false,
                    ..
                }) => {
                    println!("  Page Down and Page Up count only while the sim is in front");
                }
                // A press while the last one's camera answer is out takes its place.
                Some(Event::Key { key: Key::Mark, .. }) => {
                    match screen::cursor().filter(Cursor::over_window) {
                        Some(cursor) => {
                            self.asked = Some(cursor);
                            self.cockpit.ask_camera();
                        }
                        None => {
                            println!("  the cursor isn't over the sim's window");
                            screen::beep(false);
                        }
                    }
                }
                // Moving to another entry drops a press still waiting for the camera, whose
                // point is for the entry left.
                Some(Event::Key { key: Key::Skip, .. }) => {
                    self.asked = None;
                    println!("  skipped");
                    self.skipped += 1;
                    self.next();
                }
                None => {}
                Some(Event::Line(line)) => match line.trim() {
                    "quit" => return Ok(()),
                    "back" => {
                        self.asked = None;
                        self.at = self.at.saturating_sub(1);
                        self.show();
                    }
                    "" => {}
                    "help" => println!("{HELP}"),
                    number => match number.parse::<f64>() {
                        Ok(d) if d >= 0.0 => self.deadband(d),
                        _ => println!("  that isn't a deadband or a command; `help` lists them"),
                    },
                },
                Some(Event::Closed) => return Ok(()),
            }
        }
        Ok(())
    }

    fn show(&self) {
        let e = &self.entries[self.at];
        println!(
            "[{}/{}] {}.{}, {}: {}",
            self.at + 1,
            self.entries.len(),
            e.block.key(),
            e.key,
            e.name,
            shown(&e.location, &self.variant)
        );
    }

    fn next(&mut self) {
        self.at += 1;
        if self.at < self.entries.len() {
            self.show();
        }
    }

    fn mark(&mut self, camera: &Camera, cursor: &Cursor) {
        let Some((hit, scene)) = cockpit::cast(&mut self.cockpit.model, camera, cursor) else {
            println!("  the ray met nothing: point at the control and press Page Down again");
            screen::beep(false);
            return;
        };
        let entry = self.entries[self.at].clone();
        let point = hit.point.map(f64::from);
        let written = self
            .file
            .read()
            .and_then(|text| write_location(&text, &entry, &self.variant, point))
            .and_then(|text| self.file.write(&text));
        if let Err(e) = written {
            println!("  {e}");
            screen::beep(false);
            return;
        }
        screen::beep(true);
        println!("  {}", described(&self.cockpit, &hit, scene, camera));
        self.entries[self.at].location = Some(Location::Everywhere(point));
        self.marked += 1;
        self.last = (entry.block == Block::State).then_some(self.at);
        self.next();
    }

    fn deadband(&mut self, d: f64) {
        let Some(at) = self.last else {
            println!("  a deadband goes on the state entry marked last, and none is");
            return;
        };
        let entry = self.entries[at].clone();
        let written = self
            .file
            .read()
            .and_then(|text| yaml::set(&text, &entry.path("deadband"), &Value::Line(d.to_string())))
            .and_then(|text| self.file.write(&text));
        match written {
            Ok(()) => println!("  {}'s deadband is {d}", entry.key),
            Err(e) => println!("  {e}"),
        }
    }
}

/// A mark, as the author checks it: where it landed, on which part, and how far from the eye.
fn described(cockpit: &Cockpit, hit: &Hit, scene: Scene, camera: &Camera) -> String {
    let node = cockpit.model.node_name(scene, hit.node).unwrap_or("?");
    let p = hit.point;
    let c = camera.position;
    let far = ((f64::from(p[0]) - c[0]).powi(2)
        + (f64::from(p[1]) - c[1]).powi(2)
        + (f64::from(p[2]) - c[2]).powi(2))
    .sqrt();
    format!(
        "marked at [{}, {}, {}] on {node}, in the {}, {:.2}m from the camera",
        profile::meters(f64::from(p[0])),
        profile::meters(f64::from(p[1])),
        profile::meters(f64::from(p[2])),
        if scene == Scene::Interior {
            "interior"
        } else {
            "exterior"
        },
        far
    )
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::tests::{PROFILE, read_back};

    #[test]
    fn the_walk_takes_the_entries_that_apply_to_the_loaded_variant() {
        let facts = Facts::read(PROFILE).unwrap();
        let keys = |w: Vec<Entry>| w.into_iter().map(|e| e.key).collect::<Vec<_>>();
        assert_eq!(
            keys(walk(&facts, "base", &[]).unwrap()),
            ["battery", "ap_master"]
        );
        assert_eq!(
            keys(walk(&facts, "press", &[]).unwrap()),
            ["battery", "mixture_1", "ap_master"]
        );
        assert_eq!(
            keys(walk(&facts, "press", &["ap_master".into()]).unwrap()),
            ["ap_master"]
        );
        assert!(walk(&facts, "press", &["nope".into()]).is_err());
    }

    #[test]
    fn a_mark_with_each_variant_loaded_leaves_each_its_own_point() {
        let facts = Facts::read(PROFILE).unwrap();
        let battery = facts.entries[0].clone();
        let text = write_location(PROFILE, &battery, "press", [0.3, 0.6, 1.9]).unwrap();
        let text = write_location(&text, &battery, "base", [0.2, 0.6, 1.9]).unwrap();
        assert_eq!(
            read_back(&text).state[0].features.avatars.location,
            Some(Location::ByVariant(vec![
                ("base".into(), [0.2, 0.6, 1.9]),
                ("press".into(), [0.3, 0.6, 1.9]),
            ]))
        );
    }
}
