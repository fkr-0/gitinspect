mod common;

use std::fs;
use std::time::{Duration, Instant};

use gitinspect_core::{
    ChangeReason, FileKind, FileStatus, OpenOptions, RawWatchEvent, RefKind, RepositoryService,
    SignatureStatus, WatchOptions,
};

use common::FixtureRepo;

#[test]
fn opens_linear_history_and_serializes_contract_shape() {
    let repo = FixtureRepo::new("linear");
    repo.write("hello.txt", "one\n");
    let first = repo.commit_all("first");
    repo.write("hello.txt", "one\ntwo\n");
    let second = repo.commit_all("second");

    let (handle, snapshot) = RepositoryService::open(
        &repo.path,
        OpenOptions {
            include_commit_files: true,
            ..OpenOptions::default()
        },
    )
    .unwrap();
    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.head.as_deref(), Some(second.as_str()));
    assert_eq!(snapshot.head_ref.as_deref(), Some("refs/heads/main"));
    assert_eq!(snapshot.commits.len(), 2);
    assert_eq!(snapshot.commits[0].oid, second);
    assert_eq!(snapshot.commits[1].oid, first);
    assert_eq!(snapshot.commits[0].author_name, "Fixture User");
    assert_eq!(
        snapshot.commits[0].signature_status,
        SignatureStatus::Unsigned
    );
    assert_eq!(snapshot.commits[0].files.len(), 1);
    assert_eq!(snapshot.commits[0].files[0].path, "hello.txt");
    assert_eq!(snapshot.commits[0].files[0].additions, 1);
    assert_eq!(snapshot.commits[0].files[0].deletions, 0);
    assert_eq!(snapshot.commits[0].files[0].kind, FileKind::Text);
    assert_eq!(snapshot.commits[0].files[0].status, FileStatus::Modified);
    assert!(snapshot.revision.starts_with("sha256:"));
    assert_eq!(
        handle.repository_path(),
        fs::canonicalize(&repo.path).unwrap()
    );

    let json = serde_json::to_value(snapshot).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    assert!(json.get("repositoryPath").is_some());
    assert!(json.get("gitDir").is_some());

    let (_, truncated) = RepositoryService::open(
        &repo.path,
        OpenOptions {
            max_commits: 1,
            include_commit_files: false,
            ..OpenOptions::default()
        },
    )
    .unwrap();
    assert!(truncated.truncated);
    assert_eq!(truncated.commits.len(), 1);

    let (_, file_truncated) = RepositoryService::open(
        &repo.path,
        OpenOptions {
            include_commit_files: true,
            diff: gitinspect_core::DiffOptions {
                max_files: 0,
                ..Default::default()
            },
            ..OpenOptions::default()
        },
    )
    .unwrap();
    assert!(file_truncated.truncated);
}

#[test]
fn distinguishes_resolved_head_oid_from_symbolic_head_ref() {
    let repo = FixtureRepo::new("head-semantics");
    repo.write("one.txt", "one\n");
    let oid = repo.commit_all("one");
    let (handle, attached) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    assert_eq!(attached.head.as_deref(), Some(oid.as_str()));
    assert_eq!(attached.head_ref.as_deref(), Some("refs/heads/main"));

    repo.git(["checkout", "--detach", &oid]);
    let detached = handle.refresh(OpenOptions::default()).unwrap();
    assert_eq!(detached.head.as_deref(), Some(oid.as_str()));
    assert_eq!(detached.head_ref, None);
    assert_ne!(attached.revision, detached.revision);
}

#[test]
fn preserves_symbolic_head_for_an_unborn_branch() {
    let repo = FixtureRepo::new("unborn-head");

    let (_, snapshot) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    assert_eq!(snapshot.head, None);
    assert_eq!(snapshot.head_ref.as_deref(), Some("refs/heads/main"));
    assert!(snapshot.commits.is_empty());
}

#[test]
fn handle_watch_coalesces_a_deterministic_event_source() {
    let repo = FixtureRepo::new("watch");
    repo.write("one.txt", "one\n");
    repo.commit_all("one");
    let (handle, _) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let start = Instant::now();
    let receiver = handle.watch(
        vec![
            RawWatchEvent {
                at: start,
                reason: ChangeReason::Refs,
            },
            RawWatchEvent {
                at: start + Duration::from_millis(10),
                reason: ChangeReason::Head,
            },
            RawWatchEvent {
                at: start + Duration::from_millis(100),
                reason: ChangeReason::Objects,
            },
        ],
        WatchOptions { debounce_ms: 50 },
    );

    let changes: Vec<_> = receiver.into_iter().collect();
    assert_eq!(changes.len(), 2);
    assert_eq!(
        changes[0].reasons,
        vec![ChangeReason::Head, ChangeReason::Refs]
    );
    assert_eq!(changes[1].reasons, vec![ChangeReason::Objects]);
}

