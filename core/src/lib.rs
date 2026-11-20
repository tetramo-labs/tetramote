//! Tetramote's transport: the Mac host and the phone each hold one handle and
//! drain its events with `tetra_next_event` from a thread of their own.

#[cfg(feature = "native")]
pub mod client;
#[cfg(feature = "native")]
pub mod host;
pub mod input;
pub mod link;
#[cfg(feature = "native")]
pub mod net;
pub mod protocol;

#[cfg(feature = "native")]
mod ffi;

#[cfg(all(feature = "native", target_os = "android"))]
mod android;

#[cfg(feature = "native")]
pub use client::{Client, ConnectRequest};
#[cfg(feature = "native")]
pub use host::{Host, HostConfig};
#[cfg(feature = "native")]
pub use net::{EndpointConfig, Events};
