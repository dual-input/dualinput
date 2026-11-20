//! The helper as the core runs it, over its real pipe, with no device: its hello, its exit
//! when its standard input closes, and its exit on what only a bug sends
//! (record/areas/core/04-core-helper.md, "The pipe" and "Cases for the bench").

use std::io::{Read, Write};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use messages::core_helper::{self, FromHelper, ToHelper, Wants};

fn start() -> Child {
    Command::new(env!("CARGO_BIN_EXE_dualinput-core-helper"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("the helper should start")
}

fn read(stdout: &mut ChildStdout) -> FromHelper {
    let mut head = [0; 4];
    stdout
        .read_exact(&mut head)
        .expect("the helper should send a message");
    let mut bytes = vec![0; core_helper::length(head).expect("a length under the most")];
    stdout
        .read_exact(&mut bytes)
        .expect("the helper should send the whole message");
    core_helper::decode(&bytes).expect("the helper's message should parse")
}

/// Waits up to `within` for the helper to exit, and returns its code.
fn exits(child: &mut Child, within: Duration) -> Option<i32> {
    let until = Instant::now() + within;
    while Instant::now() < until {
        if let Some(status) = child.try_wait().expect("the helper's status should read") {
            return status.code();
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    panic!("the helper didn't exit within {within:?}");
}

/// The helper is a program with no console, as our probe p08's was, and p08 piped only its
/// standard output, so this also checks that such a program reads a piped standard input
/// (record/areas/core/04-core-helper.md, "The helper's life").
#[test]
fn it_says_hello_first_and_exits_within_1s_of_its_standard_input_closing() {
    let mut child = start();
    let mut stdout = child.stdout.take().unwrap();
    assert_eq!(
        read(&mut stdout),
        FromHelper::Hello {
            version: messages::VERSION.into(),
            hash: messages::HASH.into(),
        }
    );
    let mut stdin = child.stdin.take().unwrap();
    let wants = core_helper::frame(&ToHelper::Wants(Wants::default())).unwrap();
    stdin.write_all(&wants).unwrap();
    std::thread::sleep(Duration::from_millis(200));
    assert!(
        child.try_wait().unwrap().is_none(),
        "the helper should run while its input is open"
    );
    let closed = Instant::now();
    drop(stdin);
    assert_eq!(exits(&mut child, Duration::from_secs(1)), Some(0));
    println!(
        "budget: the helper exited {}ms after its standard input closed, against 1,000ms",
        closed.elapsed().as_millis()
    );
}

#[test]
fn a_length_over_1_mib_or_a_message_that_doesnt_parse_ends_it_with_a_code_other_than_0() {
    for (bytes, code) in [
        ((core_helper::MOST as u32 + 1).to_le_bytes().to_vec(), 2),
        (vec![1, 0, 0, 0, 0xff], 3),
    ] {
        let mut child = start();
        let mut stdout = child.stdout.take().unwrap();
        read(&mut stdout);
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(&bytes).unwrap();
        assert_eq!(exits(&mut child, Duration::from_secs(2)), Some(code));
    }
}
