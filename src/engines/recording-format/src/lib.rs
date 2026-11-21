//! A recording lets us replay a run of the core, Dual Input's main program, on our own PC,
//! and find the second where the replay parted from the run. This crate lays a recording
//! out: a header naming the build that made it, then records in the order they happened,
//! each an input the core handled or a checkpoint of what it had put out by then. Only the
//! build that wrote a recording replays it, so the layout carries no version.
//!
//! A core that's killed loses only what it wrote since it last flushed, which it does each
//! second. The file is one zstd frame, and a flush ends zstd's block, so everything written
//! before it decompresses without what comes after, and `Reader` stops at the last whole
//! record before the cut. One frame lets zstd find what repeats from one second to the next,
//! such as ground vehicles polled every 500ms: the flight of p10, a probe that recorded a
//! flight's inputs, came to 42.6 MB an hour that way, and to 66.7 MB with a frame ended each
//! second (record/areas/recording/log.md, 2026-10-23).
//!
//! Decompressed, a recording reads:
//!
//! ```text
//! DualInput recording\n                                              the magic
//! <n> <n bytes>                                                      the header, in postcard
//! 0 <seq gap> <stamp gap> <source> <n> <n bytes>                     an input
//! 1 <seq, 8 bytes> <hash, 8 bytes>                                   a checkpoint
//! ```
//!
//! An input's sequence number and stamp are each its gap from the input before, and every
//! number but a checkpoint's is a varint, 7 bits to a byte, as LEB128 has it. Gaps and
//! varints took p10's recording from 45.4 to 42.5 MB an hour with zstd at level 3, against 14
//! fixed bytes an input (record/areas/recording/01-recording-and-bug-reports.md, "The inputs").

use std::io::{self, BufReader, Read, Write};

use serde::{Deserialize, Serialize};

/// The first bytes of every recording, so a replay refuses any other file. `MAGIC` in
/// tools/replay.ts holds the same bytes, so change both together.
pub const MAGIC: &[u8] = b"DualInput recording\n";

/// The level p10's sizes above were measured at (record/areas/architecture/log.md,
/// 2026-10-16). src/engines/aircraft-model/tests/installed.rs compresses at the same level to
/// size the model's job's result in a recording, so change both together.
const LEVEL: i32 = 3;

const INPUT: u8 = 0;
const CHECKPOINT: u8 = 1;

/// The build that made a recording, and how it recorded. A replay compares the build with
/// its own: a replay built from another commit refuses, and one built with another compiler
/// or C runtime warns, since either can change the core's math
/// (record/areas/core/01-loop-and-edge.md, "Running a replay").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Header {
    /// The commit the core was built from, as 40 hex digits. tools/replay.ts reads it as the
    /// header's first field to find the release that shipped the core, so it stays first.
    pub commit: String,
    /// A SHA-256 of the changes not yet committed when it was built, or `None` when there
    /// were none.
    pub uncommitted: Option<String>,
    /// Cargo's profile, `debug` or `release`.
    pub profile: String,
    /// What `rustc -V` printed.
    pub rustc: String,
    /// The version of the MSVC tools the core was linked with, such as `14.44.35207`.
    pub msvc: String,
    /// The version of the Windows SDK whose C runtime the core links, such as `10.0.26100.0`.
    pub windows_sdk: String,
    /// The version of the MSFS SDK whose SimConnect headers laid out the messages the core
    /// read, such as `1.8.1`.
    pub simconnect_sdk: String,
    /// The PC's CPU, by the name it gives itself.
    pub cpu: String,
    /// Whether the CPU has FMA3, which the C runtime's math would use if the core let it.
    pub fma3: bool,
    /// Whether a checkpoint comes before every input, rather than once a second.
    pub checkpoint_every_input: bool,
}

/// One record of a recording.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Record {
    Input(Input),
    Checkpoint(Checkpoint),
}

/// An input the core handled: its bytes as they came in, and where from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Input {
    /// Its place in the core's queue, counted from 0.
    pub seq: u64,
    /// When the core's queue took it, in µs on the PC's performance counter.
    pub stamp: u64,
    /// The number of the source it came from, in the order the core's units registered them.
    pub source: u32,
    pub bytes: Vec<u8>,
}

