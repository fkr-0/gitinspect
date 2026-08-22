use std::ops::ControlFlow;

use gix::bstr::ByteSlice;

use crate::repository::Error;
use crate::{DiffOptions, FileKind, FileStatus, GitCommitFileChange};

pub(crate) fn commit_diff(
    repo: &gix::Repository,
    commit: &gix::Commit<'_>,
    options: &DiffOptions,
) -> Result<(Option<String>, Vec<GitCommitFileChange>, bool), Error> {
    let current_tree = commit.tree().map_err(Error::git)?;
    let parent = commit.parent_ids().next();
    let parent_oid = parent.as_ref().map(ToString::to_string);
    let previous_tree = match parent {
        Some(parent) => repo
            .find_commit(parent)
            .map_err(Error::git)?
            .tree()
            .map_err(Error::git)?,
        None => repo.empty_tree(),
    };

    let mut files = Vec::new();
    let mut truncated = false;
    let mut changes = previous_tree.changes().map_err(Error::git)?;
    // Rename/copy tracking can materialize arbitrary blobs for similarity.
    // Keep it off here; this first slice guarantees bounded blob reads.
    changes.options(|opts| {
        opts.track_rewrites(None);
    });
    changes
        .for_each_to_obtain_tree(&current_tree, |change| {
            if files.len() >= options.max_files {
                // gix reports an early delegate break as a cancellation error.
                // Continue the tree walk but skip all further blob/object work;
                // this keeps the result successful and output/blob memory bounded.
                truncated = true;
                return Ok::<_, Error>(ControlFlow::Continue(()));
            }
            if let Some(file) = file_change(repo, change, options)? {
                files.push(file);
            }
            Ok::<_, Error>(ControlFlow::Continue(()))
        })
        .map_err(Error::git)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok((parent_oid, files, truncated))
}

fn file_change(
    repo: &gix::Repository,
    change: gix::object::tree::diff::Change<'_, '_, '_>,
    options: &DiffOptions,
) -> Result<Option<GitCommitFileChange>, Error> {
    use gix::object::tree::diff::Change;

    let (path, status, old_id, new_id, opaque_entry) = match change {
        Change::Addition {
            location,
            entry_mode,
            id,
            ..
        } => {
            if entry_mode.is_tree() {
                return Ok(None);
            }
            (
                location,
                FileStatus::Added,
                None,
                Some(id),
                !entry_mode.is_blob_or_symlink(),
            )
        }
        Change::Deletion {
            location,
            entry_mode,
            id,
            ..
        } => {
            if entry_mode.is_tree() {
                return Ok(None);
            }
            (
                location,
                FileStatus::Deleted,
                Some(id),
                None,
                !entry_mode.is_blob_or_symlink(),
            )
        }
        Change::Modification {
            location,
            previous_entry_mode,
            previous_id,
            entry_mode,
            id,
        } => {
            if previous_entry_mode.is_tree() && entry_mode.is_tree() {
                return Ok(None);
            }
            (
                location,
                if entry_type_changed(previous_entry_mode, entry_mode) {
                    FileStatus::Typechange
                } else {
                    FileStatus::Modified
                },
                Some(previous_id),
                Some(id),
                !previous_entry_mode.is_blob_or_symlink() || !entry_mode.is_blob_or_symlink(),
            )
        }
        Change::Rewrite {
            source_location: _,
            location,
            source_id,
            id,
            copy,
            source_entry_mode,
            entry_mode,
            ..
        } => (
            location,
            if copy {
                FileStatus::Copied
            } else {
                FileStatus::Renamed
            },
            Some(source_id),
            Some(id),
            !source_entry_mode.is_blob_or_symlink() || !entry_mode.is_blob_or_symlink(),
        ),
    };

    if opaque_entry {
        return Ok(Some(GitCommitFileChange {
            path: path.to_str_lossy().into_owned(),
            kind: FileKind::Binary,
            additions: 0,
            deletions: 0,
            bytes: None,
            status,
        }));
    }

    let old = load_bounded_blob(repo, old_id, options)?;
    let new = load_bounded_blob(repo, new_id, options)?;
    let is_binary = old.as_ref().is_some_and(BoundedBlob::is_binary)
        || new.as_ref().is_some_and(BoundedBlob::is_binary);
    let bytes = new
        .as_ref()
        .map(|blob| blob.size)
        .or_else(|| old.as_ref().map(|blob| blob.size));

    let (additions, deletions) = if is_binary {
        (0, 0)
    } else {
        text_line_stats(
            old.as_ref()
                .and_then(|blob| blob.data.as_deref())
                .unwrap_or_default(),
            new.as_ref()
                .and_then(|blob| blob.data.as_deref())
                .unwrap_or_default(),
        )
    };

    Ok(Some(GitCommitFileChange {
        path: path.to_str_lossy().into_owned(),
        kind: if is_binary {
            FileKind::Binary
        } else {
            FileKind::Text
        },
        additions,
        deletions,
        bytes: is_binary.then_some(bytes.unwrap_or(0)),
        status,
    }))
}

fn entry_type_changed(
    previous: gix::object::tree::EntryMode,
    current: gix::object::tree::EntryMode,
) -> bool {
    if previous.is_blob() && current.is_blob() {
        // Executable-bit changes remain modifications, not Git type changes.
        false
    } else {
        previous.kind() != current.kind()
    }
}

#[derive(Debug)]
struct BoundedBlob {
    size: u64,
    data: Option<Vec<u8>>,
    opaque_large: bool,
    binary_probe_bytes: usize,
}

impl BoundedBlob {
    fn is_binary(&self) -> bool {
        self.opaque_large
            || self
                .data
                .as_deref()
                .unwrap_or_default()
                .iter()
                .take(self.binary_probe_bytes)
                .any(|byte| *byte == 0)
    }
}

fn load_bounded_blob(
    repo: &gix::Repository,
    id: Option<gix::Id<'_>>,
    options: &DiffOptions,
) -> Result<Option<BoundedBlob>, Error> {
    let Some(id) = id else {
        return Ok(None);
    };
    let id = id.detach();
    let header = repo.find_header(id).map_err(Error::git)?;
    let size = header.size();
    if size > options.max_blob_bytes {
        return Ok(Some(BoundedBlob {
            size,
            data: None,
            opaque_large: true,
            binary_probe_bytes: 0,
        }));
    }
    let blob = repo.find_blob(id).map_err(Error::git)?;
    Ok(Some(BoundedBlob {
        size,
        data: Some(blob.data.clone()),
        opaque_large: false,
        binary_probe_bytes: options
            .binary_probe_bytes
            .min(options.max_blob_bytes as usize),
    }))
}

fn text_line_stats(old: &[u8], new: &[u8]) -> (u64, u64) {
    let old = String::from_utf8_lossy(old);
    let new = String::from_utf8_lossy(new);
    let diff = similar::TextDiff::from_lines(&old, &new);
    let mut additions = 0;
    let mut deletions = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Insert => additions += 1,
            similar::ChangeTag::Delete => deletions += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    (additions, deletions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use gix::object::tree::{EntryKind, EntryMode};

    #[test]
    fn executable_bit_change_is_not_a_type_change() {
        let regular = EntryMode::from(EntryKind::Blob);
        let executable = EntryMode::from(EntryKind::BlobExecutable);
        let symlink = EntryMode::from(EntryKind::Link);

        assert!(!entry_type_changed(regular, executable));
        assert!(entry_type_changed(regular, symlink));
    }
}
