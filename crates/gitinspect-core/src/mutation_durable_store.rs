//! Crash-aware durable storage qualification for mutation authorization state.
//!
//! This module persists only [`MutationAuthorizationLedgerSnapshot`] records. It
//! does not know about repository handles, Git refs, Tauri, renderer state, or
//! any original-repository apply operation. Phase 30 exercises it exclusively
//! below repository-local disposable fixture roots.
//!
//! Durability protocol (on the qualified Unix fixture platform):
//!
//! 1. validate record/count/string/serialized-size bounds;
//! 2. write a checksummed, versioned envelope to a same-directory scratch file;
//! 3. flush and `fsync` that scratch file;
//! 4. atomically rename the scratch file over the committed ledger;
//! 5. `fsync` the containing directory;
//! 6. reopen and verify version, bounds, checksum, generation and exact payload.
//!
//! A persist call becomes unusable after *any* error or injected fault. The
//! caller must reopen the store and recover the ledger before proceeding; it
//! must never automatically retry an uncertain mutation attempt.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{MutationAuthorizationLedger, MutationAuthorizationLedgerSnapshot};

const STORE_SCHEMA_VERSION: u8 = 1;
const MAX_AUTHORIZATIONS: usize = 1024;
const MAX_ATTEMPTS: usize = 1024;
const MAX_EFFECT_STEPS_PER_ATTEMPT: usize = 64;
const MAX_IDENTIFIER_BYTES: usize = 512;
const MAX_REASON_BYTES: usize = 8192;
const MAX_EFFECT_STEP_BYTES: usize = 2048;
const MAX_SERIALIZED_LEDGER_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SERIALIZED_ENVELOPE_BYTES: u64 = MAX_SERIALIZED_LEDGER_BYTES + 64 * 1024;
const PRIMARY_FILE: &str = "mutation-authorization-ledger.json";
const SCRATCH_FILE: &str = ".mutation-authorization-ledger.next";
const LOCK_FILE: &str = ".mutation-authorization-ledger.lock";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationLedgerStoreFaultPoint {
    AfterWrite,
    AfterFlush,
    AfterFileSync,
    AfterRename,
    AfterDirectorySync,
    AfterReopen,
}

impl MutationLedgerStoreFaultPoint {
    fn label(self) -> &'static str {
        match self {
            Self::AfterWrite => "after-write",
            Self::AfterFlush => "after-flush",
            Self::AfterFileSync => "after-file-sync",
            Self::AfterRename => "after-rename",
            Self::AfterDirectorySync => "after-directory-sync",
            Self::AfterReopen => "after-reopen",
        }
    }
}

#[derive(Debug, Error)]
pub enum MutationLedgerStoreError {
    #[error("mutation ledger store I/O failed at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("mutation ledger store root is not a regular directory: {0}")]
    InvalidRoot(PathBuf),
    #[error("mutation ledger store metadata path must not be a symlink: {0}")]
    SymlinkMetadata(PathBuf),
    #[error("mutation ledger store is already exclusively owned: {0}")]
    StoreBusy(String),
    #[error(
        "mutation ledger store is unusable after an uncertain persistence outcome; reopen is required"
    )]
    ReopenRequired,
    #[error("mutation ledger snapshot violates durable bounds: {0}")]
    Bounds(String),
    #[error("mutation ledger durable envelope is corrupt: {0}")]
    Corrupt(String),
    #[error("unsupported mutation ledger store schema version {0}")]
    UnsupportedStoreVersion(u8),
    #[error("mutation ledger durable generation overflow")]
    GenerationOverflow,
    #[error("deterministic mutation ledger persistence fault injected {0}")]
    InjectedFault(&'static str),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MutationLedgerEnvelope {
    store_schema_version: u8,
    generation: u64,
    payload_sha256: String,
    ledger: MutationAuthorizationLedgerSnapshot,
}

/// Backend-owned atomic ledger file store. Holding this value also holds an OS
/// exclusive advisory lock on the fixed store lock file, preventing two
/// cooperating backend processes from concurrently replacing one ledger.
///
/// The constructor takes a storage root, not a repository handle. Phase 30 does
/// not connect this type to selected/original repository state or IPC.
#[derive(Debug)]
pub struct MutationAuthorizationAtomicStore {
    root: PathBuf,
    primary: PathBuf,
    scratch: PathBuf,
    _lock: File,
    generation: u64,
    usable: bool,
}

