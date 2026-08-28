use std::ops::ControlFlow;

use gix::bstr::ByteSlice;
use similar::ChangeTag;

use crate::repository::Error;
use crate::{
    CommitFileDetail, DiffOptions, FileContentStatus, FileDetailOptions, FileKind, FileStatus,
    GitCommitFileChange, PatchHunk, PatchLine, PatchLineKind,
};

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
    let Some(parts) = change_parts(change) else {
        return Ok(None);
    };

    if parts.opaque_entry {
        return Ok(Some(GitCommitFileChange {
            path: parts.path,
            kind: FileKind::Binary,
            additions: 0,
            deletions: 0,
            bytes: None,
            status: parts.status,
        }));
    }

    let old = load_bounded_blob(
        repo,
        parts.old_id,
        options.max_blob_bytes,
        options.binary_probe_bytes,
    )?;
    let new = load_bounded_blob(
        repo,
        parts.new_id,
        options.max_blob_bytes,
        options.binary_probe_bytes,
    )?;
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
        path: parts.path,
        kind: if is_binary {
            FileKind::Binary
        } else {
            FileKind::Text
        },
        additions,
        deletions,
        bytes: is_binary.then_some(bytes.unwrap_or(0)),
        status: parts.status,
    }))
}

#[derive(Debug)]
struct ChangeParts {
    path: String,
    status: FileStatus,
    old_id: Option<gix::ObjectId>,
    new_id: Option<gix::ObjectId>,
    opaque_entry: bool,
}