#[test]
fn native_watch_reports_fixture_repository_changes() {
    let repo = FixtureRepo::new("native-watch");
    repo.write("one.txt", "one\n");
    repo.commit_all("one");
    let (handle, _) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let watcher = handle
        .watch_native(WatchOptions { debounce_ms: 40 })
        .expect("native watcher starts");

    repo.git(["branch", "watched-branch"]);
    let change = watcher
        .recv_timeout(Duration::from_secs(3))
        .expect("filesystem watcher reports the ref change");
    assert!(
        change.reasons.contains(&ChangeReason::Refs)
            || change.reasons.contains(&ChangeReason::Unknown),
        "unexpected reasons: {:?}",
        change.reasons
    );
}

#[test]
fn enumerates_divergence_merge_tags_remote_stash_and_packed_refs() {
    let repo = FixtureRepo::new("refs");
    repo.write("base.txt", "base\n");
    let base = repo.commit_all("base");
    repo.git(["branch", "feature"]);
    repo.write("main.txt", "main\n");
    repo.commit_all("main change");
    repo.git(["checkout", "feature"]);
    repo.write("feature.txt", "feature\n");
    repo.commit_all("feature change");
    repo.git(["checkout", "main"]);
    repo.git(["merge", "--no-ff", "feature", "-m", "merge feature"]);
    repo.git(["branch", "side", &base]);
    repo.git(["checkout", "side"]);
    repo.write("side.txt", "side\n");
    let side_oid = repo.commit_all("side only");
    repo.git(["checkout", "main"]);
    repo.git(["tag", "lightweight", &base]);
    repo.git(["tag", "-a", "annotated", "-m", "annotated tag"]);
    repo.git([
        "remote",
        "add",
        "origin",
        "https://example.invalid/repo.git",
    ]);
    repo.git([
        "remote",
        "set-url",
        "--add",
        "origin",
        "https://mirror.example.invalid/repo.git",
    ]);
    repo.git([
        "config",
        "remote.origin.pushurl",
        "ssh://example.invalid/repo.git",
    ]);
    repo.git(["config", "branch.main.remote", "origin"]);
    repo.git(["config", "branch.main.merge", "refs/heads/main"]);
    repo.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    repo.git(["symbolic-ref", "refs/heads/alias", "refs/heads/main"]);
    repo.write("stash.txt", "stashed\n");
    repo.git(["stash", "push", "-u", "-m", "fixture stash"]);
    repo.write(".git/hooks/pre-commit", "#!/bin/sh\nexit 0\n");
    repo.git(["pack-refs", "--all"]);
    repo.git(["gc", "--prune=now"]);

    let (_, snapshot) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    assert!(
        snapshot
            .commits
            .iter()
            .any(|commit| commit.parents.len() == 2)
    );
    assert!(snapshot.commits.iter().any(|commit| commit.oid == side_oid));
    assert!(snapshot.refs.iter().any(|reference| {
        reference.name == "refs/heads/feature" && reference.kind == RefKind::LocalBranch
    }));
    assert!(snapshot.refs.iter().any(|reference| {
        reference.name == "refs/tags/lightweight" && reference.kind == RefKind::Tag
    }));
    assert!(snapshot.refs.iter().any(|reference| {
        reference.name == "refs/tags/annotated" && reference.kind == RefKind::Tag
    }));
    assert!(
        snapshot
            .refs
            .iter()
            .any(|reference| reference.name == "refs/stash")
    );
    assert!(
        snapshot
            .refs
            .iter()
            .any(|reference| reference.name == "refs/stash@{0}")
    );
    assert_eq!(snapshot.remotes.len(), 1);
    assert_eq!(snapshot.remotes[0].name, "origin");
    assert_eq!(
        snapshot.remotes[0].fetch_urls,
        [
            "https://example.invalid/repo.git",
            "https://mirror.example.invalid/repo.git"
        ]
    );
    assert_eq!(
        snapshot.remotes[0].push_urls,
        ["ssh://example.invalid/repo.git"]
    );
    assert!(snapshot.refs.iter().any(|reference| {
        reference.name == "refs/heads/main"
            && reference.upstream.as_deref() == Some("refs/remotes/origin/main")
    }));
    assert!(snapshot.refs.iter().any(|reference| {
        reference.name == "refs/heads/alias"
            && reference.symbolic_target.as_deref() == Some("refs/heads/main")
    }));
    assert_eq!(snapshot.hooks, ["pre-commit"]);
}

