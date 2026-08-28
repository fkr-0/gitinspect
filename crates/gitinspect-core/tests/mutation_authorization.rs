#[allow(dead_code)]
mod common;

use std::path::PathBuf;

use gitinspect_core::{
    MutationAuthorizationBinding, MutationAuthorizationError, MutationAuthorizationLedger,
    MutationAuthorizationLedgerSnapshot, MutationCapabilitySecretSource, MutationEffectClass,
    MutationExecutionIsolationFailure, MutationExecutionIsolationInputs,
    MutationFinalPreflightVerdict, MutationOriginalApplyDisposition, MutationPreflightReceipt,
    MutationPreflightSnapshot, MutationPreviewConfirmation, MutationPreviewOperation,
    MutationPreviewResult, MutationQualificationBlocker, MutationSandboxManager, OpenOptions,
    RepositoryHandle, RepositoryService, assess_mutation_execution_isolation,
    qualify_mutation_operation,
};

use common::FixtureRepo;

struct DeterministicSecretSource {
    next: u8,
}

impl MutationCapabilitySecretSource for DeterministicSecretSource {
    fn fill_secret(&mut self, destination: &mut [u8; 32]) -> Result<(), String> {
        destination.fill(self.next);
        self.next = self.next.wrapping_add(1);
        Ok(())
    }
}

struct ReceiptFixture {
    repo: FixtureRepo,
    handle: RepositoryHandle,
    manager: MutationSandboxManager,
    preview: MutationPreviewResult,
    confirmation: MutationPreviewConfirmation,
    receipt: MutationPreflightReceipt,
}

fn receipt_fixture(name: &str) -> ReceiptFixture {
    let repo = FixtureRepo::new(name);
    repo.write("tracked.txt", "base\n");
    repo.commit_all("base");
    let (handle, graph) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/mutation-authorization-sandboxes")
        .join(name);
    let manager = MutationSandboxManager::new(root).unwrap();
    let sandbox = manager.create_sandbox(&handle, &graph.revision).unwrap();
    let preview = manager
        .preview(
            &sandbox.sandbox_id,
            "tx-authorization",
            &[MutationPreviewOperation::TagCreate {
                name: "preview-only".to_owned(),
                target_oid: graph.head.clone(),
            }],
        )
        .unwrap();
    let source = MutationPreflightSnapshot::capture(&handle).unwrap();
    let confirmation = manager
        .confirm_preview(
            &sandbox.sandbox_id,
            "tx-authorization",
            &preview.preview_token,
        )
        .unwrap();
    let receipt =
        MutationPreflightReceipt::bind_confirmed_preview(source, &preview, &confirmation).unwrap();
    manager.cleanup(&sandbox.sandbox_id).unwrap();
    ReceiptFixture {
        repo,
        handle,
        manager,
        preview,
        confirmation,
        receipt,
    }
}

#[test]
fn backend_capability_binds_exact_receipt_is_single_use_and_secret_is_not_durable() {
    let fixture = receipt_fixture("authorization-single-use");
    let ledger = MutationAuthorizationLedger::new();
    let mut secrets = DeterministicSecretSource { next: 0xa5 };
    let capability = ledger.issue(&fixture.receipt, &mut secrets).unwrap();
    let binding = MutationAuthorizationBinding::from_receipt(&fixture.receipt);

    let attempt_id = ledger
        .begin_attempt(&capability, &binding, || {
            let current = MutationPreflightSnapshot::capture(&fixture.handle)
                .map_err(|error| error.to_string())?;
            let assessment =
                fixture
                    .receipt
                    .assess(&current, &fixture.preview, &fixture.confirmation);
            assert!(assessment.fresh);
            assert!(!assessment.original_apply_authorized);
            Ok(MutationFinalPreflightVerdict::from_assessment(&assessment))
        })
        .unwrap();
    let attempt = ledger.attempt(&attempt_id).unwrap();
    assert!(!attempt.automatically_retryable());

    let replay = ledger
        .begin_attempt(&capability, &binding, || {
            panic!("replay must be rejected before final preflight")
        })
        .unwrap_err();
    assert_eq!(replay, MutationAuthorizationError::CapabilityUnavailable);

    let snapshot = ledger.snapshot().unwrap();
    let json = serde_json::to_string(&snapshot).unwrap();
    assert!(!json.contains("165,165,165"));
    let debug = format!("{capability:?}");
    assert!(debug.contains("<redacted>"));
    assert!(!debug.contains("[165"));
    assert!(json.contains("secretDigest"));
    drop(fixture.manager);
}