impl MutationAuthorizationAtomicStore {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, MutationLedgerStoreError> {
        let root = root.as_ref();
        fs::create_dir_all(root).map_err(|source| io_error(root, source))?;
        let supplied_metadata =
            fs::symlink_metadata(root).map_err(|source| io_error(root, source))?;
        if supplied_metadata.file_type().is_symlink() || !supplied_metadata.is_dir() {
            return Err(MutationLedgerStoreError::InvalidRoot(root.to_path_buf()));
        }
        let root = fs::canonicalize(root).map_err(|source| io_error(root, source))?;
        let metadata = fs::symlink_metadata(&root).map_err(|source| io_error(&root, source))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(MutationLedgerStoreError::InvalidRoot(root));
        }

        let primary = root.join(PRIMARY_FILE);
        let scratch = root.join(SCRATCH_FILE);
        let lock_path = root.join(LOCK_FILE);
        reject_existing_symlink(&primary)?;
        reject_existing_symlink(&scratch)?;
        reject_existing_symlink(&lock_path)?;

        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(|source| io_error(&lock_path, source))?;
        lock.try_lock()
            .map_err(|error| MutationLedgerStoreError::StoreBusy(error.to_string()))?;

        let generation = match read_envelope_if_present(&primary)? {
            Some(envelope) => envelope.generation,
            None => 0,
        };
        Ok(Self {
            root,
            primary,
            scratch,
            _lock: lock,
            generation,
            usable: true,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn load_snapshot(
        &self,
    ) -> Result<Option<MutationAuthorizationLedgerSnapshot>, MutationLedgerStoreError> {
        self.ensure_usable()?;
        read_envelope_if_present(&self.primary).map(|value| value.map(|envelope| envelope.ledger))
    }

    pub fn persist(
        &mut self,
        snapshot: &MutationAuthorizationLedgerSnapshot,
    ) -> Result<u64, MutationLedgerStoreError> {
        self.persist_with_fault(snapshot, None)
    }

    /// Qualification-only deterministic fault seam. No product/Tauri path calls
    /// this method. Every injected fault makes this store instance unusable so
    /// tests must exercise the same reopen/recovery path required after a real
    /// uncertain persistence failure.
    pub fn persist_with_fault(
        &mut self,
        snapshot: &MutationAuthorizationLedgerSnapshot,
        fault: Option<MutationLedgerStoreFaultPoint>,
    ) -> Result<u64, MutationLedgerStoreError> {
        self.ensure_usable()?;
        let result = self.persist_inner(snapshot, fault);
        if result.is_err() {
            self.usable = false;
        }
        result
    }

    fn persist_inner(
        &mut self,
        snapshot: &MutationAuthorizationLedgerSnapshot,
        fault: Option<MutationLedgerStoreFaultPoint>,
    ) -> Result<u64, MutationLedgerStoreError> {
        validate_snapshot_bounds(snapshot)?;
        let payload = serde_json::to_vec(snapshot)
            .map_err(|error| MutationLedgerStoreError::Corrupt(error.to_string()))?;
        if payload.len() as u64 > MAX_SERIALIZED_LEDGER_BYTES {
            return Err(MutationLedgerStoreError::Bounds(format!(
                "serialized ledger is {} bytes, maximum is {MAX_SERIALIZED_LEDGER_BYTES}",
                payload.len()
            )));
        }
        let generation = self
            .generation
            .checked_add(1)
            .ok_or(MutationLedgerStoreError::GenerationOverflow)?;
        let envelope = MutationLedgerEnvelope {
            store_schema_version: STORE_SCHEMA_VERSION,
            generation,
            payload_sha256: payload_digest(&payload),
            ledger: snapshot.clone(),
        };
        let encoded = serde_json::to_vec(&envelope)
            .map_err(|error| MutationLedgerStoreError::Corrupt(error.to_string()))?;
        if encoded.len() as u64 > MAX_SERIALIZED_ENVELOPE_BYTES {
            return Err(MutationLedgerStoreError::Bounds(format!(
                "serialized envelope is {} bytes, maximum is {MAX_SERIALIZED_ENVELOPE_BYTES}",
                encoded.len()
            )));
        }

        reject_existing_symlink(&self.scratch)?;
        let mut scratch = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&self.scratch)
            .map_err(|source| io_error(&self.scratch, source))?;
        scratch
            .write_all(&encoded)
            .map_err(|source| io_error(&self.scratch, source))?;
        inject(fault, MutationLedgerStoreFaultPoint::AfterWrite)?;
        scratch
            .flush()
            .map_err(|source| io_error(&self.scratch, source))?;
        inject(fault, MutationLedgerStoreFaultPoint::AfterFlush)?;
        scratch
            .sync_all()
            .map_err(|source| io_error(&self.scratch, source))?;
        inject(fault, MutationLedgerStoreFaultPoint::AfterFileSync)?;
        drop(scratch);

        reject_existing_symlink(&self.primary)?;
        fs::rename(&self.scratch, &self.primary)
            .map_err(|source| io_error(&self.primary, source))?;
        inject(fault, MutationLedgerStoreFaultPoint::AfterRename)?;

        sync_directory(&self.root)?;
        inject(fault, MutationLedgerStoreFaultPoint::AfterDirectorySync)?;

        let reopened =
            File::open(&self.primary).map_err(|source| io_error(&self.primary, source))?;
        inject(fault, MutationLedgerStoreFaultPoint::AfterReopen)?;
        let verified = read_envelope_from_file(&self.primary, reopened)?;
        if verified.generation != generation {
            return Err(MutationLedgerStoreError::Corrupt(format!(
                "reopened generation {} does not match committed generation {generation}",
                verified.generation
            )));
        }
        if verified.ledger != *snapshot {
            return Err(MutationLedgerStoreError::Corrupt(
                "reopened ledger payload differs from committed snapshot".to_owned(),
            ));
        }
        self.generation = generation;
        Ok(generation)
    }

    fn ensure_usable(&self) -> Result<(), MutationLedgerStoreError> {
        if self.usable {
            Ok(())
        } else {
            Err(MutationLedgerStoreError::ReopenRequired)
        }
    }
}

fn inject(
    requested: Option<MutationLedgerStoreFaultPoint>,
    current: MutationLedgerStoreFaultPoint,
) -> Result<(), MutationLedgerStoreError> {
    if requested == Some(current) {
        Err(MutationLedgerStoreError::InjectedFault(current.label()))
    } else {
        Ok(())
    }
}

fn sync_directory(path: &Path) -> Result<(), MutationLedgerStoreError> {
    let directory = File::open(path).map_err(|source| io_error(path, source))?;
    directory
        .sync_all()
        .map_err(|source| io_error(path, source))
}

fn read_envelope_if_present(
    path: &Path,
) -> Result<Option<MutationLedgerEnvelope>, MutationLedgerStoreError> {
    reject_existing_symlink(path)?;
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(io_error(path, source)),
    };
    read_envelope_from_file(path, file).map(Some)
}

