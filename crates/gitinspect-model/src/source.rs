//! Read-only byte source contracts shared by native and browser adapters.
//!
//! Implementations must enforce bounds *before* allocating or reading. Paths
//! are Git-relative object identifiers, never arbitrary host filesystem paths.
use thiserror::Error;

/// Hard maximum length for an individual range read (8 MiB).
pub const MAX_PACK_RANGE_BYTES: usize = 8 * 1024 * 1024;
/// Maximum compressed size of one loose object (8 MiB).
pub const MAX_LOOSE_OBJECT_BYTES: usize = 8 * 1024 * 1024;
/// Upper limit on imported refs, prior to graph assembly.
pub const MAX_SOURCE_REFS: usize = 100_000;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SourceError {
    #[error("requested byte count exceeds source limit")]
    LimitExceeded,
    #[error("invalid Git object identifier or pack basename")]
    InvalidIdentifier,
    #[error("object or pack not found")]
    NotFound,
    #[error("repository source rejected read: {0}")]
    Rejected(String),
}

/// Metadata for a ref observed in a selected repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRef {
    pub name: String,
    pub target: String,
}

/// Read-only object storage; no general paths, write operations or handles.
pub trait ObjectSource {
    fn read_loose_object(&self, oid_hex: &str) -> Result<Option<Vec<u8>>, SourceError>;
    fn read_pack_range(
        &self,
        pack_hex: &str,
        offset: u64,
        len: usize,
    ) -> Result<Vec<u8>, SourceError>;
    fn read_index(&self, pack_hex: &str) -> Result<Vec<u8>, SourceError>;
}

/// Read-only reference discovery independent from operating-system filesystems.
pub trait RefSource {
    fn list_refs(&self) -> Result<Vec<SourceRef>, SourceError>;
    fn read_packed_refs(&self) -> Result<Option<Vec<u8>>, SourceError>;
}

pub fn validate_oid(oid: &str) -> Result<(), SourceError> {
    if (oid.len() == 40 || oid.len() == 64) && oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(SourceError::InvalidIdentifier)
    }
}

pub fn validate_pack_id(pack: &str) -> Result<(), SourceError> {
    // A pack basename is its raw digest, not a caller-supplied path.
    validate_oid(pack)
}

pub fn validate_range(offset: u64, len: usize) -> Result<(), SourceError> {
    if len > MAX_PACK_RANGE_BYTES || offset.checked_add(len as u64).is_none() {
        Err(SourceError::LimitExceeded)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_and_oversized_ranges() {
        assert_eq!(
            validate_oid("../objects"),
            Err(SourceError::InvalidIdentifier)
        );
        assert_eq!(
            validate_pack_id("pack-../foo"),
            Err(SourceError::InvalidIdentifier)
        );
        assert_eq!(validate_range(u64::MAX, 2), Err(SourceError::LimitExceeded));
        assert_eq!(
            validate_range(0, MAX_PACK_RANGE_BYTES + 1),
            Err(SourceError::LimitExceeded)
        );
    }
}
