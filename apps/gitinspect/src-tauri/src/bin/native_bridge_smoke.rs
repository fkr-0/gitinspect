#[allow(dead_code)]
#[path = "../repository_commands.rs"]
mod repository_commands;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use repository_commands::{
    AppState, get_commit_diff, get_commit_file_detail, open_repository_compact,
    refresh_repository_compact_delta, start_repository_watch, stop_repository_watch,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

#[derive(Debug)]
struct SmokeFixture {
    path: PathBuf,
    base_oid: String,
}

impl SmokeFixture {
    fn new() -> Result<Self, String> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("native-bridge-smoke");
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let path = root.join(format!("repository-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        run_git(&path, ["init", "-b", "main"])?;
        run_git(&path, ["config", "user.name", "Native Bridge Smoke"])?;
        run_git(
            &path,
            [
                "config",
                "user.email",
                "native-bridge-smoke@example.invalid",
            ],
        )?;
        fs::write(path.join("survive.txt"), "base\n").map_err(|error| error.to_string())?;
        commit_all(&path, "base")?;
        let base_oid = git_output(&path, ["rev-parse", "HEAD"])?;
        fs::write(path.join("survive.txt"), "base\nselected\n")
            .map_err(|error| error.to_string())?;
        commit_all(&path, "selected deep target")?;
        run_git(&path, ["branch", "ephemeral", "HEAD"])?;
        Ok(Self { path, base_oid })
    }
}

#[derive(Debug)]
struct SmokeState {
    fixture_path: PathBuf,
    base_oid: String,
    result_path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeMutationResult {
    phase: String,
    oids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmokeReport {
    passed: bool,
    message: String,
    service_mode: String,
    global_tauri: bool,
    change_count: usize,
    refresh_count: usize,
    initial_revision: String,
    rapid_revision: String,
    final_revision: String,
    rapid_commit_oids: Vec<String>,
    deep_selection_id: String,
    deep_selection_preserved: bool,
    disappeared_element_id: String,
    selection_cleared: bool,
    selection_notice: String,
    navigation_rewound: bool,
    navigation_notice: String,
}

#[tauri::command(rename_all = "camelCase")]
fn native_bridge_smoke_mutate(
    phase: String,
    state: State<'_, SmokeState>,
) -> Result<SmokeMutationResult, String> {
    match phase.as_str() {
        "rapid" => {
            fs::write(state.fixture_path.join("burst.txt"), "one\n")
                .map_err(|error| error.to_string())?;
            commit_all(&state.fixture_path, "rapid one")?;
            let first = git_output(&state.fixture_path, ["rev-parse", "HEAD"])?;
            std::thread::sleep(Duration::from_millis(75));
            fs::write(state.fixture_path.join("burst.txt"), "one\ntwo\n")
                .map_err(|error| error.to_string())?;
            commit_all(&state.fixture_path, "rapid two")?;
            let second = git_output(&state.fixture_path, ["rev-parse", "HEAD"])?;
            Ok(SmokeMutationResult {
                phase,
                oids: vec![first, second],
            })
        }
        "disappear" => {
            run_git(&state.fixture_path, ["branch", "-D", "ephemeral"])?;
            std::thread::sleep(Duration::from_millis(75));
            run_git(
                &state.fixture_path,
                ["reset", "--hard", state.base_oid.as_str()],
            )?;
            Ok(SmokeMutationResult {
                phase,
                oids: vec![state.base_oid.clone()],
            })
        }
        other => Err(format!(
            "unknown native bridge smoke mutation phase: {other}"
        )),
    }
}

#[tauri::command(rename_all = "camelCase")]
fn native_bridge_smoke_complete(
    report: SmokeReport,
    state: State<'_, SmokeState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut passed = report.passed;
    let mut text = format_report(&report);
    if let Err(error) = fs::remove_dir_all(&state.fixture_path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        passed = false;
        text = format!(
            "NATIVE_BRIDGE_SMOKE=FAIL\nmessage=fixture cleanup failed: {error}\nunderlying_report_passed={}\n",
            report.passed
        );
    }
    fs::write(&state.result_path, &text).map_err(|error| error.to_string())?;
    println!("{text}");
    let exit_code = if passed { 0 } else { 1 };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        app.exit(exit_code);
    });
    Ok(())
}

fn main() {
    let fixture = SmokeFixture::new().expect("create native bridge smoke fixture");
    let result_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("native-bridge-smoke")
        .join("last-result.txt");
    let _ = fs::remove_file(&result_path);
    let repository_url_path = fixture.path.to_string_lossy().into_owned();
    let fixture_path = fixture.path.clone();
    let timeout_result_path = result_path.clone();
    let timeout_fixture_path = fixture.path.clone();

    let result = tauri::Builder::default()
        .manage(AppState::default())
        .manage(SmokeState {
            fixture_path: fixture.path.clone(),
            base_oid: fixture.base_oid.clone(),
            result_path: result_path.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            open_repository_compact,
            refresh_repository_compact_delta,
            get_commit_diff,
            get_commit_file_detail,
            start_repository_watch,
            stop_repository_watch,
            native_bridge_smoke_mutate,
            native_bridge_smoke_complete,
        ])
        .setup(move |app| {
            let url = format!(
                "http://127.0.0.1:1420/native-bridge-smoke.html?repository={repository_url_path}"
            );
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("configured main webview is unavailable"))?;
            window.navigate(url.parse::<tauri::Url>()?)?;

            let app_handle = app.handle().clone();
            let timeout_result_path = timeout_result_path.clone();
            let timeout_fixture_path = timeout_fixture_path.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(30));
                if !timeout_result_path.exists() {
                    let cleanup = fs::remove_dir_all(&timeout_fixture_path);
                    let cleanup_message = cleanup
                        .err()
                        .filter(|error| error.kind() != std::io::ErrorKind::NotFound)
                        .map(|error| format!("; fixture cleanup failed: {error}"))
                        .unwrap_or_default();
                    let text = format!(
                        "NATIVE_BRIDGE_SMOKE=FAIL\nmessage=timed out before JavaScript smoke completion{cleanup_message}\n"
                    );
                    let _ = fs::write(&timeout_result_path, &text);
                    eprintln!("{text}");
                    app_handle.exit(2);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!());

    result.expect("run native bridge smoke Tauri application");
    let report_text = fs::read_to_string(&result_path).unwrap_or_else(|error| {
        format!("NATIVE_BRIDGE_SMOKE=FAIL\nmessage=missing result: {error}\n")
    });
    let passed = report_text.starts_with("NATIVE_BRIDGE_SMOKE=PASS\n");
    let _ = fs::remove_dir_all(&fixture_path);
    assert!(passed, "native bridge smoke failed:\n{report_text}");
}

fn commit_all(path: &Path, message: &str) -> Result<(), String> {
    run_git(path, ["add", "-A"])?;
    run_git(path, ["commit", "-m", message])
}

fn run_git<I, S>(cwd: &Path, args: I) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", "Native Bridge Smoke")
        .env("GIT_AUTHOR_EMAIL", "native-bridge-smoke@example.invalid")
        .env("GIT_COMMITTER_NAME", "Native Bridge Smoke")
        .env("GIT_COMMITTER_EMAIL", "native-bridge-smoke@example.invalid")
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

fn format_report(report: &SmokeReport) -> String {
    let clean = |value: &str| value.replace(['\n', '\r'], " ");
    format!(
        concat!(
            "NATIVE_BRIDGE_SMOKE={}\n",
            "message={}\n",
            "service_mode={}\n",
            "global_tauri={}\n",
            "change_count={}\n",
            "refresh_count={}\n",
            "initial_revision={}\n",
            "rapid_revision={}\n",
            "final_revision={}\n",
            "rapid_commit_oids={}\n",
            "deep_selection_id={}\n",
            "deep_selection_preserved={}\n",
            "disappeared_element_id={}\n",
            "selection_cleared={}\n",
            "selection_notice={}\n",
            "navigation_rewound={}\n",
            "navigation_notice={}\n"
        ),
        if report.passed { "PASS" } else { "FAIL" },
        clean(&report.message),
        clean(&report.service_mode),
        report.global_tauri,
        report.change_count,
        report.refresh_count,
        clean(&report.initial_revision),
        clean(&report.rapid_revision),
        clean(&report.final_revision),
        report.rapid_commit_oids.join(","),
        clean(&report.deep_selection_id),
        report.deep_selection_preserved,
        clean(&report.disappeared_element_id),
        report.selection_cleared,
        clean(&report.selection_notice),
        report.navigation_rewound,
        clean(&report.navigation_notice),
    )
}