#[test]
fn opens_dot_git_linked_worktree_and_bare_repository_paths() {
    let repo = FixtureRepo::new("topology");
    repo.write("base.txt", "base\n");
    repo.commit_all("base");

    let (_, from_dot_git) =
        RepositoryService::open(repo.path.join(".git"), OpenOptions::default()).unwrap();
    assert_eq!(
        from_dot_git.repository_path,
        fs::canonicalize(&repo.path).unwrap().to_string_lossy()
    );

    let linked = repo.path.parent().unwrap().join(format!(
        "{}-linked",
        repo.path.file_name().unwrap().to_string_lossy()
    ));
    repo.git(["worktree", "add", linked.to_str().unwrap(), "-b", "linked"]);
    let (linked_handle, linked_snapshot) =
        RepositoryService::open(&linked, OpenOptions::default()).unwrap();
    assert_eq!(
        linked_snapshot.repository_path,
        fs::canonicalize(&linked).unwrap().to_string_lossy()
    );
    assert_eq!(
        linked_handle
            .refresh(OpenOptions::default())
            .unwrap()
            .repository_path,
        linked_snapshot.repository_path
    );
    let (_, linked_gitfile_snapshot) =
        RepositoryService::open(linked.join(".git"), OpenOptions::default()).unwrap();
    assert_eq!(
        linked_gitfile_snapshot.repository_path,
        linked_snapshot.repository_path
    );
    fs::remove_dir_all(&linked).unwrap();
    repo.git(["worktree", "prune"]);

    let bare = repo.path.parent().unwrap().join(format!(
        "{}-bare.git",
        repo.path.file_name().unwrap().to_string_lossy()
    ));
    let status = std::process::Command::new("git")
        .args([
            "clone",
            "--bare",
            repo.path.to_str().unwrap(),
            bare.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    assert!(status.success());
    let (_, bare_snapshot) = RepositoryService::open(&bare, OpenOptions::default()).unwrap();
    assert_eq!(
        bare_snapshot.repository_path,
        fs::canonicalize(&bare).unwrap().to_string_lossy()
    );
    assert_eq!(
        bare_snapshot.git_dir,
        fs::canonicalize(&bare).unwrap().to_string_lossy()
    );
    fs::remove_dir_all(bare).unwrap();
}

#[test]
fn commit_diff_is_lazy_and_large_binary_content_is_not_materialized() {
    let repo = FixtureRepo::new("diff");
    repo.write("data.bin", vec![0_u8; 4096]);
    let oid = repo.commit_all("binary");

    let (handle, _) = RepositoryService::open(
        &repo.path,
        OpenOptions {
            include_commit_files: false,
            ..OpenOptions::default()
        },
    )
    .unwrap();
    let diff = handle
        .commit_diff(
            &oid,
            gitinspect_core::DiffOptions {
                max_blob_bytes: 64,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(diff.files.len(), 1);
    assert_eq!(diff.files[0].kind, FileKind::Binary);
    assert_eq!(diff.files[0].bytes, Some(4096));
}

#[test]
fn snapshot_revision_is_stable_and_changes_when_refs_move() {
    let repo = FixtureRepo::new("revision");
    repo.write("one.txt", "one\n");
    repo.commit_all("one");
    let (handle, first) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let second = handle.refresh(OpenOptions::default()).unwrap();
    assert_eq!(first.revision, second.revision);
    assert_eq!(first.commits, second.commits);
    assert!(first.commits.iter().all(|commit| commit.files.is_empty()));

    repo.write("two.txt", "two\n");
    repo.commit_all("two");
    let third = handle.refresh(OpenOptions::default()).unwrap();
    assert_ne!(first.revision, third.revision);
}

#[test]
fn opens_gitinspect_itself_without_mutation() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let (_, snapshot) = RepositoryService::open(
        &root,
        OpenOptions {
            max_commits: 16,
            include_commit_files: false,
            ..OpenOptions::default()
        },
    )
    .unwrap();
    assert!(!snapshot.commits.is_empty());
    assert_eq!(
        snapshot.repository_path,
        fs::canonicalize(root).unwrap().to_string_lossy()
    );
}