fn read_envelope_from_file(
    path: &Path,
    mut file: File,
) -> Result<MutationLedgerEnvelope, MutationLedgerStoreError> {
    let metadata = file.metadata().map_err(|source| io_error(path, source))?;
    if !metadata.is_file() {
        return Err(MutationLedgerStoreError::Corrupt(format!(
            "ledger path is not a regular file: {}",
            path.display()
        )));
    }
    if metadata.len() > MAX_SERIALIZED_ENVELOPE_BYTES {
        return Err(MutationLedgerStoreError::Bounds(format!(
            "durable envelope is {} bytes, maximum is {MAX_SERIALIZED_ENVELOPE_BYTES}",
            metadata.len()
        )));
    }
    let mut encoded = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut encoded)
        .map_err(|source| io_error(path, source))?;
    let envelope: MutationLedgerEnvelope = serde_json::from_slice(&encoded)
        .map_err(|error| MutationLedgerStoreError::Corrupt(error.to_string()))?;
    if envelope.store_schema_version != STORE_SCHEMA_VERSION {
        return Err(MutationLedgerStoreError::UnsupportedStoreVersion(
            envelope.store_schema_version,
        ));
    }
    validate_snapshot_bounds(&envelope.ledger)?;
    let payload = serde_json::to_vec(&envelope.ledger)
        .map_err(|error| MutationLedgerStoreError::Corrupt(error.to_string()))?;
    if payload.len() as u64 > MAX_SERIALIZED_LEDGER_BYTES {
        return Err(MutationLedgerStoreError::Bounds(format!(
            "serialized ledger is {} bytes, maximum is {MAX_SERIALIZED_LEDGER_BYTES}",
            payload.len()
        )));
    }
    let actual = payload_digest(&payload);
    if envelope.payload_sha256 != actual {
        return Err(MutationLedgerStoreError::Corrupt(
            "ledger payload checksum mismatch".to_owned(),
        ));
    }
    Ok(envelope)
}

