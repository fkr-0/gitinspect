use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

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
