mod common;

use std::fs;
use std::path::PathBuf;

use gitinspect_core::{
    MutationApplyUnresolvedBoundary, MutationPreflightFailureCode, MutationPreflightReceipt,
    MutationPreflightSnapshot, MutationPreviewOperation, MutationSandboxManager, OpenOptions,
    RepositoryService,
};

use common::FixtureRepo;

fn committed_fixture(name: &str) -> FixtureRepo {
    let repo = FixtureRepo::new(name);
    repo.write("tracked.txt", "base\n");
    repo.commit_all("base");
    repo
}

fn sandbox_manager(name: &str) -> MutationSandboxManager {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/mutation-preflight-sandboxes")
        .join(name);
    MutationSandboxManager::new(root).unwrap()
}

#[test]
fn stronger_capture_detects_worktree_and_index_state_omitted_by_structural_revision() {
    let repo = committed_fixture("preflight-index-worktree");
    let (handle, graph) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let clean = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert!(clean.index_clean);
    assert!(clean.worktree_clean);
    assert_eq!(clean.structural_revision, graph.revision);

    repo.write("tracked.txt", "dirty bytes\n");
    let dirty_worktree = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_eq!(
        dirty_worktree.structural_revision,
        clean.structural_revision
    );
    assert_eq!(dirty_worktree.index_fingerprint, clean.index_fingerprint);
    assert!(!dirty_worktree.worktree_clean);
    assert!(
        dirty_worktree
            .dirty_paths
            .contains(&"tracked.txt".to_owned())
    );
    assert_ne!(dirty_worktree.state_digest, clean.state_digest);

    repo.write("second-untracked.txt", "also dirty\n");
    let differently_dirty = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert!(!differently_dirty.worktree_clean);
    assert_eq!(
        differently_dirty.index_fingerprint,
        dirty_worktree.index_fingerprint
    );
    assert_ne!(differently_dirty.dirty_paths, dirty_worktree.dirty_paths);
    assert_ne!(differently_dirty.state_digest, dirty_worktree.state_digest);
    fs::remove_file(repo.path.join("second-untracked.txt")).unwrap();

    repo.git(["add", "tracked.txt"]);
    let dirty_index = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_eq!(dirty_index.structural_revision, clean.structural_revision);
    assert!(!dirty_index.index_clean);
    assert!(dirty_index.worktree_clean);
    assert_ne!(dirty_index.index_fingerprint, clean.index_fingerprint);
    assert_ne!(dirty_index.state_digest, clean.state_digest);

    repo.write("tracked.txt", "base\n");
    repo.git(["add", "tracked.txt"]);
    let restored = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert!(restored.index_clean);
    assert!(restored.worktree_clean);

    repo.write("untracked.txt", "new\n");
    let untracked = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_eq!(untracked.structural_revision, restored.structural_revision);
    assert!(!untracked.worktree_clean);
    assert!(untracked.dirty_paths.contains(&"untracked.txt".to_owned()));
}

#[test]
fn config_and_hook_bytes_have_freshness_evidence_beyond_hook_names() {
    let repo = committed_fixture("preflight-config-hooks");
    let (handle, _) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let initial = MutationPreflightSnapshot::capture(&handle).unwrap();

    repo.git(["config", "user.name", "Changed Fixture User"]);
    let config_changed = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_eq!(
        config_changed.structural_revision,
        initial.structural_revision
    );
    assert_ne!(
        config_changed.config_fingerprint,
        initial.config_fingerprint
    );
    assert_ne!(config_changed.state_digest, initial.state_digest);

    let hook = repo.path.join(".git/hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\nexit 0\n").unwrap();
    let hook_v1 = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_eq!(hook_v1.active_hooks, ["pre-commit"]);
    assert!(hook_v1.clean_for_safety_evaluation().is_err());

    fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
    let hook_v2 = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_eq!(hook_v2.structural_revision, hook_v1.structural_revision);
    assert_eq!(hook_v2.active_hooks, hook_v1.active_hooks);
    assert_ne!(hook_v2.hooks_fingerprint, hook_v1.hooks_fingerprint);
    assert_ne!(hook_v2.state_digest, hook_v1.state_digest);

    fs::remove_file(&hook).unwrap();
    repo.git(["config", "core.hooksPath", "../custom-hooks"]);
    let custom_hooks = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_eq!(
        custom_hooks.configured_hooks_path.as_deref(),
        Some("../custom-hooks")
    );
    assert!(custom_hooks.clean_for_safety_evaluation().is_err());

    repo.git(["config", "--unset", "core.hooksPath"]);
    fs::write(
        repo.path.join(".git/external.inc"),
        "[user]\n\tname = Included User\n",
    )
    .unwrap();
    repo.git(["config", "include.path", "external.inc"]);
    let included_config = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert!(included_config.config_has_includes);
    assert!(included_config.clean_for_safety_evaluation().is_err());
}

