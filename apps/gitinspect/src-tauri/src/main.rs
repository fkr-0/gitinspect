mod mutation_preview_commands;
mod repository_commands;

use std::path::PathBuf;

use gitinspect_core::{OpenOptions, RepositoryService};
use mutation_preview_commands::{
    MutationPreviewState, cancel_mutation_sandbox, confirm_mutation_preview,
    create_mutation_sandbox, preview_mutation_transaction,
};
use repository_commands::{
    AppState, choose_repository_path, get_commit_diff, get_commit_file_detail, open_repository,
    open_repository_compact, refresh_repository, refresh_repository_compact,
    refresh_repository_compact_delta, start_repository_watch, stop_repository_watch,
};

#[derive(Debug, PartialEq, Eq)]
struct ReleaseSmokeRequest {
    repository: PathBuf,
}

fn parse_release_smoke_request(
    args: impl IntoIterator<Item = String>,
) -> Result<Option<ReleaseSmokeRequest>, String> {
    let mut args = args.into_iter();
    let Some(first) = args.next() else {
        return Ok(None);
    };
    if first != "--release-smoke" {
        return Ok(None);
    }

    let mut repository = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--repository" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--repository requires a path".to_owned())?;
                if repository.replace(PathBuf::from(value)).is_some() {
                    return Err("--repository may be supplied only once".to_owned());
                }
            }
            other => return Err(format!("unknown release-smoke argument: {other}")),
        }
    }

    let repository =
        repository.ok_or_else(|| "--release-smoke requires --repository PATH".to_owned())?;
    Ok(Some(ReleaseSmokeRequest { repository }))
}

fn run_release_smoke(request: &ReleaseSmokeRequest) -> Result<(), String> {
    let options = OpenOptions {
        max_commits: 64,
        include_commit_files: false,
        ..OpenOptions::default()
    };
    let (_handle, snapshot) = RepositoryService::open(&request.repository, options)
        .map_err(|error| format!("packaged repository smoke failed: {error}"))?;
    if snapshot.revision.is_empty() {
        return Err("packaged repository smoke returned an empty revision".to_owned());
    }

    println!("GITINSPECT_PACKAGED_RELEASE_SMOKE=PASS");
    println!("product_version={}", env!("CARGO_PKG_VERSION"));
    println!("repository_revision={}", snapshot.revision);
    println!("repository_commits={}", snapshot.commits.len());
    println!("original_apply_authorized=false");
    Ok(())
}

fn main() {
    match parse_release_smoke_request(std::env::args().skip(1)) {
        Ok(Some(request)) => match run_release_smoke(&request) {
            Ok(()) => return,
            Err(error) => {
                eprintln!("GITINSPECT_PACKAGED_RELEASE_SMOKE=FAIL message={error}");
                std::process::exit(1);
            }
        },
        Ok(None) => {}
        Err(error) => {
            eprintln!("GITINSPECT_PACKAGED_RELEASE_SMOKE=FAIL message={error}");
            std::process::exit(64);
        }
    }

    tauri::Builder::default()
        .manage(AppState::default())
        .manage(MutationPreviewState::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running gitinspect");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_smoke_parser_is_explicit_and_bounded() {
        assert_eq!(
            parse_release_smoke_request(Vec::<String>::new()).unwrap(),
            None
        );
        assert_eq!(
            parse_release_smoke_request(["ordinary-app-argument".to_owned()]).unwrap(),
            None
        );
        assert_eq!(
            parse_release_smoke_request([
                "--release-smoke".to_owned(),
                "--repository".to_owned(),
                "/repo".to_owned(),
            ])
            .unwrap(),
            Some(ReleaseSmokeRequest {
                repository: PathBuf::from("/repo"),
            })
        );
        assert!(
            parse_release_smoke_request(["--release-smoke".to_owned()])
                .unwrap_err()
                .contains("requires --repository")
        );
        assert!(
            parse_release_smoke_request([
                "--release-smoke".to_owned(),
                "--repository".to_owned(),
                "/repo".to_owned(),
                "--unexpected".to_owned(),
            ])
            .unwrap_err()
            .contains("unknown release-smoke argument")
        );
    }
}
