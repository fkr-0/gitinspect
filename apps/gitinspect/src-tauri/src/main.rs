mod mutation_preview_commands;
mod repository_commands;

use mutation_preview_commands::{
    MutationPreviewState, cancel_mutation_sandbox, confirm_mutation_preview,
    create_mutation_sandbox, preview_mutation_transaction,
};
use repository_commands::{
    AppState, choose_repository_path, get_commit_diff, get_commit_file_detail, open_repository,
    open_repository_compact, refresh_repository, refresh_repository_compact,
    refresh_repository_compact_delta, start_repository_watch, stop_repository_watch,
};

fn main() {
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
