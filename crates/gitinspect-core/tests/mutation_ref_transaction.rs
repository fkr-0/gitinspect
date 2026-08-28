//! Phase-30 disposable-repository qualification for Git's expected-old ref
//! transaction semantics. This file is an integration-test harness only: no
//! ref executor is exported by gitinspect-core and no selected/original
//! repository path can reach these fixed `git update-ref --stdin` commands.

#[allow(dead_code)]
mod common;

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Output, Stdio};

use gitinspect_core::{
    MutationAttemptRecord, MutationAttemptState, MutationAuthorizationAtomicStore,
    MutationAuthorizationBinding, MutationAuthorizationLedgerSnapshot, MutationAuthorizationRecord,
    MutationAuthorizationState, MutationPreflightSnapshot, OpenOptions, RepositoryService,
};

use common::FixtureRepo;

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
    fn prepare(repo: &Path, instruction: &str) -> Self {
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
        writeln!(stdin, "{instruction}").unwrap();
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

    fn crash_before_commit(mut self) {
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
                format!("refs/heads/phase30-{index}")
            }
            SingleRefKind::TagCreate | SingleRefKind::TagDelete | SingleRefKind::TagMove => {
                format!("refs/tags/phase30-{index}")
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
fn all_five_single_ref_kinds_hold_target_lock_after_prepare_and_commit_exact_transition() {
    for (repo, case) in cases("target-lock") {
        let transaction = PreparedRefTransaction::prepare(&repo.path, &case.instruction());

        // A competing writer to the same ref cannot pass Git's lock while the
        // expected-old transaction is prepared.
        let competitor = git(
            &repo.path,
            ["update-ref", &case.ref_name, &case.competitor_oid],
        );
        assert!(
            !competitor.status.success(),
            "same-ref competitor unexpectedly passed prepared lock for {:?}",
            case.kind
        );

        transaction.commit();
        assert_eq!(
            read_ref(&repo.path, &case.ref_name).as_deref(),
            case.expected_after_success()
        );
    }
}

#[test]
fn all_five_single_ref_kinds_reject_stale_expected_state_before_effect() {
    for (repo, case) in cases("stale-expected") {
        // Move/create the target before our transaction reaches prepare. This
        // is the exact competing-writer window expected-old protects.
        let competitor = git(
            &repo.path,
            ["update-ref", &case.ref_name, &case.competitor_oid],
        );
        assert!(competitor.status.success());

        let output = run_transaction(&repo.path, &case.instruction());
        assert!(
            !output.status.success(),
            "stale expected state was accepted for {:?}",
            case.kind
        );
        assert_eq!(
            read_ref(&repo.path, &case.ref_name).as_deref(),
            Some(case.competitor_oid.as_str())
        );
    }
}

#[test]
fn crash_after_prepare_publishes_no_ref_effect_but_leaves_fail_closed_stale_lock_recovery() {
    for (repo, case) in cases("crash-before-commit") {
        let transaction = PreparedRefTransaction::prepare(&repo.path, &case.instruction());
        transaction.crash_before_commit();

        assert_eq!(
            read_ref(&repo.path, &case.ref_name).as_deref(),
            case.initial_oid.as_deref(),
            "prepared but uncommitted {:?} leaked an effect",
            case.kind
        );

        // SIGKILL cannot run Git's lockfile cleanup path. The ref effect is
        // absent, but the stale target lock remains and blocks later writers.
        // Any future executor therefore needs explicit lock reconciliation;
        // Phase-30 authorization semantics also forbid automatically replaying
        // the abandoned mutation attempt itself.
        let competitor = git(
            &repo.path,
            ["update-ref", &case.ref_name, &case.competitor_oid],
        );
        assert!(!competitor.status.success());
        assert!(String::from_utf8_lossy(&competitor.stderr).contains("cannot lock ref"));

        let stale_lock = repo
            .path
            .join(".git")
            .join(format!("{}.lock", case.ref_name));
        assert!(stale_lock.exists());
        fs::remove_file(stale_lock).unwrap();
        let reconciled = git(
            &repo.path,
            ["update-ref", &case.ref_name, &case.competitor_oid],
        );
        assert!(reconciled.status.success());
    }
}

#[test]
fn prepared_target_ref_lock_does_not_close_whole_repository_final_toctou() {
    let (repo, first, _, _) = fixture_with_three_commits("whole-source-toctou");
    let (handle, _) = RepositoryService::open(&repo.path, OpenOptions::default()).unwrap();
    let final_preflight = MutationPreflightSnapshot::capture(&handle).unwrap();
    let ledger_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/mutation-ref-ledgers")
        .join(format!("whole-source-toctou-{}", std::process::id()));
    if ledger_root.exists() {
        fs::remove_dir_all(&ledger_root).unwrap();
    }
    let mut durable_store = MutationAuthorizationAtomicStore::open(&ledger_root).unwrap();

    // Model the already-qualified Phase-29 consumption/final-preflight result
    // as a durably reserved, consumed attempt before any ref-lock effect.
    let binding = MutationAuthorizationBinding {
        repository_identity_digest: "fixture-repository".to_owned(),
        source_state_digest: final_preflight.state_digest.clone(),
        receipt_digest: "fixture-receipt".to_owned(),
        transaction_id: "fixture-transaction".to_owned(),
        operation_digest: "fixture-operation".to_owned(),
        preview_result_digest: "fixture-preview".to_owned(),
    };
    let authorization = MutationAuthorizationRecord {
        authorization_id: "fixture-authorization".to_owned(),
        binding: binding.clone(),
        secret_digest: "fixture-secret-digest".to_owned(),
        state: MutationAuthorizationState::Consumed,
    };
    let mut attempt = MutationAttemptRecord {
        attempt_id: "fixture-attempt".to_owned(),
        authorization_id: authorization.authorization_id.clone(),
        binding,
        state: MutationAttemptState::ReservedBeforeEffect,
        completed_effect_steps: Vec::new(),
        failure_reason: None,
    };
    let mut durable_snapshot = MutationAuthorizationLedgerSnapshot {
        schema_version: 1,
        authorizations: vec![authorization],
        attempts: vec![attempt.clone()],
    };
    assert_eq!(durable_store.persist(&durable_snapshot).unwrap(), 1);

    // `git update-ref prepare` creates the target lockfile, so effect-started
    // must itself be durable before prepare is allowed to begin.
    attempt.state = MutationAttemptState::EffectStarted;
    durable_snapshot.attempts[0] = attempt.clone();
    assert_eq!(durable_store.persist(&durable_snapshot).unwrap(), 2);

    let target = "refs/heads/phase30-target";
    let transaction =
        PreparedRefTransaction::prepare(&repo.path, &format!("create {target} {first}"));

    attempt
        .completed_effect_steps
        .push("fixture-target-ref-prepared".to_owned());
    durable_snapshot.attempts[0] = attempt;
    assert_eq!(durable_store.persist(&durable_snapshot).unwrap(), 3);

    // Git's prepare lock is per targeted ref. A different Git writer remains
    // free to mutate another ref after the final strong preflight snapshot.
    let unrelated = git(
        &repo.path,
        ["update-ref", "refs/heads/phase30-unrelated", &first],
    );
    assert!(unrelated.status.success());
    let raced = MutationPreflightSnapshot::capture(&handle).unwrap();
    assert_ne!(raced.state_digest, final_preflight.state_digest);
    assert_ne!(raced.refs, final_preflight.refs);

    // The target expected-old condition is still satisfied, so the prepared
    // transaction commits successfully despite the now-stale whole-source
    // preflight. Therefore target-ref locking cannot discharge Phase 28's
    // exact repository/source binding or FinalRepositoryToctou blocker.
    transaction.commit();
    assert_eq!(
        read_ref(&repo.path, target).as_deref(),
        Some(first.as_str())
    );
    assert_eq!(
        read_ref(&repo.path, "refs/heads/phase30-unrelated").as_deref(),
        Some(first.as_str())
    );
    drop(durable_store);
    fs::remove_dir_all(ledger_root).unwrap();
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

fn read_ref(repo: &Path, ref_name: &str) -> Option<String> {
    let output = git(repo, ["rev-parse", "--verify", ref_name]);
    output
        .status
        .success()
        .then(|| String::from_utf8(output.stdout).unwrap().trim().to_owned())
}
