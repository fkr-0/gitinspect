//! Read-only Git repository authority for gitinspect.
//!
//! The public API deliberately exposes only owned, serde-friendly records.
//! `gix` implementation types stay behind [`RepositoryService`] and
//! [`RepositoryHandle`]. Signature verification is intentionally not performed
//! in this phase: signed commits are reported as `unknown`, unsigned commits as
//! `unsigned`.

mod diff;
mod model;
mod repository;
mod watch;

pub use model::*;
pub use repository::{Error, RepositoryHandle, RepositoryService};
pub use watch::{ChangeReason, RawWatchEvent, RepositoryChange, WatchCoalescer, WatchOptions};
