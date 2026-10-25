//! The aircraft's own model: the job that builds it from the package's files, which the
//! edge reads one round at a time as `aircraft-model` names them, and its posing from the
//! variables its code reads (record/areas/avatars/01-avatars.md, "The aircraft model").

use aircraft_model::{Aircraft, Read};
use kernel::{Gathered, Job};

/// The job that reads the model's files and builds the model, handing up its buffer.
pub(crate) fn job(aircraft: &Aircraft) -> Job {
    let context = postcard::to_stdvec(aircraft).unwrap_or_default();
    Job::gather(context, follow).then(build)
}

/// Runs on the edge: the files the model still needs, given those read so far.
fn follow(context: &[u8], read: &[(String, Option<Vec<u8>>)]) -> Vec<String> {
    let Ok(aircraft) = postcard::from_bytes::<Aircraft>(context) else {
        return Vec::new();
    };
    aircraft_model::wanted(&aircraft, &|path| lookup(read, path))
}

/// Runs on the edge once the gather has read every file: the model's buffer.
fn build(gathered: Vec<u8>) -> Result<Vec<u8>, String> {
    let gathered = Gathered::decode(&gathered).ok_or("the gathered files didn't decode")?;
    let aircraft: Aircraft = postcard::from_bytes(&gathered.context)
        .map_err(|e| format!("the model job's aircraft didn't decode: {e}"))?;
    aircraft_model::build(&aircraft, &|path| lookup(&gathered.files, path))
}

fn lookup<'a>(read: &'a [(String, Option<Vec<u8>>)], path: &str) -> Read<'a> {
    match read.iter().find(|(p, _)| p == path) {
        Some((_, Some(bytes))) => Read::Bytes(bytes),
        Some((_, None)) => Read::Missing,
        None => Read::NotYet,
    }
}

/// A model variable as the sim client names it, `A:` or `L:` with its unit, or `number` for
/// code that names none.
pub(crate) fn sim_var(var: &aircraft_model::Var) -> sim_service::Var {
    let unit = if var.unit.is_empty() {
        "number"
    } else {
        &var.unit
    };
    sim_service::Var::number(&format!("{}:{}", var.kind, var.name), unit)
}
