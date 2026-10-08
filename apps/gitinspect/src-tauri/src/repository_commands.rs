use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gitinspect_core::{
    ChangeReason, CommitDiff, CommitFileDetail, CompactGitCommitBatch,
    CompactGitRepositorySnapshot, DiffOptions, FileDetailOptions, GitRefRecord, GitRemoteRecord,
    GitRepositorySnapshot, OpenOptions, PluginReport, PluginRunOptions,
    RepositoryAppendAwareRefresh, RepositoryHandle, RepositoryRefreshCursor, RepositoryService,
    WatchOptions,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPathSelection {
    pub mode: RepositoryPathSelectionMode,
    #[allow(dead_code)]
    pub expected_kind: Option<String>,
}

#[cfg(test)]
mod inspection_path_security_tests {
    use super::validate_inspection_path;

    #[test]
    fn rejects_hostile_inspection_paths() {
        for hostile in [
            "",
            "../secret",
            "a/../secret",
            "./a",
            "a//b",
            "/etc/passwd",
            "C:/Windows",
            "C:\\Windows",
            "\\\\server\\share",
            "a\\b",
            "a\0b",
            "a\nsecret",
            ".",
            "..",
        ] {
            assert!(
                validate_inspection_path(hostile).is_err(),
                "accepted hostile path"
            );
        }
        assert!(validate_inspection_path(&"x".repeat(4097)).is_err());
    }

    #[test]
    fn accepts_normal_relative_repo_paths() {
        assert!(validate_inspection_path("src/main.rs").is_ok());
        assert!(validate_inspection_path("docs/read me.md").is_ok());
    }
}

/// Only repository-relative Git paths are accepted for lazy file inspection.
fn validate_inspection_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 4096
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.contains('\0')
        || path.chars().any(char::is_control)
        || path.as_bytes().get(1) == Some(&b':')
        || path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("invalid repository-relative inspection path".into());
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn refresh_repository_compact_delta(
    repository_id: String,
    expected_revision: Option<String>,
    state: State<'_, AppState>,
) -> Result<CompactRepositoryDeltaRefresh, String> {
    state
        .authority
        .refresh_compact_delta(&repository_id, expected_revision.as_deref())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactRepositoryAppendDelta {
    pub base_revision: String,
    pub base_head: String,
    pub revision: String,
    pub head: String,
    pub head_ref: String,
    pub commits: CompactGitCommitBatch,
    pub refs: Vec<GitRefRecord>,
    pub remotes: Vec<GitRemoteRecord>,
    pub hooks: Vec<String>,
    pub drop_commit_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum CompactRepositoryDeltaRefresh {
    Unchanged {
        revision: String,
    },
    Delta {
        delta: Box<CompactRepositoryAppendDelta>,
    },
    Full {
        session: Box<CompactRepositorySession>,
    },
}

fn bounded_file_detail_options(options: Option<FileDetailOptions>) -> FileDetailOptions {
    let defaults = FileDetailOptions::default();
    let requested = options.unwrap_or_else(|| defaults.clone());
    FileDetailOptions {
        max_blob_bytes: requested.max_blob_bytes.min(defaults.max_blob_bytes),
        max_patch_lines: requested.max_patch_lines.min(defaults.max_patch_lines),
        context_lines: requested.context_lines.min(defaults.context_lines),
    }
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
    cursor: RepositoryRefreshCursor,
}

fn bounded_plugin_options(options: Option<PluginRunOptions>) -> PluginRunOptions {
    options.unwrap_or_default().bounded()
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
        let options = OpenOptions::default();
        let (handle, snapshot) =
            RepositoryService::open(path, options.clone()).map_err(|error| error.to_string())?;
        let cursor = RepositoryRefreshCursor::from_snapshot(&snapshot, &options);
        let id = self.next_repository_id.fetch_add(1, Ordering::Relaxed) + 1;
        let key = format!("repository:{id}");
        self.lock_repositories()?.insert(
            key.clone(),
            RepositoryEntry {
                handle,
                revision: snapshot.revision.clone(),
                cursor,
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

    pub fn refresh_compact_delta(
        &self,
        repository_id: &str,
        expected_revision: Option<&str>,
    ) -> Result<CompactRepositoryDeltaRefresh, String> {
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

        let options = OpenOptions::default();
        let refresh = entry
            .handle
            .refresh_append_aware(&entry.cursor, options.clone())
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

        match refresh {
            RepositoryAppendAwareRefresh::Unchanged { revision } => {
                if revision != observed_revision {
                    return Err(format!(
                        "unchanged repository revision mismatch: observed {observed_revision}, got {revision}"
                    ));
                }
                Ok(CompactRepositoryDeltaRefresh::Unchanged { revision })
            }
            RepositoryAppendAwareRefresh::Append { delta } => {
                let commits = CompactGitCommitBatch::from_commits(&delta.commits)
                    .map_err(|error| error.to_string())?;
                let next_cursor = entry.cursor.next_after(&delta);
                current.revision = delta.revision.clone();
                current.cursor = next_cursor;
                Ok(CompactRepositoryDeltaRefresh::Delta {
                    delta: Box::new(CompactRepositoryAppendDelta {
                        base_revision: delta.base_revision,
                        base_head: delta.base_head,
                        revision: delta.revision,
                        head: delta.head,
                        head_ref: delta.head_ref,
                        commits,
                        refs: delta.refs,
                        remotes: delta.remotes,
                        hooks: delta.hooks,
                        drop_commit_count: delta.drop_commit_count,
                        truncated: delta.truncated,
                    }),
                })
            }
            RepositoryAppendAwareRefresh::Full { snapshot } => {
                let cursor = RepositoryRefreshCursor::from_snapshot(&snapshot, &options);
                let compact = CompactGitRepositorySnapshot::from_snapshot(&snapshot)
                    .map_err(|error| error.to_string())?;
                current.revision = snapshot.revision;
                current.cursor = cursor;
                Ok(CompactRepositoryDeltaRefresh::Full {
                    session: Box::new(CompactRepositorySession {
                        key: repository_id.to_owned(),
                        snapshot: compact,
                    }),
                })
            }
        }
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
        let options = OpenOptions::default();
        let snapshot = entry
            .handle
            .refresh(options.clone())
            .map_err(|error| error.to_string())?;
        let cursor = RepositoryRefreshCursor::from_snapshot(&snapshot, &options);
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
        current.cursor = cursor;
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
        let cursor = RepositoryRefreshCursor::from_snapshot(&snapshot, &OpenOptions::default());
        let compact = CompactGitRepositorySnapshot::from_snapshot(&snapshot)
            .map_err(|error| error.to_string())?;
        current.revision = snapshot.revision;
        current.cursor = cursor;
        Ok(CompactRepositoryRefresh::Changed {
            session: Box::new(CompactRepositorySession {
                key: repository_id.to_owned(),
                snapshot: compact,
            }),
        })
    }

    pub fn run_plugins(
        &self,
        repository_id: &str,
        expected_revision: Option<&str>,
        options: Option<PluginRunOptions>,
    ) -> Result<PluginReport, String> {
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

        let report = entry
            .handle
            .run_plugins(bounded_plugin_options(options))
            .map_err(|error| error.to_string())?;
        if report.repository_revision != observed_revision {
            return Err(format!(
                "stale plugin report: expected revision {observed_revision}, analyzed {}",
                report.repository_revision
            ));
        }
        Ok(report)
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

    pub fn commit_file_detail(
        &self,
        repository_id: &str,
        oid: &str,
        path: &str,
        options: Option<FileDetailOptions>,
    ) -> Result<CommitFileDetail, String> {
        validate_inspection_path(path)?;
        let handle = self.handle(repository_id)?;
        handle
            .commit_file_detail(oid, path, bounded_file_detail_options(options))
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
pub fn run_repository_plugins(
    repository_id: String,
    expected_revision: Option<String>,
    options: Option<PluginRunOptions>,
    state: State<'_, AppState>,
) -> Result<PluginReport, String> {
    state
        .authority
        .run_plugins(&repository_id, expected_revision.as_deref(), options)
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
pub fn get_commit_file_detail(
    repository_id: String,
    oid: String,
    path: String,
    options: Option<FileDetailOptions>,
    state: State<'_, AppState>,
) -> Result<CommitFileDetail, String> {
    state
        .authority
        .commit_file_detail(&repository_id, &oid, &path, options)
}

fn start_repository_watch_for_app<R: Runtime>(
    repository_id: String,
    state: &AppState,
    app: AppHandle<R>,
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
pub fn start_repository_watch(
    repository_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WatchSession, String> {
    start_repository_watch_for_app(repository_id, state.inner(), app)
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

        let plugin_defaults = PluginRunOptions::default();
        let plugin_bounded = bounded_plugin_options(Some(PluginRunOptions {
            max_commits: usize::MAX,
            max_files: usize::MAX,
            max_file_bytes: u64::MAX,
            max_total_content_bytes: u64::MAX,
            max_findings_per_plugin: usize::MAX,
        }));
        assert_eq!(plugin_bounded, plugin_defaults);

        let detail_defaults = FileDetailOptions::default();
        let detail_bounded = bounded_file_detail_options(Some(FileDetailOptions {
            max_blob_bytes: u64::MAX,
            max_patch_lines: usize::MAX,
            context_lines: usize::MAX,
        }));
        assert_eq!(detail_bounded, detail_defaults);
        let detail_tightened = bounded_file_detail_options(Some(FileDetailOptions {
            max_blob_bytes: 1024,
            max_patch_lines: 50,
            context_lines: 1,
        }));
        assert_eq!(detail_tightened.max_blob_bytes, 1024);
        assert_eq!(detail_tightened.max_patch_lines, 50);
        assert_eq!(detail_tightened.context_lines, 1);
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

        let plugin_report = authority
            .run_plugins(&opened.key, Some(&refreshed.snapshot.revision), None)
            .unwrap();
        assert_eq!(
            plugin_report.repository_revision,
            refreshed.snapshot.revision
        );
        assert!(
            plugin_report
                .plugins
                .iter()
                .any(|plugin| plugin.id == "security-audit")
        );
        assert!(
            authority
                .run_plugins(&opened.key, Some(&previous_revision), None)
                .unwrap_err()
                .contains("stale repository revision")
        );

        let diff = authority
            .commit_diff(&opened.key, &second_oid, None)
            .unwrap();
        assert_eq!(diff.oid, second_oid);
        assert_eq!(diff.files.len(), 1);
        assert_eq!(diff.files[0].path, "one.txt");

        let detail = authority
            .commit_file_detail(&opened.key, &second_oid, "one.txt", None)
            .unwrap();
        assert_eq!(detail.oid, second_oid);
        assert_eq!(detail.path, "one.txt");
        assert!(!detail.hunks.is_empty());
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

    #[test]
    fn native_watcher_provenance_emits_event_before_append_aware_authority_refresh() {
        use tauri::Listener;

        let fixture = Fixture::new();
        let first_oid = fixture.commit("one.txt", "one\n", "one");
        let app = tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let state = app.state::<AppState>();
        let opened = state
            .authority
            .open_compact(fixture.path.to_str().unwrap())
            .unwrap();
        let base_revision = opened.snapshot.revision.clone();
        let (event_sender, event_receiver) = std::sync::mpsc::channel();
        let listener = app.listen("repository://changed", move |event| {
            let _ = event_sender.send(event.payload().to_owned());
        });
        let watch =
            start_repository_watch_for_app(opened.key.clone(), state.inner(), app.handle().clone())
                .expect("native Tauri repository watch starts");

        let second_oid = fixture.commit("one.txt", "one\ntwo\n", "two");
        let third_oid = fixture.commit("one.txt", "one\ntwo\nthree\n", "three");
        let event_payload = event_receiver
            .recv_timeout(Duration::from_secs(3))
            .expect("Tauri repository://changed event arrives from the native watcher");

        assert!(event_payload.contains("\"repositoryId\""));
        assert!(event_payload.contains("\"previousRevision\""));
        assert!(event_payload.contains("\"reasons\""));
        assert!(
            event_payload.contains(&opened.key),
            "event payload: {event_payload}"
        );
        assert!(
            event_payload.contains(&base_revision),
            "event must expose the authority revision that preceded refresh: {event_payload}"
        );
        // Event emission does not mutate the repository authority. The existing
        // compact/delta IPC boundary remains the sole refresh authority.
        assert_eq!(
            state.authority.revision(&opened.key).unwrap(),
            base_revision
        );

        match state
            .authority
            .refresh_compact_delta(&opened.key, Some(&base_revision))
            .unwrap()
        {
            CompactRepositoryDeltaRefresh::Delta { delta } => {
                let commits = delta.commits.expand().unwrap();
                assert_eq!(delta.base_revision, base_revision);
                assert_eq!(delta.base_head, first_oid);
                assert_eq!(delta.head, third_oid);
                assert_eq!(commits.len(), 2);
                assert_eq!(commits[0].oid, third_oid);
                assert_eq!(commits[1].oid, second_oid);
                assert_eq!(
                    state.authority.revision(&opened.key).unwrap(),
                    delta.revision
                );
            }
            other => panic!("rapid linear appends should remain a bounded delta, got {other:?}"),
        }

        if let Some(stop) = state.watches.lock().unwrap().remove(&watch.watch_id) {
            stop.store(true, Ordering::Release);
        }
        app.unlisten(listener);
    }

    #[test]
    fn delta_authority_returns_linear_append_and_full_ref_fallback() {
        let fixture = Fixture::new();
        let first_oid = fixture.commit("one.txt", "one\n", "one");
        let authority = RepositoryAuthority::default();
        let opened = authority
            .open_compact(fixture.path.to_str().unwrap())
            .unwrap();
        let base_revision = opened.snapshot.revision.clone();

        let second_oid = fixture.commit("one.txt", "one\ntwo\n", "two");
        let delta_revision = match authority
            .refresh_compact_delta(&opened.key, Some(&base_revision))
            .unwrap()
        {
            CompactRepositoryDeltaRefresh::Delta { delta } => {
                assert_eq!(delta.base_revision, base_revision);
                assert_eq!(delta.base_head, first_oid);
                assert_eq!(delta.head, second_oid);
                assert_eq!(delta.commits.expand().unwrap().len(), 1);
                delta.revision
            }
            other => panic!("expected append delta, got {other:?}"),
        };
        assert!(
            authority
                .refresh_compact_delta(&opened.key, Some(&base_revision))
                .unwrap_err()
                .contains("stale repository revision")
        );

        run(&fixture.path, ["branch", "side", "HEAD~1"]);
        match authority
            .refresh_compact_delta(&opened.key, Some(&delta_revision))
            .unwrap()
        {
            CompactRepositoryDeltaRefresh::Full { session } => {
                let snapshot = session.snapshot.expand().unwrap();
                assert!(
                    snapshot
                        .refs
                        .iter()
                        .any(|reference| reference.name == "refs/heads/side")
                );
            }
            other => panic!("ref-set change should use full fallback, got {other:?}"),
        }
    }
}
