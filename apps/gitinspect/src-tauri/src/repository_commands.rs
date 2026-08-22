use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gitinspect_core::{
    ChangeReason, CommitDiff, CompactGitRepositorySnapshot, DiffOptions, GitRepositorySnapshot,
    OpenOptions, RepositoryHandle, RepositoryService, WatchOptions,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPathSelection {
    pub mode: RepositoryPathSelectionMode,
    #[allow(dead_code)]
    pub expected_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactRepositorySession {
    pub key: String,
    pub snapshot: CompactGitRepositorySnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum CompactRepositoryRefresh {
    Unchanged {
        revision: String,
    },
    Changed {
        session: Box<CompactRepositorySession>,
    },
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepositoryPathSelectionMode {
    Folder,
    File,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySession {
    pub key: String,
    pub snapshot: GitRepositorySnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChangedEvent {
    pub repository_id: String,
    pub previous_revision: String,
    pub reasons: Vec<ChangeReason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSession {
    pub watch_id: String,
}

#[derive(Debug, Clone)]
struct RepositoryEntry {
    handle: RepositoryHandle,
    revision: String,
}

fn bounded_diff_options(options: Option<DiffOptions>) -> DiffOptions {
    let defaults = DiffOptions::default();
    let requested = options.unwrap_or_else(|| defaults.clone());
    DiffOptions {
        max_blob_bytes: requested.max_blob_bytes.min(defaults.max_blob_bytes),
        binary_probe_bytes: requested
            .binary_probe_bytes
            .min(defaults.binary_probe_bytes),
        max_files: requested.max_files.min(defaults.max_files),
    }
}

#[derive(Default)]
pub struct RepositoryAuthority {
    repositories: Mutex<HashMap<String, RepositoryEntry>>,
    next_repository_id: AtomicU64,
}

impl RepositoryAuthority {
    fn lock_repositories(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, RepositoryEntry>>, String> {
        self.repositories
            .lock()
            .map_err(|_| "repository authority lock poisoned".to_owned())
    }

    pub fn open(&self, path: &str) -> Result<RepositorySession, String> {
        let (handle, snapshot) = RepositoryService::open(path, OpenOptions::default())
            .map_err(|error| error.to_string())?;
        let id = self.next_repository_id.fetch_add(1, Ordering::Relaxed) + 1;
        let key = format!("repository:{id}");
        self.lock_repositories()?.insert(
            key.clone(),
            RepositoryEntry {
                handle,
                revision: snapshot.revision.clone(),
            },
        );
        Ok(RepositorySession { key, snapshot })
    }

    pub fn open_compact(&self, path: &str) -> Result<CompactRepositorySession, String> {
        let session = self.open(path)?;
        let compact = CompactGitRepositorySnapshot::from_snapshot(&session.snapshot)
            .map_err(|error| error.to_string())?;
        Ok(CompactRepositorySession {
            key: session.key,
            snapshot: compact,
        })
    }

    pub fn refresh(
        &self,
        repository_id: &str,
        expected_revision: Option<&str>,
    ) -> Result<RepositorySession, String> {
        let entry = self
            .lock_repositories()?
            .get(repository_id)
            .cloned()
            .ok_or_else(|| format!("unknown repository handle: {repository_id}"))?;
        let observed_revision = entry.revision.clone();
        if let Some(expected) = expected_revision
            && expected != observed_revision
        {
            return Err(format!(
                "stale repository revision: expected {expected}, current {observed_revision}"
            ));
        }
        let snapshot = entry
            .handle
            .refresh(OpenOptions::default())
            .map_err(|error| error.to_string())?;
        let mut repositories = self.lock_repositories()?;
        let current = repositories
            .get_mut(repository_id)
            .ok_or_else(|| format!("unknown repository handle: {repository_id}"))?;
        if current.revision != observed_revision {
            return Err(format!(
                "stale repository refresh: observed {observed_revision}, current {}",
                current.revision
            ));
        }
        current.revision = snapshot.revision.clone();
        Ok(RepositorySession {
            key: repository_id.to_owned(),
            snapshot,
        })
    }

    pub fn refresh_compact(
        &self,
        repository_id: &str,
        expected_revision: Option<&str>,
    ) -> Result<CompactRepositoryRefresh, String> {
        let entry = self
            .lock_repositories()?
            .get(repository_id)
            .cloned()
            .ok_or_else(|| format!("unknown repository handle: {repository_id}"))?;
        let observed_revision = entry.revision.clone();
        if let Some(expected) = expected_revision
            && expected != observed_revision
        {
            return Err(format!(
                "stale repository revision: expected {expected}, current {observed_revision}"
            ));
        }

        let snapshot = entry
            .handle
            .refresh_if_changed(&observed_revision, OpenOptions::default())
            .map_err(|error| error.to_string())?;

        let mut repositories = self.lock_repositories()?;
        let current = repositories
            .get_mut(repository_id)
            .ok_or_else(|| format!("unknown repository handle: {repository_id}"))?;
        if current.revision != observed_revision {
            return Err(format!(
                "stale repository refresh: observed {observed_revision}, current {}",
                current.revision
            ));
        }

        let Some(snapshot) = snapshot else {
            return Ok(CompactRepositoryRefresh::Unchanged {
                revision: observed_revision,
            });
        };
        let compact = CompactGitRepositorySnapshot::from_snapshot(&snapshot)
            .map_err(|error| error.to_string())?;
        current.revision = snapshot.revision;
        Ok(CompactRepositoryRefresh::Changed {
            session: Box::new(CompactRepositorySession {
                key: repository_id.to_owned(),
                snapshot: compact,
            }),
        })
    }

    pub fn commit_diff(
        &self,
        repository_id: &str,
        oid: &str,
        options: Option<DiffOptions>,
    ) -> Result<CommitDiff, String> {
        let handle = self.handle(repository_id)?;
        handle
            .commit_diff(oid, bounded_diff_options(options))
            .map_err(|error| error.to_string())
    }

    pub fn handle(&self, repository_id: &str) -> Result<RepositoryHandle, String> {
        self.lock_repositories()?
            .get(repository_id)
            .map(|entry| entry.handle.clone())
            .ok_or_else(|| format!("unknown repository handle: {repository_id}"))
    }

    pub fn revision(&self, repository_id: &str) -> Result<String, String> {
        self.lock_repositories()?
            .get(repository_id)
            .map(|entry| entry.revision.clone())
            .ok_or_else(|| format!("unknown repository handle: {repository_id}"))
    }
}

#[derive(Default)]
pub struct AppState {
    pub authority: RepositoryAuthority,
    watches: Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
    next_watch_id: AtomicU64,
}

#[tauri::command(rename_all = "camelCase")]
pub fn choose_repository_path(selection: RepositoryPathSelection) -> Option<String> {
    let dialog = rfd::FileDialog::new();
    let selected = match selection.mode {
        RepositoryPathSelectionMode::Folder => dialog.pick_folder(),
        RepositoryPathSelectionMode::File => dialog.pick_file(),
    };
    selected.map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_repository(
    path: String,
    state: State<'_, AppState>,
) -> Result<RepositorySession, String> {
    state.authority.open(&path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_repository_compact(
    path: String,
    state: State<'_, AppState>,
) -> Result<CompactRepositorySession, String> {
    state.authority.open_compact(&path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn refresh_repository(
    repository_id: String,
    expected_revision: Option<String>,
    state: State<'_, AppState>,
) -> Result<RepositorySession, String> {
    state
        .authority
        .refresh(&repository_id, expected_revision.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn refresh_repository_compact(
    repository_id: String,
    expected_revision: Option<String>,
    state: State<'_, AppState>,
) -> Result<CompactRepositoryRefresh, String> {
    state
        .authority
        .refresh_compact(&repository_id, expected_revision.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_commit_diff(
    repository_id: String,
    oid: String,
    options: Option<DiffOptions>,
    state: State<'_, AppState>,
) -> Result<CommitDiff, String> {
    state.authority.commit_diff(&repository_id, &oid, options)
}

#[tauri::command(rename_all = "camelCase")]
pub fn start_repository_watch(
    repository_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WatchSession, String> {
    let handle = state.authority.handle(&repository_id)?;
    let watcher = handle
        .watch_native(WatchOptions::default())
        .map_err(|error| error.to_string())?;
    let id = state.next_watch_id.fetch_add(1, Ordering::Relaxed) + 1;
    let watch_id = format!("watch:{id}");
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    state
        .watches
        .lock()
        .map_err(|_| "watch registry lock poisoned".to_owned())?
        .insert(watch_id.clone(), Arc::clone(&stop));

    let thread_watch_id = watch_id.clone();
    std::thread::spawn(move || {
        while !stop.load(Ordering::Acquire) {
            match watcher.recv_timeout(Duration::from_millis(200)) {
                Ok(change) => {
                    let previous_revision = app
                        .state::<AppState>()
                        .authority
                        .revision(&repository_id)
                        .unwrap_or_default();
                    if app
                        .emit(
                            "repository://changed",
                            RepositoryChangedEvent {
                                repository_id: repository_id.clone(),
                                previous_revision,
                                reasons: change.reasons,
                            },
                        )
                        .is_err()
                    {
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        if let Ok(mut watches) = app.state::<AppState>().watches.lock() {
            watches.remove(&thread_watch_id);
        }
    });

    Ok(WatchSession { watch_id })
}

#[tauri::command(rename_all = "camelCase")]
pub fn stop_repository_watch(watch_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(stop) = state
        .watches
        .lock()
        .map_err(|_| "watch registry lock poisoned".to_owned())?
        .remove(&watch_id)
    {
        stop.store(true, Ordering::Release);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct Fixture {
        path: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let serial = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("test-repositories");
            fs::create_dir_all(&root).unwrap();
            let path = root.join(format!("ipc-{}-{serial}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            run(&path, ["init", "-b", "main"]);
            run(&path, ["config", "user.name", "IPC Fixture"]);
            run(&path, ["config", "user.email", "ipc@example.invalid"]);
            Self { path }
        }

        fn commit(&self, path: &str, contents: &str, message: &str) -> String {
            fs::write(self.path.join(path), contents).unwrap();
            run(&self.path, ["add", "-A"]);
            run(&self.path, ["commit", "-m", message]);
            output(&self.path, ["rev-parse", "HEAD"])
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn run<I, S>(cwd: &Path, args: I)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .env("GIT_AUTHOR_NAME", "IPC Fixture")
            .env("GIT_AUTHOR_EMAIL", "ipc@example.invalid")
            .env("GIT_COMMITTER_NAME", "IPC Fixture")
            .env("GIT_COMMITTER_EMAIL", "ipc@example.invalid")
            .status()
            .unwrap();
        assert!(status.success());
    }

    fn output<I, S>(cwd: &Path, args: I) -> String
    where
        I: IntoIterator<Item = S>,
        S: AsRef<std::ffi::OsStr>,
    {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    #[test]
    fn frontend_diff_options_can_only_tighten_server_bounds() {
        let defaults = DiffOptions::default();
        let bounded = bounded_diff_options(Some(DiffOptions {
            max_blob_bytes: u64::MAX,
            binary_probe_bytes: usize::MAX,
            max_files: usize::MAX,
        }));
        assert_eq!(bounded, defaults);

        let tightened = bounded_diff_options(Some(DiffOptions {
            max_blob_bytes: 64,
            binary_probe_bytes: 16,
            max_files: 7,
        }));
        assert_eq!(tightened.max_blob_bytes, 64);
        assert_eq!(tightened.binary_probe_bytes, 16);
        assert_eq!(tightened.max_files, 7);
    }

    #[test]
    fn authority_opens_refreshes_and_loads_commit_diff_with_stale_guard() {
        let fixture = Fixture::new();
        let first_oid = fixture.commit("one.txt", "one\n", "one");
        let authority = RepositoryAuthority::default();
        let opened = authority.open(fixture.path.to_str().unwrap()).unwrap();
        assert_eq!(opened.snapshot.head.as_deref(), Some(first_oid.as_str()));
        assert_eq!(opened.snapshot.head_ref.as_deref(), Some("refs/heads/main"));
        assert!(opened.snapshot.commits[0].files.is_empty());

        let previous_revision = opened.snapshot.revision.clone();
        let second_oid = fixture.commit("one.txt", "one\ntwo\n", "two");
        let refreshed = authority
            .refresh(&opened.key, Some(&previous_revision))
            .unwrap();
        assert_eq!(
            refreshed.snapshot.head.as_deref(),
            Some(second_oid.as_str())
        );
        assert_ne!(refreshed.snapshot.revision, previous_revision);
        assert!(
            authority
                .refresh(&opened.key, Some(&previous_revision))
                .unwrap_err()
                .contains("stale repository revision")
        );

        let diff = authority
            .commit_diff(&opened.key, &second_oid, None)
            .unwrap();
        assert_eq!(diff.oid, second_oid);
        assert_eq!(diff.files.len(), 1);
        assert_eq!(diff.files[0].path, "one.txt");
    }

    #[test]
    fn compact_authority_round_trips_and_short_circuits_unchanged_refresh() {
        let fixture = Fixture::new();
        let first_oid = fixture.commit("one.txt", "one\n", "one");
        let authority = RepositoryAuthority::default();
        let opened = authority
            .open_compact(fixture.path.to_str().unwrap())
            .unwrap();
        let expanded = opened.snapshot.expand().unwrap();

        assert_eq!(expanded.head.as_deref(), Some(first_oid.as_str()));
        assert!(
            expanded
                .commits
                .iter()
                .all(|commit| commit.files.is_empty())
        );
        let previous_revision = expanded.revision.clone();

        match authority
            .refresh_compact(&opened.key, Some(&previous_revision))
            .unwrap()
        {
            CompactRepositoryRefresh::Unchanged { revision } => {
                assert_eq!(revision, previous_revision);
            }
            CompactRepositoryRefresh::Changed { .. } => {
                panic!("unchanged repository unexpectedly returned a snapshot")
            }
        }

        let second_oid = fixture.commit("one.txt", "one\ntwo\n", "two");
        match authority
            .refresh_compact(&opened.key, Some(&previous_revision))
            .unwrap()
        {
            CompactRepositoryRefresh::Changed { session } => {
                let snapshot = session.snapshot.expand().unwrap();
                assert_eq!(snapshot.head.as_deref(), Some(second_oid.as_str()));
                assert_ne!(snapshot.revision, previous_revision);
                assert!(
                    snapshot
                        .commits
                        .iter()
                        .all(|commit| commit.files.is_empty())
                );
            }
            CompactRepositoryRefresh::Unchanged { .. } => {
                panic!("changed repository failed to return a new snapshot")
            }
        }
    }
}
