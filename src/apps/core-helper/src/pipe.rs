//! The helper's ends of the pipe: each `ToHelper` read from its standard input, and each
//! `FromHelper` written to its standard output by a thread of its own, one at a time
//! (record/areas/core/04-core-helper.md, "The pipe").

use std::io::{Read, Write};
use std::sync::mpsc;

use messages::core_helper::{self, FromHelper, ToHelper};

/// Why the helper stopped reading.
#[derive(Debug, PartialEq, Eq)]
pub enum Ended {
    /// Its standard input closed: the core stopped it, exited, or crashed.
    Closed,
    /// A length over the most a message may be, which only a bug in our one build sends.
    TooLong,
    /// A message that didn't parse, which only a bug sends too.
    DidntParse,
}

/// The next message, or why there's none.
pub fn read(input: &mut impl Read) -> Result<ToHelper, Ended> {
    let mut head = [0; 4];
    input.read_exact(&mut head).map_err(closed)?;
    let length = core_helper::length(head).ok_or(Ended::TooLong)?;
    let mut bytes = vec![0; length];
    input.read_exact(&mut bytes).map_err(closed)?;
    core_helper::decode(&bytes).map_err(|_| Ended::DidntParse)
}

/// Any read error means the core's end of the pipe is gone, an EOF the commonest.
fn closed(_: std::io::Error) -> Ended {
    Ended::Closed
}

/// Where every thread sends its messages for the core.
#[derive(Clone)]
pub struct Out(mpsc::Sender<FromHelper>);

impl Out {
    /// Starts the thread that writes each message, so a thread that sends never waits on
    /// the pipe. A write that fails means the core is gone, so the helper exits.
    pub fn start(mut output: impl Write + Send + 'static) -> Out {
        let (sender, messages) = mpsc::channel::<FromHelper>();
        std::thread::Builder::new()
            .name("writer".into())
            .spawn(move || {
                for message in messages {
                    let Ok(bytes) = core_helper::frame(&message) else {
                        continue;
                    };
                    if output
                        .write_all(&bytes)
                        .and_then(|()| output.flush())
                        .is_err()
                    {
                        std::process::exit(0);
                    }
                }
            })
            .expect("the writer's thread should start");
        Out(sender)
    }

    pub fn send(&self, message: FromHelper) {
        let _ = self.0.send(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_input_a_long_length_and_a_bad_message_each_end_the_reading() {
        let wants = core_helper::frame(&ToHelper::Play { sound: 3 }).unwrap();
        let mut input = &wants[..];
        assert_eq!(read(&mut input), Ok(ToHelper::Play { sound: 3 }));
        assert_eq!(read(&mut input), Err(Ended::Closed));

        let long = ((core_helper::MOST as u32) + 1).to_le_bytes();
        assert_eq!(read(&mut &long[..]), Err(Ended::TooLong));

        let bad = [1, 0, 0, 0, 0xff];
        assert_eq!(read(&mut &bad[..]), Err(Ended::DidntParse));
    }
}
