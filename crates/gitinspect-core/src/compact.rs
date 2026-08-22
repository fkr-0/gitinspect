use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{GitCommitRecord, GitRepositorySnapshot, SignatureStatus};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CompactSnapshotError {
    #[error("compact snapshot transport only supports metadata-only snapshots")]
    CommitFilesPresent,
    #[error("compact snapshot string table exceeds u32 index space")]
    TooManyStrings,
    #[error("compact snapshot contains invalid string index {0}")]
    InvalidStringIndex(u32),
    #[error("compact snapshot contains invalid signature status code {0}")]
    InvalidSignatureStatus(u8),
}

/// Additive wire representation for metadata-only repository snapshots.
///
/// The public `GitRepositorySnapshot` contract remains authoritative. This
/// format removes repeated JSON object keys and interns repeated commit strings
/// while preserving refs/remotes/hooks verbatim. It deliberately cannot encode
/// eagerly materialized commit file lists; callers must keep diff/blob loading
/// on the existing lazy bounded path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactGitRepositorySnapshot {
    pub schema_version: u8,
    pub repository_path: String,
    pub git_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_ref: Option<String>,
    pub revision: String,
    pub strings: Vec<String>,
    pub commits: Vec<CompactGitCommitRecord>,
    pub refs: Vec<crate::GitRefRecord>,
    pub remotes: Vec<crate::GitRemoteRecord>,
    pub hooks: Vec<String>,
    pub truncated: bool,
}

/// Positional commit record used only by the compact wire contract.
///
/// Tuple order is intentionally stable and mirrored by the Tauri frontend
/// decoder: oid, tree oid, parents, author name, author email, authored time,
/// committed time, message, signature status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompactGitCommitRecord(
    pub u32,
    pub u32,
    pub Vec<u32>,
    pub u32,
    pub Option<u32>,
    pub i64,
    pub i64,
    pub u32,
    pub u8,
);

struct StringInterner<'a> {
    values: Vec<String>,
    indices: HashMap<&'a str, u32>,
}

impl<'a> StringInterner<'a> {
    fn new() -> Self {
        Self {
            values: Vec::new(),
            indices: HashMap::new(),
        }
    }

    fn intern(&mut self, value: &'a str) -> Result<u32, CompactSnapshotError> {
        if let Some(index) = self.indices.get(value) {
            return Ok(*index);
        }
        let index =
            u32::try_from(self.values.len()).map_err(|_| CompactSnapshotError::TooManyStrings)?;
        self.values.push(value.to_owned());
        self.indices.insert(value, index);
        Ok(index)
    }
}

impl CompactGitRepositorySnapshot {
    pub fn from_snapshot(snapshot: &GitRepositorySnapshot) -> Result<Self, CompactSnapshotError> {
        if snapshot
            .commits
            .iter()
            .any(|commit| !commit.files.is_empty())
        {
            return Err(CompactSnapshotError::CommitFilesPresent);
        }

        let mut strings = StringInterner::new();
        let mut commits = Vec::with_capacity(snapshot.commits.len());
        for commit in &snapshot.commits {
            commits.push(compact_commit(commit, &mut strings)?);
        }

        Ok(Self {
            schema_version: snapshot.schema_version,
            repository_path: snapshot.repository_path.clone(),
            git_dir: snapshot.git_dir.clone(),
            head: snapshot.head.clone(),
            head_ref: snapshot.head_ref.clone(),
            revision: snapshot.revision.clone(),
            strings: strings.values,
            commits,
            refs: snapshot.refs.clone(),
            remotes: snapshot.remotes.clone(),
            hooks: snapshot.hooks.clone(),
            truncated: snapshot.truncated,
        })
    }

    pub fn expand(&self) -> Result<GitRepositorySnapshot, CompactSnapshotError> {
        let mut commits = Vec::with_capacity(self.commits.len());
        for commit in &self.commits {
            commits.push(self.expand_commit(commit)?);
        }
        Ok(GitRepositorySnapshot {
            schema_version: self.schema_version,
            repository_path: self.repository_path.clone(),
            git_dir: self.git_dir.clone(),
            head: self.head.clone(),
            head_ref: self.head_ref.clone(),
            revision: self.revision.clone(),
            commits,
            refs: self.refs.clone(),
            remotes: self.remotes.clone(),
            hooks: self.hooks.clone(),
            truncated: self.truncated,
        })
    }

