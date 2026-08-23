//! Sandboxed Git mutation preview authority.
//!
//! This module intentionally has no API that mutates an opened/original repository.
//! Every porcelain command runs inside a backend-created clone under a configured,
//! manager-owned sandbox root. The source [`RepositoryHandle`] is used read-only to
//! bind preview creation/execution to the repository snapshot revision.

use std::collections::{BTreeMap, HashMap};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{GitRepositorySnapshot, OpenOptions, RefKind, RepositoryHandle, RepositoryService};

const MAX_OPERATIONS: usize = 64;
const MAX_TRANSACTION_ID_BYTES: usize = 128;
const MAX_REF_NAME_BYTES: usize = 255;
const MAX_COMMAND_MESSAGE_BYTES: usize = 4096;
static NEXT_SANDBOX_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum MutationPreviewOperation {
    BranchCreate {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_oid: Option<String>,
    },
    BranchDelete {
        name: String,
    },
    BranchRename {
        old_name: String,
        new_name: String,
    },
    TagCreate {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_oid: Option<String>,
    },
    TagDelete {
        name: String,
    },
    TagMove {
        name: String,
        target_oid: String,
    },
    CherryPick {
        commit_oid: String,
    },
    RebaseReorder {
        branch: String,
        onto_oid: String,
        commit_oids: Vec<String>,
    },
    Squash {
        branch: String,
        onto_oid: String,
        commit_oids: Vec<String>,
    },
    Fixup {
        branch: String,
        onto_oid: String,
        commit_oids: Vec<String>,
    },
}

