//! Read-only safety-case primitives for any future original-repository mutation.
//!
//! This module deliberately does **not** expose an apply operation or an
//! authorization capability. It captures repository state that the structural
//! graph revision intentionally omits, binds that state to an already-confirmed
//! disposable-copy preview, and can later explain why the source is no longer
//! fresh. A fresh assessment is evidence only; it never authorizes mutation.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use gix::bstr::ByteSlice;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::mutation_preview::{operation_digest, token_for};
use crate::{
    MutationPreviewConfirmation, MutationPreviewResult, OpenOptions, RepositoryHandle,
    RepositoryService,
};

const PREFLIGHT_SCHEMA_VERSION: u8 = 1;
const MAX_REPORTED_DIRTY_PATHS: usize = 32;

#[derive(Debug, Error)]
pub enum MutationPreflightError {
    #[error("original-apply preflight inspection failed: {0}")]
    Inspection(String),
    #[error("original-apply preflight filesystem operation failed at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("repository identity changed during preflight capture")]
    RepositoryIdentityChanged,
    #[error("repository changed while preflight state was being captured")]
    ConcurrentChange,
    #[error("confirmed preview is not eligible for original-apply safety evaluation: {0}")]
    PreviewBinding(String),
    #[error("source repository is not eligible for original-apply safety evaluation: {0}")]
    SourceState(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreflightPathIdentity {
    pub canonical_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inode: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_uid: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreflightRepositoryIdentity {
    pub repository: MutationPreflightPathIdentity,
    pub git_dir: MutationPreflightPathIdentity,
    pub common_dir: MutationPreflightPathIdentity,
    pub bare: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreflightRefState {
    pub name: String,
    pub target_oid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbolic_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
}

/// Stronger source-state evidence than [`crate::GitRepositorySnapshot::revision`].
///
/// `state_digest` binds the canonical repository topology, HEAD and exact ref
/// targets, raw index bytes, index/worktree cleanliness, local config bytes,
/// and common-hook bytes. Dirty path names are bounded for display only; any
/// dirty state is fail-closed regardless of whether all paths fit the display
/// bound.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreflightSnapshot {
    pub schema_version: u8,
    pub repository_identity: MutationPreflightRepositoryIdentity,
    pub structural_revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_ref: Option<String>,
    pub refs: Vec<MutationPreflightRefState>,
    pub index_fingerprint: String,
    pub index_clean: bool,
    pub worktree_clean: bool,
    pub dirty_paths: Vec<String>,
    pub dirty_paths_truncated: bool,
    pub config_fingerprint: String,
    pub config_has_includes: bool,
    pub hooks_fingerprint: String,
    pub active_hooks: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured_hooks_path: Option<String>,
    pub state_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreviewSafetyBinding {
    pub sandbox_id: String,
    pub transaction_id: String,
    pub base_revision: String,
    pub operation_digest: String,
    pub canonical_operations: Vec<String>,
    pub preview_token: String,
    pub confirmation_token: String,
    pub preview_result_digest: String,
}

/// Durable evidence shape for a future apply design review.
///
/// This is intentionally named a receipt rather than a capability. Possession
/// of it grants no authority and no API in this crate consumes it to mutate a
/// repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreflightReceipt {
    pub source: MutationPreflightSnapshot,
    pub preview: MutationPreviewSafetyBinding,
    pub receipt_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationPreflightFailureCode {
    RepositoryIdentityChanged,
    StructuralRevisionChanged,
    HeadChanged,
    RefTargetsChanged,
    IndexStateChanged,
    WorktreeStateChanged,
    ConfigChanged,
    HooksChanged,
    PreviewBindingChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreflightFailure {
    pub code: MutationPreflightFailureCode,
    pub message: String,
}

/// Safety boundaries which Phase 28 deliberately leaves unresolved rather than
/// silently treating a fresh repository as permission to mutate it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationApplyUnresolvedBoundary {
    BackendOwnedSingleUseAuthorization,
    DurableIdempotencyReplayLedger,
    RaceFreeFinalPreflightAndEffect,
    CrashSafeAtomicityOrRecovery,
    ConfigAndExternalExecutionIsolation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreflightAssessment {
    pub fresh: bool,
    pub failures: Vec<MutationPreflightFailure>,
    pub unresolved_boundaries: Vec<MutationApplyUnresolvedBoundary>,
    /// Always false in this design/qualification-only phase.
    pub original_apply_authorized: bool,
}

impl MutationPreflightSnapshot {
    /// Capture stronger mutation freshness state without writing the repository.
    ///
    /// The gix status outcome is intentionally never persisted, so any index
    /// stat-cache changes it computes remain in memory only.
    pub fn capture(handle: &RepositoryHandle) -> Result<Self, MutationPreflightError> {
        // A single read could combine refs from one instant with index/config/hook
        // bytes from another. Require two identical read-only captures so a
        // concurrent source change fails closed instead of producing a torn
        // receipt. This still does not close the later check-to-effect race;
        // that remains an explicit unresolved apply boundary.
        let first = Self::capture_once(handle)?;
        let second = Self::capture_once(handle)?;
        if first != second {
            return Err(MutationPreflightError::ConcurrentChange);
        }
        Ok(second)
    }

    fn capture_once(handle: &RepositoryHandle) -> Result<Self, MutationPreflightError> {
        let options = OpenOptions {
            max_commits: 0,
            include_commit_files: false,
            ..OpenOptions::default()
        };
        let (rediscovered, snapshot) =
            RepositoryService::open(handle.repository_path(), options)
                .map_err(|error| MutationPreflightError::Inspection(error.to_string()))?;
        if &rediscovered != handle {
            return Err(MutationPreflightError::RepositoryIdentityChanged);
        }

        let repo = gix::open(rediscovered.git_dir())
            .map_err(|error| MutationPreflightError::Inspection(error.to_string()))?;
        let bare = repo.workdir().is_none();
        let repository_identity = MutationPreflightRepositoryIdentity {
            repository: path_identity(rediscovered.repository_path())?,
            git_dir: path_identity(rediscovered.git_dir())?,
            common_dir: path_identity(rediscovered.common_dir())?,
            bare,
        };

        let mut refs = snapshot
            .refs
            .iter()
            .map(|reference| MutationPreflightRefState {
                name: reference.name.clone(),
                target_oid: reference.target_oid.clone(),
                symbolic_target: reference.symbolic_target.clone(),
                upstream: reference.upstream.clone(),
            })
            .collect::<Vec<_>>();
        refs.sort_by(|a, b| a.name.cmp(&b.name));

        let index_fingerprint = critical_file_fingerprint(&rediscovered.git_dir().join("index"))?;
        let (index_clean, worktree_clean, dirty_paths, dirty_paths_truncated) = if bare {
            (true, true, Vec::new(), false)
        } else {
            collect_status(&repo)?
        };

        let config_fingerprint = config_fingerprint(&rediscovered)?;
        let config_snapshot = repo.config_snapshot();
        let config_has_includes = config_snapshot
            .plumbing()
            .sections_by_name("include")
            .is_some()
            || config_snapshot
                .plumbing()
                .sections_by_name("includeIf")
                .is_some();
        let (hooks_fingerprint, active_hooks) = hook_fingerprint(rediscovered.common_dir())?;
        let configured_hooks_path = config_snapshot
            .string("core.hooksPath")
            .map(|value| value.to_str_lossy().into_owned());

        let mut captured = Self {
            schema_version: PREFLIGHT_SCHEMA_VERSION,
            repository_identity,
            structural_revision: snapshot.revision,
            head: snapshot.head,
            head_ref: snapshot.head_ref,
            refs,
            index_fingerprint,
            index_clean,
            worktree_clean,
            dirty_paths,
            dirty_paths_truncated,
            config_fingerprint,
            config_has_includes,
            hooks_fingerprint,
            active_hooks,
            configured_hooks_path,
            state_digest: String::new(),
        };
        captured.state_digest = source_state_digest(&captured);
        Ok(captured)
    }

    pub fn clean_for_safety_evaluation(&self) -> Result<(), MutationPreflightError> {
        let strong_identity_available = [
            &self.repository_identity.repository,
            &self.repository_identity.git_dir,
            &self.repository_identity.common_dir,
        ]
        .iter()
        .all(|identity| {
            identity.device.is_some() && identity.inode.is_some() && identity.owner_uid.is_some()
        });
        if !strong_identity_available {
            return Err(MutationPreflightError::SourceState(
                "strong filesystem device/inode/owner identity is unavailable on this platform"
                    .to_owned(),
            ));
        }
        if self.repository_identity.bare {
            return Err(MutationPreflightError::SourceState(
                "bare repositories are outside the qualified original-apply model".to_owned(),
            ));
        }
        if !self.index_clean || !self.worktree_clean {
            let paths = if self.dirty_paths.is_empty() {
                "no bounded path detail available".to_owned()
            } else {
                self.dirty_paths.join(", ")
            };
            return Err(MutationPreflightError::SourceState(format!(
                "index/worktree must be clean before confirmation; changed paths: {paths}"
            )));
        }
        if self.config_has_includes {
            return Err(MutationPreflightError::SourceState(
                "repository config include/includeIf is fail-closed because included bytes are outside the local config fingerprint"
                    .to_owned(),
            ));
        }
        if !self.active_hooks.is_empty() {
            return Err(MutationPreflightError::SourceState(format!(
                "active repository hooks are fail-closed: {}",
                self.active_hooks.join(", ")
            )));
        }
        if let Some(path) = &self.configured_hooks_path {
            return Err(MutationPreflightError::SourceState(format!(
                "core.hooksPath is configured and is fail-closed: {path}"
            )));
        }
        Ok(())
    }
}

impl MutationPreflightReceipt {
    /// Bind a clean source capture to an already-successful, confirmed preview.
    ///
    /// The existing deterministic preview/confirmation hashes are verified as
    /// identity evidence here. They are explicitly *not* treated as a security
    /// capability or authorization grant.
    pub fn bind_confirmed_preview(
        source: MutationPreflightSnapshot,
        preview: &MutationPreviewResult,
        confirmation: &MutationPreviewConfirmation,
    ) -> Result<Self, MutationPreflightError> {
        source.clean_for_safety_evaluation()?;
        if !preview.success || !preview.failures.is_empty() {
            return Err(MutationPreflightError::PreviewBinding(
                "preview must have succeeded without failures".to_owned(),
            ));
        }
        if preview.base_revision != source.structural_revision {
            return Err(MutationPreflightError::PreviewBinding(format!(
                "preview base revision {} does not match source revision {}",
                preview.base_revision, source.structural_revision
            )));
        }
        let expected_operation_digest = operation_digest(
            &preview.transaction_id,
            &preview.base_revision,
            &preview.canonical_operations,
        );
        if preview.operation_digest != expected_operation_digest {
            return Err(MutationPreflightError::PreviewBinding(
                "operation digest does not match canonical ordered operations".to_owned(),
            ));
        }
        let expected_preview_token = token_for(
            "preview",
            &[
                &preview.sandbox_id,
                &preview.transaction_id,
                &preview.base_revision,
                &preview.operation_digest,
            ],
        );
        if preview.preview_token != expected_preview_token {
            return Err(MutationPreflightError::PreviewBinding(
                "preview token does not match sandbox/transaction/base/digest binding".to_owned(),
            ));
        }
        let expected_confirmation = token_for(
            "confirm",
            &[
                &preview.sandbox_id,
                &preview.transaction_id,
                &preview.preview_token,
            ],
        );
        if confirmation.token != expected_confirmation {
            return Err(MutationPreflightError::PreviewBinding(
                "confirmation token does not match the confirmed preview identity".to_owned(),
            ));
        }

        let binding = MutationPreviewSafetyBinding {
            sandbox_id: preview.sandbox_id.clone(),
            transaction_id: preview.transaction_id.clone(),
            base_revision: preview.base_revision.clone(),
            operation_digest: preview.operation_digest.clone(),
            canonical_operations: preview.canonical_operations.clone(),
            preview_token: preview.preview_token.clone(),
            confirmation_token: confirmation.token.clone(),
            preview_result_digest: preview_result_digest(preview),
        };
        let receipt_digest = receipt_digest(&source, &binding);
        Ok(Self {
            source,
            preview: binding,
            receipt_digest,
        })
    }

    /// Revalidate source and preview identity evidence.
    ///
    /// Even a fresh result retains all unresolved safety boundaries and keeps
    /// `original_apply_authorized` false. This prevents callers from turning a
    /// successful read-only preflight into mutation authority by implication.
    pub fn assess(
        &self,
        current: &MutationPreflightSnapshot,
        preview: &MutationPreviewResult,
        confirmation: &MutationPreviewConfirmation,
    ) -> MutationPreflightAssessment {
        let mut failures = compare_source(&self.source, current);
        let current_preview_digest = preview_result_digest(preview);
        if preview.sandbox_id != self.preview.sandbox_id
            || preview.transaction_id != self.preview.transaction_id
            || preview.base_revision != self.preview.base_revision
            || preview.operation_digest != self.preview.operation_digest
            || preview.canonical_operations != self.preview.canonical_operations
            || preview.preview_token != self.preview.preview_token
            || confirmation.token != self.preview.confirmation_token
            || current_preview_digest != self.preview.preview_result_digest
        {
            failures.push(MutationPreflightFailure {
                code: MutationPreflightFailureCode::PreviewBindingChanged,
                message:
                    "preview/sandbox/result/confirmation identity no longer matches the receipt"
                        .to_owned(),
            });
        }
        MutationPreflightAssessment {
            fresh: failures.is_empty(),
            failures,
            unresolved_boundaries: unresolved_boundaries(),
            original_apply_authorized: false,
        }
    }
}

fn compare_source(
    expected: &MutationPreflightSnapshot,
    current: &MutationPreflightSnapshot,
) -> Vec<MutationPreflightFailure> {
    let mut failures = Vec::new();
    if expected.repository_identity != current.repository_identity {
        failures.push(failure(
            MutationPreflightFailureCode::RepositoryIdentityChanged,
            "canonical repository/git/common-dir identity or filesystem ownership changed",
        ));
    }
    if expected.structural_revision != current.structural_revision {
        failures.push(failure(
            MutationPreflightFailureCode::StructuralRevisionChanged,
            "structural repository revision changed after preview/confirmation",
        ));
    }
    if expected.head != current.head || expected.head_ref != current.head_ref {
        failures.push(failure(
            MutationPreflightFailureCode::HeadChanged,
            "resolved HEAD or symbolic HEAD target changed after preview/confirmation",
        ));
    }
    if expected.refs != current.refs {
        failures.push(failure(
            MutationPreflightFailureCode::RefTargetsChanged,
            "one or more exact ref targets/upstreams changed after preview/confirmation",
        ));
    }
    if expected.index_fingerprint != current.index_fingerprint
        || expected.index_clean != current.index_clean
    {
        failures.push(failure(
            MutationPreflightFailureCode::IndexStateChanged,
            "raw index bytes or HEAD-to-index cleanliness changed after preview/confirmation",
        ));
    }
    if expected.worktree_clean != current.worktree_clean
        || !current.worktree_clean
        || !current.index_clean
    {
        let suffix = if current.dirty_paths.is_empty() {
            String::new()
        } else {
            format!(
                "; current changed paths: {}",
                current.dirty_paths.join(", ")
            )
        };
        failures.push(MutationPreflightFailure {
            code: MutationPreflightFailureCode::WorktreeStateChanged,
            message: format!("index/worktree cleanliness changed or is no longer clean{suffix}"),
        });
    }
    if expected.config_fingerprint != current.config_fingerprint
        || expected.config_has_includes != current.config_has_includes
        || current.config_has_includes
    {
        failures.push(failure(
            MutationPreflightFailureCode::ConfigChanged,
            "repository/worktree config bytes changed after preview/confirmation",
        ));
    }
    if expected.hooks_fingerprint != current.hooks_fingerprint
        || expected.active_hooks != current.active_hooks
        || expected.configured_hooks_path != current.configured_hooks_path
        || !current.active_hooks.is_empty()
        || current.configured_hooks_path.is_some()
    {
        failures.push(failure(
            MutationPreflightFailureCode::HooksChanged,
            "hook bytes/names/policy changed or an executable hook path is now active",
        ));
    }
    failures
}

fn unresolved_boundaries() -> Vec<MutationApplyUnresolvedBoundary> {
    vec![
        MutationApplyUnresolvedBoundary::BackendOwnedSingleUseAuthorization,
        MutationApplyUnresolvedBoundary::DurableIdempotencyReplayLedger,
        MutationApplyUnresolvedBoundary::RaceFreeFinalPreflightAndEffect,
        MutationApplyUnresolvedBoundary::CrashSafeAtomicityOrRecovery,
        MutationApplyUnresolvedBoundary::ConfigAndExternalExecutionIsolation,
    ]
}

fn failure(code: MutationPreflightFailureCode, message: &str) -> MutationPreflightFailure {
    MutationPreflightFailure {
        code,
        message: message.to_owned(),
    }
}

fn collect_status(
    repo: &gix::Repository,
) -> Result<(bool, bool, Vec<String>, bool), MutationPreflightError> {
    let platform = repo
        .status(gix::progress::Discard)
        .map_err(|error| MutationPreflightError::Inspection(error.to_string()))?
        .untracked_files(gix::status::UntrackedFiles::Files)
        .index_worktree_submodules(None);
    let iter = platform
        .into_iter(Vec::<gix::bstr::BString>::new())
        .map_err(|error| MutationPreflightError::Inspection(error.to_string()))?;

    let mut index_clean = true;
    let mut worktree_clean = true;
    let mut dirty_paths = Vec::new();
    let mut dirty_paths_truncated = false;
    for item in iter {
        let item = item.map_err(|error| MutationPreflightError::Inspection(error.to_string()))?;
        match &item {
            gix::status::Item::TreeIndex(_) => index_clean = false,
            gix::status::Item::IndexWorktree(_) => worktree_clean = false,
        }
        let path = item.location().to_str_lossy().into_owned();
        if !dirty_paths.contains(&path) {
            if dirty_paths.len() < MAX_REPORTED_DIRTY_PATHS {
                dirty_paths.push(path);
            } else {
                dirty_paths_truncated = true;
            }
        }
    }
    dirty_paths.sort();
    Ok((
        index_clean,
        worktree_clean,
        dirty_paths,
        dirty_paths_truncated,
    ))
}

fn path_identity(path: &Path) -> Result<MutationPreflightPathIdentity, MutationPreflightError> {
    let canonical = fs::canonicalize(path).map_err(|source| MutationPreflightError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let metadata =
        fs::symlink_metadata(&canonical).map_err(|source| MutationPreflightError::Io {
            path: canonical.clone(),
            source,
        })?;
    if metadata.file_type().is_symlink() {
        return Err(MutationPreflightError::SourceState(format!(
            "canonical repository identity path unexpectedly resolved to a symlink: {}",
            canonical.display()
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(MutationPreflightPathIdentity {
            canonical_path: canonical.to_string_lossy().into_owned(),
            device: Some(metadata.dev()),
            inode: Some(metadata.ino()),
            owner_uid: Some(metadata.uid()),
        })
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        Ok(MutationPreflightPathIdentity {
            canonical_path: canonical.to_string_lossy().into_owned(),
            device: None,
            inode: None,
            owner_uid: None,
        })
    }
}

fn critical_file_fingerprint(path: &Path) -> Result<String, MutationPreflightError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok("absent".to_owned()),
        Err(source) => {
            return Err(MutationPreflightError::Io {
                path: path.to_path_buf(),
                source,
            });
        }
    };
    if metadata.file_type().is_symlink() {
        return Err(MutationPreflightError::SourceState(format!(
            "critical metadata file is a symlink: {}",
            path.display()
        )));
    }
    if !metadata.is_file() {
        return Err(MutationPreflightError::SourceState(format!(
            "critical metadata path is not a regular file: {}",
            path.display()
        )));
    }
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-preflight-file-v1\0");
    hash_file_bytes(path, &mut hasher)?;
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn config_fingerprint(handle: &RepositoryHandle) -> Result<String, MutationPreflightError> {
    let common = handle.common_dir().join("config");
    let worktree = handle.git_dir().join("config.worktree");
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-preflight-config-v1\0");
    for (label, path) in [("common", common), ("worktree", worktree)] {
        hasher.update(label.as_bytes());
        hasher.update([0]);
        let fingerprint = critical_file_fingerprint(&path)?;
        hasher.update(fingerprint.as_bytes());
        hasher.update([0]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn hook_fingerprint(common_dir: &Path) -> Result<(String, Vec<String>), MutationPreflightError> {
    let hooks_dir = common_dir.join("hooks");
    let mut entries =
        match fs::read_dir(&hooks_dir) {
            Ok(entries) => entries.collect::<Result<Vec<_>, _>>().map_err(|source| {
                MutationPreflightError::Io {
                    path: hooks_dir.clone(),
                    source,
                }
            })?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(source) => {
                return Err(MutationPreflightError::Io {
                    path: hooks_dir,
                    source,
                });
            }
        };
    entries.sort_by_key(|entry| entry.file_name());

    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-preflight-hooks-v1\0");
    let mut active_hooks = Vec::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".sample") {
            continue;
        }
        let path = entry.path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|source| MutationPreflightError::Io {
                path: path.clone(),
                source,
            })?;
        if !metadata.is_file() && !metadata.file_type().is_symlink() {
            continue;
        }
        active_hooks.push(name.clone());
        hasher.update(name.as_bytes());
        hasher.update([0]);
        if metadata.file_type().is_symlink() {
            hasher.update(b"symlink\0");
            let target = fs::read_link(&path).map_err(|source| MutationPreflightError::Io {
                path: path.clone(),
                source,
            })?;
            hasher.update(target.to_string_lossy().as_bytes());
        } else {
            hasher.update(b"file\0");
            hash_file_bytes(&path, &mut hasher)?;
        }
        hasher.update([0]);
    }
    active_hooks.sort();
    Ok((format!("sha256:{:x}", hasher.finalize()), active_hooks))
}

fn hash_file_bytes(path: &Path, hasher: &mut Sha256) -> Result<(), MutationPreflightError> {
    let mut file = File::open(path).map_err(|source| MutationPreflightError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|source| MutationPreflightError::Io {
                path: path.to_path_buf(),
                source,
            })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(())
}

fn source_state_digest(source: &MutationPreflightSnapshot) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-preflight-source-v1\0");
    hash_repository_identity(&mut hasher, &source.repository_identity);
    hash_string(&mut hasher, &source.structural_revision);
    hash_optional(&mut hasher, source.head.as_deref());
    hash_optional(&mut hasher, source.head_ref.as_deref());
    for reference in &source.refs {
        hash_string(&mut hasher, &reference.name);
        hash_string(&mut hasher, &reference.target_oid);
        hash_optional(&mut hasher, reference.symbolic_target.as_deref());
        hash_optional(&mut hasher, reference.upstream.as_deref());
    }
    hash_string(&mut hasher, &source.index_fingerprint);
    hasher.update([source.index_clean as u8, source.worktree_clean as u8]);
    for path in &source.dirty_paths {
        hash_string(&mut hasher, path);
    }
    hasher.update([source.dirty_paths_truncated as u8]);
    hash_string(&mut hasher, &source.config_fingerprint);
    hasher.update([source.config_has_includes as u8]);
    hash_string(&mut hasher, &source.hooks_fingerprint);
    for hook in &source.active_hooks {
        hash_string(&mut hasher, hook);
    }
    hash_optional(&mut hasher, source.configured_hooks_path.as_deref());
    format!("sha256:{:x}", hasher.finalize())
}

fn hash_repository_identity(hasher: &mut Sha256, identity: &MutationPreflightRepositoryIdentity) {
    for path in [
        &identity.repository,
        &identity.git_dir,
        &identity.common_dir,
    ] {
        hash_string(hasher, &path.canonical_path);
        hash_optional(
            hasher,
            path.device.map(|value| value.to_string()).as_deref(),
        );
        hash_optional(hasher, path.inode.map(|value| value.to_string()).as_deref());
        hash_optional(
            hasher,
            path.owner_uid.map(|value| value.to_string()).as_deref(),
        );
    }
    hasher.update([identity.bare as u8]);
}

fn preview_result_digest(preview: &MutationPreviewResult) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-preflight-preview-result-v1\0");
    hash_string(&mut hasher, &preview.sandbox_id);
    hash_string(&mut hasher, &preview.transaction_id);
    hash_string(&mut hasher, &preview.base_revision);
    hash_string(&mut hasher, &preview.operation_digest);
    for operation in &preview.canonical_operations {
        hash_string(&mut hasher, operation);
    }
    hash_preview_summary(&mut hasher, &preview.before);
    hash_preview_summary(&mut hasher, &preview.after);
    for changed in &preview.changed_refs {
        hash_string(&mut hasher, &changed.name);
        hash_optional(&mut hasher, changed.before_oid.as_deref());
        hash_optional(&mut hasher, changed.after_oid.as_deref());
    }
    for rewritten in &preview.rewritten_commits {
        hash_string(&mut hasher, &rewritten.old_oid);
        hash_string(&mut hasher, &rewritten.new_oid);
        hash_string(&mut hasher, &rewritten.operation_index.to_string());
    }
    for cascade in &preview.hash_cascade {
        hash_string(&mut hasher, &cascade.old_oid);
        hash_string(&mut hasher, &cascade.new_oid);
        hash_string(&mut hasher, &cascade.operation_index.to_string());
        hash_string(&mut hasher, &cascade.reason);
        hash_optional(&mut hasher, cascade.new_parent_oid.as_deref());
    }
    for warning in &preview.warnings {
        hash_string(&mut hasher, warning);
    }
    for failure in &preview.failures {
        hash_string(&mut hasher, &failure.operation_index.to_string());
        hash_string(&mut hasher, &failure.operation_kind);
        hash_string(&mut hasher, &failure.code);
        hash_string(&mut hasher, &failure.message);
        for conflict in &failure.conflicts {
            hash_string(&mut hasher, conflict);
        }
    }
    hasher.update([preview.success as u8]);
    hash_string(&mut hasher, &preview.preview_token);
    format!("sha256:{:x}", hasher.finalize())
}

fn hash_preview_summary(hasher: &mut Sha256, summary: &crate::MutationPreviewSnapshotSummary) {
    hash_optional(hasher, summary.head.as_deref());
    hash_optional(hasher, summary.head_ref.as_deref());
    for reference in &summary.refs {
        hash_string(hasher, &reference.name);
        hash_string(hasher, &reference.target_oid);
    }
    hash_string(hasher, &summary.commit_count.to_string());
    hasher.update([summary.truncated as u8]);
}

fn receipt_digest(
    source: &MutationPreflightSnapshot,
    preview: &MutationPreviewSafetyBinding,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-preflight-receipt-v1\0");
    hash_string(&mut hasher, &source.state_digest);
    hash_string(&mut hasher, &preview.sandbox_id);
    hash_string(&mut hasher, &preview.transaction_id);
    hash_string(&mut hasher, &preview.base_revision);
    hash_string(&mut hasher, &preview.operation_digest);
    for operation in &preview.canonical_operations {
        hash_string(&mut hasher, operation);
    }
    hash_string(&mut hasher, &preview.preview_token);
    hash_string(&mut hasher, &preview.confirmation_token);
    hash_string(&mut hasher, &preview.preview_result_digest);
    format!("sha256:{:x}", hasher.finalize())
}

fn hash_string(hasher: &mut Sha256, value: &str) {
    hasher.update(value.len().to_le_bytes());
    hasher.update(value.as_bytes());
}

fn hash_optional(hasher: &mut Sha256, value: Option<&str>) {
    match value {
        Some(value) => {
            hasher.update([1]);
            hash_string(hasher, value);
        }
        None => hasher.update([0]),
    }
}
