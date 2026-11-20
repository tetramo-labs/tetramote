//! Tetramote's transport: the Mac host and the phone each hold one handle and
//! drain its events with `tetra_next_event` from a thread of their own.

pub mod client;
pub mod host;
pub mod input;
pub mod net;
pub mod protocol;

mod ffi;

#[cfg(target_os = "android")]
mod android;

pub use client::{Client, ConnectRequest};
pub use host::{Host, HostConfig};
pub use net::{EndpointConfig, Events};
