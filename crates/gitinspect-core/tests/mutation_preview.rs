use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use gitinspect_core::{
    MutationPreviewOperation, MutationSandboxManager, OpenOptions, RepositoryHandle,
    RepositoryService,
};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

struct Fixture {
    path: PathBuf,
    handle: RepositoryHandle,
    revision: String,
    base: String,
    main: String,
    linear: Vec<String>,
    merge_range: Vec<String>,
    rename_chain: Vec<String>,
    conflict: String,
}

#[test]
fn rebase_across_merge_commit_fails_closed_with_structured_feedback() {
    let fixture = Fixture::new();
    assert!(fixture.merge_range.len() >= 3);
    let result = preview_one(
        &fixture,
        MutationPreviewOperation::RebaseReorder {
            branch: "main".to_owned(),
            onto_oid: fixture.base.clone(),
            commit_oids: fixture.merge_range.clone(),
        },
    );

    assert!(!result.success);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.failures[0].operation_kind, "rebase-reorder");
    assert_eq!(result.failures[0].code, "invalid-rewrite-range");
    assert!(
        result.failures[0]
            .message
            .contains("merge commits are not supported by the linear rewrite preview")
    );
}

#[test]
fn squash_that_attempts_to_include_root_commit_is_rejected_before_rewrite() {
    let fixture = Fixture::new();
    let mut requested = vec![fixture.base.clone()];
    requested.extend(fixture.linear.clone());
    let result = preview_one(
        &fixture,
        MutationPreviewOperation::Squash {
            branch: "linear".to_owned(),
            onto_oid: fixture.base.clone(),
            commit_oids: requested,
        },
    );

    assert!(!result.success);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.failures[0].operation_kind, "squash");
    assert_eq!(result.failures[0].code, "invalid-rewrite-range");
    assert!(result.failures[0].message.contains(
        "squash/fixup commit list must exactly match the branch range in original order"
    ));
}

#[test]
fn reordering_a_file_rename_dependency_chain_fails_structurally_without_touching_original() {
    let fixture = Fixture::new();
    let requested = vec![
        fixture.rename_chain[0].clone(),
        fixture.rename_chain[2].clone(),
        fixture.rename_chain[1].clone(),
    ];
    let result = preview_one(
        &fixture,
        MutationPreviewOperation::RebaseReorder {
            branch: "rename-chain".to_owned(),
            onto_oid: fixture.base.clone(),
            commit_oids: requested,
        },
    );

    assert!(!result.success);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.failures[0].operation_kind, "rebase-reorder");
    assert!(["conflict", "git"].contains(&result.failures[0].code.as_str()));
    assert!(!result.failures[0].message.is_empty());
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OriginalState {
    head: String,
    refs: String,
    index: Vec<u8>,
    worktree: BTreeMap<String, Vec<u8>>,
}

