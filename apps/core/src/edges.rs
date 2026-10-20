//! The core's edges: the threads that wait, each pushing what it waited for into the queue
//! as an input. When you add an edge, such as the sim thread or the WebSocket server, add
//! its module here.

pub mod jobs;
pub mod timer;
