use std::collections::HashSet;

use thiserror::Error;

use crate::{GitCommitRecord, GitRefRecord, GitRemoteRecord, GitRepositorySnapshot, OpenOptions};

/// Hard ceiling for one append-aware refresh. Larger advances fall back to the
/// authoritative full metadata snapshot rather than turning a delta probe into
/// another unbounded history walk.
pub const MAX_APPEND_DELTA_COMMITS: usize = 4_096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepositoryAppendAwareRefresh {
    Unchanged { revision: String },
    Append { delta: RepositoryAppendDelta },
    Full { snapshot: GitRepositorySnapshot },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryAppendMetadata {
    pub revision: String,
    pub head: String,
    pub head_ref: String,
    pub refs: Vec<GitRefRecord>,
    pub remotes: Vec<GitRemoteRecord>,
    pub hooks: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryRefreshCursor {
    revision: String,
    head: Option<String>,
    head_ref: Option<String>,
    refs: Vec<GitRefRecord>,
    remotes: Vec<GitRemoteRecord>,
    hooks: Vec<String>,
    commit_count: usize,
    truncated: bool,
    max_commits: usize,
    append_compatible: bool,
}

impl RepositoryRefreshCursor {
    pub fn from_snapshot(snapshot: &GitRepositorySnapshot, options: &OpenOptions) -> Self {
        Self {
            revision: snapshot.revision.clone(),
            head: snapshot.head.clone(),
            head_ref: snapshot.head_ref.clone(),
            refs: snapshot.refs.clone(),
            remotes: snapshot.remotes.clone(),
            hooks: snapshot.hooks.clone(),
            commit_count: snapshot.commits.len(),
            truncated: snapshot.truncated,
            max_commits: options.max_commits,
            append_compatible: !options.include_commit_files
                && linear_snapshot_is_append_safe(snapshot),
        }
    }

    pub fn revision(&self) -> &str {
        &self.revision
    }

    pub fn head(&self) -> Option<&str> {
        self.head.as_deref()
    }

    pub fn matches_options(&self, options: &OpenOptions) -> bool {
        !options.include_commit_files && self.max_commits == options.max_commits
    }

    pub fn append_candidate_metadata(
        &self,
        head: Option<&str>,
        head_ref: Option<&str>,
        refs: &[GitRefRecord],
        remotes: &[GitRemoteRecord],
        hooks: &[String],
    ) -> bool {
        if !self.append_compatible
            || self.head.as_deref() == head
            || self.head_ref.as_deref() != head_ref
        {
            return false;
        }
        let (Some(old_head), Some(new_head), Some(head_ref)) =
            (self.head.as_deref(), head, head_ref)
        else {
            return false;
        };
        if old_head == new_head || self.remotes != remotes || self.hooks != hooks {
            return false;
        }
        if self.refs.len() != refs.len() {
            return false;
        }

        let mut saw_head_ref = false;
        for (old, new) in self.refs.iter().zip(refs) {
            if old.name != new.name {
                return false;
            }
            if old.name == head_ref {
                saw_head_ref = true;
                if old.target_oid != old_head
                    || new.target_oid != new_head
                    || old.kind != new.kind
                    || old.symbolic_target != new.symbolic_target
                    || old.upstream != new.upstream
                    || old.ahead != new.ahead
                    || old.behind != new.behind
                {
                    return false;
                }
            } else if old != new {
                return false;
            }
        }
        saw_head_ref
    }

    pub fn next_after(&self, delta: &RepositoryAppendDelta) -> Self {
        Self {
            revision: delta.revision.clone(),
            head: Some(delta.head.clone()),
            head_ref: Some(delta.head_ref.clone()),
            refs: delta.refs.clone(),
            remotes: delta.remotes.clone(),
            hooks: delta.hooks.clone(),
            commit_count: self
                .commit_count
                .saturating_add(delta.commits.len())
                .saturating_sub(delta.drop_commit_count),
            truncated: delta.truncated,
            max_commits: self.max_commits,
            append_compatible: true,
        }
    }

    pub fn build_append_delta(
        &self,
        metadata: RepositoryAppendMetadata,
        commits: Vec<GitCommitRecord>,
    ) -> Result<RepositoryAppendDelta, DeltaValidationError> {
        if !self.append_compatible {
            return Err(DeltaValidationError::IncompatibleBase);
        }
        if metadata.revision == self.revision {
            return Err(DeltaValidationError::UnchangedRevision);
        }
        let old_head = self
            .head
            .as_deref()
            .ok_or(DeltaValidationError::IncompatibleBase)?;
        let old_head_ref = self
            .head_ref
            .as_deref()
            .ok_or(DeltaValidationError::IncompatibleBase)?;
        if old_head_ref != metadata.head_ref
            || !self.append_candidate_metadata(
                Some(&metadata.head),
                Some(&metadata.head_ref),
                &metadata.refs,
                &metadata.remotes,
                &metadata.hooks,
            )
        {
            return Err(DeltaValidationError::MetadataDiverged);
        }
        validate_appended_chain(&commits, &metadata.head, old_head)?;
        if commits.len() > MAX_APPEND_DELTA_COMMITS {
            return Err(DeltaValidationError::AppendLimitExceeded {
                count: commits.len(),
                limit: MAX_APPEND_DELTA_COMMITS,
            });
        }

        let total = self.commit_count.saturating_add(commits.len());
        let drop_commit_count = if self.truncated {
            commits.len().min(self.commit_count)
        } else {
            total
                .saturating_sub(self.max_commits)
                .min(self.commit_count)
        };
        let truncated = self.truncated || total > self.max_commits;

        Ok(RepositoryAppendDelta {
            base_revision: self.revision.clone(),
            base_head: old_head.to_owned(),
            revision: metadata.revision,
            head: metadata.head,
            head_ref: metadata.head_ref,
            commits,
            refs: metadata.refs,
            remotes: metadata.remotes,
            hooks: metadata.hooks,
            drop_commit_count,
            truncated,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryAppendDelta {
    pub base_revision: String,
    pub base_head: String,
    pub revision: String,
    pub head: String,
    pub head_ref: String,
    pub commits: Vec<GitCommitRecord>,
    pub refs: Vec<GitRefRecord>,
    pub remotes: Vec<GitRemoteRecord>,
    pub hooks: Vec<String>,
    pub drop_commit_count: usize,
    pub truncated: bool,
}

impl RepositoryAppendDelta {
    /// Apply a validated native delta to the existing public snapshot shape.
    /// This helper is also used by regression tests to prove the delta result is
    /// byte-for-byte equivalent to the authoritative full metadata snapshot.
    pub fn apply_to(
        &self,
        base: &GitRepositorySnapshot,
    ) -> Result<GitRepositorySnapshot, DeltaApplyError> {
        if base.revision != self.base_revision {
            return Err(DeltaApplyError::BaseRevisionMismatch {
                expected: self.base_revision.clone(),
                actual: base.revision.clone(),
            });
        }
        if base.commits.iter().any(|commit| !commit.files.is_empty())
            || self.commits.iter().any(|commit| !commit.files.is_empty())
        {
            return Err(DeltaApplyError::CommitFilesPresent);
        }
        let base_head = base
            .head
            .as_deref()
            .ok_or(DeltaApplyError::MissingBaseHead)?;
        if base_head != self.base_head {
            return Err(DeltaApplyError::BaseHeadMismatch {
                expected: self.base_head.clone(),
                actual: base_head.to_owned(),
            });
        }
        validate_appended_chain(&self.commits, &self.head, base_head)
            .map_err(DeltaApplyError::InvalidAppend)?;
        if self.drop_commit_count > base.commits.len() {
            return Err(DeltaApplyError::InvalidDropCount {
                drop: self.drop_commit_count,
                base: base.commits.len(),
            });
        }

        let retained_len = base.commits.len() - self.drop_commit_count;
        let retained = &base.commits[..retained_len];
        let retained_oids: HashSet<&str> =
            retained.iter().map(|commit| commit.oid.as_str()).collect();
        if self
            .commits
            .iter()
            .any(|commit| retained_oids.contains(commit.oid.as_str()))
        {
            return Err(DeltaApplyError::DuplicateCommit);
        }

        let mut commits = Vec::with_capacity(self.commits.len() + retained.len());
        commits.extend(self.commits.iter().cloned());
        commits.extend(retained.iter().cloned());
        Ok(GitRepositorySnapshot {
            schema_version: base.schema_version,
            repository_path: base.repository_path.clone(),
            git_dir: base.git_dir.clone(),
            head: Some(self.head.clone()),
            head_ref: Some(self.head_ref.clone()),
            revision: self.revision.clone(),
            commits,
            refs: self.refs.clone(),
            remotes: self.remotes.clone(),
            hooks: self.hooks.clone(),
            truncated: self.truncated,
        })
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum DeltaValidationError {
    #[error("base snapshot is not eligible for append-aware refresh")]
    IncompatibleBase,
    #[error("repository revision is unchanged")]
    UnchangedRevision,
    #[error("repository metadata changed outside the attached HEAD ref")]
    MetadataDiverged,
    #[error("append chain is empty")]
    EmptyAppend,
    #[error("append chain head does not match refreshed HEAD")]
    HeadMismatch,
    #[error("append chain contains a merge or non-linear parent transition")]
    NonLinearAppend,
    #[error("append chain does not terminate at the base HEAD")]
    BaseHeadNotReached,
    #[error("append chain contains eager commit files")]
    CommitFilesPresent,
    #[error("append chain of {count} commits exceeds delta ceiling {limit}")]
    AppendLimitExceeded { count: usize, limit: usize },
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum DeltaApplyError {
    #[error("delta base revision mismatch: expected {expected}, got {actual}")]
    BaseRevisionMismatch { expected: String, actual: String },
    #[error("delta cannot apply without a resolved base HEAD")]
    MissingBaseHead,
    #[error("delta base HEAD mismatch: expected {expected}, got {actual}")]
    BaseHeadMismatch { expected: String, actual: String },
    #[error("delta contains eager commit files")]
    CommitFilesPresent,
    #[error("invalid append delta: {0}")]
    InvalidAppend(DeltaValidationError),
    #[error("delta drops {drop} commits from a base containing only {base}")]
    InvalidDropCount { drop: usize, base: usize },
    #[error("delta introduces a commit already retained by the base snapshot")]
    DuplicateCommit,
}

fn validate_appended_chain(
    commits: &[GitCommitRecord],
    new_head: &str,
    old_head: &str,
) -> Result<(), DeltaValidationError> {
    let Some(first) = commits.first() else {
        return Err(DeltaValidationError::EmptyAppend);
    };
    if first.oid != new_head {
        return Err(DeltaValidationError::HeadMismatch);
    }
    if commits.iter().any(|commit| !commit.files.is_empty()) {
        return Err(DeltaValidationError::CommitFilesPresent);
    }
    if commits.iter().any(|commit| commit.parents.len() != 1) {
        return Err(DeltaValidationError::NonLinearAppend);
    }
    for pair in commits.windows(2) {
        if pair[0].parents[0] != pair[1].oid {
            return Err(DeltaValidationError::NonLinearAppend);
        }
    }
    let last = commits.last().expect("non-empty append checked above");
    if last.parents[0] != old_head {
        return Err(DeltaValidationError::BaseHeadNotReached);
    }
    Ok(())
}

fn linear_snapshot_is_append_safe(snapshot: &GitRepositorySnapshot) -> bool {
    let (Some(head), Some(head_ref), Some(first)) = (
        snapshot.head.as_deref(),
        snapshot.head_ref.as_deref(),
        snapshot.commits.first(),
    ) else {
        return false;
    };
    if first.oid != head
        || snapshot
            .commits
            .iter()
            .any(|commit| !commit.files.is_empty())
    {
        return false;
    }
    for pair in snapshot.commits.windows(2) {
        if pair[0].parents.len() != 1 || pair[0].parents[0] != pair[1].oid {
            return false;
        }
    }
    let Some(last) = snapshot.commits.last() else {
        return false;
    };
    if (!snapshot.truncated && !last.parents.is_empty()) || last.parents.len() > 1 {
        return false;
    }

    let visible: HashSet<&str> = snapshot
        .commits
        .iter()
        .map(|commit| commit.oid.as_str())
        .collect();
    if snapshot
        .refs
        .iter()
        .any(|reference| !visible.contains(reference.target_oid.as_str()))
    {
        return false;
    }
    snapshot
        .refs
        .iter()
        .any(|reference| reference.name == head_ref && reference.target_oid == head)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RefKind, SignatureStatus};

    fn commit(oid: &str, parent: Option<&str>) -> GitCommitRecord {
        GitCommitRecord {
            oid: oid.to_owned(),
            tree_oid: format!("tree-{oid}"),
            parents: parent.into_iter().map(str::to_owned).collect(),
            author_name: "Scale Fixture".to_owned(),
            author_email: None,
            authored_at_ms: 1,
            committed_at_ms: 1,
            message: oid.to_owned(),
            signature_status: SignatureStatus::Unsigned,
            files: Vec::new(),
        }
    }

    fn reference(target: &str) -> GitRefRecord {
        GitRefRecord {
            name: "refs/heads/main".to_owned(),
            target_oid: target.to_owned(),
            kind: RefKind::LocalBranch,
            symbolic_target: None,
            upstream: None,
            ahead: None,
            behind: None,
        }
    }

    fn snapshot() -> GitRepositorySnapshot {
        GitRepositorySnapshot {
            schema_version: 1,
            repository_path: "/repo".to_owned(),
            git_dir: "/repo/.git".to_owned(),
            head: Some("base".to_owned()),
            head_ref: Some("refs/heads/main".to_owned()),
            revision: "base-revision".to_owned(),
            commits: vec![commit("base", Some("older")), commit("older", None)],
            refs: vec![reference("base")],
            remotes: Vec::new(),
            hooks: Vec::new(),
            truncated: false,
        }
    }

    #[test]
    fn validated_linear_append_reconstructs_full_snapshot_shape() {
        let base = snapshot();
        let options = OpenOptions {
            max_commits: 3,
            ..OpenOptions::default()
        };
        let cursor = RepositoryRefreshCursor::from_snapshot(&base, &options);
        let delta = cursor
            .build_append_delta(
                RepositoryAppendMetadata {
                    revision: "next-revision".to_owned(),
                    head: "next".to_owned(),
                    head_ref: "refs/heads/main".to_owned(),
                    refs: vec![reference("next")],
                    remotes: Vec::new(),
                    hooks: Vec::new(),
                },
                vec![commit("next", Some("base"))],
            )
            .unwrap();
        let applied = delta.apply_to(&base).unwrap();

        assert_eq!(applied.head.as_deref(), Some("next"));
        assert_eq!(
            applied
                .commits
                .iter()
                .map(|commit| commit.oid.as_str())
                .collect::<Vec<_>>(),
            vec!["next", "base", "older"]
        );
        assert!(!applied.truncated);
    }

    #[test]
    fn merge_append_and_ref_changes_fail_closed() {
        let base = snapshot();
        let cursor = RepositoryRefreshCursor::from_snapshot(&base, &OpenOptions::default());
        let mut changed_refs = vec![reference("next")];
        changed_refs.push(GitRefRecord {
            name: "refs/tags/v1".to_owned(),
            target_oid: "base".to_owned(),
            kind: RefKind::Tag,
            symbolic_target: None,
            upstream: None,
            ahead: None,
            behind: None,
        });
        assert!(!cursor.append_candidate_metadata(
            Some("next"),
            Some("refs/heads/main"),
            &changed_refs,
            &[],
            &[],
        ));

        let mut merge = commit("next", Some("base"));
        merge.parents.push("side".to_owned());
        assert_eq!(
            cursor
                .build_append_delta(
                    RepositoryAppendMetadata {
                        revision: "next-revision".to_owned(),
                        head: "next".to_owned(),
                        head_ref: "refs/heads/main".to_owned(),
                        refs: vec![reference("next")],
                        remotes: Vec::new(),
                        hooks: Vec::new(),
                    },
                    vec![merge],
                )
                .unwrap_err(),
            DeltaValidationError::NonLinearAppend
        );
    }
}