#[test]
fn structural_confirmation_can_miss_dirty_source_but_preflight_fails_closed() {
    let repo = committed_fixture("preflight-dirty-confirm");
    let (handle, graph) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let manager = sandbox_manager("dirty-confirm");
    let sandbox = manager.create_sandbox(&handle, &graph.revision).unwrap();
    let preview = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-dirty-confirm",
            &[MutationPreviewOperation::BranchCreate {
                name: "preview-only".to_owned(),
                target_oid: graph.head.clone(),
            }],
        )
        .unwrap();

    // A worktree-only byte change leaves the existing structural revision stable.
    repo.write("tracked.txt", "changed after preview\n");
    let current = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_eq!(current.structural_revision, graph.revision);
    assert!(!current.worktree_clean);

    // Existing preview confirmation is still structurally valid. That is identity
    // evidence only; Phase 28 deliberately refuses to promote it to apply authority.
    let confirmation = manager
        .confirm_preview(
            &sandbox.sandbox_id,
            "tx-dirty-confirm",
            &preview.preview_token,
        )
        .unwrap();
    let error = MutationPreflightReceipt::bind_confirmed_preview(current, &preview, &confirmation)
        .unwrap_err();
    assert!(error.to_string().contains("index/worktree must be clean"));
    manager.cleanup(&sandbox.sandbox_id).unwrap();
}

#[test]
fn confirmed_preview_receipt_binds_order_tokens_result_and_never_authorizes_apply() {
    let repo = committed_fixture("preflight-receipt");
    let (handle, graph) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let manager = sandbox_manager("receipt");
    let sandbox = manager.create_sandbox(&handle, &graph.revision).unwrap();
    let operations = vec![
        MutationPreviewOperation::BranchCreate {
            name: "first".to_owned(),
            target_oid: graph.head.clone(),
        },
        MutationPreviewOperation::TagCreate {
            name: "second".to_owned(),
            target_oid: graph.head.clone(),
        },
    ];
    let preview = manager
        .preview(&sandbox.sandbox_id, "tx-receipt", &operations)
        .unwrap();
    let source = MutationPreflightSnapshot::capture(&handle).unwrap();
    let confirmation = manager
        .confirm_preview(&sandbox.sandbox_id, "tx-receipt", &preview.preview_token)
        .unwrap();
    let receipt =
        MutationPreflightReceipt::bind_confirmed_preview(source.clone(), &preview, &confirmation)
            .unwrap();

    assert_eq!(
        receipt.preview.canonical_operations,
        preview.canonical_operations
    );
    assert_eq!(receipt.preview.operation_digest, preview.operation_digest);
    assert_eq!(receipt.preview.preview_token, preview.preview_token);
    assert_eq!(receipt.preview.confirmation_token, confirmation.token);
    assert!(receipt.receipt_digest.starts_with("sha256:"));

    let assessment = receipt.assess(&source, &preview, &confirmation);
    assert!(assessment.fresh);
    assert!(assessment.failures.is_empty());
    assert!(!assessment.original_apply_authorized);
    assert_eq!(
        assessment.unresolved_boundaries,
        vec![
            MutationApplyUnresolvedBoundary::BackendOwnedSingleUseAuthorization,
            MutationApplyUnresolvedBoundary::DurableIdempotencyReplayLedger,
            MutationApplyUnresolvedBoundary::RaceFreeFinalPreflightAndEffect,
            MutationApplyUnresolvedBoundary::CrashSafeAtomicityOrRecovery,
            MutationApplyUnresolvedBoundary::ConfigAndExternalExecutionIsolation,
        ]
    );

    let mut tampered = preview.clone();
    tampered.canonical_operations.reverse();
    let tampered_assessment = receipt.assess(&source, &tampered, &confirmation);
    assert!(!tampered_assessment.fresh);
    assert!(
        tampered_assessment
            .failures
            .iter()
            .any(|failure| { failure.code == MutationPreflightFailureCode::PreviewBindingChanged })
    );

    let mut wrong_sandbox = preview.clone();
    wrong_sandbox.sandbox_id = "sandbox-0000000000009999".to_owned();
    let wrong_sandbox_assessment = receipt.assess(&source, &wrong_sandbox, &confirmation);
    assert!(
        wrong_sandbox_assessment
            .failures
            .iter()
            .any(|failure| { failure.code == MutationPreflightFailureCode::PreviewBindingChanged })
    );
    manager.cleanup(&sandbox.sandbox_id).unwrap();
}