fn change_parts(change: gix::object::tree::diff::Change<'_, '_, '_>) -> Option<ChangeParts> {
    use gix::object::tree::diff::Change;

    let (path, status, old_id, new_id, opaque_entry) = match change {
        Change::Addition {
            location,
            entry_mode,
            id,
            ..
        } => {
            if entry_mode.is_tree() {
                return None;
            }
            (
                location,
                FileStatus::Added,
                None,
                Some(id.detach()),
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
                return None;
            }
            (
                location,
                FileStatus::Deleted,
                Some(id.detach()),
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
                return None;
            }
            (
                location,
                if entry_type_changed(previous_entry_mode, entry_mode) {
                    FileStatus::Typechange
                } else {
                    FileStatus::Modified
                },
                Some(previous_id.detach()),
                Some(id.detach()),
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
            Some(source_id.detach()),
            Some(id.detach()),
            !source_entry_mode.is_blob_or_symlink() || !entry_mode.is_blob_or_symlink(),
        ),
    };
    Some(ChangeParts {
        path: path.to_str_lossy().into_owned(),
        status,
        old_id,
        new_id,
        opaque_entry,
    })
}

pub(crate) fn commit_file_detail(
    repo: &gix::Repository,
    commit: &gix::Commit<'_>,
    path: &str,
    options: &FileDetailOptions,
) -> Result<CommitFileDetail, Error> {
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
    let mut detail = None;
    let mut changes = previous_tree.changes().map_err(Error::git)?;
    changes.options(|opts| {
        opts.track_rewrites(None);
    });
    changes
        .for_each_to_obtain_tree(&current_tree, |change| {
            if detail.is_some() {
                return Ok::<_, Error>(ControlFlow::Continue(()));
            }
            let Some(parts) = change_parts(change) else {
                return Ok(ControlFlow::Continue(()));
            };
            if parts.path != path {
                return Ok(ControlFlow::Continue(()));
            }
            detail = Some(file_detail_from_parts(
                repo,
                commit.id.to_string(),
                parent_oid.clone(),
                parts,
                options,
            )?);
            Ok(ControlFlow::Continue(()))
        })
        .map_err(Error::git)?;

    detail.ok_or_else(|| Error::ChangedPathNotFound {
        oid: commit.id.to_string(),
        path: path.to_owned(),
    })
}

fn file_detail_from_parts(
    repo: &gix::Repository,
    oid: String,
    parent_oid: Option<String>,
    parts: ChangeParts,
    options: &FileDetailOptions,
) -> Result<CommitFileDetail, Error> {
    let old_oid = parts.old_id.as_ref().map(ToString::to_string);
    let new_oid = parts.new_id.as_ref().map(ToString::to_string);
    if parts.opaque_entry {
        return Ok(CommitFileDetail {
            oid,
            parent_oid,
            path: parts.path,
            status: parts.status,
            kind: FileKind::Binary,
            old_oid,
            new_oid,
            old_bytes: None,
            new_bytes: None,
            content_status: FileContentStatus::Opaque,
            hunks: Vec::new(),
            truncated: false,
        });
    }

    let binary_probe_bytes = (8 * 1024).min(options.max_blob_bytes as usize);
    let old = load_bounded_blob(
        repo,
        parts.old_id,
        options.max_blob_bytes,
        binary_probe_bytes,
    )?;
    let new = load_bounded_blob(
        repo,
        parts.new_id,
        options.max_blob_bytes,
        binary_probe_bytes,
    )?;
    let old_bytes = old.as_ref().map(|blob| blob.size);
    let new_bytes = new.as_ref().map(|blob| blob.size);
    let too_large = old.as_ref().is_some_and(|blob| blob.opaque_large)
        || new.as_ref().is_some_and(|blob| blob.opaque_large);
    let is_binary = !too_large
        && (old.as_ref().is_some_and(BoundedBlob::is_binary)
            || new.as_ref().is_some_and(BoundedBlob::is_binary));
    let content_status = if too_large {
        FileContentStatus::TooLarge
    } else if is_binary {
        FileContentStatus::Binary
    } else {
        FileContentStatus::Text
    };
    let (hunks, patch_truncated) = if content_status == FileContentStatus::Text {
        patch_hunks(
            old.as_ref()
                .and_then(|blob| blob.data.as_deref())
                .unwrap_or_default(),
            new.as_ref()
                .and_then(|blob| blob.data.as_deref())
                .unwrap_or_default(),
            options,
        )
    } else {
        (Vec::new(), false)
    };

    Ok(CommitFileDetail {
        oid,
        parent_oid,
        path: parts.path,
        status: parts.status,
        kind: if content_status == FileContentStatus::Text {
            FileKind::Text
        } else {
            FileKind::Binary
        },
        old_oid,
        new_oid,
        old_bytes,
        new_bytes,
        content_status,
        hunks,
        truncated: too_large || patch_truncated,
    })
}

fn patch_hunks(old: &[u8], new: &[u8], options: &FileDetailOptions) -> (Vec<PatchHunk>, bool) {
    let old = String::from_utf8_lossy(old);
    let new = String::from_utf8_lossy(new);
    let diff = similar::TextDiff::from_lines(&old, &new);
    let groups = diff.grouped_ops(options.context_lines);
    let mut hunks = Vec::new();
    let mut rendered_lines = 0usize;
    let mut truncated = false;

    'groups: for group in groups {
        let Some(first) = group.first() else {
            continue;
        };
        let Some(last) = group.last() else {
            continue;
        };
        let old_start = first.old_range().start;
        let new_start = first.new_range().start;
        let old_end = last.old_range().end;
        let new_end = last.new_range().end;
        let mut lines = Vec::new();
        for op in &group {
            for change in diff.iter_changes(op) {
                if rendered_lines >= options.max_patch_lines {
                    truncated = true;
                    if !lines.is_empty() {
                        hunks.push(PatchHunk {
                            old_start: (old_start + 1) as u64,
                            old_lines: (old_end - old_start) as u64,
                            new_start: (new_start + 1) as u64,
                            new_lines: (new_end - new_start) as u64,
                            lines,
                        });
                    }
                    break 'groups;
                }
                rendered_lines += 1;
                lines.push(PatchLine {
                    kind: match change.tag() {
                        ChangeTag::Equal => PatchLineKind::Context,
                        ChangeTag::Insert => PatchLineKind::Addition,
                        ChangeTag::Delete => PatchLineKind::Deletion,
                    },
                    old_line: change.old_index().map(|line| (line + 1) as u64),
                    new_line: change.new_index().map(|line| (line + 1) as u64),
                    content: change.to_string_lossy().into_owned(),
                });
            }
        }
        hunks.push(PatchHunk {
            old_start: (old_start + 1) as u64,
            old_lines: (old_end - old_start) as u64,
            new_start: (new_start + 1) as u64,
            new_lines: (new_end - new_start) as u64,
            lines,
        });
    }
    (hunks, truncated)
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
    id: Option<gix::ObjectId>,
    max_blob_bytes: u64,
    binary_probe_bytes: usize,
) -> Result<Option<BoundedBlob>, Error> {
    let Some(id) = id else {
        return Ok(None);
    };
    let header = repo.find_header(id).map_err(Error::git)?;
    let size = header.size();
    if size > max_blob_bytes {
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
        binary_probe_bytes: binary_probe_bytes.min(max_blob_bytes as usize),
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
