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
/// Maximum bytes accepted in a single browser import batch (128 MiB).
pub const MAX_IMPORT_BYTES: usize = 128 * 1024 * 1024;
/// Maximum number of object records accepted in a browser import batch.
pub const MAX_IMPORT_OBJECTS: usize = 100_000;

/// Validate aggregate byte/object counts before browser adapters allocate memory.
pub fn validate_import_limits(bytes: usize, objects: usize) -> Result<(), SourceError> {
    if bytes > MAX_IMPORT_BYTES || objects > MAX_IMPORT_OBJECTS {
        Err(SourceError::LimitExceeded)
    } else {
        Ok(())
    }
}

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

/// A bounded, read-only source of caller-supplied inflated object bodies.
/// Object identity and type must be verified by the caller before import.
#[derive(Debug, Clone, Default)]
pub struct InMemorySource {
    objects: std::collections::BTreeMap<String, Vec<u8>>,
    refs: Vec<SourceRef>,
    bytes: usize,
}

impl InMemorySource {
    pub fn new(
        objects: impl IntoIterator<Item = (String, Vec<u8>)>,
        refs: Vec<SourceRef>,
    ) -> Result<Self, SourceError> {
        if refs.len() > MAX_SOURCE_REFS {
            return Err(SourceError::LimitExceeded);
        }
        let mut result = Self {
            refs,
            ..Self::default()
        };
        for (oid, body) in objects {
            validate_oid(&oid)?;
            if oid.bytes().any(|b| b.is_ascii_uppercase()) {
                return Err(SourceError::InvalidIdentifier);
            }
            if body.len() > MAX_LOOSE_OBJECT_BYTES || result.objects.contains_key(&oid) {
                return Err(SourceError::LimitExceeded);
            }
            result.bytes = result
                .bytes
                .checked_add(body.len())
                .ok_or(SourceError::LimitExceeded)?;
            validate_import_limits(result.bytes, result.objects.len() + 1)?;
            result.objects.insert(oid, body);
        }
        for reference in &result.refs {
            validate_oid(&reference.target)?;
            if !reference.name.starts_with("refs/")
                || reference.name.contains("..")
                || reference.name.contains('\0')
                || reference.name.contains('\n')
            {
                return Err(SourceError::InvalidIdentifier);
            }
        }
        Ok(result)
    }

    pub fn object_count(&self) -> usize {
        self.objects.len()
    }
    pub fn total_bytes(&self) -> usize {
        self.bytes
    }
}

impl ObjectSource for InMemorySource {
    fn read_loose_object(&self, oid_hex: &str) -> Result<Option<Vec<u8>>, SourceError> {
        validate_oid(oid_hex)?;
        Ok(self.objects.get(oid_hex).cloned())
    }
    fn read_pack_range(
        &self,
        pack_hex: &str,
        offset: u64,
        len: usize,
    ) -> Result<Vec<u8>, SourceError> {
        validate_pack_id(pack_hex)?;
        validate_range(offset, len)?;
        Err(SourceError::NotFound)
    }
    fn read_index(&self, pack_hex: &str) -> Result<Vec<u8>, SourceError> {
        validate_pack_id(pack_hex)?;
        Err(SourceError::NotFound)
    }
}

impl RefSource for InMemorySource {
    fn list_refs(&self) -> Result<Vec<SourceRef>, SourceError> {
        Ok(self.refs.clone())
    }
    fn read_packed_refs(&self) -> Result<Option<Vec<u8>>, SourceError> {
        Ok(None)
    }
}

#[cfg(test)]
mod memory_tests {
    use super::*;
    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn reads_inflated_objects_and_refs() {
        let refs = vec![SourceRef {
            name: "refs/heads/main".into(),
            target: OID.into(),
        }];
        let source = InMemorySource::new([(OID.into(), b"body".to_vec())], refs.clone()).unwrap();
        assert_eq!(source.object_count(), 1);
        assert_eq!(source.total_bytes(), 4);
        assert_eq!(
            source.read_loose_object(OID).unwrap(),
            Some(b"body".to_vec())
        );
        assert_eq!(source.list_refs().unwrap(), refs);
        assert_eq!(
            source.read_pack_range(OID, 0, 5),
            Err(SourceError::NotFound)
        );
    }

    #[test]
    fn rejects_duplicate_oversized_and_untrusted_refs() {
        assert!(InMemorySource::new([(OID.into(), vec![]), (OID.into(), vec![])], vec![]).is_err());
        assert_eq!(
            InMemorySource::new([(OID.into(), vec![0; MAX_LOOSE_OBJECT_BYTES + 1])], vec![])
                .unwrap_err(),
            SourceError::LimitExceeded
        );
        assert!(
            InMemorySource::new(
                [],
                vec![SourceRef {
                    name: "refs/../escape".into(),
                    target: OID.into()
                }]
            )
            .is_err()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imported_repository_limits_are_closed_at_boundary() {
        assert!(validate_import_limits(MAX_IMPORT_BYTES, MAX_IMPORT_OBJECTS).is_ok());
        assert_eq!(
            validate_import_limits(MAX_IMPORT_BYTES + 1, 0),
            Err(SourceError::LimitExceeded)
        );
        assert_eq!(
            validate_import_limits(0, MAX_IMPORT_OBJECTS + 1),
            Err(SourceError::LimitExceeded)
        );
    }

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
