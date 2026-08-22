mod repository_commands;

use repository_commands::{
    AppState, choose_repository_path, get_commit_diff, open_repository, open_repository_compact,
    refresh_repository, refresh_repository_compact, start_repository_watch, stop_repository_watch,
};

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            choose_repository_path,
            open_repository,
            open_repository_compact,
            refresh_repository,
            refresh_repository_compact,
            get_commit_diff,
            start_repository_watch,
            stop_repository_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gitinspect");
}