impl Fixture {
    fn new() -> Self {
        let serial = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/mutation-preview-fixtures");
        fs::create_dir_all(&root).unwrap();
        let path = root.join(format!("fixture-{}-{serial}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        git(&path, ["init", "-b", "main"]);
        git(&path, ["config", "user.name", "Preview Fixture"]);
        git(&path, ["config", "user.email", "preview@example.invalid"]);

        write(&path, "conflict.txt", "base\n");
        let base = commit(&path, "base");
        git(&path, ["tag", "v1", &base]);
        git(&path, ["branch", "delete-me", &base]);
        git(&path, ["branch", "rename-me", &base]);

        git(&path, ["checkout", "-b", "linear", &base]);
        let mut linear = Vec::new();
        for (name, contents) in [("a.txt", "a\n"), ("b.txt", "b\n"), ("c.txt", "c\n")] {
            write(&path, name, contents);
            linear.push(commit(&path, &format!("add {name}")));
        }

        git(&path, ["checkout", "-b", "rename-chain", &base]);
        let mut rename_chain = Vec::new();
        write(&path, "rename-old.txt", "rename chain\n");
        rename_chain.push(commit(&path, "introduce rename dependency"));
        git(&path, ["mv", "rename-old.txt", "rename-mid.txt"]);
        rename_chain.push(commit(&path, "rename old to mid"));
        git(&path, ["mv", "rename-mid.txt", "rename-new.txt"]);
        rename_chain.push(commit(&path, "rename mid to new"));

        git(&path, ["checkout", "-b", "conflict", &base]);
        write(&path, "conflict.txt", "feature\n");
        let conflict = commit(&path, "feature conflict");

        git(&path, ["checkout", "main"]);
        write(&path, "conflict.txt", "main\n");
        let _main_change = commit(&path, "main conflict");
        git(&path, ["checkout", "-b", "merge-side", &base]);
        write(&path, "merge.txt", "side\n");
        let _ = commit(&path, "merge side");
        git(&path, ["checkout", "main"]);
        git(
            &path,
            ["merge", "--no-ff", "merge-side", "-m", "merge side"],
        );
        let main = output(&path, ["rev-parse", "HEAD"]);
        let merge_range = output(
            &path,
            ["rev-list", "--reverse", "main", &format!("^{base}")],
        )
        .lines()
        .map(str::to_owned)
        .collect();

        let (handle, snapshot) = RepositoryService::open(&path, OpenOptions::default()).unwrap();
        Self {
            path,
            handle,
            revision: snapshot.revision,
            base,
            main,
            linear,
            merge_range,
            rename_chain,
            conflict,
        }
    }

    fn original_state(&self) -> OriginalState {
        let head = output(&self.path, ["symbolic-ref", "-q", "HEAD"]);
        let refs = output(&self.path, ["show-ref", "--head"]);
        let index = fs::read(self.path.join(".git/index")).unwrap();
        let mut worktree = BTreeMap::new();
        collect_worktree(&self.path, &self.path, &mut worktree);
        OriginalState {
            head,
            refs,
            index,
            worktree,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn sandbox_manager() -> MutationSandboxManager {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/mutation-preview-sandboxes-tests");
    MutationSandboxManager::new(root).unwrap()
}

fn preview_one(
    fixture: &Fixture,
    operation: MutationPreviewOperation,
) -> gitinspect_core::MutationPreviewResult {
    let manager = sandbox_manager();
    let before = fixture.original_state();
    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    assert!(
        manager
            .root()
            .join(&sandbox.sandbox_id)
            .starts_with(manager.root())
    );
    let result = manager
        .preview(&sandbox.sandbox_id, "tx-preview", &[operation])
        .unwrap();
    assert_eq!(fixture.original_state(), before);
    manager.cleanup(&sandbox.sandbox_id).unwrap();
    assert!(!manager.root().join(&sandbox.sandbox_id).exists());
    assert_eq!(fixture.original_state(), before);
    result
}

#[test]
fn every_supported_operation_runs_only_in_a_disposable_copy() {
    let fixture = Fixture::new();
    let operations = vec![
        MutationPreviewOperation::BranchCreate {
            name: "preview-created".to_owned(),
            target_oid: Some(fixture.base.clone()),
        },
        MutationPreviewOperation::BranchDelete {
            name: "delete-me".to_owned(),
        },
        MutationPreviewOperation::BranchRename {
            old_name: "rename-me".to_owned(),
            new_name: "renamed-in-preview".to_owned(),
        },
        MutationPreviewOperation::TagCreate {
            name: "preview-tag".to_owned(),
            target_oid: Some(fixture.main.clone()),
        },
        MutationPreviewOperation::TagDelete {
            name: "v1".to_owned(),
        },
        MutationPreviewOperation::TagMove {
            name: "v1".to_owned(),
            target_oid: fixture.main.clone(),
        },
        MutationPreviewOperation::CherryPick {
            commit_oid: fixture.linear[0].clone(),
        },
        MutationPreviewOperation::RebaseReorder {
            branch: "linear".to_owned(),
            onto_oid: fixture.base.clone(),
            commit_oids: vec![
                fixture.linear[2].clone(),
                fixture.linear[0].clone(),
                fixture.linear[1].clone(),
            ],
        },
        MutationPreviewOperation::Squash {
            branch: "linear".to_owned(),
            onto_oid: fixture.base.clone(),
            commit_oids: fixture.linear.clone(),
        },
        MutationPreviewOperation::Fixup {
            branch: "linear".to_owned(),
            onto_oid: fixture.base.clone(),
            commit_oids: fixture.linear.clone(),
        },
    ];

    for operation in operations {
        let kind = operation.kind_name();
        let result = preview_one(&fixture, operation);
        assert!(result.success, "{kind} failed: {:?}", result.failures);
        assert!(result.failures.is_empty());
        assert!(result.preview_token.starts_with("preview:"));
        if matches!(kind, "cherry-pick" | "rebase-reorder" | "squash" | "fixup") {
            assert!(!result.rewritten_commits.is_empty());
            assert!(!result.hash_cascade.is_empty());
        }
    }
}

#[test]
fn multi_operation_order_is_stable_and_backend_batch_bound_is_fail_closed() {
    let fixture = Fixture::new();
    let manager = sandbox_manager();
    let before = fixture.original_state();
    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    let operations = vec![
        MutationPreviewOperation::BranchRename {
            old_name: "rename-me".to_owned(),
            new_name: "renamed-first-by-order".to_owned(),
        },
        MutationPreviewOperation::TagMove {
            name: "v1".to_owned(),
            target_oid: fixture.main.clone(),
        },
        MutationPreviewOperation::BranchDelete {
            name: "delete-me".to_owned(),
        },
        MutationPreviewOperation::TagDelete {
            name: "v1".to_owned(),
        },
        MutationPreviewOperation::BranchCreate {
            name: "z-created-fifth".to_owned(),
            target_oid: Some(fixture.base.clone()),
        },
        MutationPreviewOperation::TagCreate {
            name: "a-created-sixth".to_owned(),
            target_oid: Some(fixture.main.clone()),
        },
        MutationPreviewOperation::RebaseReorder {
            branch: "linear".to_owned(),
            onto_oid: fixture.base.clone(),
            commit_oids: vec![
                fixture.linear[2].clone(),
                fixture.linear[0].clone(),
                fixture.linear[1].clone(),
            ],
        },
    ];
    let result = manager
        .preview(&sandbox.sandbox_id, "tx-ordered", &operations)
        .unwrap();
    assert!(
        result.success,
        "mixed ref preview failed: {:?}",
        result.failures
    );
    let kinds = result
        .canonical_operations
        .iter()
        .map(|operation| operation.split('|').next().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        kinds,
        vec![
            "branch-rename",
            "tag-move",
            "branch-delete",
            "tag-delete",
            "branch-create",
            "tag-create",
            "rebase-reorder",
        ]
    );
    let rewrite_order = result
        .rewritten_commits
        .iter()
        .filter(|rewrite| rewrite.operation_index == 6)
        .map(|rewrite| rewrite.old_oid.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        rewrite_order,
        vec![
            fixture.linear[2].as_str(),
            fixture.linear[0].as_str(),
            fixture.linear[1].as_str(),
        ]
    );
    assert_eq!(fixture.original_state(), before);
    manager.cleanup(&sandbox.sandbox_id).unwrap();

    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    let oversized = (0..65)
        .map(|index| MutationPreviewOperation::BranchCreate {
            name: format!("bounded-{index}"),
            target_oid: Some(fixture.base.clone()),
        })
        .collect::<Vec<_>>();
    let error = manager
        .preview(&sandbox.sandbox_id, "tx-over-bound", &oversized)
        .unwrap_err();
    assert!(error.to_string().contains("operation count exceeds 64"));
    assert_eq!(fixture.original_state(), before);
    manager.cleanup(&sandbox.sandbox_id).unwrap();

    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    let oversized_rewrite = (0..65)
        .map(|index| format!("{index:040x}"))
        .collect::<Vec<_>>();
    let error = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-rewrite-over-bound",
            &[MutationPreviewOperation::RebaseReorder {
                branch: "linear".to_owned(),
                onto_oid: fixture.base.clone(),
                commit_oids: oversized_rewrite,
            }],
        )
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("rewrite preview commit count exceeds 64")
    );
    assert_eq!(fixture.original_state(), before);
    manager.cleanup(&sandbox.sandbox_id).unwrap();

    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    let error = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-rewrite-duplicate",
            &[MutationPreviewOperation::Fixup {
                branch: "linear".to_owned(),
                onto_oid: fixture.base.clone(),
                commit_oids: vec!["A".repeat(40), "a".repeat(40)],
            }],
        )
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("commit list contains duplicates")
    );
    assert_eq!(fixture.original_state(), before);
    manager.cleanup(&sandbox.sandbox_id).unwrap();
}

#[test]
fn conflicting_cherry_pick_is_structured_and_original_is_untouched() {
    let fixture = Fixture::new();
    let before = fixture.original_state();
    let result = preview_one(
        &fixture,
        MutationPreviewOperation::CherryPick {
            commit_oid: fixture.conflict.clone(),
        },
    );
    assert!(!result.success);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.failures[0].code, "conflict");
    assert_eq!(result.failures[0].conflicts, vec!["conflict.txt"]);
    assert_eq!(fixture.original_state(), before);
}

