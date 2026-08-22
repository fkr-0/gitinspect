use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOptions {
    pub max_commits: usize,
    /// Populate each snapshot commit's `files` field eagerly. Disabled by
    /// default so opening a large repository stays bounded; callers can fetch
    /// one commit through `RepositoryHandle::commit_diff()` instead.
    pub include_commit_files: bool,
    pub diff: DiffOptions,
}

impl Default for OpenOptions {
    fn default() -> Self {
        Self {
            max_commits: 50_000,
            include_commit_files: false,
            diff: DiffOptions::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffOptions {
    /// Maximum blob size that may be materialized for text/binary inspection.
    /// Objects larger than this are treated as binary/opaque without loading
    /// their content.
    pub max_blob_bytes: u64,
    /// Prefix inspected for NUL bytes. This value is always clamped to
    /// `max_blob_bytes`.
    pub binary_probe_bytes: usize,
    pub max_files: usize,
}

impl Default for DiffOptions {
    fn default() -> Self {
        Self {
            max_blob_bytes: 2 * 1024 * 1024,
            binary_probe_bytes: 8 * 1024,
            max_files: 10_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositorySnapshot {
    pub schema_version: u8,
    pub repository_path: String,
    pub git_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    pub revision: String,
    pub commits: Vec<GitCommitRecord>,
    pub refs: Vec<GitRefRecord>,
    pub remotes: Vec<GitRemoteRecord>,
    pub hooks: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRecord {
    pub oid: String,
    pub tree_oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_email: Option<String>,
    pub authored_at_ms: i64,
    pub committed_at_ms: i64,
    pub message: String,
    pub signature_status: SignatureStatus,
    pub files: Vec<GitCommitFileChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SignatureStatus {
    Valid,
    Invalid,
    Unknown,
    Unsigned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileChange {
    pub path: String,
    pub kind: FileKind,
    pub additions: u64,
    pub deletions: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    pub status: FileStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Text,
    Binary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Typechange,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefRecord {
    pub name: String,
    pub target_oid: String,
    pub kind: RefKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbolic_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    /// Reserved seam for a later graph-distance computation. This first
    /// read-only slice serializes it only when a backend computes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<u64>,
    /// Reserved seam for a later graph-distance computation. This first
    /// read-only slice serializes it only when a backend computes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
    Stash,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteRecord {
    pub name: String,
    pub fetch_urls: Vec<String>,
    pub push_urls: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiff {
    pub oid: String,
    /// Diff base. Merge commits use their first parent in this first slice;
    /// root commits compare against the empty tree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_oid: Option<String>,
    pub files: Vec<GitCommitFileChange>,
    pub truncated: bool,
}
