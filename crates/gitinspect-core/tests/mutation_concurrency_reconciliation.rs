//! Phase-31 disposable-fixture qualification for two questions left open by
//! Phase 30:
//!
//! 1. can a backend-owned or Git ref-lock envelope preserve the exact Phase-28
//!    whole-source predicate against independent writers through target commit?;
//! 2. after a durably recorded `effect-started` attempt and restart, can a
//!    read-only inspection classify the single-ref outcome without retrying or
//!    deleting a lock automatically?
//!
//! This is an integration-test harness only. It exports no executor, accepts no
//! selected/original repository handle from product code, and performs fixture
//! cleanup only after the relevant diagnosis has been asserted.

#[allow(dead_code)]
mod common;

use std::fs::{self, OpenOptions as FsOpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use gitinspect_core::{
    MutationAttemptRecord, MutationAttemptState, MutationAuthorizationAtomicStore,
    MutationAuthorizationBinding, MutationAuthorizationLedger, MutationAuthorizationLedgerSnapshot,
    MutationAuthorizationRecord, MutationAuthorizationState, MutationPreflightSnapshot,
    OpenOptions, RepositoryService,
};

use common::FixtureRepo;

static NEXT_DURABLE_ROOT: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SingleRefKind {
    BranchCreate,
    BranchDelete,
    TagCreate,
    TagDelete,
    TagMove,
}

#[derive(Debug)]
struct RefCase {
    kind: SingleRefKind,
    ref_name: String,
    initial_oid: Option<String>,
    new_oid: Option<String>,
    competitor_oid: String,
}

impl RefCase {
    fn instruction(&self) -> String {
        match self.kind {
            SingleRefKind::BranchCreate | SingleRefKind::TagCreate => format!(
                "create {} {}",
                self.ref_name,
                self.new_oid.as_deref().unwrap()
            ),
            SingleRefKind::BranchDelete | SingleRefKind::TagDelete => format!(
                "delete {} {}",
                self.ref_name,
                self.initial_oid.as_deref().unwrap()
            ),
            SingleRefKind::TagMove => format!(
                "update {} {} {}",
                self.ref_name,
                self.new_oid.as_deref().unwrap(),
                self.initial_oid.as_deref().unwrap()
            ),
        }
    }

    fn expected_after_success(&self) -> Option<&str> {
        match self.kind {
            SingleRefKind::BranchDelete | SingleRefKind::TagDelete => None,
            _ => self.new_oid.as_deref(),
        }
    }
}

struct PreparedRefTransaction {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl PreparedRefTransaction {
    fn prepare(repo: &Path, instructions: &[String]) -> Self {
        let mut child = Command::new("git")
            .args(["update-ref", "--stdin"])
            .current_dir(repo)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        writeln!(stdin, "start").unwrap();
        for instruction in instructions {
            writeln!(stdin, "{instruction}").unwrap();
        }
        writeln!(stdin, "prepare").unwrap();
        stdin.flush().unwrap();

        let mut transaction = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        };
        transaction.expect_line("start: ok");
        transaction.expect_line("prepare: ok");
        transaction
    }

    fn commit(mut self) {
        writeln!(self.stdin, "commit").unwrap();
        self.stdin.flush().unwrap();
        self.expect_line("commit: ok");
        drop(self.stdin);
        let output = self.child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "prepared update-ref commit failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn kill(mut self) {
        self.child.kill().unwrap();
        let status = self.child.wait().unwrap();
        assert!(!status.success());
    }

    fn expect_line(&mut self, expected: &str) {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        assert_eq!(line.trim_end(), expected);
    }
}

fn fixture_with_three_commits(name: &str) -> (FixtureRepo, String, String, String) {
    let repo = FixtureRepo::new(name);
    repo.write("tracked.txt", "one\n");
    let first = repo.commit_all("one");
    repo.write("tracked.txt", "two\n");
    let second = repo.commit_all("two");
    repo.write("tracked.txt", "three\n");
    let third = repo.commit_all("three");
    (repo, first, second, third)
}

fn cases(name: &str) -> Vec<(FixtureRepo, RefCase)> {
    [
        SingleRefKind::BranchCreate,
        SingleRefKind::BranchDelete,
        SingleRefKind::TagCreate,
        SingleRefKind::TagDelete,
        SingleRefKind::TagMove,
    ]
    .into_iter()
    .enumerate()
    .map(|(index, kind)| {
        let (repo, first, second, third) =
            fixture_with_three_commits(&format!("{name}-{index}-{kind:?}"));
        let ref_name = match kind {
            SingleRefKind::BranchCreate | SingleRefKind::BranchDelete => {
                format!("refs/heads/phase31-{index}")
            }
            SingleRefKind::TagCreate | SingleRefKind::TagDelete | SingleRefKind::TagMove => {
                format!("refs/tags/phase31-{index}")
            }
        };
        let (initial_oid, new_oid) = match kind {
            SingleRefKind::BranchCreate | SingleRefKind::TagCreate => (None, Some(first)),
            SingleRefKind::BranchDelete | SingleRefKind::TagDelete => (Some(first), None),
            SingleRefKind::TagMove => (Some(first), Some(second)),
        };
        if let Some(initial) = &initial_oid {
            assert!(
                git(&repo.path, ["update-ref", &ref_name, initial])
                    .status
                    .success()
            );
        }
        (
            repo,
            RefCase {
                kind,
                ref_name,
                initial_oid,
                new_oid,
                competitor_oid: third,
            },
        )
    })
    .collect()
}

#[test]
fn cooperative_backend_advisory_lock_is_not_external_git_exclusion() {
    let (repo, first, _, _) = fixture_with_three_commits("cooperative-lock");
    let lock_path = repo.path.join(".git/gitinspect-phase31-cooperative.lock");
    let lock = FsOpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .unwrap();
    lock.try_lock().unwrap();

    // This lock can serialize cooperating Gitinspect owners, but Git itself does
    // not participate in the advisory-lock protocol. An independent Git writer
    // therefore updates a ref while the backend lock is held.
    let external = git(
        &repo.path,
        ["update-ref", "refs/heads/external-writer", &first],
    );
    assert!(external.status.success());
    assert_eq!(
        read_ref(&repo.path, "refs/heads/external-writer").as_deref(),
        Some(first.as_str())
    );
}

#[test]
fn all_current_direct_ref_locks_still_do_not_preserve_phase28_whole_source() {
    let (repo, first, second, third) = fixture_with_three_commits("all-current-ref-locks");
    assert!(
        git(&repo.path, ["update-ref", "refs/heads/unrelated", &first])
            .status
            .success()
    );
    assert!(
        git(&repo.path, ["update-ref", "refs/tags/pinned", &second])
            .status
            .success()
    );

    let (handle, _) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let final_preflight = MutationPreflightSnapshot::capture(&handle).unwrap();
    let target = "refs/heads/phase31-target";

    // This is stronger than Phase 30's target-only lock: the prepared
    // transaction locks the target plus every direct ref present in the final
    // preflight. Git 2.55 rejects a redundant explicit HEAD verification when
    // its referent is already present, but the referent transaction still
    // blocks the normal symbolic-HEAD move tested below. The exact source
    // predicate is broader still: future refs plus index/worktree/config/hooks
    // are not reserved by this finite ref transaction.
    let transaction = PreparedRefTransaction::prepare(
        &repo.path,
        &[
            format!("create {target} {first}"),
            format!("verify refs/heads/main {third}"),
            format!("verify refs/heads/unrelated {first}"),
            format!("verify refs/tags/pinned {second}"),
        ],
    );

    // Existing refs included in the prepared set are genuinely excluded.
    let existing_ref_move = git(&repo.path, ["update-ref", "refs/heads/unrelated", &third]);
    assert!(!existing_ref_move.status.success());
    assert!(String::from_utf8_lossy(&existing_ref_move.stderr).contains("cannot lock ref"));

    // The namespace is open-ended: no finite lock set over current refs can
    // reserve every name an independent Git process may create later.
    let new_ref = git(
        &repo.path,
        ["update-ref", "refs/heads/created-after-preflight", &first],
    );
    assert!(new_ref.status.success());

    // Git 2.55 also protects symbolic HEAD while its referent participates in
    // this prepared transaction: the normal independent Git HEAD move is
    // rejected. This is useful exclusion evidence, but it does not widen the
    // finite ref set into a whole-source repository lock.
    let head_move = git(&repo.path, ["symbolic-ref", "HEAD", "refs/heads/unrelated"]);
    assert!(!head_move.status.success());
    assert!(String::from_utf8_lossy(&head_move.stderr).contains("cannot lock ref 'HEAD'"));

    // Ref locks do not lock the per-worktree index or worktree bytes.
    repo.write("tracked.txt", "staged while all current refs are locked\n");
    let index_change = git(&repo.path, ["add", "tracked.txt"]);
    assert!(index_change.status.success());
    repo.write(
        "tracked.txt",
        "unstaged while all current refs are locked\n",
    );

    // Ref locks do not lock local config bytes.
    let config_change = git(&repo.path, ["config", "phase31.probe", "changed"]);
    assert!(config_change.status.success());

    // Git has no transaction participant for repository hook bytes. An
    // independent writer can replace those bytes while ref locks are held.
    let hook = repo.path.join(".git/hooks/pre-commit");
    fs::write(&hook, "#!/bin/sh\nexit 0\n").unwrap();
    assert!(hook.exists());

    let raced = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_ne!(raced.state_digest, final_preflight.state_digest);
    assert_ne!(raced.refs, final_preflight.refs);
    assert_eq!(raced.head_ref, final_preflight.head_ref);
    assert_ne!(raced.index_fingerprint, final_preflight.index_fingerprint);
    assert!(!raced.index_clean);
    assert!(!raced.worktree_clean);
    assert_ne!(raced.config_fingerprint, final_preflight.config_fingerprint);
    assert_ne!(raced.hooks_fingerprint, final_preflight.hooks_fingerprint);

    // All originally locked direct refs still satisfy their verifies, so the
    // target transaction can commit after the exact whole-source receipt became
    // stale. This is terminal negative evidence for this execution architecture.
    transaction.commit();
    assert_eq!(
        read_ref(&repo.path, target).as_deref(),
        Some(first.as_str())
    );
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LockOwnerEvidence {
    KnownDeadFixtureOwner,
    UnknownOrPotentiallyLive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ObservedTargetRelation {
    ExpectedOld,
    ExpectedNew,
    ThirdValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReconciliationOutcome {
    Diverged,
    LockRecoveryRequired,
    Indeterminate,
}

#[derive(Debug, PartialEq, Eq)]
struct ReconciliationInspection {
    outcome: ReconciliationOutcome,
    observed_target_relation: ObservedTargetRelation,
    observed_target: Option<String>,
    lock_present: bool,
    automatically_retryable: bool,
}

/// Fixture-only model of the read-only restart inspection required after a
/// durable `effect-started` marker. It reads only the target ref and lock-file
/// presence. Crucially, a lock file does not prove whether its owner is alive;
/// that ownership evidence must come from outside the lock file itself.
fn inspect_reconciliation(
    repo: &Path,
    case: &RefCase,
    lock_owner: LockOwnerEvidence,
) -> ReconciliationInspection {
    let observed_target = read_ref(repo, &case.ref_name);
    let observed_target_relation = if observed_target.as_deref() == case.initial_oid.as_deref() {
        ObservedTargetRelation::ExpectedOld
    } else if observed_target.as_deref() == case.expected_after_success() {
        ObservedTargetRelation::ExpectedNew
    } else {
        ObservedTargetRelation::ThirdValue
    };
    let lock_present = ref_lock_path(repo, &case.ref_name).exists();
    let outcome = if lock_present {
        match lock_owner {
            LockOwnerEvidence::KnownDeadFixtureOwner => ReconciliationOutcome::LockRecoveryRequired,
            LockOwnerEvidence::UnknownOrPotentiallyLive => ReconciliationOutcome::Indeterminate,
        }
    } else if observed_target_relation == ObservedTargetRelation::ThirdValue {
        ReconciliationOutcome::Diverged
    } else {
        // With no external-writer-honored envelope, current expected-old/new
        // state cannot prove which process produced it. The attempt may have
        // committed and then been restored, or an independent writer may have
        // produced expected-new without this attempt committing at all.
        ReconciliationOutcome::Indeterminate
    };
    ReconciliationInspection {
        outcome,
        observed_target_relation,
        observed_target,
        lock_present,
        automatically_retryable: false,
    }
}

struct DurableEffectStartedFixture {
    root: PathBuf,
}

impl Drop for DurableEffectStartedFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn persist_effect_started(name: &str) -> DurableEffectStartedFixture {
    let serial = NEXT_DURABLE_ROOT.fetch_add(1, Ordering::Relaxed);
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/mutation-phase31-reconciliation")
        .join(format!("{name}-{}-{serial}", std::process::id()));
    if root.exists() {
        fs::remove_dir_all(&root).unwrap();
    }

    let binding = MutationAuthorizationBinding {
        repository_identity_digest: "phase31-repository".to_owned(),
        source_state_digest: "phase31-source".to_owned(),
        receipt_digest: "phase31-receipt".to_owned(),
        transaction_id: "phase31-transaction".to_owned(),
        operation_digest: "phase31-operation".to_owned(),
        preview_result_digest: "phase31-preview".to_owned(),
    };
    let authorization = MutationAuthorizationRecord {
        authorization_id: "phase31-authorization".to_owned(),
        binding: binding.clone(),
        secret_digest: "phase31-secret-digest".to_owned(),
        state: MutationAuthorizationState::Consumed,
    };
    let snapshot = MutationAuthorizationLedgerSnapshot {
        schema_version: 1,
        authorizations: vec![authorization],
        attempts: vec![MutationAttemptRecord {
            attempt_id: "phase31-attempt".to_owned(),
            authorization_id: "phase31-authorization".to_owned(),
            binding,
            state: MutationAttemptState::EffectStarted,
            completed_effect_steps: Vec::new(),
            failure_reason: None,
        }],
    };

    let mut store = MutationAuthorizationAtomicStore::open(&root).unwrap();
    assert_eq!(store.persist(&snapshot).unwrap(), 1);

    // Read the committed envelope back through the store after persistence.
    // Phase 30 separately qualifies process-level reopen and lock release; this
    // phase composes that durable-store result with the Phase-29 restart model
    // instead of re-testing immediate same-process reopen in every scenario.
    let loaded = store.load_snapshot().unwrap().unwrap();
    assert_eq!(
        loaded.attempts[0].state,
        MutationAttemptState::EffectStarted
    );
    drop(store);
    let recovered = MutationAuthorizationLedger::recover(loaded).unwrap();
    let recovered_attempt = recovered.attempt("phase31-attempt").unwrap();
    assert_eq!(
        recovered_attempt.state,
        MutationAttemptState::RecoveryRequired
    );
    assert!(!recovered_attempt.automatically_retryable());

    DurableEffectStartedFixture { root }
}

#[test]
fn restart_reconciliation_distinguishes_old_new_and_third_target_without_causal_overclaim_for_all_five_kinds()
 {
    for (index, (repo, case)) in cases("reconcile-expected-old").into_iter().enumerate() {
        let _durable = persist_effect_started(&format!("expected-old-{index}"));
        let inspection = inspect_reconciliation(
            &repo.path,
            &case,
            LockOwnerEvidence::UnknownOrPotentiallyLive,
        );
        assert_eq!(
            inspection.observed_target_relation,
            ObservedTargetRelation::ExpectedOld
        );
        assert_eq!(inspection.outcome, ReconciliationOutcome::Indeterminate);
        assert!(!inspection.lock_present);
        assert!(!inspection.automatically_retryable);
    }

    for (index, (repo, case)) in cases("reconcile-expected-new").into_iter().enumerate() {
        let _durable = persist_effect_started(&format!("expected-new-{index}"));
        let committed = run_transaction(&repo.path, &case.instruction());
        assert!(
            committed.status.success(),
            "fixture commit failed for {:?}: {}",
            case.kind,
            String::from_utf8_lossy(&committed.stderr)
        );
        let inspection = inspect_reconciliation(
            &repo.path,
            &case,
            LockOwnerEvidence::UnknownOrPotentiallyLive,
        );
        assert_eq!(
            inspection.observed_target_relation,
            ObservedTargetRelation::ExpectedNew
        );
        assert_eq!(inspection.outcome, ReconciliationOutcome::Indeterminate);
        assert!(!inspection.lock_present);
        assert!(!inspection.automatically_retryable);
    }

    for (index, (repo, case)) in cases("reconcile-diverged").into_iter().enumerate() {
        let _durable = persist_effect_started(&format!("diverged-{index}"));
        let external = git(
            &repo.path,
            ["update-ref", &case.ref_name, &case.competitor_oid],
        );
        assert!(external.status.success());
        let inspection = inspect_reconciliation(
            &repo.path,
            &case,
            LockOwnerEvidence::UnknownOrPotentiallyLive,
        );
        assert_eq!(
            inspection.observed_target_relation,
            ObservedTargetRelation::ThirdValue
        );
        assert_eq!(inspection.outcome, ReconciliationOutcome::Diverged);
        assert_eq!(
            inspection.observed_target.as_deref(),
            Some(case.competitor_oid.as_str())
        );
        assert!(!inspection.lock_present);
        assert!(!inspection.automatically_retryable);
    }
}

#[test]
fn same_target_external_writers_make_expected_old_and_new_causally_ambiguous_for_all_five_kinds() {
    for (index, (repo, case)) in cases("reconcile-commit-then-restore-old")
        .into_iter()
        .enumerate()
    {
        let _durable = persist_effect_started(&format!("commit-then-restore-old-{index}"));
        let committed = run_transaction(&repo.path, &case.instruction());
        assert!(committed.status.success());
        let restored = force_ref(&repo.path, &case.ref_name, case.initial_oid.as_deref());
        assert!(restored.status.success());

        let inspection = inspect_reconciliation(
            &repo.path,
            &case,
            LockOwnerEvidence::UnknownOrPotentiallyLive,
        );
        assert_eq!(
            inspection.observed_target_relation,
            ObservedTargetRelation::ExpectedOld
        );
        assert_eq!(inspection.outcome, ReconciliationOutcome::Indeterminate);
        assert!(!inspection.lock_present);
        assert!(!inspection.automatically_retryable);
    }

    for (index, (repo, case)) in cases("reconcile-external-produces-new")
        .into_iter()
        .enumerate()
    {
        let _durable = persist_effect_started(&format!("external-produces-new-{index}"));
        let external = force_ref(&repo.path, &case.ref_name, case.expected_after_success());
        assert!(external.status.success());

        let inspection = inspect_reconciliation(
            &repo.path,
            &case,
            LockOwnerEvidence::UnknownOrPotentiallyLive,
        );
        assert_eq!(
            inspection.observed_target_relation,
            ObservedTargetRelation::ExpectedNew
        );
        assert_eq!(inspection.outcome, ReconciliationOutcome::Indeterminate);
        assert!(!inspection.lock_present);
        assert!(!inspection.automatically_retryable);
    }
}

#[test]
fn restart_reconciliation_distinguishes_known_stale_from_live_or_unknown_lock_for_all_five_kinds() {
    for (index, (repo, case)) in cases("reconcile-stale-lock").into_iter().enumerate() {
        let _durable = persist_effect_started(&format!("stale-lock-{index}"));
        let transaction = PreparedRefTransaction::prepare(&repo.path, &[case.instruction()]);
        transaction.kill();

        let lock_path = ref_lock_path(&repo.path, &case.ref_name);
        assert!(lock_path.exists());
        let inspection =
            inspect_reconciliation(&repo.path, &case, LockOwnerEvidence::KnownDeadFixtureOwner);
        assert_eq!(
            inspection.outcome,
            ReconciliationOutcome::LockRecoveryRequired
        );
        assert!(inspection.lock_present);
        assert!(!inspection.automatically_retryable);

        // Cleanup is deliberately fixture-only and occurs only after the stale
        // lock diagnosis has been recorded by the assertions above.
        fs::remove_file(lock_path).unwrap();
    }

    for (index, (repo, case)) in cases("reconcile-live-lock").into_iter().enumerate() {
        let _durable = persist_effect_started(&format!("live-lock-{index}"));
        let transaction = PreparedRefTransaction::prepare(&repo.path, &[case.instruction()]);

        let inspection = inspect_reconciliation(
            &repo.path,
            &case,
            LockOwnerEvidence::UnknownOrPotentiallyLive,
        );
        assert_eq!(inspection.outcome, ReconciliationOutcome::Indeterminate);
        assert!(inspection.lock_present);
        assert!(!inspection.automatically_retryable);

        // End the fixture owner only after proving that a present lock with no
        // dead-owner proof is indeterminate. Killing it leaves the known stale
        // lock, which is then removed only for disposable-fixture cleanup.
        transaction.kill();
        let lock_path = ref_lock_path(&repo.path, &case.ref_name);
        assert!(lock_path.exists());
        fs::remove_file(lock_path).unwrap();
    }
}

fn run_transaction(repo: &Path, instruction: &str) -> Output {
    let mut child = Command::new("git")
        .args(["update-ref", "--stdin"])
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let stdin = child.stdin.as_mut().unwrap();
        writeln!(stdin, "start").unwrap();
        writeln!(stdin, "{instruction}").unwrap();
        writeln!(stdin, "prepare").unwrap();
        writeln!(stdin, "commit").unwrap();
    }
    child.wait_with_output().unwrap()
}

fn git<const N: usize>(repo: &Path, args: [&str; N]) -> Output {
    Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .unwrap()
}

fn force_ref(repo: &Path, ref_name: &str, target: Option<&str>) -> Output {
    let mut command = Command::new("git");
    command.arg("update-ref");
    match target {
        Some(oid) => {
            command.args([ref_name, oid]);
        }
        None => {
            command.args(["-d", ref_name]);
        }
    }
    command.current_dir(repo).output().unwrap()
}

fn read_ref(repo: &Path, ref_name: &str) -> Option<String> {
    let output = git(repo, ["rev-parse", "--verify", ref_name]);
    output
        .status
        .success()
        .then(|| String::from_utf8(output.stdout).unwrap().trim().to_owned())
}

fn ref_lock_path(repo: &Path, ref_name: &str) -> PathBuf {
    repo.join(".git").join(format!("{ref_name}.lock"))
}