/// The hash of everything the core's units had put out before the input `seq`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Checkpoint {
    pub seq: u64,
    pub hash: u64,
}

/// Writes a recording into one zstd frame.
pub struct Writer<W: Write> {
    /// `None` once a write failed, which took the output with it.
    encoder: Option<zstd::stream::write::Encoder<'static, W>>,
    seq: u64,
    stamp: u64,
}

impl<W: Write> Writer<W> {
    /// Starts a recording on `out` with its header, flushed.
    pub fn new(out: W, header: &Header) -> io::Result<Self> {
        let header = postcard::to_stdvec(header).map_err(io::Error::other)?;
        let mut bytes = MAGIC.to_vec();
        put_varint(&mut bytes, header.len() as u64);
        bytes.extend_from_slice(&header);
        let mut writer = Writer {
            encoder: Some(zstd::stream::write::Encoder::new(out, LEVEL)?),
            seq: 0,
            stamp: 0,
        };
        writer.put(&bytes)?;
        writer.flush()?;
        Ok(writer)
    }

    /// Adds a record. Inputs come in the order of their sequence numbers, as the core's queue
    /// hands them out.
    pub fn write(&mut self, record: &Record) -> io::Result<()> {
        let mut bytes = Vec::new();
        match record {
            Record::Input(input) => {
                let (Some(seq), Some(stamp)) = (
                    input.seq.checked_sub(self.seq),
                    input.stamp.checked_sub(self.stamp),
                ) else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        format!(
                            "input {} at {}µs came after input {} at {}µs",
                            input.seq, input.stamp, self.seq, self.stamp
                        ),
                    ));
                };
                bytes.push(INPUT);
                put_varint(&mut bytes, seq);
                put_varint(&mut bytes, stamp);
                put_varint(&mut bytes, u64::from(input.source));
                put_varint(&mut bytes, input.bytes.len() as u64);
                bytes.extend_from_slice(&input.bytes);
                self.seq = input.seq;
                self.stamp = input.stamp;
            }
            Record::Checkpoint(checkpoint) => {
                bytes.push(CHECKPOINT);
                bytes.extend_from_slice(&checkpoint.seq.to_le_bytes());
                bytes.extend_from_slice(&checkpoint.hash.to_le_bytes());
            }
        }
        self.put(&bytes)
    }

    /// Ends zstd's block and flushes it to `out`, so a reader gets every record written so
    /// far even if nothing is written after.
    pub fn flush(&mut self) -> io::Result<()> {
        self.with(|encoder| {
            encoder.flush()?;
            encoder.get_mut().flush()
        })
    }

    /// Ends the frame, and hands back `out`.
    pub fn finish(mut self) -> io::Result<W> {
        let mut out = self.encoder.take().ok_or_else(lost)?.finish()?;
        out.flush()?;
        Ok(out)
    }

    fn put(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.with(|encoder| encoder.write_all(bytes))
    }

    fn with(
        &mut self,
        f: impl FnOnce(&mut zstd::stream::write::Encoder<'static, W>) -> io::Result<()>,
    ) -> io::Result<()> {
        let result = f(self.encoder.as_mut().ok_or_else(lost)?);
        if result.is_err() {
            self.encoder = None;
        }
        result
    }
}

fn lost() -> io::Error {
    io::Error::other("an earlier write to the recording failed")
}

/// Reads a recording's records in order.
pub struct Reader<R: Read> {
    input: BufReader<zstd::stream::read::Decoder<'static, BufReader<R>>>,
    seq: u64,
    stamp: u64,
    truncated: bool,
}

