//! The core's edges: the threads that wait, each pushing what it waited for into the queue
//! as an input. When you add an edge, such as the WebSocket server, add its module here.

pub mod jobs;
// A bench build puts the stand-in sim where the sim edge goes, and starts no sim thread.
#[cfg_attr(feature = "stand-in", allow(dead_code))]
pub mod sim;
pub mod timer;
