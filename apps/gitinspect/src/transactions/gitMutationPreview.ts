import {
  type TransactionDomainAdapter,
  TransactionManager,
  type TransactionPreviewContext,
  type TransactionValidationContext,
} from "@gitinspect/graph-elements";

import type { RepositorySession } from "../services/repository";

export type GitMutationPreviewOperation =
  | { readonly kind: "branch-create"; readonly name: string; readonly targetOid?: string }
  | { readonly kind: "branch-delete"; readonly name: string }
  | { readonly kind: "branch-rename"; readonly oldName: string; readonly newName: string }
  | { readonly kind: "tag-create"; readonly name: string; readonly targetOid?: string }
  | { readonly kind: "tag-delete"; readonly name: string }
  | { readonly kind: "tag-move"; readonly name: string; readonly targetOid: string }
  | { readonly kind: "cherry-pick"; readonly commitOid: string }
  | {
      readonly kind: "rebase-reorder";
      readonly branch: string;
      readonly ontoOid: string;
      readonly commitOids: readonly string[];
    }
  | {
      readonly kind: "squash" | "fixup";
      readonly branch: string;
      readonly ontoOid: string;
      readonly commitOids: readonly string[];
    };

export interface GitMutationPreviewRef {
  readonly name: string;
  readonly targetOid: string;
}

export interface GitMutationPreviewSnapshotSummary {
  readonly head?: string;
  readonly headRef?: string;
  readonly refs: readonly GitMutationPreviewRef[];
  readonly commitCount: number;
  readonly truncated: boolean;
}

export interface GitMutationChangedRef {
  readonly name: string;
  readonly beforeOid?: string;
  readonly afterOid?: string;
}

export interface GitMutationRewrittenCommit {
  readonly oldOid: string;
  readonly newOid: string;
  readonly operationIndex: number;
}

export interface GitMutationHashCascadeEntry extends GitMutationRewrittenCommit {
  readonly reason: string;
  readonly newParentOid?: string;
}

export interface GitMutationPreviewFailure {
  readonly operationIndex: number;
  readonly operationKind: string;
  readonly code: string;
  readonly message: string;
  readonly conflicts: readonly string[];
}

export interface GitMutationPreview {
  readonly sandboxId: string;
  readonly transactionId: string;
  readonly baseRevision: string;
  readonly operationDigest: string;
  readonly canonicalOperations: readonly string[];
  readonly before: GitMutationPreviewSnapshotSummary;
  readonly after: GitMutationPreviewSnapshotSummary;
  readonly changedRefs: readonly GitMutationChangedRef[];
  readonly rewrittenCommits: readonly GitMutationRewrittenCommit[];
  readonly hashCascade: readonly GitMutationHashCascadeEntry[];
  readonly warnings: readonly string[];
  readonly failures: readonly GitMutationPreviewFailure[];
  readonly success: boolean;
  readonly previewToken: string;
}

export interface GitMutationSandboxSession {
  readonly sandboxId: string;
  readonly baseRevision: string;
}

export interface GitMutationPreviewBridge {
  createSandbox(repositoryId: string, baseRevision: string): Promise<GitMutationSandboxSession>;
  preview(
    sandboxId: string,
    transactionId: string,
    operations: readonly GitMutationPreviewOperation[],
  ): Promise<GitMutationPreview>;
  confirm(
    sandboxId: string,
    transactionId: string,
    previewToken: string,
  ): Promise<{ readonly token: string }>;
  cancelSandbox(sandboxId: string): Promise<boolean>;
}

function assertCopyTarget(
  context: TransactionValidationContext<GitMutationPreviewOperation>,
): void {
  if (context.targetMode !== "copy") {
    throw new Error(
      "gitinspect Phase 5 mutation transactions support disposable-copy preview only.",
    );
  }
  if (context.baseRevision !== context.liveRevision) {
    throw new Error("Mutation transaction revision changed before preview.");
  }
  if (context.operations.length === 0) {
    throw new Error("Stage at least one Git mutation before previewing.");
  }
}

