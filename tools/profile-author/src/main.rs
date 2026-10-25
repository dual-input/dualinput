//! `profile-author`: measures a profile's seats and its controls' locations in the sim, for
//! the core team, who run it from the repository with the sim in a flight in the aircraft
//! (record/areas/avatars/01-avatars.md, "The authoring tool"):
//!
//!   cargo run -p profile-author -- seats <profile>
//!   cargo run -p profile-author -- locations <profile> [<entry key>...]
//!
//! A profile is a file in a folder named `aircraft`, as `profiles/aircraft/bksq-baronpro.yaml`.
//! Each change goes into the profile as it's made, once the profile engine finds no error in
//! it, so ending the tool at any point loses nothing.

mod cockpit;
mod locations;
mod profile;
mod ray;
mod screen;
mod seats;
mod sim;
mod yaml;

use std::path::Path;
use std::process::ExitCode;

use crate::profile::ProfileFile;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &[String]) -> Result<(), String> {
    match args {
        [command, profile] if command == "seats" => {
            seats::run(ProfileFile::open(Path::new(profile))?)
        }
        [command, profile, keys @ ..] if command == "locations" => {
            locations::run(ProfileFile::open(Path::new(profile))?, keys)
        }
        _ => Err("Usage:
  cargo run -p profile-author -- seats <profile>
  cargo run -p profile-author -- locations <profile> [<entry key>...]"
            .into()),
    }
}