#[test]
fn restart_never_retries_consumed_or_uncertain_attempts() {
    let fixture = receipt_fixture("authorization-restart");
    let binding = MutationAuthorizationBinding::from_receipt(&fixture.receipt);
    let mut secrets = DeterministicSecretSource { next: 1 };

    let ledger = MutationAuthorizationLedger::new();
    let before_effect_capability = ledger.issue(&fixture.receipt, &mut secrets).unwrap();
    let before_effect_attempt = ledger
        .begin_attempt(&before_effect_capability, &binding, || {
            Ok(MutationFinalPreflightVerdict {
                fresh: true,
                failure_messages: Vec::new(),
            })
        })
        .unwrap();

    let encoded = serde_json::to_vec(&ledger.snapshot().unwrap()).unwrap();
    let durable: MutationAuthorizationLedgerSnapshot = serde_json::from_slice(&encoded).unwrap();
    let recovered = MutationAuthorizationLedger::recover(durable).unwrap();
    let abandoned = recovered.attempt(&before_effect_attempt).unwrap();
    assert_eq!(
        abandoned.state,
        gitinspect_core::MutationAttemptState::AbandonedBeforeEffect
    );
    assert!(!abandoned.automatically_retryable());
    assert!(abandoned.failure_reason.unwrap().contains("not replayed"));

    let effect_ledger = MutationAuthorizationLedger::new();
    let effect_capability = effect_ledger.issue(&fixture.receipt, &mut secrets).unwrap();
    let effect_attempt = effect_ledger
        .begin_attempt(&effect_capability, &binding, || {
            Ok(MutationFinalPreflightVerdict {
                fresh: true,
                failure_messages: Vec::new(),
            })
        })
        .unwrap();
    effect_ledger.mark_effect_started(&effect_attempt).unwrap();
    effect_ledger
        .record_effect_step(&effect_attempt, "fixture-ref-lock-acquired")
        .unwrap();

    let encoded = serde_json::to_vec(&effect_ledger.snapshot().unwrap()).unwrap();
    let durable: MutationAuthorizationLedgerSnapshot = serde_json::from_slice(&encoded).unwrap();
    let recovered = MutationAuthorizationLedger::recover(durable).unwrap();
    let uncertain = recovered.attempt(&effect_attempt).unwrap();
    assert_eq!(
        uncertain.state,
        gitinspect_core::MutationAttemptState::RecoveryRequired
    );
    assert_eq!(
        uncertain.completed_effect_steps,
        ["fixture-ref-lock-acquired"]
    );
    assert!(!uncertain.automatically_retryable());
    assert!(
        uncertain
            .failure_reason
            .unwrap()
            .contains("partial effect cannot be excluded")
    );
    drop(fixture.manager);
}

#[test]
fn final_preflight_failure_burns_capability_before_any_effect() {
    let fixture = receipt_fixture("authorization-stale");
    let ledger = MutationAuthorizationLedger::new();
    let mut secrets = DeterministicSecretSource { next: 9 };
    let capability = ledger.issue(&fixture.receipt, &mut secrets).unwrap();
    let binding = MutationAuthorizationBinding::from_receipt(&fixture.receipt);

    fixture
        .repo
        .write("tracked.txt", "changed after confirmation\n");
    let failure = ledger
        .begin_attempt(&capability, &binding, || {
            let current = MutationPreflightSnapshot::capture(&fixture.handle)
                .map_err(|error| error.to_string())?;
            let assessment =
                fixture
                    .receipt
                    .assess(&current, &fixture.preview, &fixture.confirmation);
            assert!(!assessment.fresh);
            Ok(MutationFinalPreflightVerdict::from_assessment(&assessment))
        })
        .unwrap_err();
    assert!(matches!(
        failure,
        MutationAuthorizationError::FinalPreflightRejected(_)
    ));
    let snapshot = ledger.snapshot().unwrap();
    assert_eq!(snapshot.attempts.len(), 1);
    assert_eq!(
        snapshot.attempts[0].state,
        gitinspect_core::MutationAttemptState::RejectedBeforeEffect
    );
    assert!(snapshot.attempts[0].completed_effect_steps.is_empty());

    let replay = ledger
        .begin_attempt(&capability, &binding, || {
            panic!("burned stale capability must not reach preflight")
        })
        .unwrap_err();
    assert_eq!(replay, MutationAuthorizationError::CapabilityUnavailable);
    drop(fixture.manager);
}

