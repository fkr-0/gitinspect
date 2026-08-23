import type {
  GitMutationPreview,
  GitMutationPreviewBridge,
  GitMutationPreviewOperation,
  GitMutationSandboxSession,
} from "./gitMutationPreview";

interface TauriMutationGlobal {
  readonly core: {
    invoke<T>(command: string, args?: Readonly<Record<string, unknown>>): Promise<T>;
  };
}

function tauriMutationGlobal(): TauriMutationGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { readonly __TAURI__?: TauriMutationGlobal }).__TAURI__;
}

export function createTauriMutationPreviewBridge(): GitMutationPreviewBridge | undefined {
  const tauri = tauriMutationGlobal();
  if (!tauri?.core?.invoke) return undefined;
  const invoke = tauri.core.invoke.bind(tauri.core);
  return {
    createSandbox(repositoryId: string, baseRevision: string): Promise<GitMutationSandboxSession> {
      return invoke("create_mutation_sandbox", { repositoryId, baseRevision });
    },
    preview(
      sandboxId: string,
      transactionId: string,
      operations: readonly GitMutationPreviewOperation[],
    ): Promise<GitMutationPreview> {
      return invoke("preview_mutation_transaction", { sandboxId, transactionId, operations });
    },
    confirm(
      sandboxId: string,
      transactionId: string,
      previewToken: string,
    ): Promise<{ readonly token: string }> {
      return invoke("confirm_mutation_preview", { sandboxId, transactionId, previewToken });
    },
    cancelSandbox(sandboxId: string): Promise<boolean> {
      return invoke("cancel_mutation_sandbox", { sandboxId });
    },
  };
}