impl<R: Read> Reader<R> {
    /// Reads the magic and the header, and fails on a file that isn't a recording.
    pub fn new(input: R) -> io::Result<(Header, Self)> {
        let mut reader = Reader {
            input: BufReader::new(zstd::stream::read::Decoder::new(input)?),
            seq: 0,
            stamp: 0,
            truncated: false,
        };
        let mut magic = [0; MAGIC.len()];
        reader
            .input
            .read_exact(&mut magic)
            .map_err(|_| not_a_recording())?;
        if magic != MAGIC {
            return Err(not_a_recording());
        }
        let length = reader.varint()?.ok_or_else(not_a_recording)?;
        let bytes = reader.bytes(length)?.ok_or_else(not_a_recording)?;
        let header = postcard::from_bytes(&bytes).map_err(|e| invalid(e.to_string()))?;
        Ok((header, reader))
    }

    /// The next record, or `None` at the end. The end comes early when the file stops inside
    /// a frame, as a killed core's does, and `truncated` then says so.
    pub fn next_record(&mut self) -> io::Result<Option<Record>> {
        let mut tag = [0];
        match self.input.read(&mut tag) {
            Ok(0) => return Ok(None),
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                self.truncated = true;
                return Ok(None);
            }
            Err(e) => return Err(e),
        }
        match tag[0] {
            INPUT => {
                let (Some(seq), Some(stamp), Some(source), Some(length)) = (
                    self.varint()?,
                    self.varint()?,
                    self.varint()?,
                    self.varint()?,
                ) else {
                    return Ok(None);
                };
                let Some(bytes) = self.bytes(length)? else {
                    return Ok(None);
                };
                self.seq = self
                    .seq
                    .checked_add(seq)
                    .ok_or_else(|| invalid("a sequence number overflowed"))?;
                self.stamp = self
                    .stamp
                    .checked_add(stamp)
                    .ok_or_else(|| invalid("a stamp overflowed"))?;
                let source = u32::try_from(source).map_err(|_| invalid("a source passed u32"))?;
                Ok(Some(Record::Input(Input {
                    seq: self.seq,
                    stamp: self.stamp,
                    source,
                    bytes,
                })))
            }
            CHECKPOINT => {
                let mut fields = [0; 16];
                if !self.exact(&mut fields)? {
                    return Ok(None);
                }
                let (seq, hash) = fields.split_at(8);
                Ok(Some(Record::Checkpoint(Checkpoint {
                    seq: u64::from_le_bytes(seq.try_into().expect("split_at(8) leaves 8 bytes")),
                    hash: u64::from_le_bytes(hash.try_into().expect("16 less 8 leaves 8 bytes")),
                })))
            }
            other => Err(invalid(format!("a record's kind was {other}"))),
        }
    }

    /// Whether the file stopped inside a frame.
    pub fn truncated(&self) -> bool {
        self.truncated
    }

    /// A varint, or `None` when the file stops inside it.
    fn varint(&mut self) -> io::Result<Option<u64>> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let mut byte = [0];
            if !self.exact(&mut byte)? {
                return Ok(None);
            }
            value |= u64::from(byte[0] & 0x7f) << shift;
            if byte[0] & 0x80 == 0 {
                return Ok(Some(value));
            }
        }
        Err(invalid("a varint ran past 64 bits"))
    }

    /// `length` bytes, or `None` when the file stops inside them. It reads rather than
    /// allocating `length` first, so a damaged length can't ask for terabytes.
    fn bytes(&mut self, length: u64) -> io::Result<Option<Vec<u8>>> {
        let mut bytes = Vec::new();
        match (&mut self.input).take(length).read_to_end(&mut bytes) {
            Ok(_) if bytes.len() as u64 == length => Ok(Some(bytes)),
            Ok(_) => {
                self.truncated = true;
                Ok(None)
            }
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                self.truncated = true;
                Ok(None)
            }
            Err(e) => Err(e),
        }
    }

    /// Fills `buffer`, or returns `false` when the file stops first.
    fn exact(&mut self, buffer: &mut [u8]) -> io::Result<bool> {
        match self.input.read_exact(buffer) {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                self.truncated = true;
                Ok(false)
            }
            Err(e) => Err(e),
        }
    }
}