#[test]
fn stale_original_is_rejected_between_copy_creation_and_preview() {
    let fixture = Fixture::new();
    let manager = sandbox_manager();
    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();

    write(&fixture.path, "stale.txt", "changed by fixture owner\n");
    let _ = commit(&fixture.path, "advance original intentionally");
    let expected_after_fixture_change = fixture.original_state();

    let error = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-stale",
            &[MutationPreviewOperation::BranchCreate {
                name: "should-not-run".to_owned(),
                target_oid: None,
            }],
        )
        .unwrap_err();
    assert!(error.to_string().contains("stale repository revision"));
    assert_eq!(fixture.original_state(), expected_after_fixture_change);
    manager.cleanup(&sandbox.sandbox_id).unwrap();
}

#[test]
fn validation_confirmation_and_cleanup_fail_closed() {
    let fixture = Fixture::new();
    let manager = sandbox_manager();
    let repository_target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target");
    assert!(
        manager
            .root()
            .starts_with(fs::canonicalize(repository_target).unwrap())
    );
    assert!(manager.cleanup("sandbox-../../outside").is_err());

    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    let invalid = manager.preview(
        &sandbox.sandbox_id,
        "tx-invalid",
        &[MutationPreviewOperation::BranchCreate {
            name: "../escape".to_owned(),
            target_oid: None,
        }],
    );
    assert!(invalid.unwrap_err().to_string().contains("invalid ref"));
    manager.cleanup(&sandbox.sandbox_id).unwrap();

    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    let invalid_target = manager.preview(
        &sandbox.sandbox_id,
        "tx-invalid-target",
        &[MutationPreviewOperation::BranchCreate {
            name: "valid-name".to_owned(),
            target_oid: Some("deadbeef".to_owned()),
        }],
    );
    assert!(
        invalid_target
            .unwrap_err()
            .to_string()
            .contains("object IDs must be full hexadecimal")
    );
    manager.cleanup(&sandbox.sandbox_id).unwrap();

    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    let preview = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-confirm",
            &[MutationPreviewOperation::BranchCreate {
                name: "confirmed-preview".to_owned(),
                target_oid: None,
            }],
        )
        .unwrap();
    assert!(
        manager
            .confirm_preview(&sandbox.sandbox_id, "tx-confirm", "preview:wrong")
            .is_err()
    );
    let confirmation = manager
        .confirm_preview(&sandbox.sandbox_id, "tx-confirm", &preview.preview_token)
        .unwrap();
    assert!(confirmation.token.starts_with("confirm:"));
    assert!(
        manager
            .confirm_preview(&sandbox.sandbox_id, "tx-confirm", &preview.preview_token,)
            .is_err()
    );
    assert!(manager.cleanup(&sandbox.sandbox_id).unwrap());
    assert!(!manager.cleanup(&sandbox.sandbox_id).unwrap());
}

