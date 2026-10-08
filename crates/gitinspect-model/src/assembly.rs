//! Pure, bounded commit projection over caller-verified, inflated Git objects.
//! This module deliberately has no filesystem or repository authority.
use gix_object::bstr::ByteSlice;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::{
    GitCommitRecord, GitRefRecord, MAX_IMPORT_OBJECTS, ObjectSource, RefKind, RefSource,
    SignatureStatus, SourceError,
};

/// A read-only graph assembled from inflated commit bodies and direct refs.
/// Missing objects are errors, not silently substituted graph records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssembledGraph {
    pub commits: Vec<GitCommitRecord>,
    pub refs: Vec<GitRefRecord>,
    pub truncated: bool,
}

/// Assemble the native-compatible snapshot envelope without filesystem authority.
/// Paths are caller-supplied display labels, never permissions or source handles.
/// HEAD must be supplied explicitly: it cannot be inferred from refs sharing an OID.
pub fn assemble_snapshot<S: ObjectSource + RefSource>(
    source: &S,
    max_commits: usize,
    head: Option<&str>,
    head_ref: Option<&str>,
    repository_path: &str,
    git_dir: &str,
) -> Result<crate::GitRepositorySnapshot, SourceError> {
    if let Some(oid) = head {
        crate::validate_oid(oid)?;
    }
    if let Some(name) = head_ref
        && (!name.starts_with("refs/") || name.contains("..") || name.contains(['\0', '\n', '\r']))
    {
        return Err(SourceError::InvalidIdentifier);
    }
    let graph = assemble_graph(source, max_commits)?;
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-snapshot-v1\0");
    if let Some(oid) = head {
        hasher.update(oid.as_bytes());
    }
    hasher.update([0]);
    if let Some(name) = head_ref {
        hasher.update(name.as_bytes());
    }
    hasher.update([0]);
    for reference in &graph.refs {
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
    Ok(crate::GitRepositorySnapshot {
        schema_version: 1,
        repository_path: repository_path.to_owned(),
        git_dir: git_dir.to_owned(),
        head: head.map(str::to_owned),
        head_ref: head_ref.map(str::to_owned),
        revision: format!("sha256:{:x}", hasher.finalize()),
        commits: graph.commits,
        refs: graph.refs,
        remotes: Vec::new(),
        hooks: Vec::new(),
        truncated: graph.truncated,
    })
}

/// Traverse commit parents without allocating more than `max_commits` records.
/// The caller supplies inflated object bodies; loose/pack decompression is a separate layer.
pub fn assemble_graph<S: ObjectSource + RefSource>(
    source: &S,
    max_commits: usize,
) -> Result<AssembledGraph, SourceError> {
    let mut by_name = BTreeMap::new();
    if let Some(packed) = source.read_packed_refs()? {
        if packed.len() > crate::MAX_IMPORT_BYTES {
            return Err(SourceError::LimitExceeded);
        }
        let mut previous = None;
        for line in packed.split(|byte| *byte == b'\n') {
            if line.is_empty() || line[0] == b'#' {
                continue;
            }
            if line[0] == b'^' {
                // The peeled hint is deliberately ignored: resolve and validate the tag
                // object itself so stale or malicious hints cannot alter the graph.
                if previous.is_none() || line.len() != 41 {
                    return Err(SourceError::InvalidIdentifier);
                }
                continue;
            }
            let text = std::str::from_utf8(line).map_err(|_| SourceError::InvalidIdentifier)?;
            let (oid, name) = text.split_once(' ').ok_or(SourceError::InvalidIdentifier)?;
            crate::validate_oid(oid)?;
            if !name.starts_with("refs/") || name.contains("..") || name.contains(['\0', '\r', ' '])
            {
                return Err(SourceError::InvalidIdentifier);
            }
            by_name.insert(name.to_owned(), oid.to_owned());
            previous = Some(name);
            if by_name.len() > crate::MAX_SOURCE_REFS {
                return Err(SourceError::LimitExceeded);
            }
        }
    }
    // Loose refs override packed refs, as in Git.
    let loose = source.list_refs()?;
    for reference in loose {
        by_name.insert(reference.name, reference.target);
    }
    let mut refs: Vec<_> = by_name
        .into_iter()
        .map(|(name, target)| crate::SourceRef { name, target })
        .collect();
    if refs.len() > crate::MAX_SOURCE_REFS {
        return Err(SourceError::LimitExceeded);
    }
    refs.sort_by(|a, b| a.name.cmp(&b.name));
    let mut records = Vec::with_capacity(refs.len());
    let mut queue = VecDeque::new();
    for reference in refs {
        crate::validate_oid(&reference.target)?;
        if !reference.name.starts_with("refs/")
            || reference.name.contains("..")
            || reference.name.contains(['\0', '\n'])
        {
            return Err(SourceError::InvalidIdentifier);
        }
        let kind = if reference.name.starts_with("refs/heads/") {
            RefKind::LocalBranch
        } else if reference.name.starts_with("refs/remotes/") {
            RefKind::RemoteBranch
        } else if reference.name.starts_with("refs/tags/") {
            RefKind::Tag
        } else if reference.name == "refs/stash" {
            RefKind::Stash
        } else {
            RefKind::Other
        };
        let mut peeled = reference.target.clone();
        let mut visited = BTreeSet::new();
        if kind == RefKind::Tag {
            for _ in 0..32 {
                if !visited.insert(peeled.clone()) {
                    return Err(SourceError::Rejected("tag cycle".into()));
                }
                let Some(body) = source.read_loose_object(&peeled)? else {
                    break;
                };
                if !body.starts_with(b"object ") {
                    break;
                }
                let header = std::str::from_utf8(
                    &body[..body
                        .iter()
                        .position(|b| *b == b'\n')
                        .ok_or(SourceError::InvalidIdentifier)?],
                )
                .map_err(|_| SourceError::InvalidIdentifier)?;
                let target = header
                    .strip_prefix("object ")
                    .ok_or(SourceError::InvalidIdentifier)?;
                crate::validate_oid(target)?;
                if !body
                    .split(|b| *b == b'\n')
                    .any(|line| line == b"type commit" || line == b"type tag")
                {
                    return Err(SourceError::Rejected(
                        "unsupported annotated tag target".into(),
                    ));
                }
                peeled = target.to_owned();
            }
            if visited.len() == 32 {
                return Err(SourceError::LimitExceeded);
            }
        }
        queue.push_back(peeled.clone());
        records.push(GitRefRecord {
            name: reference.name,
            target_oid: peeled,
            kind,
            symbolic_target: None,
            upstream: None,
            ahead: None,
            behind: None,
        });
    }
    let bound = max_commits.min(MAX_IMPORT_OBJECTS);
    let mut seen = BTreeSet::new();
    let mut commits = Vec::new();
    let mut truncated = false;
    while let Some(oid) = queue.pop_front() {
        if !seen.insert(oid.clone()) {
            continue;
        }
        if commits.len() >= bound {
            truncated = true;
            break;
        }
        let body = source
            .read_loose_object(&oid)?
            .ok_or(SourceError::NotFound)?;
        if body.len() > crate::MAX_LOOSE_OBJECT_BYTES {
            return Err(SourceError::LimitExceeded);
        }
        let commit = gix_object::CommitRef::from_bytes(&body, gix_hash::Kind::Sha1)
            .map_err(|e| SourceError::Rejected(format!("invalid commit {oid}: {e}")))?;
        let author = commit
            .author()
            .map_err(|e| SourceError::Rejected(format!("invalid author: {e}")))?;
        let committer = commit
            .committer()
            .map_err(|e| SourceError::Rejected(format!("invalid committer: {e}")))?;
        let authored_at_ms = author
            .time()
            .map_err(|e| SourceError::Rejected(format!("invalid author time: {e}")))?
            .seconds
            .saturating_mul(1000);
        let committed_at_ms = committer
            .time()
            .map_err(|e| SourceError::Rejected(format!("invalid committer time: {e}")))?
            .seconds
            .saturating_mul(1000);
        let parents: Vec<_> = commit.parents().map(|id| id.to_string()).collect();
        if queue.len().saturating_add(parents.len()) > MAX_IMPORT_OBJECTS {
            return Err(SourceError::LimitExceeded);
        }
        queue.extend(parents.iter().cloned());
        commits.push(GitCommitRecord {
            oid,
            tree_oid: commit.tree().to_string(),
            parents,
            author_name: String::from_utf8_lossy(author.name.as_ref()).into_owned(),
            author_email: (!author.email.is_empty())
                .then(|| String::from_utf8_lossy(author.email.as_ref()).into_owned()),
            authored_at_ms,
            committed_at_ms,
            message: String::from_utf8_lossy(commit.message.as_ref()).into_owned(),
            signature_status: if commit
                .extra_headers
                .iter()
                .any(|(k, _)| k.as_bytes() == b"gpgsig")
            {
                SignatureStatus::Unknown
            } else {
                SignatureStatus::Unsigned
            },
            files: Vec::new(),
        });
    }
    Ok(AssembledGraph {
        commits,
        refs: records,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{InMemorySource, SourceRef};

    const ROOT: &str = "0123456789abcdef0123456789abcdef01234567";
    const CHILD: &str = "fedcba9876543210fedcba9876543210fedcba98";

    fn commit(parent: Option<&str>) -> Vec<u8> {
        let mut body = format!("tree {ROOT}\n");
        if let Some(parent) = parent {
            body.push_str(&format!("parent {parent}\n"));
        }
        body.push_str("author Ada <ada@example.org> 100 +0000\ncommitter Bob <bob@example.org> 200 +0000\n\nA test commit\n");
        body.into_bytes()
    }

    #[test]
    fn assembles_parent_edges_and_metadata_without_filesystem() {
        let source = InMemorySource::new(
            [
                (ROOT.into(), commit(None)),
                (CHILD.into(), commit(Some(ROOT))),
            ],
            vec![SourceRef {
                name: "refs/heads/main".into(),
                target: CHILD.into(),
            }],
        )
        .unwrap();
        let graph = assemble_graph(&source, 10).unwrap();
        assert_eq!(graph.commits.len(), 2);
        assert_eq!(graph.commits[0].oid, CHILD);
        assert_eq!(graph.commits[0].parents, [ROOT]);
        assert_eq!(graph.commits[0].author_name, "Ada");
        assert_eq!(graph.commits[0].committed_at_ms, 200_000);
        assert_eq!(graph.refs[0].kind, RefKind::LocalBranch);
        assert!(!graph.truncated);
        let bounded = assemble_graph(&source, 1).unwrap();
        assert_eq!(bounded.commits.len(), 1);
        assert!(bounded.truncated);
    }

    struct PackedFixture {
        memory: InMemorySource,
        packed: Vec<u8>,
    }
    impl ObjectSource for PackedFixture {
        fn read_loose_object(&self, oid: &str) -> Result<Option<Vec<u8>>, SourceError> {
            self.memory.read_loose_object(oid)
        }
        fn read_pack_range(
            &self,
            id: &str,
            offset: u64,
            len: usize,
        ) -> Result<Vec<u8>, SourceError> {
            self.memory.read_pack_range(id, offset, len)
        }
        fn read_index(&self, id: &str) -> Result<Vec<u8>, SourceError> {
            self.memory.read_index(id)
        }
    }
    impl RefSource for PackedFixture {
        fn list_refs(&self) -> Result<Vec<SourceRef>, SourceError> {
            self.memory.list_refs()
        }
        fn read_packed_refs(&self) -> Result<Option<Vec<u8>>, SourceError> {
            Ok(Some(self.packed.clone()))
        }
    }

    #[test]
    fn peels_annotated_tags_and_merges_packed_refs_with_loose_precedence() {
        const TAG: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let tag = format!(
            "object {CHILD}\ntype commit\ntag v1\ntagger Ada <ada@example.org> 200 +0000\n\nRelease\n"
        );
        let source = PackedFixture {
            memory: InMemorySource::new(
                [
                    (ROOT.into(), commit(None)),
                    (CHILD.into(), commit(Some(ROOT))),
                    (TAG.into(), tag.into_bytes()),
                ],
                vec![SourceRef {
                    name: "refs/heads/main".into(),
                    target: CHILD.into(),
                }],
            )
            .unwrap(),
            packed: format!(
                "# pack-refs with: peeled\n{ROOT} refs/heads/main\n{TAG} refs/tags/v1\n^{CHILD}\n"
            )
            .into_bytes(),
        };
        let graph = assemble_graph(&source, 10).unwrap();
        assert_eq!(graph.refs.len(), 2);
        assert_eq!(graph.refs[0].target_oid, CHILD);
        assert_eq!(graph.refs[1].target_oid, CHILD);
        assert_eq!(graph.commits.len(), 2);
    }

    #[test]
    fn rejects_malformed_packed_ref_lines() {
        let source = PackedFixture {
            memory: InMemorySource::default(),
            packed: b"^0123456789abcdef0123456789abcdef01234567\n".to_vec(),
        };
        assert_eq!(
            assemble_graph(&source, 10).unwrap_err(),
            SourceError::InvalidIdentifier
        );
    }
}