#[test]
fn exact_binding_substitution_is_rejected_and_capability_is_burned() {
    let fixture = receipt_fixture("authorization-binding");
    let ledger = MutationAuthorizationLedger::new();
    let mut secrets = DeterministicSecretSource { next: 0x41 };
    let capability = ledger.issue(&fixture.receipt, &mut secrets).unwrap();
    let mut wrong = MutationAuthorizationBinding::from_receipt(&fixture.receipt);
    wrong.preview_result_digest.push_str("-tampered");

    let failure = ledger
        .begin_attempt(&capability, &wrong, || {
            panic!("binding mismatch must be rejected before final preflight")
        })
        .unwrap_err();
    assert_eq!(failure, MutationAuthorizationError::BindingMismatch);
    let snapshot = ledger.snapshot().unwrap();
    assert_eq!(snapshot.attempts.len(), 1);
    assert_eq!(
        snapshot.attempts[0].state,
        gitinspect_core::MutationAttemptState::RejectedBeforeEffect
    );
    assert!(
        snapshot.attempts[0]
            .failure_reason
            .as_deref()
            .unwrap()
            .contains("binding did not match")
    );
    let replay = ledger
        .begin_attempt(
            &capability,
            &MutationAuthorizationBinding::from_receipt(&fixture.receipt),
            || panic!("mismatched capability is burned"),
        )
        .unwrap_err();
    assert_eq!(replay, MutationAuthorizationError::CapabilityUnavailable);
    drop(fixture.manager);
}

#[test]
fn explicit_attempt_terminals_are_one_way_and_never_retryable() {
    let fixture = receipt_fixture("authorization-terminals");
    let binding = MutationAuthorizationBinding::from_receipt(&fixture.receipt);
    let ledger = MutationAuthorizationLedger::new();
    let mut secrets = DeterministicSecretSource { next: 0x51 };

    let no_effect_capability = ledger.issue(&fixture.receipt, &mut secrets).unwrap();
    let no_effect_attempt = ledger
        .begin_attempt(&no_effect_capability, &binding, || {
            Ok(MutationFinalPreflightVerdict {
                fresh: true,
                failure_messages: Vec::new(),
            })
        })
        .unwrap();
    ledger
        .fail_before_effect(&no_effect_attempt, "fixture executor refused before effect")
        .unwrap();
    let no_effect = ledger.attempt(&no_effect_attempt).unwrap();
    assert_eq!(
        no_effect.state,
        gitinspect_core::MutationAttemptState::FailedNoEffect
    );
    assert!(no_effect.state.terminal());
    assert!(!no_effect.automatically_retryable());
    assert!(ledger.mark_effect_started(&no_effect_attempt).is_err());

    let success_capability = ledger.issue(&fixture.receipt, &mut secrets).unwrap();
    let success_attempt = ledger
        .begin_attempt(&success_capability, &binding, || {
            Ok(MutationFinalPreflightVerdict {
                fresh: true,
                failure_messages: Vec::new(),
            })
        })
        .unwrap();
    ledger.mark_effect_started(&success_attempt).unwrap();
    ledger
        .record_effect_step(&success_attempt, "fixture-single-ref-transition")
        .unwrap();
    ledger.complete_success(&success_attempt).unwrap();
    let succeeded = ledger.attempt(&success_attempt).unwrap();
    assert_eq!(
        succeeded.state,
        gitinspect_core::MutationAttemptState::Succeeded
    );
    assert!(succeeded.state.terminal());
    assert!(!succeeded.automatically_retryable());
    assert!(
        ledger
            .mark_uncertain(&success_attempt, "late error")
            .is_err()
    );

    let uncertain_capability = ledger.issue(&fixture.receipt, &mut secrets).unwrap();
    let uncertain_attempt = ledger
        .begin_attempt(&uncertain_capability, &binding, || {
            Ok(MutationFinalPreflightVerdict {
                fresh: true,
                failure_messages: Vec::new(),
            })
        })
        .unwrap();
    ledger.mark_effect_started(&uncertain_attempt).unwrap();
    ledger
        .mark_uncertain(
            &uncertain_attempt,
            "fault injected after first effect boundary",
        )
        .unwrap();
    let uncertain = ledger.attempt(&uncertain_attempt).unwrap();
    assert_eq!(
        uncertain.state,
        gitinspect_core::MutationAttemptState::RecoveryRequired
    );
    assert!(uncertain.state.terminal());
    assert!(!uncertain.automatically_retryable());
    drop(fixture.manager);
}