class GitMutationDomainAdapter
  implements TransactionDomainAdapter<GitMutationPreviewOperation, GitMutationPreview, never>
{
  private sandbox: GitMutationSandboxSession | undefined;
  private previewValue: GitMutationPreview | undefined;
  private lifecycleGeneration = 0;

  constructor(
    private readonly repositoryId: string,
    private readonly bridge: GitMutationPreviewBridge,
  ) {}

  validate(context: TransactionValidationContext<GitMutationPreviewOperation>): void {
    assertCopyTarget(context);
  }

  async preview(
    context: TransactionPreviewContext<GitMutationPreviewOperation>,
  ): Promise<{ readonly preview: GitMutationPreview; readonly previewRevision: string }> {
    assertCopyTarget(context);
    const generation = ++this.lifecycleGeneration;
    const sandbox = await this.bridge.createSandbox(this.repositoryId, context.baseRevision);
    if (generation !== this.lifecycleGeneration) {
      await this.bridge.cancelSandbox(sandbox.sandboxId);
      throw new Error("Mutation preview was cancelled while creating its disposable sandbox.");
    }
    this.sandbox = sandbox;
    try {
      const preview = await this.bridge.preview(
        sandbox.sandboxId,
        context.transactionId,
        context.operations,
      );
      if (generation !== this.lifecycleGeneration) {
        if (this.sandbox === sandbox) await this.cleanupSandbox();
        throw new Error("Mutation preview was cancelled before the disposable preview completed.");
      }
      if (
        preview.baseRevision !== context.baseRevision ||
        preview.transactionId !== context.transactionId
      ) {
        throw new Error("Backend mutation preview identity does not match the staged transaction.");
      }
      this.previewValue = preview;
      if (!preview.success) {
        await this.cleanupSandbox(false);
        this.previewValue = preview;
      }
      return { preview, previewRevision: preview.baseRevision };
    } catch (error) {
      if (this.sandbox === sandbox) await this.cleanupSandbox();
      throw error;
    }
  }

  async confirm(context: {
    readonly transactionId: string;
    readonly baseRevision: string;
    readonly targetMode: "copy" | "original";
    readonly operations: readonly GitMutationPreviewOperation[];
    readonly liveRevision: string;
    readonly preview: GitMutationPreview;
    readonly previewRevision: string;
  }): Promise<{ readonly token: string }> {
    assertCopyTarget(context);
    if (!context.preview.success) {
      throw new Error("A failed/conflicting mutation preview cannot be confirmed.");
    }
    const sandbox = this.sandbox;
    const preview = this.previewValue;
    if (!sandbox || !preview || preview !== context.preview) {
      throw new Error("Mutation preview sandbox is unavailable for confirmation.");
    }
    let confirmation: { readonly token: string };
    try {
      confirmation = await this.bridge.confirm(
        sandbox.sandboxId,
        context.transactionId,
        preview.previewToken,
      );
    } catch (error) {
      try {
        await this.cleanupSandbox();
      } catch {
        // Preserve the confirmation failure as the primary error. The backend
        // sandbox manager also owns bounded process-lifetime cleanup.
      }
      throw error;
    }
    await this.cleanupSandbox();
    return confirmation;
  }

  async apply(): Promise<never> {
    await this.cleanupSandbox();
    throw new Error("Original-repository mutation apply is intentionally unavailable in Phase 5.");
  }

  async cancel(): Promise<void> {
    this.lifecycleGeneration += 1;
    await this.cleanupSandbox();
  }

  private async cleanupSandbox(clearPreview = true): Promise<void> {
    const sandbox = this.sandbox;
    this.sandbox = undefined;
    if (clearPreview) this.previewValue = undefined;
    if (sandbox) await this.bridge.cancelSandbox(sandbox.sandboxId);
  }
}

export function createGitMutationPreviewTransaction(
  session: RepositorySession,
  bridge: GitMutationPreviewBridge,
  transactionId?: string,
): TransactionManager<GitMutationPreviewOperation, GitMutationPreview, never> {
  return new TransactionManager(
    session.snapshot.revision,
    new GitMutationDomainAdapter(session.key, bridge),
    {
      targetMode: "copy",
      ...(transactionId === undefined ? {} : { id: transactionId }),
    },
  );
}