    fn expand_commit(
        &self,
        commit: &CompactGitCommitRecord,
    ) -> Result<GitCommitRecord, CompactSnapshotError> {
        Ok(GitCommitRecord {
            oid: self.string(commit.0)?.to_owned(),
            tree_oid: self.string(commit.1)?.to_owned(),
            parents: commit
                .2
                .iter()
                .map(|index| self.string(*index).map(str::to_owned))
                .collect::<Result<Vec<_>, _>>()?,
            author_name: self.string(commit.3)?.to_owned(),
            author_email: commit
                .4
                .map(|index| self.string(index).map(str::to_owned))
                .transpose()?,
            authored_at_ms: commit.5,
            committed_at_ms: commit.6,
            message: self.string(commit.7)?.to_owned(),
            signature_status: signature_from_code(commit.8)?,
            files: Vec::new(),
        })
    }

    fn string(&self, index: u32) -> Result<&str, CompactSnapshotError> {
        self.strings
            .get(index as usize)
            .map(String::as_str)
            .ok_or(CompactSnapshotError::InvalidStringIndex(index))
    }
}

fn compact_commit<'a>(
    commit: &'a GitCommitRecord,
    strings: &mut StringInterner<'a>,
) -> Result<CompactGitCommitRecord, CompactSnapshotError> {
    Ok(CompactGitCommitRecord(
        strings.intern(&commit.oid)?,
        strings.intern(&commit.tree_oid)?,
        commit
            .parents
            .iter()
            .map(|parent| strings.intern(parent))
            .collect::<Result<Vec<_>, _>>()?,
        strings.intern(&commit.author_name)?,
        commit
            .author_email
            .as_deref()
            .map(|email| strings.intern(email))
            .transpose()?,
        commit.authored_at_ms,
        commit.committed_at_ms,
        strings.intern(&commit.message)?,
        signature_to_code(commit.signature_status),
    ))
}

fn signature_to_code(status: SignatureStatus) -> u8 {
    match status {
        SignatureStatus::Valid => 0,
        SignatureStatus::Invalid => 1,
        SignatureStatus::Unknown => 2,
        SignatureStatus::Unsigned => 3,
    }
}

fn signature_from_code(code: u8) -> Result<SignatureStatus, CompactSnapshotError> {
    match code {
        0 => Ok(SignatureStatus::Valid),
        1 => Ok(SignatureStatus::Invalid),
        2 => Ok(SignatureStatus::Unknown),
        3 => Ok(SignatureStatus::Unsigned),
        _ => Err(CompactSnapshotError::InvalidSignatureStatus(code)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_snapshot_with_eager_commit_files() {
        let snapshot = GitRepositorySnapshot {
            schema_version: 1,
            repository_path: "/repo".to_owned(),
            git_dir: "/repo/.git".to_owned(),
            head: None,
            head_ref: None,
            revision: "revision".to_owned(),
            commits: vec![GitCommitRecord {
                oid: "a".to_owned(),
                tree_oid: "b".to_owned(),
                parents: Vec::new(),
                author_name: "author".to_owned(),
                author_email: None,
                authored_at_ms: 1,
                committed_at_ms: 1,
                message: "message".to_owned(),
                signature_status: SignatureStatus::Unsigned,
                files: vec![crate::GitCommitFileChange {
                    path: "file".to_owned(),
                    kind: crate::FileKind::Text,
                    additions: 1,
                    deletions: 0,
                    bytes: None,
                    status: crate::FileStatus::Added,
                }],
            }],
            refs: Vec::new(),
            remotes: Vec::new(),
            hooks: Vec::new(),
            truncated: false,
        };

        assert_eq!(
            CompactGitRepositorySnapshot::from_snapshot(&snapshot),
            Err(CompactSnapshotError::CommitFilesPresent)
        );
    }
}
