use std::path::PathBuf;

use gitinspect_core::{
    MutationPreviewConfirmation, MutationPreviewOperation, MutationPreviewResult,
    MutationSandboxManager, MutationSandboxSession,
};
use tauri::State;

use crate::repository_commands::AppState;

pub struct MutationPreviewState {
    manager: MutationSandboxManager,
}

impl Default for MutationPreviewState {
    fn default() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("target")
            .join("mutation-preview-sandboxes");
        Self {
            manager: MutationSandboxManager::new(root)
                .expect("repository-local mutation preview sandbox root must be creatable"),
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_mutation_sandbox(
    repository_id: String,
    base_revision: String,
    repositories: State<'_, AppState>,
    previews: State<'_, MutationPreviewState>,
) -> Result<MutationSandboxSession, String> {
    let recorded_revision = repositories.authority.revision(&repository_id)?;
    if recorded_revision != base_revision {
        return Err(format!(
            "stale repository revision: expected {base_revision}, current {recorded_revision}"
        ));
    }
    let handle = repositories.authority.handle(&repository_id)?;
    previews
        .manager
        .create_sandbox(&handle, &base_revision)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn preview_mutation_transaction(
    sandbox_id: String,
    transaction_id: String,
    operations: Vec<MutationPreviewOperation>,
    previews: State<'_, MutationPreviewState>,
) -> Result<MutationPreviewResult, String> {
    previews
        .manager
        .preview(&sandbox_id, &transaction_id, &operations)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn confirm_mutation_preview(
    sandbox_id: String,
    transaction_id: String,
    preview_token: String,
    previews: State<'_, MutationPreviewState>,
) -> Result<MutationPreviewConfirmation, String> {
    previews
        .manager
        .confirm_preview(&sandbox_id, &transaction_id, &preview_token)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_mutation_sandbox(
    sandbox_id: String,
    previews: State<'_, MutationPreviewState>,
) -> Result<bool, String> {
    previews
        .manager
        .cleanup(&sandbox_id)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn tauri_handler_has_preview_commands_but_no_original_apply_command() {
        let main = include_str!("main.rs");
        for command in [
            "create_mutation_sandbox",
            "preview_mutation_transaction",
            "confirm_mutation_preview",
            "cancel_mutation_sandbox",
        ] {
            assert!(main.contains(command), "missing preview command {command}");
        }
        assert!(!main.contains("apply_mutation"));
        assert!(!main.contains("apply_to_original"));
    }
}
