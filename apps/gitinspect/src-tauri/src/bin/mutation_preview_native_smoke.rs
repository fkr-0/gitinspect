#[allow(dead_code)]
#[path = "../mutation_preview_commands.rs"]
mod mutation_preview_commands;
#[allow(dead_code)]
#[path = "../repository_commands.rs"]
mod repository_commands;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI32, Ordering},
};
use std::time::Duration;

use mutation_preview_commands::{
    MutationPreviewState, cancel_mutation_sandbox, confirm_mutation_preview,
    create_mutation_sandbox, preview_mutation_transaction,
};
use repository_commands::{AppState, open_repository_compact, refresh_repository_compact_delta};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const REWRITE_KINDS: [&str; 7] = [
    "rebase-reorder",
    "squash",
    "fixup",
    "reword",
    "drop",
    "split",
    "cherry-pick",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeFixtureMetadata {
    base_oid: String,
    main_oid: String,
    linear_oids: Vec<String>,
    split_oid: String,
    conflict_oid: String,
    long_oids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OriginalState {
    head: String,
    refs: String,
    index: Vec<u8>,
    worktree: BTreeMap<String, Vec<u8>>,
}

#[derive(Debug)]
struct SmokeFixture {
    path: PathBuf,
    metadata: SmokeFixtureMetadata,
    original: OriginalState,
}

impl SmokeFixture {
    fn new(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
        let path = root.join(format!("repository-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        run_git(&path, ["init", "-b", "main"])?;
        run_git(
            &path,
            ["config", "user.name", "Mutation Preview Native Smoke"],
        )?;
        run_git(
            &path,
            [
                "config",
                "user.email",
                "mutation-preview-native-smoke@example.invalid",
            ],
        )?;

        fs::write(path.join("conflict.txt"), "base\n").map_err(|error| error.to_string())?;
        let base_oid = commit_all(&path, "base")?;

        run_git(&path, ["checkout", "-b", "linear", &base_oid])?;
        let mut linear_oids = Vec::new();
        for (name, contents) in [("a.txt", "a\n"), ("b.txt", "b\n"), ("c.txt", "c\n")] {
            fs::write(path.join(name), contents).map_err(|error| error.to_string())?;
            linear_oids.push(commit_all(&path, &format!("linear {name}"))?);
        }

        run_git(&path, ["checkout", "-b", "split", &base_oid])?;
        fs::write(path.join("split-a.txt"), "split a\n").map_err(|error| error.to_string())?;
        fs::write(path.join("split-b.txt"), "split b\n").map_err(|error| error.to_string())?;
        let split_oid = commit_all(&path, "native deterministic split source")?;

        run_git(&path, ["checkout", "-b", "conflict", &base_oid])?;
        fs::write(path.join("conflict.txt"), "feature\n").map_err(|error| error.to_string())?;
        let conflict_oid = commit_all(&path, "feature conflict")?;

        run_git(&path, ["checkout", "-b", "long", &base_oid])?;
        let mut long_oids = Vec::new();
        for index in 0..64 {
            let name = format!("long-{index:02}.txt");
            let contents = format!("long rewrite fixture {index:02}\n");
            fs::write(path.join(&name), contents).map_err(|error| error.to_string())?;
            long_oids.push(commit_all(&path, &format!("long {index:02}"))?);
        }

        run_git(&path, ["checkout", "main"])?;
        fs::write(path.join("conflict.txt"), "main\n").map_err(|error| error.to_string())?;
        let main_oid = commit_all(&path, "main conflict")?;

        let metadata = SmokeFixtureMetadata {
            base_oid,
            main_oid,
            linear_oids,
            split_oid,
            conflict_oid,
            long_oids,
        };
        let original = original_state(&path)?;
        Ok(Self {
            path,
            metadata,
            original,
        })
    }
}

#[derive(Debug)]
struct SmokeState {
    fixture_path: PathBuf,
    sandbox_root: PathBuf,
    result_path: PathBuf,
    metadata: SmokeFixtureMetadata,
    initial_original: OriginalState,
    expected_after_advance: Mutex<Option<OriginalState>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SandboxProbe {
    sandbox_count: usize,
    long_preview_started: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmokeReport {
    passed: bool,
    message: String,
    rewrite_kinds: Vec<String>,
    ordered_operation_summaries: Vec<String>,
    reorder_old_oids: Vec<String>,
    reorder_new_oids: Vec<String>,
    cascade_parent_oids: Vec<String>,
    conflict_files: Vec<String>,
    stale_message: String,
    cancellation_preview_started: bool,
    cancellation_returned_to_idle: bool,
    confirm_sandbox_count: usize,
    conflict_sandbox_count: usize,
    cancellation_sandbox_count: usize,
    apply_disabled: bool,
    eager_materialization_commands_registered: bool,
    frame_renderer: String,
    frame_timing_blocker: String,
    frame_logical_commit_count: usize,
    frame_preview_commit_count: usize,
    frame_samples: usize,
    frame_baseline_median_ms: f64,
    frame_baseline_p95_ms: f64,
    frame_transition_median_ms: f64,
    frame_transition_p95_ms: f64,
    frame_transition_max_ms: f64,
    #[serde(rename = "frameTransitionOver16_7Ms")]
    frame_transition_over16_7_ms: usize,
    topology_commit_latency_ms: f64,
    frame_visibility_state: String,
    frame_document_has_focus: bool,
    frame_visibility_changes: usize,
    frame_window_focus_events: usize,
    frame_window_blur_events: usize,
    frame_max_gap_visibility_state: String,
    frame_max_gap_document_has_focus: bool,
    frame_accessibility_live: bool,
    frame_accessibility_pressed: bool,
    frame_accessibility_roving: bool,
    frame_accessibility_element_id: String,
    frame_accessibility_blocker: String,
    frame_accessibility_visibility_state: String,
    frame_accessibility_document_has_focus: bool,
    frame_accessibility_focus_stable: bool,
    frame_accessibility_diagnostics: String,
}

#[tauri::command]
fn mutation_preview_native_smoke_fixture(state: State<'_, SmokeState>) -> SmokeFixtureMetadata {
    state.metadata.clone()
}

#[tauri::command]
fn mutation_preview_native_smoke_progress(message: String) {
    println!(
        "MUTATION_PREVIEW_NATIVE_SMOKE_PROGRESS={}",
        message.replace(['\n', '\r'], " ")
    );
}

#[tauri::command]
fn mutation_preview_native_smoke_advance(state: State<'_, SmokeState>) -> Result<String, String> {
    let before = original_state(&state.fixture_path)?;
    if before != state.initial_original {
        return Err(
            "original repository changed before the intentional stale-revision fixture advance"
                .to_owned(),
        );
    }
    fs::write(
        state.fixture_path.join("stale.txt"),
        "intentional stale advance\n",
    )
    .map_err(|error| error.to_string())?;
    let oid = commit_all(&state.fixture_path, "intentional stale advance")?;
    let after = original_state(&state.fixture_path)?;
    *state
        .expected_after_advance
        .lock()
        .map_err(|_| "expected original-state lock poisoned".to_owned())? = Some(after);
    Ok(oid)
}

#[tauri::command]
fn mutation_preview_native_smoke_probe(
    state: State<'_, SmokeState>,
) -> Result<SandboxProbe, String> {
    probe_sandboxes(&state.sandbox_root)
}

#[tauri::command(rename_all = "camelCase")]
fn mutation_preview_native_smoke_complete(
    report: SmokeReport,
    state: State<'_, SmokeState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut failures = Vec::new();
    if !report.passed {
        failures.push(format!("JavaScript smoke failed: {}", report.message));
    }
    if report.rewrite_kinds != REWRITE_KINDS.map(str::to_owned) {
        failures.push(format!(
            "rewrite kind coverage mismatch: {:?}",
            report.rewrite_kinds
        ));
    }
    if report.reorder_old_oids
        != vec![
            state.metadata.linear_oids[2].clone(),
            state.metadata.linear_oids[0].clone(),
            state.metadata.linear_oids[1].clone(),
        ]
    {
        failures
            .push("rebase-reorder old-commit evidence did not preserve caller order".to_owned());
    }
    if report.reorder_new_oids.len() != 3
        || report.reorder_new_oids.iter().any(|oid| oid.len() != 40)
    {
        failures.push("rebase-reorder did not expose three full rewritten commit OIDs".to_owned());
    }
    if report.cascade_parent_oids.len() != 3
        || report.cascade_parent_oids.first() != Some(&state.metadata.base_oid)
        || report.cascade_parent_oids.get(1) != report.reorder_new_oids.first()
        || report.cascade_parent_oids.get(2) != report.reorder_new_oids.get(1)
    {
        failures.push("hash-cascade parent chain did not match rewritten commit order".to_owned());
    }
    if report.conflict_files != ["conflict.txt"] {
        failures.push(format!(
            "structured conflict filenames mismatch: {:?}",
            report.conflict_files
        ));
    }
    if !report.stale_message.contains("stale repository revision") {
        failures.push(format!(
            "stale revision rejection was not visible: {}",
            report.stale_message
        ));
    }
    if !report.cancellation_preview_started || !report.cancellation_returned_to_idle {
        failures.push(
            "in-flight native cancellation did not complete through the tray lifecycle".to_owned(),
        );
    }
    if report.confirm_sandbox_count != 0
        || report.conflict_sandbox_count != 0
        || report.cancellation_sandbox_count != 0
    {
        failures.push(format!(
            "sandbox cleanup counts were non-zero: confirm={}, conflict={}, cancellation={}",
            report.confirm_sandbox_count,
            report.conflict_sandbox_count,
            report.cancellation_sandbox_count
        ));
    }
    if !report.apply_disabled {
        failures.push("original-repository Apply control was not disabled".to_owned());
    }
    if report.eager_materialization_commands_registered {
        failures
            .push("native smoke registered eager diff/blob materialization commands".to_owned());
    }
    let normalized_renderer = report.frame_renderer.trim().to_ascii_lowercase();
    if normalized_renderer.is_empty()
        || normalized_renderer == "unavailable"
        || ["llvmpipe", "softpipe", "swiftshader", "software rasterizer"]
            .iter()
            .any(|marker| normalized_renderer.contains(marker))
    {
        failures.push(format!(
            "headed GraphScene did not report a hardware-accelerated WebGL renderer: {}",
            report.frame_renderer
        ));
    }
    if report.frame_logical_commit_count != 1_000 || report.frame_preview_commit_count != 32 {
        failures.push(format!(
            "headed frame fixture bounds mismatch: logical={}, preview={}",
            report.frame_logical_commit_count, report.frame_preview_commit_count
        ));
    }
    if report.frame_timing_blocker.is_empty() {
        if report.frame_samples < 120 {
            failures.push(format!(
                "headed frame sample bound mismatch: samples={}",
                report.frame_samples
            ));
        }
        if report.frame_baseline_median_ms <= 0.0
            || report.frame_transition_median_ms <= 0.0
            || report.frame_transition_p95_ms <= 0.0
            || report.frame_transition_max_ms <= 0.0
            || report.topology_commit_latency_ms <= 0.0
        {
            failures.push("headed frame timing evidence contained non-positive samples".to_owned());
        }
        if report.frame_visibility_state != "visible"
            || !report.frame_document_has_focus
            || report.frame_max_gap_visibility_state != "visible"
            || !report.frame_max_gap_document_has_focus
            || report.frame_visibility_changes != 0
            || report.frame_window_blur_events != 0
        {
            failures.push(format!(
                "headed frame visibility/focus was not stable: final_visibility={}, final_focus={}, visibility_changes={}, focus_events={}, blur_events={}, max_gap_visibility={}, max_gap_focus={}",
                report.frame_visibility_state,
                report.frame_document_has_focus,
                report.frame_visibility_changes,
                report.frame_window_focus_events,
                report.frame_window_blur_events,
                report.frame_max_gap_visibility_state,
                report.frame_max_gap_document_has_focus
            ));
        }
    } else {
        failures.push(format!(
            "headed frame timing blocker: {}",
            report.frame_timing_blocker
        ));
        if report.frame_samples != 0 {
            failures.push(format!(
                "headed frame timing blocker was reported with unexpected samples: blocker={}, samples={}",
                report.frame_timing_blocker, report.frame_samples
            ));
        }
    }
    if !report.frame_accessibility_blocker.is_empty() {
        failures.push(format!(
            "transformed-topology accessibility blocker: {}",
            report.frame_accessibility_blocker
        ));
    } else if !report.frame_accessibility_live
        || !report.frame_accessibility_pressed
        || !report.frame_accessibility_roving
        || report.frame_accessibility_element_id.is_empty()
    {
        failures.push(format!(
            "transformed-topology accessibility evidence incomplete: live={}, pressed={}, roving={}, element_id={}",
            report.frame_accessibility_live,
            report.frame_accessibility_pressed,
            report.frame_accessibility_roving,
            report.frame_accessibility_element_id
        ));
    }
    if report.frame_accessibility_visibility_state != "visible"
        || !report.frame_accessibility_document_has_focus
        || !report.frame_accessibility_focus_stable
    {
        failures.push(format!(
            "transformed-topology accessibility visibility/focus was not stable: visibility={}, focus={}, diagnostic_focus_stable={}",
            report.frame_accessibility_visibility_state,
            report.frame_accessibility_document_has_focus,
            report.frame_accessibility_focus_stable
        ));
    }

    let final_probe = probe_sandboxes(&state.sandbox_root)?;
    if final_probe.sandbox_count != 0 {
        failures.push(format!(
            "{} disposable sandbox(es) remained at native completion",
            final_probe.sandbox_count
        ));
    }

    let expected = state
        .expected_after_advance
        .lock()
        .map_err(|_| "expected original-state lock poisoned".to_owned())?
        .clone();
    match expected {
        Some(expected) => {
            let actual = original_state(&state.fixture_path)?;
            if actual != expected {
                failures.push(
                    "original repository changed outside the one intentional stale-revision fixture advance"
                        .to_owned(),
                );
            }
        }
        None => failures
            .push("intentional stale-revision fixture advance was never executed".to_owned()),
    }

    let passed = failures.is_empty();
    let text = format_report(&report, &failures);
    fs::write(&state.result_path, &text).map_err(|error| error.to_string())?;
    println!("{text}");

    if let Err(error) = fs::remove_dir_all(&state.fixture_path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        return Err(format!("fixture cleanup failed: {error}"));
    }

    let exit_code = if passed { 0 } else { 1 };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        app.exit(exit_code);
    });
    Ok(())
}

fn main() {
    let harness_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("mutation-preview-native-smoke");
    fs::create_dir_all(&harness_root).expect("create native rewrite smoke root");
    let fixture = SmokeFixture::new(&harness_root).expect("create native rewrite smoke fixture");
    let sandbox_root = harness_root.join("sandboxes");
    let _ = fs::remove_dir_all(&sandbox_root);
    let preview_state = MutationPreviewState::with_root(sandbox_root.clone())
        .expect("create isolated preview state");
    let result_path = harness_root.join("last-result.txt");
    let _ = fs::remove_file(&result_path);
    let repository_url_path = fixture.path.to_string_lossy().into_owned();
    let fixture_path = fixture.path.clone();
    let timeout_fixture_path = fixture.path.clone();
    let timeout_result_path = result_path.clone();
    let post_run_sandbox_root = sandbox_root.clone();

    let app = tauri::Builder::default()
        .manage(AppState::default())
        .manage(preview_state)
        .manage(SmokeState {
            fixture_path: fixture.path,
            sandbox_root,
            result_path: result_path.clone(),
            metadata: fixture.metadata,
            initial_original: fixture.original,
            expected_after_advance: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            open_repository_compact,
            refresh_repository_compact_delta,
            create_mutation_sandbox,
            preview_mutation_transaction,
            confirm_mutation_preview,
            cancel_mutation_sandbox,
            mutation_preview_native_smoke_fixture,
            mutation_preview_native_smoke_progress,
            mutation_preview_native_smoke_advance,
            mutation_preview_native_smoke_probe,
            mutation_preview_native_smoke_complete,
        ])
        .setup(move |app| {
            let url = format!(
                "http://127.0.0.1:1420/mutation-preview-native-smoke.html?repository={repository_url_path}"
            );
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("configured main webview is unavailable"))?;
            window.navigate(url.parse::<tauri::Url>()?)?;
            window.show()?;
            window.set_focus()?;

            let app_handle = app.handle().clone();
            let timeout_fixture_path = timeout_fixture_path.clone();
            let timeout_result_path = timeout_result_path.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(90));
                if !timeout_result_path.exists() {
                    let _ = fs::remove_dir_all(&timeout_fixture_path);
                    let text = "MUTATION_PREVIEW_NATIVE_SMOKE=FAIL\nmessage=timed out before JavaScript smoke completion\n";
                    let _ = fs::write(&timeout_result_path, text);
                    eprintln!("{text}");
                    app_handle.exit(2);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build mutation preview native smoke Tauri application");

    let requested_exit_code = Arc::new(AtomicI32::new(i32::MIN));
    let requested_exit_code_for_run = Arc::clone(&requested_exit_code);
    let runtime_exit_code = app.run_return(move |_, event| {
        if let tauri::RunEvent::ExitRequested {
            code: Some(exit_code),
            ..
        } = event
        {
            requested_exit_code_for_run.store(exit_code, Ordering::SeqCst);
        }
    });
    let requested_exit_code = requested_exit_code.load(Ordering::SeqCst);
    let exit_code = if requested_exit_code == i32::MIN {
        runtime_exit_code
    } else {
        requested_exit_code
    };
    let report_text = fs::read_to_string(&result_path).unwrap_or_else(|error| {
        format!("MUTATION_PREVIEW_NATIVE_SMOKE=FAIL\nmessage=missing result: {error}\n")
    });
    let passed = exit_code == 0 && report_text.starts_with("MUTATION_PREVIEW_NATIVE_SMOKE=PASS\n");
    let _ = fs::remove_dir_all(&fixture_path);
    let _ = fs::remove_dir_all(&post_run_sandbox_root);
    assert!(
        passed,
        "mutation preview native smoke failed with app exit code {exit_code}:\n{report_text}"
    );
}

fn probe_sandboxes(root: &Path) -> Result<SandboxProbe, String> {
    if !root.exists() {
        return Ok(SandboxProbe {
            sandbox_count: 0,
            long_preview_started: false,
        });
    }
    let mut sandbox_count = 0;
    let mut long_preview_started = false;
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name();
        if !file_name.to_string_lossy().starts_with("sandbox-") || !entry.path().is_dir() {
            continue;
        }
        sandbox_count += 1;
        let head_path = entry.path().join(".git").join("HEAD");
        if let Ok(head) = fs::read_to_string(head_path)
            && head.trim() == "ref: refs/heads/long"
        {
            long_preview_started = true;
        }
    }
    Ok(SandboxProbe {
        sandbox_count,
        long_preview_started,
    })
}

fn original_state(path: &Path) -> Result<OriginalState, String> {
    let head = git_output(path, ["symbolic-ref", "-q", "HEAD"])?;
    let refs = git_output(path, ["show-ref", "--head"])?;
    let index = fs::read(path.join(".git/index")).map_err(|error| error.to_string())?;
    let mut worktree = BTreeMap::new();
    collect_worktree(path, path, &mut worktree)?;
    Ok(OriginalState {
        head,
        refs,
        index,
        worktree,
    })
}

fn collect_worktree(
    root: &Path,
    current: &Path,
    output: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
        if relative
            .components()
            .next()
            .is_some_and(|part| part.as_os_str() == ".git")
        {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            collect_worktree(root, &path, output)?;
        } else if file_type.is_file() {
            output.insert(
                relative.to_string_lossy().into_owned(),
                fs::read(path).map_err(|error| error.to_string())?,
            );
        }
    }
    Ok(())
}

fn commit_all(path: &Path, message: &str) -> Result<String, String> {
    run_git(path, ["add", "-A"])?;
    run_git(path, ["commit", "-m", message])?;
    git_output(path, ["rev-parse", "HEAD"])
}

fn run_git<I, S>(cwd: &Path, args: I) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", "Mutation Preview Native Smoke")
        .env(
            "GIT_AUTHOR_EMAIL",
            "mutation-preview-native-smoke@example.invalid",
        )
        .env("GIT_COMMITTER_NAME", "Mutation Preview Native Smoke")
        .env(
            "GIT_COMMITTER_EMAIL",
            "mutation-preview-native-smoke@example.invalid",
        )
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn git_output<I, S>(cwd: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8(output.stdout)
        .map_err(|error| error.to_string())?
        .trim()
        .to_owned())
}

fn format_report(report: &SmokeReport, failures: &[String]) -> String {
    let clean = |value: &str| value.replace(['\n', '\r'], " ");
    let passed = failures.is_empty();
    format!(
        concat!(
            "MUTATION_PREVIEW_NATIVE_SMOKE={}\n",
            "message={}\n",
            "rewrite_kinds={}\n",
            "ordered_operation_summaries={}\n",
            "reorder_old_oids={}\n",
            "reorder_new_oids={}\n",
            "cascade_parent_oids={}\n",
            "conflict_files={}\n",
            "stale_message={}\n",
            "cancellation_preview_started={}\n",
            "cancellation_returned_to_idle={}\n",
            "confirm_sandbox_count={}\n",
            "conflict_sandbox_count={}\n",
            "cancellation_sandbox_count={}\n",
            "apply_disabled={}\n",
            "eager_materialization_commands_registered={}\n",
            "frame_renderer={}\n",
            "frame_timing_blocker={}\n",
            "frame_logical_commit_count={}\n",
            "frame_preview_commit_count={}\n",
            "frame_samples={}\n",
            "frame_baseline_median_ms={}\n",
            "frame_baseline_p95_ms={}\n",
            "frame_transition_median_ms={}\n",
            "frame_transition_p95_ms={}\n",
            "frame_transition_max_ms={}\n",
            "frame_transition_over16_7_ms={}\n",
            "topology_commit_latency_ms={}\n",
            "frame_visibility_state={}\n",
            "frame_document_has_focus={}\n",
            "frame_visibility_changes={}\n",
            "frame_window_focus_events={}\n",
            "frame_window_blur_events={}\n",
            "frame_max_gap_visibility_state={}\n",
            "frame_max_gap_document_has_focus={}\n",
            "frame_accessibility_live={}\n",
            "frame_accessibility_pressed={}\n",
            "frame_accessibility_roving={}\n",
            "frame_accessibility_element_id={}\n",
            "frame_accessibility_blocker={}\n",
            "frame_accessibility_visibility_state={}\n",
            "frame_accessibility_document_has_focus={}\n",
            "frame_accessibility_focus_stable={}\n",
            "frame_accessibility_diagnostics={}\n",
            "failures={}\n"
        ),
        if passed { "PASS" } else { "FAIL" },
        clean(&report.message),
        report.rewrite_kinds.join(","),
        report
            .ordered_operation_summaries
            .iter()
            .map(|value| clean(value))
            .collect::<Vec<_>>()
            .join(" | "),
        report.reorder_old_oids.join(","),
        report.reorder_new_oids.join(","),
        report.cascade_parent_oids.join(","),
        report.conflict_files.join(","),
        clean(&report.stale_message),
        report.cancellation_preview_started,
        report.cancellation_returned_to_idle,
        report.confirm_sandbox_count,
        report.conflict_sandbox_count,
        report.cancellation_sandbox_count,
        report.apply_disabled,
        report.eager_materialization_commands_registered,
        clean(&report.frame_renderer),
        clean(&report.frame_timing_blocker),
        report.frame_logical_commit_count,
        report.frame_preview_commit_count,
        report.frame_samples,
        report.frame_baseline_median_ms,
        report.frame_baseline_p95_ms,
        report.frame_transition_median_ms,
        report.frame_transition_p95_ms,
        report.frame_transition_max_ms,
        report.frame_transition_over16_7_ms,
        report.topology_commit_latency_ms,
        clean(&report.frame_visibility_state),
        report.frame_document_has_focus,
        report.frame_visibility_changes,
        report.frame_window_focus_events,
        report.frame_window_blur_events,
        clean(&report.frame_max_gap_visibility_state),
        report.frame_max_gap_document_has_focus,
        report.frame_accessibility_live,
        report.frame_accessibility_pressed,
        report.frame_accessibility_roving,
        clean(&report.frame_accessibility_element_id),
        clean(&report.frame_accessibility_blocker),
        clean(&report.frame_accessibility_visibility_state),
        report.frame_accessibility_document_has_focus,
        report.frame_accessibility_focus_stable,
        clean(&report.frame_accessibility_diagnostics),
        failures
            .iter()
            .map(|failure| clean(failure))
            .collect::<Vec<_>>()
            .join(" | "),
    )
}