#[test]
fn post_confirmation_source_changes_produce_specific_user_visible_reasons() {
    let repo = committed_fixture("preflight-races");
    let (handle, graph) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let manager = sandbox_manager("races");
    let sandbox = manager.create_sandbox(&handle, &graph.revision).unwrap();
    let preview = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-races",
            &[MutationPreviewOperation::BranchCreate {
                name: "preview-branch".to_owned(),
                target_oid: graph.head.clone(),
            }],
        )
        .unwrap();
    let source = MutationPreflightSnapshot::capture(&handle).unwrap();
    let confirmation = manager
        .confirm_preview(&sandbox.sandbox_id, "tx-races", &preview.preview_token)
        .unwrap();
    let receipt =
        MutationPreflightReceipt::bind_confirmed_preview(source, &preview, &confirmation).unwrap();

    repo.write("tracked.txt", "concurrent worktree edit\n");
    let dirty = MutationPreflightSnapshot::capture(&handle).unwrap();
    let dirty_assessment = receipt.assess(&dirty, &preview, &confirmation);
    assert!(!dirty_assessment.fresh);
    assert!(dirty_assessment.failures.iter().any(|failure| {
        failure.code == MutationPreflightFailureCode::WorktreeStateChanged
            && failure.message.contains("tracked.txt")
    }));

    repo.write("tracked.txt", "base\n");
    repo.write("tracked.txt", "staged concurrent edit\n");
    repo.git(["add", "tracked.txt"]);
    let index_changed = MutationPreflightSnapshot::capture(&handle).unwrap();
    let index_assessment = receipt.assess(&index_changed, &preview, &confirmation);
    assert!(
        index_assessment
            .failures
            .iter()
            .any(|failure| { failure.code == MutationPreflightFailureCode::IndexStateChanged })
    );

    repo.write("tracked.txt", "base\n");
    repo.git(["add", "tracked.txt"]);
    repo.git(["config", "user.email", "changed@example.invalid"]);
    let config_changed = MutationPreflightSnapshot::capture(&handle).unwrap();
    let config_assessment = receipt.assess(&config_changed, &preview, &confirmation);
    assert!(
        config_assessment
            .failures
            .iter()
            .any(|failure| { failure.code == MutationPreflightFailureCode::ConfigChanged })
    );

    repo.git(["branch", "concurrent-ref", "HEAD"]);
    let ref_changed = MutationPreflightSnapshot::capture(&handle).unwrap();
    let ref_assessment = receipt.assess(&ref_changed, &preview, &confirmation);
    assert!(ref_assessment.failures.iter().any(|failure| {
        failure.code == MutationPreflightFailureCode::StructuralRevisionChanged
    }));
    assert!(
        ref_assessment
            .failures
            .iter()
            .any(|failure| { failure.code == MutationPreflightFailureCode::RefTargetsChanged })
    );

    repo.git(["checkout", "concurrent-ref"]);
    let head_changed = MutationPreflightSnapshot::capture(&handle).unwrap();
    let head_assessment = receipt.assess(&head_changed, &preview, &confirmation);
    assert!(
        head_assessment
            .failures
            .iter()
            .any(|failure| { failure.code == MutationPreflightFailureCode::HeadChanged })
    );

    fs::write(
        repo.path.join(".git/hooks/pre-commit"),
        "#!/bin/sh\nexit 0\n",
    )
    .unwrap();
    let hook_changed = MutationPreflightSnapshot::capture(&handle).unwrap();
    let hook_assessment = receipt.assess(&hook_changed, &preview, &confirmation);
    assert!(
        hook_assessment
            .failures
            .iter()
            .any(|failure| { failure.code == MutationPreflightFailureCode::HooksChanged })
    );
    assert!(!hook_assessment.original_apply_authorized);
    manager.cleanup(&sandbox.sandbox_id).unwrap();
}

