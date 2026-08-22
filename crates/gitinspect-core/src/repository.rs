use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::thread;

use gix::bstr::ByteSlice;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::diff;
use crate::{
    CommitDiff, DiffOptions, GitCommitRecord, GitRefRecord, GitRemoteRecord, GitRepositorySnapshot,
    OpenOptions, RefKind, SignatureStatus,
};
use crate::{RawWatchEvent, RepositoryChange, WatchCoalescer, WatchOptions};

#[derive(Debug, Error)]
pub enum Error {
    #[error("git repository operation failed: {0}")]
    Git(String),
    #[error("filesystem operation failed at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("path does not resolve to a Git repository: {0}")]
    NotRepository(PathBuf),
    #[error("repository watcher operation failed: {0}")]
    Watch(String),
}

impl Error {
    pub(crate) fn git(error: impl std::fmt::Display) -> Self {
        Self::Git(error.to_string())
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct RepositoryService;

impl RepositoryService {
    pub fn open(
        path: impl AsRef<Path>,
        options: OpenOptions,
    ) -> Result<(RepositoryHandle, GitRepositorySnapshot), Error> {
        let repo = discover_repository(path.as_ref())?;
        let repository_path = canonical_repository_path(&repo)?;
        let git_dir = canonicalize(repo.git_dir())?;
        let common_dir = canonicalize(repo.common_dir())?;
        let handle = RepositoryHandle {
            repository_path,
            git_dir,
            common_dir,
        };
        let snapshot = snapshot_from_repo(&repo, &options)?;
        Ok((handle, snapshot))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryHandle {
    repository_path: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
}

impl RepositoryHandle {
    pub fn repository_path(&self) -> &Path {
        &self.repository_path
    }

    pub fn git_dir(&self) -> &Path {
        &self.git_dir
    }

    pub fn common_dir(&self) -> &Path {
        &self.common_dir
    }

    pub fn refresh(&self, options: OpenOptions) -> Result<GitRepositorySnapshot, Error> {
        let repo = gix::open(&self.git_dir).map_err(Error::git)?;
        snapshot_from_repo(&repo, &options)
    }

    /// Recompute only the revision-defining repository metadata first and skip
    /// the commit walk when it still matches `current_revision`.
    ///
    /// `None` means the authoritative snapshot revision is unchanged. `Some`
    /// contains the same full metadata-only snapshot returned by `refresh()`.
    pub fn refresh_if_changed(
        &self,
        current_revision: &str,
        options: OpenOptions,
    ) -> Result<Option<GitRepositorySnapshot>, Error> {
        let repo = gix::open(&self.git_dir).map_err(Error::git)?;
        snapshot_from_repo_if_changed(&repo, &options, current_revision)
    }

    pub fn commit_diff(
        &self,
        oid: impl AsRef<str>,
        options: DiffOptions,
    ) -> Result<CommitDiff, Error> {
        let repo = gix::open(&self.git_dir).map_err(Error::git)?;
        let id = gix::ObjectId::from_hex(oid.as_ref().as_bytes()).map_err(Error::git)?;
        let commit = repo.find_commit(id).map_err(Error::git)?;
        let (parent_oid, files, truncated) = diff::commit_diff(&repo, &commit, &options)?;
        Ok(CommitDiff {
            oid: commit.id.to_string(),
            parent_oid,
            files,
            truncated,
        })
    }

    /// Start a native filesystem watcher for the per-worktree git directory and
    /// its shared common directory (when different), preserving the same
    /// coalesced change contract as the deterministic watcher core.
    pub fn watch_native(
        &self,
        options: WatchOptions,
    ) -> Result<crate::NativeRepositoryWatcher, Error> {
        crate::watch::start_native_watch(self, options)
    }

    /// Adapt a deterministic raw event source into a coalesced change receiver.
    /// Tests can use this path without sleeping or touching global watcher state.
    pub fn watch<I>(&self, events: I, options: WatchOptions) -> Receiver<RepositoryChange>
    where
        I: IntoIterator<Item = RawWatchEvent> + Send + 'static,
        I::IntoIter: Send + 'static,
    {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut coalescer = WatchCoalescer::new(options);
            for event in events {
                if let Some(change) = coalescer.flush_if_due(event.at)
                    && sender.send(change).is_err()
                {
                    return;
                }
                coalescer.push(event);
            }
            if let Some(change) = coalescer.flush() {
                let _ = sender.send(change);
            }
        });
        receiver
    }
}

fn discover_repository(path: &Path) -> Result<gix::Repository, Error> {
    // `gix::discover()` intentionally starts from a directory. A linked
    // worktree's `.git` is a gitfile containing `gitdir: ...`; normalize that
    // file input to the worktree directory and let gix resolve the indirection.
    let start = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    gix::discover(start).map_err(|error| {
        if path.exists() {
            Error::git(error)
        } else {
            Error::NotRepository(path.to_path_buf())
        }
    })
}

fn canonical_repository_path(repo: &gix::Repository) -> Result<PathBuf, Error> {
    match repo.workdir() {
        Some(workdir) => canonicalize(workdir),
        None => canonicalize(repo.git_dir()),
    }
}

fn canonicalize(path: &Path) -> Result<PathBuf, Error> {
    fs::canonicalize(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn snapshot_from_repo(
    repo: &gix::Repository,
    options: &OpenOptions,
) -> Result<GitRepositorySnapshot, Error> {
    let metadata = snapshot_metadata_from_repo(repo)?;
    snapshot_from_metadata(repo, options, metadata)
}

fn snapshot_from_repo_if_changed(
    repo: &gix::Repository,
    options: &OpenOptions,
    current_revision: &str,
) -> Result<Option<GitRepositorySnapshot>, Error> {
    let metadata = snapshot_metadata_from_repo(repo)?;
    if metadata.revision == current_revision {
        return Ok(None);
    }
    snapshot_from_metadata(repo, options, metadata).map(Some)
}

#[derive(Debug)]
struct SnapshotMetadata {
    repository_path: String,
    git_dir: String,
    head: Option<String>,
    head_ref: Option<String>,
    revision: String,
    refs: Vec<GitRefRecord>,
    remotes: Vec<GitRemoteRecord>,
    hooks: Vec<String>,
}

fn snapshot_metadata_from_repo(repo: &gix::Repository) -> Result<SnapshotMetadata, Error> {
    let repository_path = canonical_repository_path(repo)?;
    let git_dir = canonicalize(repo.git_dir())?;
    let head = repo.head_id().ok().map(|id| id.to_string());
    let head_ref = repo
        .head_name()
        .ok()
        .flatten()
        .map(|name| name.as_bstr().to_str_lossy().into_owned());
    let mut refs = collect_refs(repo)?;
    let mut remotes = collect_remotes(repo)?;
    let hooks = collect_hooks(repo)?;

    refs.sort_by(|a, b| a.name.cmp(&b.name));
    remotes.sort_by(|a, b| a.name.cmp(&b.name));
    let revision = revision_fingerprint(
        head.as_deref(),
        head_ref.as_deref(),
        &refs,
        &remotes,
        &hooks,
    );
    Ok(SnapshotMetadata {
        repository_path: path_to_string(&repository_path),
        git_dir: path_to_string(&git_dir),
        head,
        head_ref,
        revision,
        refs,
        remotes,
        hooks,
    })
}

fn snapshot_from_metadata(
    repo: &gix::Repository,
    options: &OpenOptions,
    metadata: SnapshotMetadata,
) -> Result<GitRepositorySnapshot, Error> {
    let (commits, truncated) = collect_commits(repo, options, &metadata.refs)?;
    Ok(GitRepositorySnapshot {
        schema_version: 1,
        repository_path: metadata.repository_path,
        git_dir: metadata.git_dir,
        head: metadata.head,
        head_ref: metadata.head_ref,
        revision: metadata.revision,
        commits,
        refs: metadata.refs,
        remotes: metadata.remotes,
        hooks: metadata.hooks,
        truncated,
    })
}

fn collect_commits(
    repo: &gix::Repository,
    options: &OpenOptions,
    refs: &[GitRefRecord],
) -> Result<(Vec<GitCommitRecord>, bool), Error> {
    let mut tips = Vec::new();
    if let Ok(head) = repo.head_id() {
        tips.push(head.detach());
    }
    for reference in refs {
        let Ok(id) = gix::ObjectId::from_hex(reference.target_oid.as_bytes()) else {
            continue;
        };
        if repo.find_commit(id).is_ok() && !tips.contains(&id) {
            tips.push(id);
        }
    }
    if tips.is_empty() {
        return Ok((Vec::new(), false));
    }

    let mut commits = Vec::new();
    let mut truncated = false;
    let walk = repo.rev_walk(tips).all().map_err(Error::git)?;
    for info in walk {
        if commits.len() >= options.max_commits {
            truncated = true;
            break;
        }
        let info = info.map_err(Error::git)?;
        let commit = repo.find_commit(info.id).map_err(Error::git)?;
        let author = commit.author().map_err(Error::git)?;
        let committer = commit.committer().map_err(Error::git)?;
        let files = if options.include_commit_files {
            let (_, files, files_truncated) = diff::commit_diff(repo, &commit, &options.diff)?;
            truncated |= files_truncated;
            files
        } else {
            Vec::new()
        };
        commits.push(GitCommitRecord {
            oid: commit.id.to_string(),
            tree_oid: commit.tree_id().map_err(Error::git)?.to_string(),
            parents: commit.parent_ids().map(|id| id.to_string()).collect(),
            author_name: author.name.to_str_lossy().into_owned(),
            author_email: (!author.email.is_empty())
                .then(|| author.email.to_str_lossy().into_owned()),
            authored_at_ms: author
                .time()
                .map_err(Error::git)?
                .seconds
                .saturating_mul(1000),
            committed_at_ms: committer
                .time()
                .map_err(Error::git)?
                .seconds
                .saturating_mul(1000),
            message: commit.message_raw_sloppy().to_str_lossy().into_owned(),
            signature_status: if commit.signature().map_err(Error::git)?.is_some() {
                SignatureStatus::Unknown
            } else {
                SignatureStatus::Unsigned
            },
            files,
        });
    }
    Ok((commits, truncated))
}

fn collect_refs(repo: &gix::Repository) -> Result<Vec<GitRefRecord>, Error> {
    let mut records = Vec::new();
    let platform = repo.references().map_err(Error::git)?;
    let iter = platform.all().map_err(Error::git)?;
    for reference in iter {
        let mut reference = reference.map_err(Error::git)?;
        let name = reference.name().as_bstr().to_str_lossy().into_owned();
        let kind = classify_ref(&name);
        let symbolic_target = symbolic_target(&reference);
        let upstream = if kind == RefKind::LocalBranch {
            repo.branch_remote_tracking_ref_name(reference.name(), gix::remote::Direction::Fetch)
                .and_then(Result::ok)
                .map(|name| name.as_bstr().to_str_lossy().into_owned())
        } else {
            None
        };
        let target_oid = reference.peel_to_id().map_err(Error::git)?.to_string();
        records.push(GitRefRecord {
            name,
            target_oid,
            kind,
            symbolic_target,
            upstream,
            ahead: None,
            behind: None,
        });
    }

    append_stash_entries(repo, &mut records)?;
    Ok(records)
}

fn symbolic_target(reference: &gix::Reference<'_>) -> Option<String> {
    match reference.target() {
        gix::refs::TargetRef::Symbolic(name) => Some(name.as_bstr().to_str_lossy().into_owned()),
        gix::refs::TargetRef::Object(_) => None,
    }
}

fn append_stash_entries(
    repo: &gix::Repository,
    records: &mut Vec<GitRefRecord>,
) -> Result<(), Error> {
    let Some(stash) = repo.try_find_reference("refs/stash").map_err(Error::git)? else {
        return Ok(());
    };
    if !stash.log_exists() {
        return Ok(());
    }
    let mut platform = stash.log_iter();
    let Some(iter) = platform.rev().map_err(Error::git)? else {
        return Ok(());
    };
    for (index, entry) in iter.enumerate() {
        let entry = entry.map_err(Error::git)?;
        records.push(GitRefRecord {
            name: format!("refs/stash@{{{index}}}"),
            target_oid: entry.new_oid.to_string(),
            kind: RefKind::Stash,
            symbolic_target: None,
            upstream: None,
            ahead: None,
            behind: None,
        });
    }
    Ok(())
}

fn classify_ref(name: &str) -> RefKind {
    if name == "refs/stash" || name.starts_with("refs/stash@{") {
        RefKind::Stash
    } else if name.starts_with("refs/heads/") {
        RefKind::LocalBranch
    } else if name.starts_with("refs/remotes/") {
        RefKind::RemoteBranch
    } else if name.starts_with("refs/tags/") {
        RefKind::Tag
    } else {
        RefKind::Other
    }
}

fn collect_remotes(repo: &gix::Repository) -> Result<Vec<GitRemoteRecord>, Error> {
    let mut records = Vec::new();
    for name in repo.remote_names() {
        let name_string = name.to_str_lossy().into_owned();
        let remote = repo.find_remote(name.as_bstr()).map_err(Error::git)?;
        let fetch_urls = remote
            .urls(gix::remote::Direction::Fetch)
            .map(|url| url.to_bstring().to_str_lossy().into_owned())
            .collect();
        let push_urls = remote
            .urls(gix::remote::Direction::Push)
            .map(|url| url.to_bstring().to_str_lossy().into_owned())
            .collect();
        records.push(GitRemoteRecord {
            name: name_string,
            fetch_urls,
            push_urls,
        });
    }
    Ok(records)
}

fn collect_hooks(repo: &gix::Repository) -> Result<Vec<String>, Error> {
    let hooks_dir = repo.common_dir().join("hooks");
    let mut hooks = Vec::new();
    let entries = match fs::read_dir(&hooks_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(hooks),
        Err(source) => {
            return Err(Error::Io {
                path: hooks_dir,
                source,
            });
        }
    };
    for entry in entries {
        let entry = entry.map_err(|source| Error::Io {
            path: hooks_dir.clone(),
            source,
        })?;
        let file_type = entry.file_type().map_err(|source| Error::Io {
            path: entry.path(),
            source,
        })?;
        if !file_type.is_file() && !file_type.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".sample") {
            hooks.push(name);
        }
    }
    hooks.sort();
    Ok(hooks)
}

fn revision_fingerprint(
    head: Option<&str>,
    head_ref: Option<&str>,
    refs: &[GitRefRecord],
    remotes: &[GitRemoteRecord],
    hooks: &[String],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-snapshot-v1\0");
    if let Some(head) = head {
        hasher.update(head.as_bytes());
    }
    hasher.update([0]);
    if let Some(head_ref) = head_ref {
        hasher.update(head_ref.as_bytes());
    }
    hasher.update([0]);
    for reference in refs {
        hasher.update(reference.name.as_bytes());
        hasher.update([0]);
        hasher.update(reference.target_oid.as_bytes());
        hasher.update([0]);
        if let Some(symbolic) = &reference.symbolic_target {
            hasher.update(symbolic.as_bytes());
        }
        hasher.update([0]);
        if let Some(upstream) = &reference.upstream {
            hasher.update(upstream.as_bytes());
        }
        hasher.update([0]);
    }
    for remote in remotes {
        hasher.update(remote.name.as_bytes());
        hasher.update([0]);
        for url in &remote.fetch_urls {
            hasher.update(url.as_bytes());
            hasher.update([0]);
        }
        for url in &remote.push_urls {
            hasher.update(url.as_bytes());
            hasher.update([0]);
        }
    }
    for hook in hooks {
        hasher.update(hook.as_bytes());
        hasher.update([0]);
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ref_classification_is_stable() {
        assert_eq!(classify_ref("refs/heads/main"), RefKind::LocalBranch);
        assert_eq!(
            classify_ref("refs/remotes/origin/main"),
            RefKind::RemoteBranch
        );
        assert_eq!(classify_ref("refs/tags/v1"), RefKind::Tag);
        assert_eq!(classify_ref("refs/stash"), RefKind::Stash);
        assert_eq!(classify_ref("refs/notes/test"), RefKind::Other);
    }
}
