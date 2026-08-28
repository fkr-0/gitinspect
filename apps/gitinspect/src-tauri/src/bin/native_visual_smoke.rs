#[allow(dead_code)]
#[path = "../mutation_preview_commands.rs"]
mod mutation_preview_commands;
#[allow(dead_code)]
#[path = "../repository_commands.rs"]
mod repository_commands;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use mutation_preview_commands::{
    MutationPreviewState, cancel_mutation_sandbox, confirm_mutation_preview,
    create_mutation_sandbox, preview_mutation_transaction,
};
use repository_commands::{
    AppState, choose_repository_path, get_commit_diff, get_commit_file_detail, open_repository,
    open_repository_compact, refresh_repository, refresh_repository_compact,
    refresh_repository_compact_delta, start_repository_watch, stop_repository_watch,
};
use tauri::{AppHandle, Manager, State};

#[derive(Debug)]
struct NativeVisualFixture {
    path: PathBuf,
}

impl NativeVisualFixture {
    fn new(root: &Path) -> Result<Self, String> {
        let path = root.join("repository");
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;

        run_git(&path, ["init", "-b", "main"])?;
        run_git(&path, ["config", "user.name", "Native Visual Fixture"])?;
        run_git(
            &path,
            ["config", "user.email", "native-visual@example.invalid"],
        )?;

        fs::write(path.join("README.md"), "root\n").map_err(|error| error.to_string())?;
        commit_all_at(
            &path,
            "Initialize visualization workspace",
            "2026-08-20T10:00:00+02:00",
        )?;
        let root_oid = git_output(&path, ["rev-parse", "HEAD"])?;

        fs::write(path.join("contracts.txt"), "contracts\n").map_err(|error| error.to_string())?;
        commit_all_at(
            &path,
            "Define graph element contracts",
            "2026-08-21T10:00:00+02:00",
        )?;
        let tagged_oid = git_output(&path, ["rev-parse", "HEAD"])?;
        run_git(&path, ["tag", "v0.1.0-alpha", tagged_oid.as_str()])?;
        run_git(&path, ["branch", "camera-lab", tagged_oid.as_str()])?;

        fs::write(path.join("layout.txt"), "main layout\n").map_err(|error| error.to_string())?;
        commit_all_at(
            &path,
            "Add deterministic layered layout",
            "2026-08-22T10:00:00+02:00",
        )?;
        let main_pre_merge_oid = git_output(&path, ["rev-parse", "HEAD"])?;

        run_git(&path, ["checkout", "camera-lab"])?;
        fs::write(path.join("camera.txt"), "camera prototype\n")
            .map_err(|error| error.to_string())?;
        commit_all_at(
            &path,
            "Prototype attached camera mode",
            "2026-08-22T12:00:00+02:00",
        )?;
        let feature_oid = git_output(&path, ["rev-parse", "HEAD"])?;

        run_git(&path, ["checkout", "main"])?;
        run_git_at(
            &path,
            [
                "merge",
                "--no-ff",
                "camera-lab",
                "-m",
                "Merge camera traversal prototype",
            ],
            "2026-08-23T10:00:00+02:00",
        )?;
        let merge_oid = git_output(&path, ["rev-parse", "HEAD"])?;

        fs::write(path.join("world.txt"), "world shell\n").map_err(|error| error.to_string())?;
        commit_all_at(
            &path,
            "Integrate repository world shell",
            "2026-08-24T10:00:00+02:00",
        )?;
        let head_oid = git_output(&path, ["rev-parse", "HEAD"])?;

        run_git(
            &path,
            [
                "remote",
                "add",
                "origin",
                "https://example.invalid/gitinspect.git",
            ],
        )?;
        run_git(
            &path,
            ["update-ref", "refs/remotes/origin/main", merge_oid.as_str()],
        )?;

        let graph = git_output(
            &path,
            ["log", "--all", "--graph", "--decorate", "--oneline"],
        )?;
        let manifest = format!(
            concat!(
                "repository={}\n",
                "root={}\n",
                "tagged={}\n",
                "main_pre_merge={}\n",
                "feature={}\n",
                "merge={}\n",
                "head={}\n",
                "graph=\n{}\n"
            ),
            path.display(),
            root_oid,
            tagged_oid,
            main_pre_merge_oid,
            feature_oid,
            merge_oid,
            head_oid,
            graph
        );
        fs::write(root.join("fixture-manifest.txt"), manifest)
            .map_err(|error| error.to_string())?;

        Ok(Self { path })
    }
}

#[derive(Debug)]
struct NativeVisualState {
    root: PathBuf,
    fixture_path: PathBuf,
    result_path: PathBuf,
}