#[test]
fn exact_repository_identity_is_not_substitutable_even_at_same_structural_revision() {
    let repo_a = committed_fixture("preflight-identity-a");
    let repo_b = committed_fixture("preflight-identity-b");
    let (handle_a, graph_a) =
        RepositoryService::open(&repo_a.path, OpenOptions::default()).unwrap();
    let (handle_b, graph_b) =
        RepositoryService::open(&repo_b.path, OpenOptions::default()).unwrap();
    assert_eq!(graph_a.head, graph_b.head);
    assert_eq!(graph_a.revision, graph_b.revision);

    let manager = sandbox_manager("identity");
    let sandbox = manager
        .create_sandbox(&handle_a, &graph_a.revision)
        .unwrap();
    let preview = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-identity",
            &[MutationPreviewOperation::BranchCreate {
                name: "identity-preview".to_owned(),
                target_oid: graph_a.head.clone(),
            }],
        )
        .unwrap();
    let source_a = MutationPreflightSnapshot::capture(&handle_a).unwrap();
    let confirmation = manager
        .confirm_preview(&sandbox.sandbox_id, "tx-identity", &preview.preview_token)
        .unwrap();
    let receipt =
        MutationPreflightReceipt::bind_confirmed_preview(source_a, &preview, &confirmation)
            .unwrap();

    let source_b = MutationPreflightSnapshot::capture(&handle_b).unwrap();
    let assessment = receipt.assess(&source_b, &preview, &confirmation);
    assert!(!assessment.fresh);
    assert!(assessment.failures.iter().any(|failure| {
        failure.code == MutationPreflightFailureCode::RepositoryIdentityChanged
    }));
    assert!(!assessment.failures.iter().any(|failure| {
        failure.code == MutationPreflightFailureCode::StructuralRevisionChanged
    }));
    manager.cleanup(&sandbox.sandbox_id).unwrap();
}

#[test]
fn canonical_operation_order_changes_the_existing_digest_and_preview_token() {
    let repo = committed_fixture("preflight-order");
    let (handle, graph) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let manager = sandbox_manager("order");
    let a = MutationPreviewOperation::BranchCreate {
        name: "a".to_owned(),
        target_oid: graph.head.clone(),
    };
    let b = MutationPreviewOperation::TagCreate {
        name: "b".to_owned(),
        target_oid: graph.head.clone(),
    };

    let sandbox_ab = manager.create_sandbox(&handle, &graph.revision).unwrap();
    let preview_ab = manager
        .preview(&sandbox_ab.sandbox_id, "tx-order", &[a.clone(), b.clone()])
        .unwrap();
    manager.cleanup(&sandbox_ab.sandbox_id).unwrap();

    let sandbox_ba = manager.create_sandbox(&handle, &graph.revision).unwrap();
    let preview_ba = manager
        .preview(&sandbox_ba.sandbox_id, "tx-order", &[b, a])
        .unwrap();
    assert_ne!(
        preview_ab.canonical_operations,
        preview_ba.canonical_operations
    );
    assert_ne!(preview_ab.operation_digest, preview_ba.operation_digest);
    assert_ne!(preview_ab.preview_token, preview_ba.preview_token);
    manager.cleanup(&sandbox_ba.sandbox_id).unwrap();
}
