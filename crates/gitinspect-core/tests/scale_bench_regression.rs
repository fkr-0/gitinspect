#[path = "common/scale.rs"]
mod scale;

use gitinspect_core::{CompactGitRepositorySnapshot, OpenOptions, RepositoryService};

use scale::ScaleFixture;

#[test]
fn deterministic_fast_import_fixture_has_stable_history_identity() {
    let left = ScaleFixture::new("deterministic-left", 128);
    let right = ScaleFixture::new("deterministic-right", 128);
    let options = OpenOptions {
        max_commits: 128,
        include_commit_files: false,
        ..OpenOptions::default()
    };
    let (_, left_snapshot) = RepositoryService::open(&left.path, options.clone()).unwrap();
    let (_, right_snapshot) = RepositoryService::open(&right.path, options).unwrap();

    assert_eq!(left_snapshot.head, right_snapshot.head);
    assert_eq!(left_snapshot.revision, right_snapshot.revision);
    assert_eq!(left_snapshot.commits, right_snapshot.commits);
}

#[test]
fn thousand_commit_snapshot_stays_metadata_only_and_payload_is_linear() {
    let fixture = ScaleFixture::new("metadata-only-1000", 1_000);
    let (handle, snapshot) = RepositoryService::open(
        &fixture.path,
        OpenOptions {
            max_commits: 1_000,
            include_commit_files: false,
            ..OpenOptions::default()
        },
    )
    .unwrap();

    assert_eq!(snapshot.commits.len(), 1_000);
    assert!(!snapshot.truncated);
    assert!(
        snapshot
            .commits
            .iter()
            .all(|commit| commit.files.is_empty())
    );
    let payload = serde_json::to_vec(&snapshot).unwrap();
    assert!(
        payload.len() < 512_000,
        "metadata-only payload unexpectedly exceeds 512 kB: {} bytes",
        payload.len()
    );

    let refreshed = handle
        .refresh(OpenOptions {
            max_commits: 1_000,
            include_commit_files: false,
            ..OpenOptions::default()
        })
        .unwrap();
    assert_eq!(refreshed.revision, snapshot.revision);
    assert_eq!(refreshed.commits, snapshot.commits);
}

#[test]
fn compact_transport_round_trips_and_unchanged_refresh_skips_snapshot_rebuild() {
    let fixture = ScaleFixture::new("compact-1000", 1_000);
    let options = OpenOptions {
        max_commits: 1_000,
        include_commit_files: false,
        ..OpenOptions::default()
    };
    let (handle, snapshot) = RepositoryService::open(&fixture.path, options.clone()).unwrap();
    let legacy_payload = serde_json::to_vec(&snapshot).unwrap();
    let compact = CompactGitRepositorySnapshot::from_snapshot(&snapshot).unwrap();
    let compact_payload = serde_json::to_vec(&compact).unwrap();

    assert_eq!(compact.expand().unwrap(), snapshot);
    assert!(
        compact_payload.len() * 2 < legacy_payload.len(),
        "compact payload should be less than half of legacy JSON: compact={} legacy={}",
        compact_payload.len(),
        legacy_payload.len()
    );
    assert!(
        handle
            .refresh_if_changed(&snapshot.revision, options)
            .unwrap()
            .is_none(),
        "unchanged revision should not rebuild the commit snapshot"
    );
}
