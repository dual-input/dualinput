//! An input as the kernel takes it and as the recording holds it. The kernel is a crate of
//! the platform's and the recording's format an engine, which can't depend on the platform,
//! so each has its own type, and the edge converts between them here.

pub fn to_record(input: &kernel::Input) -> recording_format::Input {
    recording_format::Input {
        seq: input.seq,
        stamp: input.stamp,
        source: input.source.0,
        bytes: input.bytes.clone(),
    }
}

pub fn from_record(input: recording_format::Input) -> kernel::Input {
    kernel::Input {
        seq: input.seq,
        stamp: input.stamp,
        source: kernel::SourceId(input.source),
        bytes: input.bytes,
    }
}