impl MutationPreviewOperation {
    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::BranchCreate { .. } => "branch-create",
            Self::BranchDelete { .. } => "branch-delete",
            Self::BranchRename { .. } => "branch-rename",
            Self::TagCreate { .. } => "tag-create",
            Self::TagDelete { .. } => "tag-delete",
            Self::TagMove { .. } => "tag-move",
            Self::CherryPick { .. } => "cherry-pick",
            Self::RebaseReorder { .. } => "rebase-reorder",
            Self::Squash { .. } => "squash",
            Self::Fixup { .. } => "fixup",
        }
    }

    /// Stable, deliberately simple serialization used for preview-token binding.
    /// Inputs are validated before this value is trusted.
    pub fn canonical(&self) -> String {
        fn oid(value: &Option<String>) -> &str {
            value.as_deref().unwrap_or("HEAD")
        }
        fn field(name: &str, value: &str) -> String {
            format!("{name}#{}:{value}", value.len())
        }
        fn oid_list(value: &[String]) -> String {
            value
                .iter()
                .map(|oid| field("oid", oid))
                .collect::<Vec<_>>()
                .join("|")
        }
        match self {
            Self::BranchCreate { name, target_oid } => {
                format!(
                    "branch-create|{}|{}",
                    field("name", name),
                    field("target", oid(target_oid))
                )
            }
            Self::BranchDelete { name } => format!("branch-delete|{}", field("name", name)),
            Self::BranchRename { old_name, new_name } => {
                format!(
                    "branch-rename|{}|{}",
                    field("old", old_name),
                    field("new", new_name)
                )
            }
            Self::TagCreate { name, target_oid } => {
                format!(
                    "tag-create|{}|{}",
                    field("name", name),
                    field("target", oid(target_oid))
                )
            }
            Self::TagDelete { name } => format!("tag-delete|{}", field("name", name)),
            Self::TagMove { name, target_oid } => {
                format!(
                    "tag-move|{}|{}",
                    field("name", name),
                    field("target", target_oid)
                )
            }
            Self::CherryPick { commit_oid } => {
                format!("cherry-pick|{}", field("commit", commit_oid))
            }
            Self::RebaseReorder {
                branch,
                onto_oid,
                commit_oids,
            } => format!(
                "rebase-reorder|{}|{}|count#{}|{}",
                field("branch", branch),
                field("onto", onto_oid),
                commit_oids.len(),
                oid_list(commit_oids)
            ),
            Self::Squash {
                branch,
                onto_oid,
                commit_oids,
            } => format!(
                "squash|{}|{}|count#{}|{}",
                field("branch", branch),
                field("onto", onto_oid),
                commit_oids.len(),
                oid_list(commit_oids)
            ),
            Self::Fixup {
                branch,
                onto_oid,
                commit_oids,
            } => format!(
                "fixup|{}|{}|count#{}|{}",
                field("branch", branch),
                field("onto", onto_oid),
                commit_oids.len(),
                oid_list(commit_oids)
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationSandboxSession {
    pub sandbox_id: String,
    pub base_revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreviewRef {
    pub name: String,
    pub target_oid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreviewSnapshotSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_ref: Option<String>,
    pub refs: Vec<MutationPreviewRef>,
    pub commit_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationChangedRef {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_oid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_oid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationRewrittenCommit {
    pub old_oid: String,
    pub new_oid: String,
    pub operation_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationHashCascadeEntry {
    pub old_oid: String,
    pub new_oid: String,
    pub operation_index: usize,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_parent_oid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreviewFailure {
    pub operation_index: usize,
    pub operation_kind: String,
    pub code: String,
    pub message: String,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreviewResult {
    pub sandbox_id: String,
    pub transaction_id: String,
    pub base_revision: String,
    pub operation_digest: String,
    pub canonical_operations: Vec<String>,
    pub before: MutationPreviewSnapshotSummary,
    pub after: MutationPreviewSnapshotSummary,
    pub changed_refs: Vec<MutationChangedRef>,
    pub rewritten_commits: Vec<MutationRewrittenCommit>,
    pub hash_cascade: Vec<MutationHashCascadeEntry>,
    pub warnings: Vec<String>,
    pub failures: Vec<MutationPreviewFailure>,
    pub success: bool,
    pub preview_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreviewConfirmation {
    pub token: String,
}

#[derive(Debug, Error)]
pub enum MutationPreviewError {
    #[error("mutation preview input is invalid: {0}")]
    InvalidInput(String),
    #[error("stale repository revision: expected {expected}, current {current}")]
    StaleRevision { expected: String, current: String },
    #[error("unknown mutation sandbox: {0}")]
    UnknownSandbox(String),
    #[error("mutation sandbox {0} has already been previewed")]
    AlreadyPreviewed(String),
    #[error("mutation preview token does not match the backend-owned preview")]
    PreviewTokenMismatch,
    #[error("mutation preview was already confirmed")]
    PreviewAlreadyConfirmed,
    #[error("sandbox boundary rejected path: {0}")]
    SandboxBoundary(PathBuf),
    #[error("filesystem operation failed at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("git setup command failed ({operation}): {message}")]
    GitSetup { operation: String, message: String },
    #[error("repository inspection failed: {0}")]
    Inspection(String),
}

#[derive(Debug, Clone)]
struct SandboxEntry {
    path: PathBuf,
    source: RepositoryHandle,
    base_revision: String,
    before: MutationPreviewSnapshotSummary,
    preview: Option<StoredPreview>,
}

#[derive(Debug, Clone)]
struct StoredPreview {
    transaction_id: String,
    preview_token: String,
    confirmed: bool,
}

#[derive(Debug)]
pub struct MutationSandboxManager {
    root: PathBuf,
    sandboxes: Mutex<HashMap<String, SandboxEntry>>,
}

impl Drop for MutationSandboxManager {
    fn drop(&mut self) {
        let entries = match self.sandboxes.get_mut() {
            Ok(entries) => entries,
            Err(poisoned) => poisoned.into_inner(),
        };
        for (_, entry) in entries.drain() {
            if ensure_direct_child(&self.root, &entry.path).is_ok() && entry.path.exists() {
                let _ = fs::remove_dir_all(entry.path);
            }
        }
    }
}

impl MutationSandboxManager {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, MutationPreviewError> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(|source| MutationPreviewError::Io {
            path: root.clone(),
            source,
        })?;
        let root = fs::canonicalize(&root).map_err(|source| MutationPreviewError::Io {
            path: root.clone(),
            source,
        })?;
        let hooks = root.join("empty-hooks");
        fs::create_dir_all(&hooks).map_err(|source| MutationPreviewError::Io {
            path: hooks,
            source,
        })?;
        Ok(Self {
            root,
            sandboxes: Mutex::new(HashMap::new()),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn create_sandbox(
        &self,
        source: &RepositoryHandle,
        expected_revision: &str,
    ) -> Result<MutationSandboxSession, MutationPreviewError> {
        validate_revision(expected_revision)?;
        let source_snapshot = source
            .refresh(OpenOptions::default())
            .map_err(|error| MutationPreviewError::Inspection(error.to_string()))?;
        ensure_revision(expected_revision, &source_snapshot.revision)?;

        let serial = NEXT_SANDBOX_ID.fetch_add(1, Ordering::Relaxed);
        let sandbox_id = format!("sandbox-{}-{serial}", std::process::id());
        let path = self.root.join(&sandbox_id);
        ensure_direct_child(&self.root, &path)?;
        if path.exists() {
            return Err(MutationPreviewError::SandboxBoundary(path));
        }

        let clone_args = [
            OsString::from("clone"),
            OsString::from("--quiet"),
            OsString::from("--no-hardlinks"),
            source.repository_path().as_os_str().to_owned(),
            path.as_os_str().to_owned(),
        ];
        let clone = run_git_raw(&self.root, clone_args.iter().map(OsString::as_os_str))?;
        if !clone.status.success() {
            let _ = fs::remove_dir_all(&path);
            return Err(MutationPreviewError::GitSetup {
                operation: "clone".to_owned(),
                message: bounded_output_message(&clone),
            });
        }

        if let Err(error) = self.normalize_clone(&path, &source_snapshot) {
            let _ = fs::remove_dir_all(&path);
            return Err(error);
        }

        let before = summarize_snapshot(&source_snapshot);
        self.lock_sandboxes()?.insert(
            sandbox_id.clone(),
            SandboxEntry {
                path,
                source: source.clone(),
                base_revision: expected_revision.to_owned(),
                before,
                preview: None,
            },
        );
        Ok(MutationSandboxSession {
            sandbox_id,
            base_revision: expected_revision.to_owned(),
        })
    }

    pub fn preview(
        &self,
        sandbox_id: &str,
        transaction_id: &str,
        operations: &[MutationPreviewOperation],
    ) -> Result<MutationPreviewResult, MutationPreviewError> {
        validate_sandbox_id(sandbox_id)?;
        validate_transaction_id(transaction_id)?;
        validate_operations(operations)?;

        let entry = self
            .lock_sandboxes()?
            .get(sandbox_id)
            .cloned()
            .ok_or_else(|| MutationPreviewError::UnknownSandbox(sandbox_id.to_owned()))?;
        if entry.preview.is_some() {
            return Err(MutationPreviewError::AlreadyPreviewed(
                sandbox_id.to_owned(),
            ));
        }
        ensure_direct_child(&self.root, &entry.path)?;

        let live = entry
            .source
            .refresh(OpenOptions::default())
            .map_err(|error| MutationPreviewError::Inspection(error.to_string()))?;
        ensure_revision(&entry.base_revision, &live.revision)?;

        let canonical_operations = operations
            .iter()
            .map(MutationPreviewOperation::canonical)
            .collect::<Vec<_>>();
        let operation_digest =
            operation_digest(transaction_id, &entry.base_revision, &canonical_operations);
        let mut rewritten_commits = Vec::new();
        let mut hash_cascade = Vec::new();
        let mut warnings = vec![
            "Preview uses committed Git object/ref state only; the original index and worktree are never copied or mutated."
                .to_owned(),
        ];
        let mut failures = Vec::new();

        for (operation_index, operation) in operations.iter().enumerate() {
            match self.execute_operation(
                &entry.path,
                operation_index,
                operation,
                &mut rewritten_commits,
                &mut hash_cascade,
                &mut warnings,
            )? {
                OperationExecution::Success => {}
                OperationExecution::Failure(failure) => {
                    failures.push(failure);
                    break;
                }
            }
        }

        let (_, after_snapshot) = RepositoryService::open(&entry.path, OpenOptions::default())
            .map_err(|error| MutationPreviewError::Inspection(error.to_string()))?;
        let live_after = entry
            .source
            .refresh(OpenOptions::default())
            .map_err(|error| MutationPreviewError::Inspection(error.to_string()))?;
        ensure_revision(&entry.base_revision, &live_after.revision)?;
        let after = summarize_snapshot(&after_snapshot);
        let changed_refs = changed_refs(&entry.before, &after);
        let preview_token = token_for(
            "preview",
            &[
                sandbox_id,
                transaction_id,
                &entry.base_revision,
                &operation_digest,
            ],
        );

        let mut sandboxes = self.lock_sandboxes()?;
        let current = sandboxes
            .get_mut(sandbox_id)
            .ok_or_else(|| MutationPreviewError::UnknownSandbox(sandbox_id.to_owned()))?;
        if current.preview.is_some() {
            return Err(MutationPreviewError::AlreadyPreviewed(
                sandbox_id.to_owned(),
            ));
        }
        current.preview = Some(StoredPreview {
            transaction_id: transaction_id.to_owned(),
            preview_token: preview_token.clone(),
            confirmed: false,
        });

        Ok(MutationPreviewResult {
            sandbox_id: sandbox_id.to_owned(),
            transaction_id: transaction_id.to_owned(),
            base_revision: entry.base_revision,
            operation_digest,
            canonical_operations,
            before: entry.before,
            after,
            changed_refs,
            rewritten_commits,
            hash_cascade,
            warnings,
            success: failures.is_empty(),
            failures,
            preview_token,
        })
    }

    pub fn confirm_preview(
        &self,
        sandbox_id: &str,
        transaction_id: &str,
        preview_token: &str,
    ) -> Result<MutationPreviewConfirmation, MutationPreviewError> {
        validate_sandbox_id(sandbox_id)?;
        validate_transaction_id(transaction_id)?;
        let mut sandboxes = self.lock_sandboxes()?;
        let entry = sandboxes
            .get_mut(sandbox_id)
            .ok_or_else(|| MutationPreviewError::UnknownSandbox(sandbox_id.to_owned()))?;

        let live = entry
            .source
            .refresh(OpenOptions::default())
            .map_err(|error| MutationPreviewError::Inspection(error.to_string()))?;
        ensure_revision(&entry.base_revision, &live.revision)?;

        let preview = entry
            .preview
            .as_mut()
            .ok_or(MutationPreviewError::PreviewTokenMismatch)?;
        if preview.confirmed {
            return Err(MutationPreviewError::PreviewAlreadyConfirmed);
        }
        if preview.transaction_id != transaction_id || preview.preview_token != preview_token {
            return Err(MutationPreviewError::PreviewTokenMismatch);
        }
        preview.confirmed = true;
        Ok(MutationPreviewConfirmation {
            token: token_for("confirm", &[sandbox_id, transaction_id, preview_token]),
        })
    }

    pub fn cleanup(&self, sandbox_id: &str) -> Result<bool, MutationPreviewError> {
        validate_sandbox_id(sandbox_id)?;
        let entry = self.lock_sandboxes()?.remove(sandbox_id);
        let Some(entry) = entry else {
            return Ok(false);
        };
        ensure_direct_child(&self.root, &entry.path)?;
        if entry.path.exists() {
            fs::remove_dir_all(&entry.path).map_err(|source| MutationPreviewError::Io {
                path: entry.path,
                source,
            })?;
        }
        Ok(true)
    }

    fn lock_sandboxes(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, SandboxEntry>>, MutationPreviewError>
    {
        self.sandboxes.lock().map_err(|_| {
            MutationPreviewError::InvalidInput("mutation sandbox registry lock poisoned".to_owned())
        })
    }

    fn normalize_clone(
        &self,
        path: &Path,
        source: &GitRepositorySnapshot,
    ) -> Result<(), MutationPreviewError> {
        let current_head_ref = source.head_ref.as_deref();
        for reference in &source.refs {
            if reference.kind != RefKind::LocalBranch
                || Some(reference.name.as_str()) == current_head_ref
            {
                continue;
            }
            let name = reference.name.strip_prefix("refs/heads/").ok_or_else(|| {
                MutationPreviewError::InvalidInput(
                    "local branch ref lacks refs/heads prefix".to_owned(),
                )
            })?;
            validate_ref_name(name)?;
            validate_oid(&reference.target_oid)?;
            let output = self.run_git(path, ["branch", "--force", name, &reference.target_oid])?;
            if !output.status.success() {
                return Err(MutationPreviewError::GitSetup {
                    operation: "recreate-local-branch".to_owned(),
                    message: bounded_output_message(&output),
                });
            }
        }

        // A preview sandbox never needs to contact the source repository again.
        let remote = self.run_git(path, ["remote", "remove", "origin"])?;
        if !remote.status.success() {
            // A source may clone without an origin in unusual local setups. That is safe.
            let has_origin = self.run_git(path, ["remote"])?;
            if String::from_utf8_lossy(&has_origin.stdout)
                .lines()
                .any(|line| line.trim() == "origin")
            {
                return Err(MutationPreviewError::GitSetup {
                    operation: "remove-origin".to_owned(),
                    message: bounded_output_message(&remote),
                });
            }
        }
        Ok(())
    }

    fn execute_operation(
        &self,
        path: &Path,
        operation_index: usize,
        operation: &MutationPreviewOperation,
        rewritten: &mut Vec<MutationRewrittenCommit>,
        cascade: &mut Vec<MutationHashCascadeEntry>,
        warnings: &mut Vec<String>,
    ) -> Result<OperationExecution, MutationPreviewError> {
        match operation {
            MutationPreviewOperation::BranchCreate { name, target_oid } => {
                let mut args = vec!["branch", name.as_str()];
                if let Some(target) = target_oid.as_deref() {
                    args.push(target);
                }
                self.simple_mutation(path, operation_index, operation, &args)
            }
            MutationPreviewOperation::BranchDelete { name } => {
                self.simple_mutation(path, operation_index, operation, &["branch", "-D", name])
            }
            MutationPreviewOperation::BranchRename { old_name, new_name } => self.simple_mutation(
                path,
                operation_index,
                operation,
                &["branch", "-m", old_name, new_name],
            ),
            MutationPreviewOperation::TagCreate { name, target_oid } => {
                let mut args = vec!["tag", name.as_str()];
                if let Some(target) = target_oid.as_deref() {
                    args.push(target);
                }
                self.simple_mutation(path, operation_index, operation, &args)
            }
            MutationPreviewOperation::TagDelete { name } => {
                self.simple_mutation(path, operation_index, operation, &["tag", "-d", name])
            }
            MutationPreviewOperation::TagMove { name, target_oid } => self.simple_mutation(
                path,
                operation_index,
                operation,
                &["tag", "-f", name, target_oid],
            ),
            MutationPreviewOperation::CherryPick { commit_oid } => {
                let output = self.run_git(path, ["cherry-pick", commit_oid.as_str()])?;
                if !output.status.success() {
                    return Ok(OperationExecution::Failure(self.failure_from_output(
                        path,
                        operation_index,
                        operation,
                        &output,
                    )?));
                }
                let new_oid = self.head_oid(path)?;
                let mut evidence = RewriteEvidence { rewritten, cascade };
                self.record_rewrite(
                    path,
                    operation_index,
                    "cherry-pick",
                    commit_oid,
                    &new_oid,
                    &mut evidence,
                )?;
                Ok(OperationExecution::Success)
            }
            MutationPreviewOperation::RebaseReorder {
                branch,
                onto_oid,
                commit_oids,
            } => {
                if let Some(failure) = self.validate_rewrite_range(
                    path,
                    operation_index,
                    operation,
                    RewriteRange {
                        branch,
                        onto_oid,
                        commit_oids,
                        allow_permutation: true,
                    },
                )? {
                    return Ok(OperationExecution::Failure(failure));
                }
                if let Some(failure) =
                    self.checkout_and_reset(path, operation_index, operation, branch, onto_oid)?
                {
                    return Ok(OperationExecution::Failure(failure));
                }
                let mut evidence = RewriteEvidence { rewritten, cascade };
                for old_oid in commit_oids {
                    let output = self.run_git(path, ["cherry-pick", old_oid.as_str()])?;
                    if !output.status.success() {
                        return Ok(OperationExecution::Failure(self.failure_from_output(
                            path,
                            operation_index,
                            operation,
                            &output,
                        )?));
                    }
                    let new_oid = self.head_oid(path)?;
                    self.record_rewrite(
                        path,
                        operation_index,
                        "rebase-reorder",
                        old_oid,
                        &new_oid,
                        &mut evidence,
                    )?;
                }
                Ok(OperationExecution::Success)
            }
            MutationPreviewOperation::Squash {
                branch,
                onto_oid,
                commit_oids,
            } => self.execute_fold_preview(
                path,
                operation_index,
                operation,
                branch,
                onto_oid,
                commit_oids,
                "squash",
                rewritten,
                cascade,
                warnings,
            ),
            MutationPreviewOperation::Fixup {
                branch,
                onto_oid,
                commit_oids,
            } => self.execute_fold_preview(
                path,
                operation_index,
                operation,
                branch,
                onto_oid,
                commit_oids,
                "fixup",
                rewritten,
                cascade,
                warnings,
            ),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn execute_fold_preview(
        &self,
        path: &Path,
        operation_index: usize,
        operation: &MutationPreviewOperation,
        branch: &str,
        onto_oid: &str,
        commit_oids: &[String],
        reason: &str,
        rewritten: &mut Vec<MutationRewrittenCommit>,
        cascade: &mut Vec<MutationHashCascadeEntry>,
        warnings: &mut Vec<String>,
    ) -> Result<OperationExecution, MutationPreviewError> {
        if let Some(failure) = self.validate_rewrite_range(
            path,
            operation_index,
            operation,
            RewriteRange {
                branch,
                onto_oid,
                commit_oids,
                allow_permutation: false,
            },
        )? {
            return Ok(OperationExecution::Failure(failure));
        }
        if let Some(failure) =
            self.checkout_and_reset(path, operation_index, operation, branch, onto_oid)?
        {
            return Ok(OperationExecution::Failure(failure));
        }
        for old_oid in commit_oids {
            let output = self.run_git(path, ["cherry-pick", "--no-commit", old_oid.as_str()])?;
            if !output.status.success() {
                return Ok(OperationExecution::Failure(self.failure_from_output(
                    path,
                    operation_index,
                    operation,
                    &output,
                )?));
            }
        }
        let first_oid = &commit_oids[0];
        let commit = self.run_git(path, ["commit", "--no-gpg-sign", "-C", first_oid.as_str()])?;
        if !commit.status.success() {
            return Ok(OperationExecution::Failure(self.failure_from_output(
                path,
                operation_index,
                operation,
                &commit,
            )?));
        }
        let new_oid = self.head_oid(path)?;
        let mut evidence = RewriteEvidence { rewritten, cascade };
        for old_oid in commit_oids {
            self.record_rewrite(
                path,
                operation_index,
                reason,
                old_oid,
                &new_oid,
                &mut evidence,
            )?;
        }
        if reason == "squash" {
            warnings.push(
                "Squash preview combines trees but reuses the first commit message; interactive message editing is not modeled."
                    .to_owned(),
            );
        }
        Ok(OperationExecution::Success)
    }

    fn validate_rewrite_range(
        &self,
        path: &Path,
        operation_index: usize,
        operation: &MutationPreviewOperation,
        range: RewriteRange<'_>,
    ) -> Result<Option<MutationPreviewFailure>, MutationPreviewError> {
        let exclude = format!("^{}", range.onto_oid);
        let output = self.run_git(
            path,
            ["rev-list", "--reverse", range.branch, exclude.as_str()],
        )?;
        if !output.status.success() {
            return Ok(Some(self.failure_from_output(
                path,
                operation_index,
                operation,
                &output,
            )?));
        }
        let expected = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let valid = if range.allow_permutation {
            let mut expected_sorted = expected.clone();
            let mut provided_sorted = range.commit_oids.to_vec();
            expected_sorted.sort();
            provided_sorted.sort();
            expected_sorted == provided_sorted
        } else {
            expected == range.commit_oids
        };
        if !valid {
            return Ok(Some(validation_failure(
                operation_index,
                operation,
                if range.allow_permutation {
                    "rebase reorder commit list must be an exact permutation of the linear branch range"
                } else {
                    "squash/fixup commit list must exactly match the branch range in original order"
                },
            )));
        }
        for oid in range.commit_oids {
            let parents = self.run_git(path, ["show", "-s", "--format=%P", oid.as_str()])?;
            if !parents.status.success() {
                return Ok(Some(self.failure_from_output(
                    path,
                    operation_index,
                    operation,
                    &parents,
                )?));
            }
            if String::from_utf8_lossy(&parents.stdout)
                .split_whitespace()
                .count()
                > 1
            {
                return Ok(Some(validation_failure(
                    operation_index,
                    operation,
                    "merge commits are not supported by the linear rewrite preview",
                )));
            }
        }
        Ok(None)
    }

    fn record_rewrite(
        &self,
        path: &Path,
        operation_index: usize,
        reason: &str,
        old_oid: &str,
        new_oid: &str,
        evidence: &mut RewriteEvidence<'_>,
    ) -> Result<(), MutationPreviewError> {
        evidence.rewritten.push(MutationRewrittenCommit {
            old_oid: old_oid.to_owned(),
            new_oid: new_oid.to_owned(),
            operation_index,
        });
        evidence.cascade.push(MutationHashCascadeEntry {
            old_oid: old_oid.to_owned(),
            new_oid: new_oid.to_owned(),
            operation_index,
            reason: reason.to_owned(),
            new_parent_oid: self.head_parent_oid(path)?,
        });
        Ok(())
    }

    fn checkout_and_reset(
        &self,
        path: &Path,
        operation_index: usize,
        operation: &MutationPreviewOperation,
        branch: &str,
        onto_oid: &str,
    ) -> Result<Option<MutationPreviewFailure>, MutationPreviewError> {
        for args in [
            vec!["checkout", "--quiet", branch],
            vec!["reset", "--hard", onto_oid],
        ] {
            let output = self.run_git(path, args)?;
            if !output.status.success() {
                return Ok(Some(self.failure_from_output(
                    path,
                    operation_index,
                    operation,
                    &output,
                )?));
            }
        }
        Ok(None)
    }

    fn simple_mutation(
        &self,
        path: &Path,
        operation_index: usize,
        operation: &MutationPreviewOperation,
        args: &[&str],
    ) -> Result<OperationExecution, MutationPreviewError> {
        let output = self.run_git(path, args.iter().copied())?;
        if output.status.success() {
            Ok(OperationExecution::Success)
        } else {
            Ok(OperationExecution::Failure(self.failure_from_output(
                path,
                operation_index,
                operation,
                &output,
            )?))
        }
    }

    fn failure_from_output(
        &self,
        path: &Path,
        operation_index: usize,
        operation: &MutationPreviewOperation,
        output: &Output,
    ) -> Result<MutationPreviewFailure, MutationPreviewError> {
        Ok(MutationPreviewFailure {
            operation_index,
            operation_kind: operation.kind_name().to_owned(),
            code: if self.conflict_paths(path)?.is_empty() {
                "git-command-failed".to_owned()
            } else {
                "conflict".to_owned()
            },
            message: bounded_output_message(output),
            conflicts: self.conflict_paths(path)?,
        })
    }

    fn conflict_paths(&self, path: &Path) -> Result<Vec<String>, MutationPreviewError> {
        let output = self.run_git(path, ["diff", "--name-only", "--diff-filter=U", "-z"])?;
        if !output.status.success() {
            return Ok(Vec::new());
        }
        let mut paths = output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty())
            .map(|part| String::from_utf8_lossy(part).into_owned())
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        Ok(paths)
    }

    fn head_oid(&self, path: &Path) -> Result<String, MutationPreviewError> {
        let output = self.run_git(path, ["rev-parse", "HEAD"])?;
        if !output.status.success() {
            return Err(MutationPreviewError::GitSetup {
                operation: "resolve-head".to_owned(),
                message: bounded_output_message(&output),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    fn head_parent_oid(&self, path: &Path) -> Result<Option<String>, MutationPreviewError> {
        let output = self.run_git(path, ["rev-parse", "HEAD^"])?;
        if output.status.success() {
            Ok(Some(
                String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            ))
        } else {
            Ok(None)
        }
    }

    fn run_git<I, S>(&self, cwd: &Path, args: I) -> Result<Output, MutationPreviewError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let hooks = self.root.join("empty-hooks");
        let hooks_config = format!("core.hooksPath={}", hooks.to_string_lossy());
        let mut command = Command::new("git");
        command
            .current_dir(cwd)
            .arg("-c")
            .arg(hooks_config)
            .arg("-c")
            .arg("commit.gpgSign=false")
            .arg("-c")
            .arg("tag.gpgSign=false")
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_COMMITTER_NAME", "gitinspect preview")
            .env("GIT_COMMITTER_EMAIL", "preview@gitinspect.invalid");
        command.output().map_err(|source| MutationPreviewError::Io {
            path: cwd.to_path_buf(),
            source,
        })
    }
}

enum OperationExecution {
    Success,
    Failure(MutationPreviewFailure),
}

struct RewriteRange<'a> {
    branch: &'a str,
    onto_oid: &'a str,
    commit_oids: &'a [String],
    allow_permutation: bool,
}

struct RewriteEvidence<'a> {
    rewritten: &'a mut Vec<MutationRewrittenCommit>,
    cascade: &'a mut Vec<MutationHashCascadeEntry>,
}

fn run_git_raw<'a, I>(cwd: &Path, args: I) -> Result<Output, MutationPreviewError>
where
    I: IntoIterator<Item = &'a OsStr>,
{
    Command::new("git")
        .current_dir(cwd)
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|source| MutationPreviewError::Io {
            path: cwd.to_path_buf(),
            source,
        })
}

fn validate_operations(
    operations: &[MutationPreviewOperation],
) -> Result<(), MutationPreviewError> {
    if operations.is_empty() {
        return Err(MutationPreviewError::InvalidInput(
            "at least one mutation operation is required".to_owned(),
        ));
    }
    if operations.len() > MAX_OPERATIONS {
        return Err(MutationPreviewError::InvalidInput(format!(
            "mutation operation count exceeds {MAX_OPERATIONS}"
        )));
    }
    for operation in operations {
        match operation {
            MutationPreviewOperation::BranchCreate { name, target_oid }
            | MutationPreviewOperation::TagCreate { name, target_oid } => {
                validate_ref_name(name)?;
                if let Some(oid) = target_oid {
                    validate_oid(oid)?;
                }
            }
            MutationPreviewOperation::BranchDelete { name }
            | MutationPreviewOperation::TagDelete { name } => validate_ref_name(name)?,
            MutationPreviewOperation::BranchRename { old_name, new_name } => {
                validate_ref_name(old_name)?;
                validate_ref_name(new_name)?;
                if old_name == new_name {
                    return Err(MutationPreviewError::InvalidInput(
                        "branch rename requires distinct names".to_owned(),
                    ));
                }
            }
            MutationPreviewOperation::TagMove { name, target_oid } => {
                validate_ref_name(name)?;
                validate_oid(target_oid)?;
            }
            MutationPreviewOperation::CherryPick { commit_oid } => validate_oid(commit_oid)?,
            MutationPreviewOperation::RebaseReorder {
                branch,
                onto_oid,
                commit_oids,
            }
            | MutationPreviewOperation::Squash {
                branch,
                onto_oid,
                commit_oids,
            }
            | MutationPreviewOperation::Fixup {
                branch,
                onto_oid,
                commit_oids,
            } => {
                validate_ref_name(branch)?;
                validate_oid(onto_oid)?;
                if commit_oids.is_empty() {
                    return Err(MutationPreviewError::InvalidInput(
                        "rewrite preview requires at least one commit".to_owned(),
                    ));
                }
                for oid in commit_oids {
                    validate_oid(oid)?;
                }
                let mut unique = commit_oids.clone();
                unique.sort();
                unique.dedup();
                if unique.len() != commit_oids.len() {
                    return Err(MutationPreviewError::InvalidInput(
                        "rewrite preview commit list contains duplicates".to_owned(),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_ref_name(value: &str) -> Result<(), MutationPreviewError> {
    if value.is_empty() || value.len() > MAX_REF_NAME_BYTES {
        return Err(MutationPreviewError::InvalidInput(
            "invalid ref name length".to_owned(),
        ));
    }
    if value.starts_with('-')
        || value.starts_with('/')
        || value.ends_with('/')
        || value.ends_with('.')
        || value.ends_with(".lock")
        || value.contains("..")
        || value.contains("@{")
        || value.contains("//")
        || value
            .split('/')
            .any(|part| part.is_empty() || part.starts_with('.') || part.ends_with('.'))
        || value.bytes().any(|byte| {
            byte <= 0x20
                || byte == 0x7f
                || matches!(byte, b'~' | b'^' | b':' | b'?' | b'*' | b'[' | b'\\')
        })
    {
        return Err(MutationPreviewError::InvalidInput(format!(
            "unsafe or invalid ref name: {value}"
        )));
    }
    Ok(())
}

fn validate_oid(value: &str) -> Result<(), MutationPreviewError> {
    if !(value.len() == 40 || value.len() == 64)
        || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(MutationPreviewError::InvalidInput(
            "object IDs must be full hexadecimal SHA-1/SHA-256 values".to_owned(),
        ));
    }
    Ok(())
}

fn validate_revision(value: &str) -> Result<(), MutationPreviewError> {
    if !value.starts_with("sha256:") || value.len() != "sha256:".len() + 64 {
        return Err(MutationPreviewError::InvalidInput(
            "base revision must be a gitinspect sha256 snapshot revision".to_owned(),
        ));
    }
    Ok(())
}

fn validate_transaction_id(value: &str) -> Result<(), MutationPreviewError> {
    if value.is_empty()
        || value.len() > MAX_TRANSACTION_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(MutationPreviewError::InvalidInput(
            "transaction ID contains unsupported characters or length".to_owned(),
        ));
    }
    Ok(())
}

fn validate_sandbox_id(value: &str) -> Result<(), MutationPreviewError> {
    if !value.starts_with("sandbox-")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(MutationPreviewError::InvalidInput(
            "invalid opaque sandbox ID".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_revision(expected: &str, current: &str) -> Result<(), MutationPreviewError> {
    if expected == current {
        Ok(())
    } else {
        Err(MutationPreviewError::StaleRevision {
            expected: expected.to_owned(),
            current: current.to_owned(),
        })
    }
}

fn ensure_direct_child(root: &Path, path: &Path) -> Result<(), MutationPreviewError> {
    if path.parent() != Some(root) {
        return Err(MutationPreviewError::SandboxBoundary(path.to_path_buf()));
    }
    Ok(())
}

fn summarize_snapshot(snapshot: &GitRepositorySnapshot) -> MutationPreviewSnapshotSummary {
    let mut refs = snapshot
        .refs
        .iter()
        .filter(|reference| matches!(reference.kind, RefKind::LocalBranch | RefKind::Tag))
        .map(|reference| MutationPreviewRef {
            name: reference.name.clone(),
            target_oid: reference.target_oid.clone(),
        })
        .collect::<Vec<_>>();
    refs.sort_by(|a, b| a.name.cmp(&b.name));
    MutationPreviewSnapshotSummary {
        head: snapshot.head.clone(),
        head_ref: snapshot.head_ref.clone(),
        refs,
        commit_count: snapshot.commits.len(),
        truncated: snapshot.truncated,
    }
}

fn changed_refs(
    before: &MutationPreviewSnapshotSummary,
    after: &MutationPreviewSnapshotSummary,
) -> Vec<MutationChangedRef> {
    let before = before
        .refs
        .iter()
        .map(|reference| (reference.name.as_str(), reference.target_oid.as_str()))
        .collect::<BTreeMap<_, _>>();
    let after = after
        .refs
        .iter()
        .map(|reference| (reference.name.as_str(), reference.target_oid.as_str()))
        .collect::<BTreeMap<_, _>>();
    let mut names = before
        .keys()
        .chain(after.keys())
        .copied()
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
        .into_iter()
        .filter_map(|name| {
            let before_oid = before.get(name).copied();
            let after_oid = after.get(name).copied();
            (before_oid != after_oid).then(|| MutationChangedRef {
                name: name.to_owned(),
                before_oid: before_oid.map(str::to_owned),
                after_oid: after_oid.map(str::to_owned),
            })
        })
        .collect()
}

fn operation_digest(transaction_id: &str, base_revision: &str, canonical: &[String]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-preview-operations-v1\0");
    hasher.update(transaction_id.as_bytes());
    hasher.update([0]);
    hasher.update(base_revision.as_bytes());
    hasher.update([0]);
    for operation in canonical {
        hasher.update(operation.as_bytes());
        hasher.update([0]);
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn token_for(namespace: &str, values: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-preview-token-v1\0");
    hasher.update(namespace.as_bytes());
    hasher.update([0]);
    for value in values {
        hasher.update(value.as_bytes());
        hasher.update([0]);
    }
    format!("{namespace}:{:x}", hasher.finalize())
}

fn validation_failure(
    operation_index: usize,
    operation: &MutationPreviewOperation,
    message: &str,
) -> MutationPreviewFailure {
    MutationPreviewFailure {
        operation_index,
        operation_kind: operation.kind_name().to_owned(),
        code: "invalid-rewrite-range".to_owned(),
        message: message.to_owned(),
        conflicts: Vec::new(),
    }
}

fn bounded_output_message(output: &Output) -> String {
    let bytes = if output.stderr.is_empty() {
        &output.stdout
    } else {
        &output.stderr
    };
    let end = bytes.len().min(MAX_COMMAND_MESSAGE_BYTES);
    String::from_utf8_lossy(&bytes[..end]).trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_operation_serialization_is_stable() {
        let operation = MutationPreviewOperation::RebaseReorder {
            branch: "topic".to_owned(),
            onto_oid: "a".repeat(40),
            commit_oids: vec!["b".repeat(40), "c".repeat(40)],
        };
        assert_eq!(
            operation.canonical(),
            format!(
                "rebase-reorder|branch#5:topic|onto#40:{}|count#2|oid#40:{}|oid#40:{}",
                "a".repeat(40),
                "b".repeat(40),
                "c".repeat(40)
            )
        );
    }

    #[test]
    fn validation_rejects_argv_shaped_ref_names_and_abbreviated_oids() {
        assert!(validate_ref_name("--delete").is_err());
        assert!(validate_ref_name("../escape").is_err());
        assert!(validate_oid("deadbeef").is_err());
    }
}
