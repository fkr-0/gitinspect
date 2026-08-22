use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, RecvTimeoutError},
};
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};

use crate::{Error, RepositoryHandle};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeReason {
    Head,
    Refs,
    Objects,
    Index,
    Config,
    Hooks,
    Worktree,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct RawWatchEvent {
    pub at: Instant,
    pub reason: ChangeReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryChange {
    pub reasons: Vec<ChangeReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchOptions {
    pub debounce_ms: u64,
}

impl Default for WatchOptions {
    fn default() -> Self {
        Self { debounce_ms: 75 }
    }
}

/// Live filesystem watcher backed by the platform `notify` implementation.
/// Dropping this value requests termination of its worker and releases the
/// underlying OS watcher shortly afterwards.
pub struct NativeRepositoryWatcher {
    receiver: Receiver<RepositoryChange>,
    stop: Arc<AtomicBool>,
}

impl NativeRepositoryWatcher {
    pub fn recv_timeout(&self, timeout: Duration) -> Result<RepositoryChange, RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }
}

impl Drop for NativeRepositoryWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

fn classify_path(path: &Path, git_dir: &Path, common_dir: &Path) -> ChangeReason {
    let relative = path
        .strip_prefix(git_dir)
        .or_else(|_| path.strip_prefix(common_dir))
        .unwrap_or(path);
    let mut components = relative.components();
    let first = components
        .next()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .unwrap_or_default();

    match first.as_str() {
        "HEAD" => ChangeReason::Head,
        "refs" | "packed-refs" => ChangeReason::Refs,
        "objects" => ChangeReason::Objects,
        "index" => ChangeReason::Index,
        "config" | "config.worktree" => ChangeReason::Config,
        "hooks" => ChangeReason::Hooks,
        _ => ChangeReason::Unknown,
    }
}

pub(crate) fn start_native_watch(
    handle: &RepositoryHandle,
    options: WatchOptions,
) -> Result<NativeRepositoryWatcher, Error> {
    let git_dir = handle.git_dir().to_path_buf();
    let common_dir = handle.common_dir().to_path_buf();
    let (raw_sender, raw_receiver) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = raw_sender.send(event);
    })
    .map_err(|error| Error::Watch(error.to_string()))?;
    watcher
        .watch(&git_dir, RecursiveMode::Recursive)
        .map_err(|error| Error::Watch(error.to_string()))?;
    if common_dir != git_dir {
        watcher
            .watch(&common_dir, RecursiveMode::Recursive)
            .map_err(|error| Error::Watch(error.to_string()))?;
    }

    let (sender, receiver) = mpsc::channel();
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    thread::spawn(move || {
        let _watcher = watcher;
        let quiet = Duration::from_millis(options.debounce_ms.max(1));
        let mut coalescer = WatchCoalescer::new(options);
        loop {
            if worker_stop.load(Ordering::Acquire) {
                break;
            }
            match raw_receiver.recv_timeout(quiet) {
                Ok(Ok(event)) => {
                    let at = Instant::now();
                    if event.paths.is_empty() {
                        coalescer.push(RawWatchEvent {
                            at,
                            reason: ChangeReason::Unknown,
                        });
                    } else {
                        for path in event.paths {
                            coalescer.push(RawWatchEvent {
                                at,
                                reason: classify_path(&path, &git_dir, &common_dir),
                            });
                        }
                    }
                }
                Ok(Err(_)) => coalescer.push(RawWatchEvent {
                    at: Instant::now(),
                    reason: ChangeReason::Unknown,
                }),
                Err(RecvTimeoutError::Timeout) => {
                    if let Some(change) = coalescer.flush()
                        && sender.send(change).is_err()
                    {
                        break;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        if let Some(change) = coalescer.flush() {
            let _ = sender.send(change);
        }
    });

    Ok(NativeRepositoryWatcher { receiver, stop })
}

/// Deterministic debounce/coalescing core. A filesystem adapter can feed raw
/// events into this type without putting timing-sensitive behavior in tests.
#[derive(Debug)]
pub struct WatchCoalescer {
    debounce: Duration,
    first_at: Option<Instant>,
    last_at: Option<Instant>,
    reasons: BTreeSet<ChangeReason>,
}

impl WatchCoalescer {
    pub fn new(options: WatchOptions) -> Self {
        Self {
            debounce: Duration::from_millis(options.debounce_ms),
            first_at: None,
            last_at: None,
            reasons: BTreeSet::new(),
        }
    }

    pub fn push(&mut self, event: RawWatchEvent) {
        self.first_at.get_or_insert(event.at);
        self.last_at = Some(event.at);
        self.reasons.insert(event.reason);
    }

    pub fn flush_if_due(&mut self, now: Instant) -> Option<RepositoryChange> {
        let last_at = self.last_at?;
        if now.saturating_duration_since(last_at) < self.debounce {
            return None;
        }
        self.flush()
    }

    pub fn flush(&mut self) -> Option<RepositoryChange> {
        if self.reasons.is_empty() {
            return None;
        }
        self.first_at = None;
        self.last_at = None;
        Some(RepositoryChange {
            reasons: std::mem::take(&mut self.reasons).into_iter().collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalesces_duplicate_reasons_and_waits_for_quiet_period() {
        let start = Instant::now();
        let mut watcher = WatchCoalescer::new(WatchOptions { debounce_ms: 50 });
        watcher.push(RawWatchEvent {
            at: start,
            reason: ChangeReason::Refs,
        });
        watcher.push(RawWatchEvent {
            at: start + Duration::from_millis(20),
            reason: ChangeReason::Head,
        });
        watcher.push(RawWatchEvent {
            at: start + Duration::from_millis(25),
            reason: ChangeReason::Refs,
        });

        assert!(
            watcher
                .flush_if_due(start + Duration::from_millis(60))
                .is_none()
        );
        assert_eq!(
            watcher
                .flush_if_due(start + Duration::from_millis(80))
                .unwrap()
                .reasons,
            vec![ChangeReason::Head, ChangeReason::Refs]
        );
    }
}