#[test]
fn operation_matrix_keeps_every_previewable_kind_fail_closed() {
    let oid_a = "a".repeat(40);
    let oid_b = "b".repeat(40);
    let operations = vec![
        MutationPreviewOperation::BranchCreate {
            name: "create".to_owned(),
            target_oid: Some(oid_a.clone()),
        },
        MutationPreviewOperation::BranchDelete {
            name: "delete".to_owned(),
        },
        MutationPreviewOperation::BranchRename {
            old_name: "old".to_owned(),
            new_name: "new".to_owned(),
        },
        MutationPreviewOperation::TagCreate {
            name: "tag-create".to_owned(),
            target_oid: Some(oid_a.clone()),
        },
        MutationPreviewOperation::TagDelete {
            name: "tag-delete".to_owned(),
        },
        MutationPreviewOperation::TagMove {
            name: "tag-move".to_owned(),
            target_oid: oid_b.clone(),
        },
        MutationPreviewOperation::CherryPick {
            commit_oid: oid_a.clone(),
        },
        MutationPreviewOperation::RebaseReorder {
            branch: "main".to_owned(),
            onto_oid: oid_a.clone(),
            commit_oids: vec![oid_b.clone()],
        },
        MutationPreviewOperation::Squash {
            branch: "main".to_owned(),
            onto_oid: oid_a.clone(),
            commit_oids: vec![oid_b.clone()],
        },
        MutationPreviewOperation::Fixup {
            branch: "main".to_owned(),
            onto_oid: oid_a.clone(),
            commit_oids: vec![oid_b.clone()],
        },
        MutationPreviewOperation::Reword {
            branch: "main".to_owned(),
            commit_oid: oid_a.clone(),
            message: "replacement subject".to_owned(),
        },
        MutationPreviewOperation::Drop {
            branch: "main".to_owned(),
            commit_oid: oid_a,
        },
        MutationPreviewOperation::Split {
            branch: "main".to_owned(),
            commit_oid: oid_b,
        },
    ];

    let qualifications = operations
        .iter()
        .map(qualify_mutation_operation)
        .collect::<Vec<_>>();
    assert!(qualifications.iter().all(|qualification| {
        qualification.original_apply == MutationOriginalApplyDisposition::FailClosed
            && qualification
                .blockers
                .contains(&MutationQualificationBlocker::FinalRepositoryToctou)
            && qualification.blockers.contains(
                &MutationQualificationBlocker::DurableAtomicLedgerStoreNotWiredToOriginalAuthority,
            )
    }));
    assert_eq!(
        qualifications
            .iter()
            .filter(
                |qualification| qualification.effect_class == MutationEffectClass::SingleRefUpdate
            )
            .count(),
        5
    );
    let rename = &qualifications[2];
    assert!(
        rename
            .blockers
            .contains(&MutationQualificationBlocker::MultiRefConfigReflogAtomicityNotClosed)
    );
    for rewrite in &qualifications[6..] {
        assert_eq!(
            rewrite.effect_class,
            MutationEffectClass::RewriteWithObjectIndexWorktreeEffects
        );
        assert!(
            rewrite
                .blockers
                .contains(&MutationQualificationBlocker::IndexWorktreeCrashRecoveryNotClosed)
        );
        assert!(
            rewrite
                .blockers
                .contains(&MutationQualificationBlocker::ExternalProgramIsolationNotClosed)
        );
    }
}

#[test]
fn execution_isolation_fails_closed_for_unbound_porcelain_influences() {
    let pure_ref_model = assess_mutation_execution_isolation(&MutationExecutionIsolationInputs {
        uses_git_subprocess: false,
        inherited_process_environment: false,
        effective_config_fully_bound: true,
        active_repository_hooks: false,
        custom_hooks_path: false,
        config_includes: false,
        repository_filters_or_merge_drivers_may_execute: false,
        signing_program_may_execute: false,
        editor_may_execute: false,
        credential_or_transport_helper_may_execute: false,
        network_access_possible: false,
    });
    assert!(pure_ref_model.isolated);
    assert!(pure_ref_model.failures.is_empty());

    let rewrite_porcelain =
        assess_mutation_execution_isolation(&MutationExecutionIsolationInputs {
            uses_git_subprocess: true,
            inherited_process_environment: true,
            effective_config_fully_bound: false,
            active_repository_hooks: false,
            custom_hooks_path: false,
            config_includes: false,
            repository_filters_or_merge_drivers_may_execute: true,
            signing_program_may_execute: false,
            editor_may_execute: true,
            credential_or_transport_helper_may_execute: true,
            network_access_possible: true,
        });
    assert!(!rewrite_porcelain.isolated);
    for expected in [
        MutationExecutionIsolationFailure::GitSubprocessEnvironmentNotFullyOwned,
        MutationExecutionIsolationFailure::EffectiveConfigNotFullyBound,
        MutationExecutionIsolationFailure::RepositoryFilterOrMergeDriver,
        MutationExecutionIsolationFailure::Editor,
        MutationExecutionIsolationFailure::CredentialOrTransportHelper,
        MutationExecutionIsolationFailure::NetworkAccess,
    ] {
        assert!(rewrite_porcelain.failures.contains(&expected));
    }
}