#[test]
fn confirmation_rejects_a_source_revision_change_and_manager_drop_cleans_owned_copy() {
    let fixture = Fixture::new();
    let manager = sandbox_manager();
    let sandbox = manager
        .create_sandbox(&fixture.handle, &fixture.revision)
        .unwrap();
    let sandbox_path = manager.root().join(&sandbox.sandbox_id);
    let preview = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-stale-confirm",
            &[MutationPreviewOperation::BranchCreate {
                name: "preview-only".to_owned(),
                target_oid: None,
            }],
        )
        .unwrap();

    write(&fixture.path, "advance.txt", "advance\n");
    let _ = commit(&fixture.path, "advance before confirmation");
    let error = manager
        .confirm_preview(
            &sandbox.sandbox_id,
            "tx-stale-confirm",
            &preview.preview_token,
        )
        .unwrap_err();
    assert!(error.to_string().contains("stale repository revision"));
    assert!(sandbox_path.exists());
    drop(manager);
    assert!(!sandbox_path.exists());
}

fn write(root: &Path, relative: &str, contents: &str) {
    fs::write(root.join(relative), contents).unwrap();
}

fn commit(root: &Path, message: &str) -> String {
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", message]);
    output(root, ["rev-parse", "HEAD"])
}

fn git<I, S>(root: &Path, args: I)
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let status = Command::new("git")
        .current_dir(root)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Preview Fixture")
        .env("GIT_AUTHOR_EMAIL", "preview@example.invalid")
        .env("GIT_COMMITTER_NAME", "Preview Fixture")
        .env("GIT_COMMITTER_EMAIL", "preview@example.invalid")
        .status()
        .unwrap();
    assert!(status.success());
}

fn output<I, S>(root: &Path, args: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn collect_worktree(root: &Path, current: &Path, output: &mut BTreeMap<String, Vec<u8>>) {
    for entry in fs::read_dir(current).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap();
        if relative
            .components()
            .next()
            .is_some_and(|part| part.as_os_str() == ".git")
        {
            continue;
        }
        let file_type = entry.file_type().unwrap();
        if file_type.is_dir() {
            collect_worktree(root, &path, output);
        } else if file_type.is_file() {
            output.insert(
                relative.to_string_lossy().into_owned(),
                fs::read(path).unwrap(),
            );
        }
    }
}
