use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use gitinspect_core::{GitRepositorySnapshot, OpenOptions, RepositoryService};
use serde::Serialize;

const BASE_TIMESTAMP: i64 = 1_700_000_000;
const FIXTURE_CONTENT: &str = "synthetic scale fixture\n";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositorySessionPayload<'a> {
    key: &'a str,
    snapshot: &'a GitRepositorySnapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScaleBenchResult {
    commits_requested: usize,
    commits_loaded: usize,
    fixture_generation_ms: f64,
    snapshot_open_ms: f64,
    snapshot_serialization_ms: f64,
    ipc_serialization_ms: f64,
    snapshot_json_bytes: usize,
    ipc_session_json_bytes: usize,
    payload_bytes_per_commit: f64,
    unchanged_refresh_ms: f64,
    changed_refresh_ms: f64,
    changed_commits_loaded: usize,
    all_commit_files_lazy: bool,
    snapshot_truncated: bool,
    deterministic_head: String,
    revision: String,
    snapshot_rss_bytes: Option<u64>,
    ipc_rss_bytes: Option<u64>,
    final_rss_bytes: Option<u64>,
    peak_rss_bytes: Option<u64>,
    fixture_path: String,
}

fn elapsed_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn parse_commit_count() -> Result<usize, String> {
    let mut args = std::env::args().skip(1);
    let raw = args
        .next()
        .ok_or_else(|| "usage: scale_bench <commit-count>".to_owned())?;
    if args.next().is_some() {
        return Err("scale_bench accepts exactly one commit-count argument".to_owned());
    }
    let count = raw
        .parse::<usize>()
        .map_err(|error| format!("invalid commit count {raw:?}: {error}"))?;
    if count == 0 || count > 1_000_000 {
        return Err("commit count must be between 1 and 1,000,000".to_owned());
    }
    Ok(count)
}

fn fixture_path(commit_count: usize) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("scale-bench")
        .join(format!("history-{commit_count}"))
}

