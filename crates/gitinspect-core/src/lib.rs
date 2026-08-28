//! Read-only Git repository authority for gitinspect.
//!
//! The public API deliberately exposes only owned, serde-friendly records.
//! `gix` implementation types stay behind [`RepositoryService`] and
//! [`RepositoryHandle`]. Signature verification is intentionally not performed
//! in this phase: signed commits are reported as `unknown`, unsigned commits as
//! `unsigned`.

mod compact;
mod delta;
mod diff;
mod model;
mod mutation_authorization;
mod mutation_durable_store;
mod mutation_preflight;
mod mutation_preview;
mod repository;
mod watch;

pub use compact::{
    CompactGitCommitBatch, CompactGitCommitRecord, CompactGitRepositorySnapshot,
    CompactSnapshotError,
};
pub use delta::{
    DeltaApplyError, DeltaValidationError, MAX_APPEND_DELTA_COMMITS, RepositoryAppendAwareRefresh,
    RepositoryAppendDelta, RepositoryAppendMetadata, RepositoryRefreshCursor,
};
pub use model::*;
pub use mutation_authorization::*;
pub use mutation_durable_store::*;
pub use mutation_preflight::*;
pub use mutation_preview::*;
pub use repository::{Error, RepositoryHandle, RepositoryService};
pub use watch::{
    ChangeReason, NativeRepositoryWatcher, RawWatchEvent, RepositoryChange, WatchCoalescer,
    WatchOptions,
};