fn put_varint(bytes: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        bytes.push(value as u8 | 0x80);
        value >>= 7;
    }
    bytes.push(value as u8);
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn not_a_recording() -> io::Error {
    invalid("the file isn't a Dual Input recording")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header() -> Header {
        Header {
            commit: "0".repeat(40),
            uncommitted: None,
            profile: "debug".into(),
            rustc: "rustc 1.95.0".into(),
            msvc: "14.44.35207".into(),
            windows_sdk: "10.0.26100.0".into(),
            simconnect_sdk: "1.8.1".into(),
            cpu: "a test CPU".into(),
            fma3: true,
            checkpoint_every_input: false,
        }
    }

    fn input(seq: u64, stamp: u64, bytes: &[u8]) -> Record {
        Record::Input(Input {
            seq,
            stamp,
            source: 3,
            bytes: bytes.to_vec(),
        })
    }

    fn read_all(file: &[u8]) -> (Header, Vec<Record>, bool) {
        let (header, mut reader) = Reader::new(file).expect("the file should be a recording");
        let mut records = Vec::new();
        while let Some(record) = reader.next_record().expect("every record should read") {
            records.push(record);
        }
        (header, records, reader.truncated())
    }

    /// An output a test can read while the writer still holds it.
    #[derive(Clone, Default)]
    struct Shared(std::rc::Rc<std::cell::RefCell<Vec<u8>>>);

    impl Write for Shared {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.borrow_mut().write(bytes)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn reads_back_what_it_wrote_across_flushes() {
        let records = vec![
            input(0, 1_000, b"first"),
            input(1, 1_000, b""),
            Record::Checkpoint(Checkpoint {
                seq: 4,
                hash: u64::MAX,
            }),
            input(4, 2_500_000, &[0xff; 300]),
            input(u64::MAX - 1, u64::MAX, b"last"),
        ];
        let mut writer = Writer::new(Vec::new(), &header()).unwrap();
        for (i, record) in records.iter().enumerate() {
            writer.write(record).unwrap();
            if i % 2 == 1 {
                writer.flush().unwrap();
            }
        }
        let file = writer.finish().unwrap();
        assert_eq!(read_all(&file), (header(), records, false));
    }

    /// A killed core leaves the file cut after its last flush, and the records flushed before
    /// the cut still read.
    #[test]
    fn stops_at_the_last_flush_of_a_cut_file() {
        let out = Shared::default();
        let mut writer = Writer::new(out.clone(), &header()).unwrap();
        writer.write(&input(0, 10, b"kept")).unwrap();
        writer.flush().unwrap();
        let flushed = out.0.borrow().len();
        writer.write(&input(1, 20, &[7; 5_000])).unwrap();
        writer.flush().unwrap();
        let mut file = out.0.borrow().clone();
        assert!(file.len() > flushed, "the second flush should add a block");
        file.truncate(flushed + (file.len() - flushed) / 2);
        let (_, records, truncated) = read_all(&file);
        assert_eq!(records, vec![input(0, 10, b"kept")]);
        assert!(truncated);
    }

    #[test]
    fn refuses_a_file_that_isnt_a_recording() {
        let mut encoder = zstd::stream::write::Encoder::new(Vec::new(), LEVEL).unwrap();
        encoder.write_all(b"DualInput recordinG\n").unwrap();
        let file = encoder.finish().unwrap();
        let error = Reader::new(&file[..]).err().expect("the magic differs");
        assert_eq!(error.to_string(), "the file isn't a Dual Input recording");
    }

    #[test]
    fn refuses_an_input_out_of_order() {
        let mut writer = Writer::new(Vec::new(), &header()).unwrap();
        writer.write(&input(5, 100, b"")).unwrap();
        assert!(writer.write(&input(4, 200, b"")).is_err());
        assert!(writer.write(&input(6, 99, b"")).is_err());
    }

    #[test]
    fn writes_each_number_as_a_varint() {
        let mut bytes = Vec::new();
        for value in [0, 127, 128, 300, u64::MAX] {
            put_varint(&mut bytes, value);
        }
        assert_eq!(bytes[..6], [0, 127, 0x80, 1, 0xac, 2]);
        assert_eq!(bytes.len(), 6 + 10);
    }
}