fn run_git(path: &Path, args: &[&str]) -> Result<(), String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|error| format!("failed to run git {args:?}: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

fn write_data(stream: &mut impl Write, value: &str) -> std::io::Result<()> {
    writeln!(stream, "data {}", value.len())?;
    write!(stream, "{value}")?;
    if !value.ends_with('\n') {
        writeln!(stream)?;
    }
    Ok(())
}

fn generate_fixture(path: &Path, commit_count: usize) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("failed to replace {}: {error}", path.display()))?;
    }
    fs::create_dir_all(path)
        .map_err(|error| format!("failed to create {}: {error}", path.display()))?;
    run_git(path, &["init", "-q", "-b", "main"])?;

    let mut child = Command::new("git")
        .args(["fast-import", "--quiet"])
        .current_dir(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start git fast-import: {error}"))?;
    {
        let stream = child
            .stdin
            .as_mut()
            .ok_or_else(|| "git fast-import stdin unavailable".to_owned())?;
        for index in 0..commit_count {
            let mark = index + 1;
            let timestamp = BASE_TIMESTAMP + index as i64;
            writeln!(stream, "commit refs/heads/main").map_err(|error| error.to_string())?;
            writeln!(stream, "mark :{mark}").map_err(|error| error.to_string())?;
            writeln!(
                stream,
                "author Scale Fixture <scale@example.invalid> {timestamp} +0000"
            )
            .map_err(|error| error.to_string())?;
            writeln!(
                stream,
                "committer Scale Fixture <scale@example.invalid> {timestamp} +0000"
            )
            .map_err(|error| error.to_string())?;
            write_data(stream, &format!("synthetic commit {index}\n"))
                .map_err(|error| error.to_string())?;
            if index > 0 {
                writeln!(stream, "from :{index}").map_err(|error| error.to_string())?;
            }
            writeln!(stream, "M 100644 inline state.txt").map_err(|error| error.to_string())?;
            write_data(stream, FIXTURE_CONTENT).map_err(|error| error.to_string())?;
            writeln!(stream).map_err(|error| error.to_string())?;
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed waiting for git fast-import: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "git fast-import failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn append_refresh_commit(path: &Path, ordinal: usize) -> Result<(), String> {
    let timestamp = BASE_TIMESTAMP + ordinal as i64;
    let head_output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(path)
        .output()
        .map_err(|error| format!("failed to resolve refresh parent: {error}"))?;
    if !head_output.status.success() {
        return Err(format!(
            "failed to resolve refresh parent: {}",
            String::from_utf8_lossy(&head_output.stderr).trim()
        ));
    }
    let parent = String::from_utf8(head_output.stdout)
        .map_err(|error| format!("refresh parent was not UTF-8: {error}"))?;
    let parent = parent.trim();
    let mut child = Command::new("git")
        .args(["fast-import", "--quiet"])
        .current_dir(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start refresh fast-import: {error}"))?;
    {
        let stream = child
            .stdin
            .as_mut()
            .ok_or_else(|| "refresh fast-import stdin unavailable".to_owned())?;
        writeln!(stream, "commit refs/heads/main").map_err(|error| error.to_string())?;
        writeln!(
            stream,
            "author Scale Fixture <scale@example.invalid> {timestamp} +0000"
        )
        .map_err(|error| error.to_string())?;
        writeln!(
            stream,
            "committer Scale Fixture <scale@example.invalid> {timestamp} +0000"
        )
        .map_err(|error| error.to_string())?;
        write_data(stream, "refresh commit\n").map_err(|error| error.to_string())?;
        writeln!(stream, "from {parent}").map_err(|error| error.to_string())?;
        writeln!(stream, "M 100644 inline state.txt").map_err(|error| error.to_string())?;
        write_data(stream, FIXTURE_CONTENT).map_err(|error| error.to_string())?;
        writeln!(stream).map_err(|error| error.to_string())?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed waiting for refresh fast-import: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "refresh fast-import failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn proc_memory_bytes(field: &str) -> Option<u64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|line| line.starts_with(field))?;
    let kib = line.split_whitespace().nth(1)?.parse::<u64>().ok()?;
    Some(kib.saturating_mul(1024))
}

fn run() -> Result<ScaleBenchResult, String> {
    let commits_requested = parse_commit_count()?;
    let fixture_path = fixture_path(commits_requested);

    let generation_started = Instant::now();
    generate_fixture(&fixture_path, commits_requested)?;
    let fixture_generation_ms = elapsed_ms(generation_started.elapsed());

    let options = OpenOptions {
        max_commits: commits_requested + 1,
        include_commit_files: false,
        ..OpenOptions::default()
    };
    let snapshot_started = Instant::now();
    let (handle, snapshot) = RepositoryService::open(&fixture_path, options.clone())
        .map_err(|error| error.to_string())?;
    let snapshot_open_ms = elapsed_ms(snapshot_started.elapsed());
    if snapshot.commits.len() != commits_requested {
        return Err(format!(
            "fixture expected {commits_requested} commits, snapshot loaded {}",
            snapshot.commits.len()
        ));
    }
    let all_commit_files_lazy = snapshot
        .commits
        .iter()
        .all(|commit| commit.files.is_empty());
    if !all_commit_files_lazy {
        return Err("metadata-only snapshot eagerly materialized commit files".to_owned());
    }

    let snapshot_rss_bytes = proc_memory_bytes("VmRSS:");
    let snapshot_serialization_started = Instant::now();
    let snapshot_payload = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;
    let snapshot_serialization_ms = elapsed_ms(snapshot_serialization_started.elapsed());
    let snapshot_json_bytes = snapshot_payload.len();
    drop(snapshot_payload);

    let ipc_serialization_started = Instant::now();
    let ipc_payload = serde_json::to_vec(&RepositorySessionPayload {
        key: "repository:1",
        snapshot: &snapshot,
    })
    .map_err(|error| error.to_string())?;
    let ipc_serialization_ms = elapsed_ms(ipc_serialization_started.elapsed());
    let ipc_session_json_bytes = ipc_payload.len();
    let ipc_rss_bytes = proc_memory_bytes("VmRSS:");
    drop(ipc_payload);

    let unchanged_started = Instant::now();
    let unchanged = handle
        .refresh(options.clone())
        .map_err(|error| error.to_string())?;
    let unchanged_refresh_ms = elapsed_ms(unchanged_started.elapsed());
    if unchanged.revision != snapshot.revision || unchanged.commits != snapshot.commits {
        return Err("unchanged refresh produced a different snapshot".to_owned());
    }
    drop(unchanged);

    append_refresh_commit(&fixture_path, commits_requested)?;
    let changed_started = Instant::now();
    let changed = handle.refresh(options).map_err(|error| error.to_string())?;
    let changed_refresh_ms = elapsed_ms(changed_started.elapsed());
    if changed.commits.len() != commits_requested + 1 || changed.revision == snapshot.revision {
        return Err("changed refresh did not observe exactly one appended commit".to_owned());
    }
    if changed
        .commits
        .iter()
        .any(|commit| !commit.files.is_empty())
    {
        return Err("changed metadata-only refresh eagerly materialized commit files".to_owned());
    }
    let changed_commits_loaded = changed.commits.len();
    drop(changed);

    let deterministic_head = snapshot
        .head
        .clone()
        .ok_or_else(|| "generated fixture has no HEAD".to_owned())?;
    Ok(ScaleBenchResult {
        commits_requested,
        commits_loaded: snapshot.commits.len(),
        fixture_generation_ms,
        snapshot_open_ms,
        snapshot_serialization_ms,
        ipc_serialization_ms,
        snapshot_json_bytes,
        ipc_session_json_bytes,
        payload_bytes_per_commit: ipc_session_json_bytes as f64 / commits_requested as f64,
        unchanged_refresh_ms,
        changed_refresh_ms,
        changed_commits_loaded,
        all_commit_files_lazy,
        snapshot_truncated: snapshot.truncated,
        deterministic_head,
        revision: snapshot.revision,
        snapshot_rss_bytes,
        ipc_rss_bytes,
        final_rss_bytes: proc_memory_bytes("VmRSS:"),
        peak_rss_bytes: proc_memory_bytes("VmHWM:"),
        fixture_path: fixture_path.to_string_lossy().into_owned(),
    })
}

fn main() {
    match run() {
        Ok(result) => println!(
            "{}",
            serde_json::to_string(&result).expect("serialize result")
        ),
        Err(error) => {
            eprintln!("scale_bench: {error}");
            std::process::exit(2);
        }
    }
}
