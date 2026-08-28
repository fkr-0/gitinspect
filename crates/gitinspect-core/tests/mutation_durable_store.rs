use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use gitinspect_core::{
    MutationAttemptRecord, MutationAttemptState, MutationAuthorizationAtomicStore,
    MutationAuthorizationBinding, MutationAuthorizationLedger, MutationAuthorizationLedgerSnapshot,
    MutationAuthorizationRecord, MutationAuthorizationState, MutationLedgerStoreError,
    MutationLedgerStoreFaultPoint,
};

static NEXT_ROOT: AtomicU64 = AtomicU64::new(1);

struct FixtureRoot {
    path: PathBuf,
}

impl FixtureRoot {
    fn new(name: &str) -> Self {
        let serial = NEXT_ROOT.fetch_add(1, Ordering::Relaxed);
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repository_root = fs::canonicalize(manifest_dir.join("../..")).unwrap();
        let root = repository_root.join("target/mutation-durable-store");
        fs::create_dir_all(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        assert!(root.starts_with(repository_root.join("target")));
        let path = root.join(format!("{name}-{}-{serial}", std::process::id()));
        if path.exists() {
            fs::remove_dir_all(&path).unwrap();
        }
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn ledger_path(&self) -> PathBuf {
        self.path.join("mutation-authorization-ledger.json")
    }
}

impl Drop for FixtureRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn binding(label: &str) -> MutationAuthorizationBinding {
    MutationAuthorizationBinding {
        repository_identity_digest: format!("repo:{label}"),
        source_state_digest: format!("source:{label}"),
        receipt_digest: format!("receipt:{label}"),
        transaction_id: format!("tx-{label}"),
        operation_digest: format!("op:{label}"),
        preview_result_digest: format!("preview:{label}"),
    }
}

fn authorization(label: &str, state: MutationAuthorizationState) -> MutationAuthorizationRecord {
    MutationAuthorizationRecord {
        authorization_id: format!("authorization-{label}"),
        binding: binding(label),
        secret_digest: format!("secret:{label}"),
        state,
    }
}

fn attempt(
    label: &str,
    state: MutationAttemptState,
    completed_effect_steps: Vec<String>,
) -> MutationAttemptRecord {
    MutationAttemptRecord {
        attempt_id: format!("attempt-{label}"),
        authorization_id: format!("authorization-{label}"),
        binding: binding(label),
        state,
        completed_effect_steps,
        failure_reason: None,
    }
}

fn snapshot(label: &str) -> MutationAuthorizationLedgerSnapshot {
    MutationAuthorizationLedgerSnapshot {
        schema_version: 1,
        authorizations: vec![authorization(label, MutationAuthorizationState::Consumed)],
        attempts: vec![attempt(
            label,
            MutationAttemptState::ReservedBeforeEffect,
            Vec::new(),
        )],
    }
}

#[test]
fn atomic_store_round_trips_exact_snapshot_excludes_second_owner_and_recovers_restart_state() {
    let fixture = FixtureRoot::new("round-trip");
    let original = snapshot("round-trip");

    let mut store = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap();
    assert_eq!(store.generation(), 0);
    assert_eq!(store.persist(&original).unwrap(), 1);
    assert_eq!(store.load_snapshot().unwrap().as_ref(), Some(&original));

    let second = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap_err();
    assert!(matches!(second, MutationLedgerStoreError::StoreBusy(_)));
    drop(store);

    let reopened = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap();
    assert_eq!(reopened.generation(), 1);
    let durable = reopened.load_snapshot().unwrap().unwrap();
    assert_eq!(durable, original);
    let recovered = MutationAuthorizationLedger::recover(durable).unwrap();
    let recovered_attempt = recovered.attempt("attempt-round-trip").unwrap();
    assert_eq!(
        recovered_attempt.state,
        MutationAttemptState::AbandonedBeforeEffect
    );
    assert!(!recovered_attempt.automatically_retryable());
}

#[test]
fn deterministic_faults_require_reopen_and_never_publish_a_pre_rename_candidate() {
    let fault_points = [
        MutationLedgerStoreFaultPoint::AfterWrite,
        MutationLedgerStoreFaultPoint::AfterFlush,
        MutationLedgerStoreFaultPoint::AfterFileSync,
        MutationLedgerStoreFaultPoint::AfterRename,
        MutationLedgerStoreFaultPoint::AfterDirectorySync,
        MutationLedgerStoreFaultPoint::AfterReopen,
    ];

    for fault in fault_points {
        let fixture = FixtureRoot::new(&format!("fault-{fault:?}"));
        let baseline = snapshot("baseline");
        let candidate = snapshot("candidate");
        let mut store = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap();
        assert_eq!(store.persist(&baseline).unwrap(), 1);

        let error = store
            .persist_with_fault(&candidate, Some(fault))
            .unwrap_err();
        assert!(matches!(error, MutationLedgerStoreError::InjectedFault(_)));
        assert!(matches!(
            store.load_snapshot().unwrap_err(),
            MutationLedgerStoreError::ReopenRequired
        ));
        drop(store);

        let reopened = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap();
        let durable = reopened.load_snapshot().unwrap().unwrap();
        match fault {
            MutationLedgerStoreFaultPoint::AfterWrite
            | MutationLedgerStoreFaultPoint::AfterFlush
            | MutationLedgerStoreFaultPoint::AfterFileSync => {
                assert_eq!(reopened.generation(), 1);
                assert_eq!(durable, baseline);
            }
            MutationLedgerStoreFaultPoint::AfterRename
            | MutationLedgerStoreFaultPoint::AfterDirectorySync
            | MutationLedgerStoreFaultPoint::AfterReopen => {
                // Once rename has happened a process-level reopen observes the
                // candidate. AfterRename is still durability-uncertain across
                // sudden system/power loss until the directory fsync completes,
                // which is why the failed caller is forbidden from continuing.
                assert_eq!(reopened.generation(), 2);
                assert_eq!(durable, candidate);
            }
        }
    }
}

#[test]
fn restart_recovery_expires_issued_abandons_reserved_and_marks_effect_started_uncertain() {
    let fixture = FixtureRoot::new("restart-states");
    let snapshot = MutationAuthorizationLedgerSnapshot {
        schema_version: 1,
        authorizations: vec![
            authorization("issued", MutationAuthorizationState::Issued),
            authorization("reserved", MutationAuthorizationState::Consumed),
            authorization("effect", MutationAuthorizationState::Consumed),
        ],
        attempts: vec![
            attempt(
                "reserved",
                MutationAttemptState::ReservedBeforeEffect,
                Vec::new(),
            ),
            attempt(
                "effect",
                MutationAttemptState::EffectStarted,
                vec!["fixture-ref-transaction-prepared".to_owned()],
            ),
        ],
    };

    let mut store = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap();
    store.persist(&snapshot).unwrap();
    drop(store);

    let reopened = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap();
    let recovered =
        MutationAuthorizationLedger::recover(reopened.load_snapshot().unwrap().unwrap()).unwrap();
    let recovered_snapshot = recovered.snapshot().unwrap();
    let issued = recovered_snapshot
        .authorizations
        .iter()
        .find(|record| record.authorization_id == "authorization-issued")
        .unwrap();
    assert_eq!(issued.state, MutationAuthorizationState::ExpiredOnRestart);

    let reserved = recovered.attempt("attempt-reserved").unwrap();
    assert_eq!(reserved.state, MutationAttemptState::AbandonedBeforeEffect);
    assert!(!reserved.automatically_retryable());

    let effect = recovered.attempt("attempt-effect").unwrap();
    assert_eq!(effect.state, MutationAttemptState::RecoveryRequired);
    assert_eq!(
        effect.completed_effect_steps,
        ["fixture-ref-transaction-prepared"]
    );
    assert!(!effect.automatically_retryable());
}

#[test]
fn checksum_corruption_and_store_version_mismatch_fail_closed() {
    let corrupt_fixture = FixtureRoot::new("corrupt");
    let durable = snapshot("corrupt");
    let mut store = MutationAuthorizationAtomicStore::open(&corrupt_fixture.path).unwrap();
    store.persist(&durable).unwrap();
    drop(store);

    let path = corrupt_fixture.ledger_path();
    let mut json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    json["ledger"]["authorizations"][0]["secretDigest"] =
        serde_json::Value::String("tampered-without-checksum-update".to_owned());
    fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
    let error = MutationAuthorizationAtomicStore::open(&corrupt_fixture.path).unwrap_err();
    assert!(matches!(error, MutationLedgerStoreError::Corrupt(_)));

    let version_fixture = FixtureRoot::new("version");
    let mut store = MutationAuthorizationAtomicStore::open(&version_fixture.path).unwrap();
    store.persist(&snapshot("version")).unwrap();
    drop(store);
    let path = version_fixture.ledger_path();
    let mut json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    json["storeSchemaVersion"] = serde_json::Value::from(99);
    fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
    let error = MutationAuthorizationAtomicStore::open(&version_fixture.path).unwrap_err();
    assert!(matches!(
        error,
        MutationLedgerStoreError::UnsupportedStoreVersion(99)
    ));
}

#[test]
fn record_and_string_bounds_reject_unbounded_durable_state_before_commit() {
    let fixture = FixtureRoot::new("bounds");
    let mut oversized = snapshot("bounds");
    oversized.attempts[0].failure_reason = Some("x".repeat(8193));
    let mut store = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap();
    let error = store.persist(&oversized).unwrap_err();
    assert!(matches!(error, MutationLedgerStoreError::Bounds(_)));
    drop(store);

    assert!(!fixture.ledger_path().exists());
}

#[cfg(unix)]
#[test]
fn metadata_symlink_is_rejected_instead_of_followed() {
    use std::os::unix::fs::symlink;

    let fixture = FixtureRoot::new("symlink");
    let outside = fixture.path.join("outside.json");
    fs::write(&outside, b"do not touch").unwrap();
    symlink(&outside, fixture.ledger_path()).unwrap();
    let error = MutationAuthorizationAtomicStore::open(&fixture.path).unwrap_err();
    assert!(matches!(
        error,
        MutationLedgerStoreError::SymlinkMetadata(_)
    ));
    assert_eq!(fs::read(&outside).unwrap(), b"do not touch");
}
