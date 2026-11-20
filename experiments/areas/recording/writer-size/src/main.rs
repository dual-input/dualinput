//! Writes p10's capture through recording-format's writer and prints each recording's size,
//! as MB an hour of the capture's own clock: every kind together and each kind alone,
//! flushed each second, as the core's writer flushes, and as one frame with no flush. Then
//! it cuts the flushed recording midway between two flushes, as a killed core's file would
//! be, and reads it back.
//!
//! Each record of the capture becomes an input whose source is its kind and whose bytes are
//! its SimConnect message, with a checkpoint each second, as the core records them.
//!
//! On commit e38a4ff, the writer ended a frame each second rather than flushing, and this
//! probe compared that with one frame and with a re-encoding flushed each second; its output
//! then is results/2026-10-23-writer-size.txt.

use std::cell::RefCell;
use std::fs::File;
use std::io::{Read, Write};
use std::rc::Rc;

use recording_format::{Checkpoint, Header, Input, Reader, Record, Writer};

const SECOND: u64 = 1_000_000;

struct Captured<'a> {
    us: u64,
    kind: u16,
    bytes: &'a [u8],
}

/// An output the probe can read while the writer still holds it.
#[derive(Clone, Default)]
struct Shared(Rc<RefCell<Vec<u8>>>);

impl Write for Shared {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.borrow_mut().write(bytes)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: writer-size <capture.bin.zst>");
    let mut bytes = Vec::new();
    zstd::stream::read::Decoder::new(File::open(&path).expect("the capture should open"))
        .expect("the capture should start a zstd stream")
        .read_to_end(&mut bytes)
        .expect("the capture should decompress");
    let records = parse(&bytes);
    let first = records[0].us;
    let length = records.last().expect("the capture has records").us + 1 - first;
    let per_hour = 3_600.0 * SECOND as f64 / length as f64;
    println!(
        "{} records, {:.1} MB, over {:.1}s of the capture's clock",
        records.len(),
        bytes.len() as f64 / 1e6,
        length as f64 / 1e6
    );
    println!();
    println!("{:<8} {:>8} {:>16} {:>12}", "kind", "records", "flushed each 1s", "one frame");
    let mut kinds: Vec<u16> = records.iter().map(|r| r.kind).collect();
    kinds.sort_unstable();
    kinds.dedup();
    let mut rows = vec![("all".to_string(), None)];
    rows.extend(kinds.iter().map(|k| (k.to_string(), Some(*k))));
    for (name, kind) in rows {
        let chosen: Vec<&Captured> = records
            .iter()
            .filter(|r| kind.is_none_or(|k| r.kind == k))
            .collect();
        let (flushed, _) = write(&chosen, first, true);
        let (whole, _) = write(&chosen, first, false);
        println!(
            "{:<8} {:>8} {:>13.2} MB {:>9.2} MB",
            name,
            chosen.len(),
            flushed.len() as f64 * per_hour / 1e6,
            whole.len() as f64 * per_hour / 1e6,
        );
    }
    println!();
    println!("MB an hour with zstd at recording-format's level, on the capture's clock.");
    println!();

    // Cut midway between two flushes 70% of the way through, as a kill would.
    let all: Vec<&Captured> = records.iter().collect();
    let (file, flushes) = write(&all, first, true);
    let n = flushes.len() * 7 / 10;
    let (inputs, at) = flushes[n];
    let cut = (at + flushes[n + 1].1) / 2;
    let (_, mut reader) = Reader::new(&file[..cut]).expect("the cut file should open");
    let mut read = 0;
    while let Some(record) = reader.next_record().expect("the cut file should read") {
        if matches!(record, Record::Input(_)) {
            read += 1;
        }
    }
    println!(
        "Cut at byte {cut} of {}: read {read} inputs, {inputs} were flushed before the cut, truncated: {}",
        file.len(),
        reader.truncated()
    );
}

fn parse(bytes: &[u8]) -> Vec<Captured<'_>> {
    let mut records = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let head = &bytes[at..at + 14];
        let us = u64::from_le_bytes(head[0..8].try_into().expect("8 bytes"));
        let kind = u16::from_le_bytes(head[8..10].try_into().expect("2 bytes"));
        let length = u32::from_le_bytes(head[10..14].try_into().expect("4 bytes")) as usize;
        records.push(Captured {
            us,
            kind,
            bytes: &bytes[at + 14..at + 14 + length],
        });
        at += 14 + length;
    }
    records
}

/// The recording, and with `flushed`, each flush's count of inputs before it and the file's
/// length after it. A flush comes as each second of the capture's clock begins, after that
/// second's checkpoint.
fn write(records: &[&Captured], first: u64, flushed: bool) -> (Vec<u8>, Vec<(usize, usize)>) {
    let out = Shared::default();
    let mut writer = Writer::new(out.clone(), &header()).expect("a Vec takes every write");
    let (mut second, mut flushes) = (0, Vec::new());
    for (seq, record) in records.iter().enumerate() {
        let stamp = record.us - first;
        if stamp / SECOND > second {
            second = stamp / SECOND;
            writer
                .write(&Record::Checkpoint(Checkpoint {
                    seq: seq as u64,
                    hash: seq as u64 ^ 0x9E37_79B9_7F4A_7C15,
                }))
                .expect("a Vec takes every write");
            if flushed {
                writer.flush().expect("a Vec takes every write");
                flushes.push((seq, out.0.borrow().len()));
            }
        }
        writer
            .write(&Record::Input(Input {
                seq: seq as u64,
                stamp,
                source: u32::from(record.kind),
                bytes: record.bytes.to_vec(),
            }))
            .expect("a Vec takes every write");
    }
    writer.finish().expect("a Vec takes every write");
    let file = out.0.borrow().clone();
    (file, flushes)
}

fn header() -> Header {
    Header {
        commit: "0".repeat(40),
        uncommitted: None,
        profile: "release".into(),
        rustc: "rustc".into(),
        msvc: "14".into(),
        windows_sdk: "10".into(),
        simconnect_sdk: "1.8.1".into(),
        cpu: "cpu".into(),
        fma3: true,
        checkpoint_every_input: false,
    }
}