#[tauri::command(rename_all = "camelCase")]
fn native_visual_stage(
    stage: String,
    report_json: String,
    state: State<'_, NativeVisualState>,
) -> Result<(), String> {
    if !matches!(stage.as_str(), "overview" | "current-line" | "merge") {
        return Err(format!("unexpected native visual stage: {stage}"));
    }
    let path = state.root.join(format!("stage-{stage}.json"));
    fs::write(&path, report_json).map_err(|error| error.to_string())?;
    println!("NATIVE_VISUAL_STAGE={stage} path={}", path.display());
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn native_visual_complete(
    passed: bool,
    report_json: String,
    state: State<'_, NativeVisualState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut final_passed = passed;
    let mut text = report_json;
    if let Err(error) = fs::remove_dir_all(&state.fixture_path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        final_passed = false;
        text = format!(
            "{{\"passed\":false,\"message\":\"fixture cleanup failed: {}\"}}",
            error.to_string().replace('"', "\\\"")
        );
    }
    fs::write(&state.result_path, &text).map_err(|error| error.to_string())?;
    println!(
        "NATIVE_VISUAL_SMOKE={} result={}",
        if final_passed { "PASS" } else { "FAIL" },
        state.result_path.display()
    );
    let exit_code = if final_passed { 0 } else { 1 };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        app.exit(exit_code);
    });
    Ok(())
}

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("native-visual-smoke");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create native visual smoke root");
    let fixture = NativeVisualFixture::new(&root).expect("create native visual fixture");
    let result_path = root.join("last-result.json");
    let repository_url_path = fixture.path.to_string_lossy().into_owned();
    let fixture_path = fixture.path.clone();
    let timeout_fixture_path = fixture.path.clone();
    let timeout_result_path = result_path.clone();

    let result = tauri::Builder::default()
        .manage(AppState::default())
        .manage(MutationPreviewState::default())
        .manage(NativeVisualState {
            root: root.clone(),
            fixture_path: fixture.path.clone(),
            result_path: result_path.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            choose_repository_path,
            open_repository,
            open_repository_compact,
            refresh_repository,
            refresh_repository_compact,
            refresh_repository_compact_delta,
            get_commit_diff,
            get_commit_file_detail,
            start_repository_watch,
            stop_repository_watch,
            create_mutation_sandbox,
            preview_mutation_transaction,
            confirm_mutation_preview,
            cancel_mutation_sandbox,
            native_visual_stage,
            native_visual_complete,
        ])
        .setup(move |app| {
            let url = format!(
                "http://127.0.0.1:1420/native-visual-smoke.html?repository={repository_url_path}"
            );
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| std::io::Error::other("configured main webview is unavailable"))?;
            window.navigate(url.parse::<tauri::Url>()?)?;

            let app_handle = app.handle().clone();
            let timeout_fixture_path = timeout_fixture_path.clone();
            let timeout_result_path = timeout_result_path.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(60));
                if !timeout_result_path.exists() {
                    let _ = fs::remove_dir_all(&timeout_fixture_path);
                    let text =
                        "{\"passed\":false,\"message\":\"timed out before native visual completion\"}\n";
                    let _ = fs::write(&timeout_result_path, text);
                    eprintln!("NATIVE_VISUAL_SMOKE=FAIL message=timeout");
                    app_handle.exit(2);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!());

    result.expect("run native visual smoke Tauri application");
    let report_text = fs::read_to_string(&result_path).unwrap_or_else(|error| {
        format!("{{\"passed\":false,\"message\":\"missing result: {error}\"}}")
    });
    let passed =
        report_text.contains("\"passed\": true") || report_text.contains("\"passed\":true");
    let _ = fs::remove_dir_all(&fixture_path);
    assert!(passed, "native visual smoke failed:\n{report_text}");
}

fn commit_all_at(path: &Path, message: &str, date: &str) -> Result<(), String> {
    run_git(path, ["add", "-A"])?;
    run_git_at(path, ["commit", "-m", message], date)
}

fn run_git<I, S>(cwd: &Path, args: I) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    run_git_command(cwd, args, None).map(|_| ())
}

fn run_git_at<I, S>(cwd: &Path, args: I, date: &str) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    run_git_command(cwd, args, Some(date)).map(|_| ())
}

fn git_output<I, S>(cwd: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = run_git_command(cwd, args, None)?;
    String::from_utf8(output.stdout)
        .map_err(|error| error.to_string())
        .map(|value| value.trim().to_owned())
}

fn run_git_command<I, S>(
    cwd: &Path,
    args: I,
    date: Option<&str>,
) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", "Native Visual Fixture")
        .env("GIT_AUTHOR_EMAIL", "native-visual@example.invalid")
        .env("GIT_COMMITTER_NAME", "Native Visual Fixture")
        .env("GIT_COMMITTER_EMAIL", "native-visual@example.invalid");
    if let Some(date) = date {
        command
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date);
    }
    let output = command.output().map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(format!(
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}
