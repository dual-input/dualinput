//! p11's Windows program: what the core and its stand-in sim would link. It
//! runs the module's host and Follow natively, fed through the same slot bytes
//! the module reads, and writes one JSON message from the shared crate, so one
//! build of the workspace shows the module's code running outside the sim.

use messages::{FollowSlot, Hello, PoseSample, SlotHeader};
use module_host::{Frame, routines};

fn bytes(slot: &FollowSlot) -> Vec<u8> {
    let p = (slot as *const FollowSlot).cast::<u8>();
    unsafe { std::slice::from_raw_parts(p, size_of::<FollowSlot>()) }.to_vec()
}

fn main() {
    let mut host = routines![follow::Follow];
    let mut frozen = false;
    for (feed, t_us) in [(1u32, 0u64), (2, 200_000), (3, 400_000)] {
        let slot = FollowSlot {
            header: SlotHeader { feeds: feed, ended: 0 },
            sample: PoseSample { t_us, lat_deg: 47.0 + f64::from(feed) / 1000.0, ..Default::default() },
        };
        host.write(messages::FOLLOW, t_us, &bytes(&slot));
    }
    for now_us in [100_000u64, 450_000, 900_000, 1_500_000] {
        let a = host.frame(&Frame { now_us }, frozen);
        if let Some(on) = a.freeze {
            frozen = on;
        }
        println!("frame at {now_us}µs: freeze {:?}, writes {:?}", a.freeze, a.writes);
    }
    let hello = Hello::Pilot { id: uuid::Uuid::new_v4(), version: env!("CARGO_PKG_VERSION").into() };
    println!("{}", serde_json::to_string(&hello).unwrap());
}