fn validate_snapshot_bounds(
    snapshot: &MutationAuthorizationLedgerSnapshot,
) -> Result<(), MutationLedgerStoreError> {
    if snapshot.authorizations.len() > MAX_AUTHORIZATIONS {
        return Err(MutationLedgerStoreError::Bounds(format!(
            "authorization record count {} exceeds {MAX_AUTHORIZATIONS}",
            snapshot.authorizations.len()
        )));
    }
    if snapshot.attempts.len() > MAX_ATTEMPTS {
        return Err(MutationLedgerStoreError::Bounds(format!(
            "attempt record count {} exceeds {MAX_ATTEMPTS}",
            snapshot.attempts.len()
        )));
    }

    for authorization in &snapshot.authorizations {
        bounded_identifier("authorization id", &authorization.authorization_id)?;
        bounded_identifier("secret digest", &authorization.secret_digest)?;
        validate_binding(&authorization.binding)?;
    }
    for attempt in &snapshot.attempts {
        bounded_identifier("attempt id", &attempt.attempt_id)?;
        bounded_identifier("attempt authorization id", &attempt.authorization_id)?;
        validate_binding(&attempt.binding)?;
        if attempt.completed_effect_steps.len() > MAX_EFFECT_STEPS_PER_ATTEMPT {
            return Err(MutationLedgerStoreError::Bounds(format!(
                "attempt {} has {} effect steps, maximum is {MAX_EFFECT_STEPS_PER_ATTEMPT}",
                attempt.attempt_id,
                attempt.completed_effect_steps.len()
            )));
        }
        for step in &attempt.completed_effect_steps {
            if step.len() > MAX_EFFECT_STEP_BYTES {
                return Err(MutationLedgerStoreError::Bounds(format!(
                    "effect-step evidence exceeds {MAX_EFFECT_STEP_BYTES} bytes"
                )));
            }
        }
        if attempt
            .failure_reason
            .as_ref()
            .is_some_and(|reason| reason.len() > MAX_REASON_BYTES)
        {
            return Err(MutationLedgerStoreError::Bounds(format!(
                "attempt failure reason exceeds {MAX_REASON_BYTES} bytes"
            )));
        }
    }

    // Reuse the Phase-29 snapshot validator for schema/duplicate-id checks.
    MutationAuthorizationLedger::recover(snapshot.clone())
        .map_err(|error| MutationLedgerStoreError::Corrupt(error.to_string()))?;
    Ok(())
}

fn validate_binding(
    binding: &crate::MutationAuthorizationBinding,
) -> Result<(), MutationLedgerStoreError> {
    for (label, value) in [
        (
            "repository identity digest",
            &binding.repository_identity_digest,
        ),
        ("source state digest", &binding.source_state_digest),
        ("receipt digest", &binding.receipt_digest),
        ("transaction id", &binding.transaction_id),
        ("operation digest", &binding.operation_digest),
        ("preview-result digest", &binding.preview_result_digest),
    ] {
        bounded_identifier(label, value)?;
    }
    Ok(())
}

fn bounded_identifier(label: &str, value: &str) -> Result<(), MutationLedgerStoreError> {
    if value.len() > MAX_IDENTIFIER_BYTES {
        Err(MutationLedgerStoreError::Bounds(format!(
            "{label} is {} bytes, maximum is {MAX_IDENTIFIER_BYTES}",
            value.len()
        )))
    } else {
        Ok(())
    }
}

fn reject_existing_symlink(path: &Path) -> Result<(), MutationLedgerStoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(
            MutationLedgerStoreError::SymlinkMetadata(path.to_path_buf()),
        ),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_error(path, source)),
    }
}

fn payload_digest(payload: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-ledger-store-payload-v1\0");
    hasher.update(payload);
    format!("sha256:{:x}", hasher.finalize())
}

fn io_error(path: &Path, source: io::Error) -> MutationLedgerStoreError {
    MutationLedgerStoreError::Io {
        path: path.to_path_buf(),
        source,
    }
}
