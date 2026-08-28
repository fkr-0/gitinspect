import { useEffect, useMemo, useRef, useState } from "react";

import type { RepositorySession } from "../services/repository";
import {
  createGitMutationPreviewTransaction,
  type GitMutationPreview,
  type GitMutationPreviewBridge,
  type GitMutationPreviewOperation,
} from "./gitMutationPreview";
import { createTauriMutationPreviewBridge } from "./tauriMutationPreview";

export const MAX_GIT_MUTATION_PREVIEW_OPERATIONS = 8;
export const MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS = 64;
const MAX_GIT_MUTATION_PREVIEW_REF_NAME_BYTES = 255;
const MAX_GIT_MUTATION_PREVIEW_REWRITE_TEXT_CHARS = MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS * 65;

export type GitMutationPreviewDraftKind =
  | "branch-create"
  | "branch-delete"
  | "branch-rename"
  | "tag-create"
  | "tag-delete"
  | "tag-move"
  | "cherry-pick"
  | "rebase-reorder"
  | "squash"
  | "fixup";

export interface GitMutationPreviewDraftInput {
  readonly name?: string;
  readonly newName?: string;
  readonly targetOid?: string;
  readonly branch?: string;
  readonly ontoOid?: string;
  readonly commitOid?: string;
  readonly commitOids?: readonly string[];
}

export interface GitMutationPreviewDraftPresentation {
  readonly primaryLabel?: string;
  readonly primaryPlaceholder?: string;
  readonly secondaryLabel?: string;
  readonly secondaryPlaceholder?: string;
  readonly targetLabel?: string;
  readonly targetPlaceholder?: string;
  readonly commitLabel?: string;
  readonly commitPlaceholder?: string;
  readonly commitListLabel?: string;
  readonly commitListPlaceholder?: string;
}

export interface GitMutationPreviewTrayProps {
  readonly open: boolean;
  readonly session: RepositorySession | undefined;
  readonly selectedCommitOid?: string;
  readonly bridge?: GitMutationPreviewBridge;
  readonly onDraftCountChange?: (count: number) => void;
}

export interface GitMutationPreviewRequest {
  readonly session: RepositorySession;
  readonly bridge: GitMutationPreviewBridge;
  readonly operations: readonly GitMutationPreviewOperation[];
}

interface StagedMutationOperation {
  readonly id: number;
  readonly operation: GitMutationPreviewOperation;
}

function normalizeRefName(value: string, label: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    new TextEncoder().encode(normalized).length > MAX_GIT_MUTATION_PREVIEW_REF_NAME_BYTES
  ) {
    throw new Error(`${label} must be 1-${MAX_GIT_MUTATION_PREVIEW_REF_NAME_BYTES} bytes.`);
  }
  const unsafeCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x20 ||
      codePoint === 0x7f ||
      ["~", "^", ":", "?", "*", "[", "\\"].includes(character)
    );
  });
  if (
    normalized.startsWith("-") ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.endsWith(".") ||
    normalized.endsWith(".lock") ||
    normalized.includes("..") ||
    normalized.includes("@{") ||
    normalized.includes("//") ||
    normalized
      .split("/")
      .some((part) => part.length === 0 || part.startsWith(".") || part.endsWith(".")) ||
    unsafeCharacter
  ) {
    throw new Error(`${label} is not a safe Git ref name.`);
  }
  return normalized;
}

function normalizeFullOid(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    const sentenceLabel = `${label.slice(0, 1).toLowerCase()}${label.slice(1)}`;
    throw new Error(`Enter a full ${sentenceLabel} before staging.`);
  }
  if (!/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(normalized)) {
    throw new Error(`${label} must be a full hexadecimal SHA-1 or SHA-256 value.`);
  }
  return normalized.toLowerCase();
}

function normalizeRewriteCommitOids(values: readonly string[] | undefined): readonly string[] {
  if (!values || values.length === 0) {
    throw new Error("Enter at least one full commit object ID before staging a rewrite.");
  }
  if (values.length > MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS) {
    throw new Error(
      `A single rewrite operation is limited to ${MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS} commits.`,
    );
  }
  const normalized = values.map((value) => normalizeFullOid(value, "Commit object ID"));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Rewrite commit object IDs must be unique; duplicates are not allowed.");
  }
  return normalized;
}

export function gitMutationPreviewCommitOidList(value: string): readonly string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function gitMutationPreviewDraftPresentation(
  kind: GitMutationPreviewDraftKind,
): GitMutationPreviewDraftPresentation {
  switch (kind) {
    case "branch-create":
      return { primaryLabel: "Branch name", primaryPlaceholder: "topic/preview" };
    case "branch-delete":
      return { primaryLabel: "Branch name to delete", primaryPlaceholder: "topic/obsolete" };
    case "branch-rename":
      return {
        primaryLabel: "Current branch name",
        primaryPlaceholder: "topic/old",
        secondaryLabel: "New branch name",
        secondaryPlaceholder: "topic/new",
      };
    case "tag-create":
      return { primaryLabel: "Tag name", primaryPlaceholder: "preview-tag" };
    case "tag-delete":
      return { primaryLabel: "Tag name to delete", primaryPlaceholder: "preview-old" };
    case "tag-move":
      return {
        primaryLabel: "Tag name to move",
        primaryPlaceholder: "preview-tag",
        targetLabel: "Target object ID",
        targetPlaceholder: "full 40- or 64-hex object ID",
      };
    case "cherry-pick":
      return {
        commitLabel: "Commit object ID",
        commitPlaceholder: "full 40- or 64-hex commit object ID",
      };
    case "rebase-reorder":
      return {
        primaryLabel: "Branch name",
        primaryPlaceholder: "topic/rewrite",
        targetLabel: "Onto object ID",
        targetPlaceholder: "full 40- or 64-hex base object ID",
        commitListLabel: "Commit object IDs in desired order",
        commitListPlaceholder: "one full commit object ID per line, in desired order",
      };
    case "squash":
      return {
        primaryLabel: "Branch name",
        primaryPlaceholder: "topic/rewrite",
        targetLabel: "Onto object ID",
        targetPlaceholder: "full 40- or 64-hex base object ID",
        commitListLabel: "Commit object IDs in branch order",
        commitListPlaceholder: "one full commit object ID per line, oldest to newest",
      };
    case "fixup":
      return {
        primaryLabel: "Branch name",
        primaryPlaceholder: "topic/rewrite",
        targetLabel: "Onto object ID",
        targetPlaceholder: "full 40- or 64-hex base object ID",
        commitListLabel: "Commit object IDs in branch order",
        commitListPlaceholder: "one full commit object ID per line, oldest to newest",
      };
  }
}

export function gitMutationPreviewOperation(
  kind: GitMutationPreviewDraftKind,
  input: GitMutationPreviewDraftInput,
): GitMutationPreviewOperation {
  switch (kind) {
    case "branch-create": {
      const name = normalizeRefName(input.name ?? "", "Branch name");
      const targetOid = normalizeFullOid(input.targetOid, "Target object ID");
      return { kind, name, targetOid };
    }
    case "branch-delete":
      return { kind, name: normalizeRefName(input.name ?? "", "Branch name") };
    case "branch-rename": {
      const oldName = normalizeRefName(input.name ?? "", "Current branch name");
      const newName = normalizeRefName(input.newName ?? "", "New branch name");
      if (oldName === newName) throw new Error("Branch rename requires distinct names.");
      return { kind, oldName, newName };
    }
    case "tag-create": {
      const name = normalizeRefName(input.name ?? "", "Tag name");
      const targetOid = normalizeFullOid(input.targetOid, "Target object ID");
      return { kind, name, targetOid };
    }
    case "tag-delete":
      return { kind, name: normalizeRefName(input.name ?? "", "Tag name") };
    case "tag-move":
      return {
        kind,
        name: normalizeRefName(input.name ?? "", "Tag name"),
        targetOid: normalizeFullOid(input.targetOid, "Target object ID"),
      };
    case "cherry-pick":
      return { kind, commitOid: normalizeFullOid(input.commitOid, "Commit object ID") };
    case "rebase-reorder":
    case "squash":
    case "fixup":
      return {
        kind,
        branch: normalizeRefName(input.branch ?? "", "Branch name"),
        ontoOid: normalizeFullOid(input.ontoOid, "Onto object ID"),
        commitOids: normalizeRewriteCommitOids(input.commitOids),
      };
  }
}

export function gitMutationPreviewOperationSummary(operation: GitMutationPreviewOperation): string {
  const target = (oid: string | undefined) => oid ?? "unresolved";
  switch (operation.kind) {
    case "branch-create":
      return `Create branch ${operation.name} → ${target(operation.targetOid)}`;
    case "branch-delete":
      return `Delete branch ${operation.name}`;
    case "branch-rename":
      return `Rename branch ${operation.oldName} → ${operation.newName}`;
    case "tag-create":
      return `Create tag ${operation.name} → ${target(operation.targetOid)}`;
    case "tag-delete":
      return `Delete tag ${operation.name}`;
    case "tag-move":
      return `Move tag ${operation.name} → ${target(operation.targetOid)}`;
    case "cherry-pick":
      return `Cherry-pick ${operation.commitOid}`;
    case "rebase-reorder":
      return `Reorder ${operation.commitOids.join(" → ")} on ${operation.branch} onto ${operation.ontoOid}`;
    case "squash":
      return `Squash ${operation.commitOids.join(" + ")} on ${operation.branch} onto ${operation.ontoOid}`;
    case "fixup":
      return `Fixup ${operation.commitOids.join(" + ")} on ${operation.branch} onto ${operation.ontoOid}`;
  }
}

function assertBoundedOperations(operations: readonly GitMutationPreviewOperation[]): void {
  if (operations.length === 0) {
    throw new Error("Stage at least one Git mutation before previewing.");
  }
  if (operations.length > MAX_GIT_MUTATION_PREVIEW_OPERATIONS) {
    throw new Error(
      `The transaction tray is limited to ${MAX_GIT_MUTATION_PREVIEW_OPERATIONS} staged operations per disposable preview.`,
    );
  }
}

/**
 * Owns at most one disposable-copy preview transaction.
 *
 * Confirmation acknowledges the backend-owned preview proof and immediately
 * destroys that disposable sandbox. The controller deliberately exposes no
 * apply method and never requests original-repository mutation authority.
 */
export class GitMutationPreviewTrayController {
  private generation = 0;
  private active: ReturnType<typeof createGitMutationPreviewTransaction> | undefined;

  async preview(request: GitMutationPreviewRequest): Promise<GitMutationPreview | undefined> {
    assertBoundedOperations(request.operations);
    await this.reset();
    const generation = ++this.generation;
    const manager = createGitMutationPreviewTransaction(request.session, request.bridge);
    manager.replaceOperations(request.operations);
    this.active = manager;
    try {
      const preview = await manager.preview(request.session.snapshot.revision);
      if (generation !== this.generation || this.active !== manager) {
        await this.cancelManager(manager);
        return undefined;
      }
      return preview;
    } catch (error) {
      if (generation !== this.generation || this.active !== manager) return undefined;
      this.active = undefined;
      throw error;
    }
  }

  async confirm(liveRevision: string): Promise<void> {
    const manager = this.active;
    if (manager?.state !== "previewed") {
      throw new Error("A current disposable-copy preview is required before confirmation.");
    }
    try {
      await manager.confirm(liveRevision);
    } finally {
      if (this.active === manager && manager.state !== "previewed") this.active = undefined;
    }
  }

  async reset(): Promise<void> {
    this.generation += 1;
    const manager = this.active;
    this.active = undefined;
    if (manager) await this.cancelManager(manager);
  }

  private async cancelManager(
    manager: ReturnType<typeof createGitMutationPreviewTransaction>,
  ): Promise<void> {
    if (["failed", "cancelled", "applied"].includes(manager.state)) return;
    try {
      await manager.cancel();
    } catch {
      // Cleanup is best-effort here. Backend sandboxes are independently bounded
      // and the UI never gains an original-repository apply capability.
    }
  }
}

export interface GitMutationPreviewOperationListItem {
  readonly id: string | number;
  readonly operation: GitMutationPreviewOperation;
}

export interface GitMutationPreviewOperationListProps {
  readonly items: readonly GitMutationPreviewOperationListItem[];
  readonly disabled?: boolean;
  readonly onMove?: (fromIndex: number, toIndex: number) => void;
  readonly onRemove?: (index: number) => void;
}

export function GitMutationPreviewOperationList({
  items,
  disabled = false,
  onMove,
  onRemove,
}: GitMutationPreviewOperationListProps) {
  if (items.length === 0) return <p>No operations staged.</p>;
  return (
    <ol aria-label="Staged preview operations">
      {items.map(({ id, operation }, index) => (
        <li key={id}>
          <span>
            {index + 1}. {gitMutationPreviewOperationSummary(operation)}
          </span>{" "}
          {onMove && (
            <>
              <button
                type="button"
                className="button button--ghost"
                aria-label={`Move operation ${index + 1} up`}
                disabled={disabled || index === 0}
                onClick={() => onMove(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="button button--ghost"
                aria-label={`Move operation ${index + 1} down`}
                disabled={disabled || index === items.length - 1}
                onClick={() => onMove(index, index + 1)}
              >
                ↓
              </button>
            </>
          )}
          {onRemove && (
            <button
              type="button"
              className="button button--ghost"
              aria-label={`Remove operation ${index + 1}`}
              disabled={disabled}
              onClick={() => onRemove(index)}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

type PreviewUiState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly preview: GitMutationPreview }
  | { readonly status: "confirmed"; readonly preview: GitMutationPreview }
  | { readonly status: "error"; readonly message: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function GitMutationPreviewResult({ preview }: { readonly preview: GitMutationPreview }) {
  const warningOccurrences = new Map<string, number>();
  const keyedWarnings = preview.warnings.map((warning) => {
    const occurrence = (warningOccurrences.get(warning) ?? 0) + 1;
    warningOccurrences.set(warning, occurrence);
    return { key: `warning:${warning}:${occurrence}`, warning };
  });
  return (
    <div data-testid="mutation-preview-result">
      <strong>{preview.success ? "Preview succeeded" : "Preview has conflicts"}</strong>
      <p>{preview.canonicalOperations.length} ordered operation(s) evaluated.</p>
      <p>
        {preview.changedRefs.length} ref change(s) · {preview.rewrittenCommits.length} rewritten
        commit(s) · {preview.hashCascade.length} hash-cascade entry(s)
      </p>
      {preview.changedRefs.map((change) => (
        <p key={`${change.name}:${change.beforeOid ?? ""}:${change.afterOid ?? ""}`}>
          {change.name}: {change.beforeOid ?? "∅"} → {change.afterOid ?? "∅"}
        </p>
      ))}
      {preview.rewrittenCommits.map((rewrite) => (
        <p key={`rewrite:${rewrite.operationIndex}:${rewrite.oldOid}:${rewrite.newOid}`}>
          Rewrite operation {rewrite.operationIndex + 1}: {rewrite.oldOid} → {rewrite.newOid}
        </p>
      ))}
      {preview.hashCascade.map((entry) => (
        <p
          key={`cascade:${entry.operationIndex}:${entry.reason}:${entry.oldOid}:${entry.newOid}:${entry.newParentOid ?? ""}`}
        >
          Hash cascade operation {entry.operationIndex + 1} · {entry.reason}: {entry.oldOid} →{" "}
          {entry.newOid}
          {entry.newParentOid ? ` · parent ${entry.newParentOid}` : ""}
        </p>
      ))}
      {keyedWarnings.map(({ key, warning }) => (
        <p key={key}>Warning: {warning}</p>
      ))}
      {preview.failures.map((failure) => (
        <div
          key={`failure:${failure.operationIndex}:${failure.operationKind}:${failure.code}:${failure.message}:${failure.conflicts.join("\u0000")}`}
          role="alert"
        >
          <p>
            Operation {failure.operationIndex + 1} · {failure.operationKind} · {failure.code}:{" "}
            {failure.message}
          </p>
          {failure.conflicts.length > 0 && <p>Conflicts: {failure.conflicts.join(", ")}</p>}
        </div>
      ))}
    </div>
  );
}

export function GitMutationPreviewTray({
  open,
  session,
  selectedCommitOid,
  bridge,
  onDraftCountChange,
}: GitMutationPreviewTrayProps) {
  const controllerRef = useRef<GitMutationPreviewTrayController | undefined>(undefined);
  controllerRef.current ??= new GitMutationPreviewTrayController();
  const controller = controllerRef.current;
  const nativeBridge = useMemo(() => bridge ?? createTauriMutationPreviewBridge(), [bridge]);
  const [kind, setKind] = useState<GitMutationPreviewDraftKind>("branch-create");
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [targetOid, setTargetOid] = useState("");
  const [commitOid, setCommitOid] = useState("");
  const [commitOidsText, setCommitOidsText] = useState("");
  const [staged, setStaged] = useState<readonly StagedMutationOperation[]>([]);
  const [ui, setUi] = useState<PreviewUiState>({ status: "idle" });
  const nextDraftIdRef = useRef(1);
  const repositoryIdentity = session?.key ?? "no-session";
  const previousRepositoryIdentityRef = useRef(repositoryIdentity);
  const previewContextIdentity = session
    ? `${session.key}\u0000${session.snapshot.revision}\u0000${selectedCommitOid ?? "HEAD"}`
    : "no-session";

  useEffect(() => {
    onDraftCountChange?.(staged.length);
  }, [onDraftCountChange, staged.length]);

  useEffect(() => {
    if (previousRepositoryIdentityRef.current !== repositoryIdentity) {
      previousRepositoryIdentityRef.current = repositoryIdentity;
      setStaged([]);
      setName("");
      setNewName("");
      setTargetOid("");
      setCommitOid("");
      setCommitOidsText("");
    }
    if (previewContextIdentity.length > 0) {
      setUi({ status: "idle" });
      void controller.reset();
    }
  }, [controller, previewContextIdentity, repositoryIdentity]);

  useEffect(
    () => () => {
      void controller.reset();
      onDraftCountChange?.(0);
    },
    [controller, onDraftCountChange],
  );

  const invalidatePreview = () => {
    if (ui.status !== "idle") setUi({ status: "idle" });
    void controller.reset();
  };

  const presentation = gitMutationPreviewDraftPresentation(kind);
  const draft = useMemo(() => {
    if (!session) return { operation: undefined, error: undefined };
    try {
      const draftTargetOid =
        kind === "tag-move"
          ? targetOid
          : kind === "branch-create" || kind === "tag-create"
            ? (selectedCommitOid ?? session.snapshot.head)
            : undefined;
      return {
        operation: gitMutationPreviewOperation(kind, {
          name,
          newName,
          ...(draftTargetOid === undefined ? {} : { targetOid: draftTargetOid }),
          branch: name,
          ontoOid: targetOid,
          commitOid,
          commitOids: gitMutationPreviewCommitOidList(commitOidsText),
        }),
        error: undefined,
      };
    } catch (error) {
      return { operation: undefined, error: failureMessage(error) };
    }
  }, [commitOid, commitOidsText, kind, name, newName, selectedCommitOid, session, targetOid]);

  const stageOperation = () => {
    const operation = draft.operation;
    if (!session || !operation || staged.length >= MAX_GIT_MUTATION_PREVIEW_OPERATIONS) return;
    invalidatePreview();
    const id = nextDraftIdRef.current++;
    setStaged((current) => [...current, { id, operation }]);
    setName("");
    setNewName("");
    setTargetOid("");
    setCommitOid("");
    setCommitOidsText("");
  };

  const moveOperation = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= staged.length || fromIndex === toIndex) return;
    invalidatePreview();
    setStaged((current) => {
      const next = [...current];
      const [entry] = next.splice(fromIndex, 1);
      if (!entry) return current;
      next.splice(toIndex, 0, entry);
      return next;
    });
  };

  const removeOperation = (index: number) => {
    invalidatePreview();
    setStaged((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const operations = staged.map((entry) => entry.operation);
  const canStage =
    session !== undefined &&
    draft.operation !== undefined &&
    staged.length < MAX_GIT_MUTATION_PREVIEW_OPERATIONS &&
    ui.status !== "loading";
  const canPreview =
    session !== undefined &&
    nativeBridge !== undefined &&
    staged.length > 0 &&
    staged.length <= MAX_GIT_MUTATION_PREVIEW_OPERATIONS &&
    ui.status !== "loading";

  const previewDraft = async () => {
    if (!session || !nativeBridge || !canPreview) return;
    const requestSession = session;
    setUi({ status: "loading" });
    try {
      const preview = await controller.preview({
        session: requestSession,
        bridge: nativeBridge,
        operations,
      });
      if (preview) setUi({ status: "ready", preview });
    } catch (error) {
      setUi({ status: "error", message: failureMessage(error) });
    }
  };

  const confirmPreview = async () => {
    if (!session || ui.status !== "ready") return;
    const preview = ui.preview;
    try {
      await controller.confirm(session.snapshot.revision);
      setUi({ status: "confirmed", preview });
    } catch (error) {
      setUi({ status: "error", message: failureMessage(error) });
    }
  };

  const clearPreview = () => {
    setUi({ status: "idle" });
    void controller.reset();
  };

  const displayedPreview =
    ui.status === "ready" || ui.status === "confirmed" ? ui.preview : undefined;

  return (
    <section
      className="transaction-tray"
      data-open={open || undefined}
      aria-label="Transaction tray"
      data-testid="mutation-preview-tray"
    >
      <div>
        <span className="eyebrow">Disposable-copy preview</span>
        <strong>Ordered sandbox-only Git mutations</strong>
        <p>
          Stage up to {MAX_GIT_MUTATION_PREVIEW_OPERATIONS} branch/tag ref or commit-rewrite
          operations in explicit order. Each rewrite is limited to{" "}
          {MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS} explicit commit object IDs. Confirmation
          acknowledges the disposable preview only. No original-repository apply command is exposed
          here.
        </p>
        <label>
          <span className="sr-only">Preview operation</span>
          <select
            aria-label="Preview operation"
            value={kind}
            disabled={ui.status === "loading"}
            onChange={(event) => {
              const nextKind = event.currentTarget.value as GitMutationPreviewDraftKind;
              setKind(nextKind);
              setName("");
              setNewName("");
              setTargetOid(
                nextKind === "tag-move" ? (selectedCommitOid ?? session?.snapshot.head ?? "") : "",
              );
              setCommitOid(nextKind === "cherry-pick" ? (selectedCommitOid ?? "") : "");
              setCommitOidsText("");
            }}
          >
            <option value="branch-create">Create branch</option>
            <option value="branch-delete">Delete branch</option>
            <option value="branch-rename">Rename branch</option>
            <option value="tag-create">Create tag</option>
            <option value="tag-delete">Delete tag</option>
            <option value="tag-move">Move tag</option>
            <option value="cherry-pick">Cherry-pick commit</option>
            <option value="rebase-reorder">Reorder branch commits</option>
            <option value="squash">Squash branch commits</option>
            <option value="fixup">Fixup branch commits</option>
          </select>
        </label>
        {presentation.primaryLabel && (
          <label>
            <span className="sr-only">{presentation.primaryLabel}</span>
            <input
              aria-label={presentation.primaryLabel}
              value={name}
              maxLength={MAX_GIT_MUTATION_PREVIEW_REF_NAME_BYTES}
              disabled={ui.status === "loading"}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={presentation.primaryPlaceholder}
            />
          </label>
        )}
        {presentation.secondaryLabel && (
          <label>
            <span className="sr-only">{presentation.secondaryLabel}</span>
            <input
              aria-label={presentation.secondaryLabel}
              value={newName}
              maxLength={MAX_GIT_MUTATION_PREVIEW_REF_NAME_BYTES}
              disabled={ui.status === "loading"}
              onChange={(event) => setNewName(event.currentTarget.value)}
              placeholder={presentation.secondaryPlaceholder}
            />
          </label>
        )}
        {presentation.targetLabel && (
          <label>
            <span className="sr-only">{presentation.targetLabel}</span>
            <input
              aria-label={presentation.targetLabel}
              value={targetOid}
              maxLength={64}
              disabled={ui.status === "loading"}
              onChange={(event) => setTargetOid(event.currentTarget.value)}
              placeholder={presentation.targetPlaceholder}
              spellCheck={false}
            />
          </label>
        )}
        {presentation.commitLabel && (
          <label>
            <span className="sr-only">{presentation.commitLabel}</span>
            <input
              aria-label={presentation.commitLabel}
              value={commitOid}
              maxLength={64}
              disabled={ui.status === "loading"}
              onChange={(event) => setCommitOid(event.currentTarget.value)}
              placeholder={presentation.commitPlaceholder}
              spellCheck={false}
            />
          </label>
        )}
        {presentation.commitListLabel && (
          <label>
            <span className="sr-only">{presentation.commitListLabel}</span>
            <textarea
              aria-label={presentation.commitListLabel}
              value={commitOidsText}
              maxLength={MAX_GIT_MUTATION_PREVIEW_REWRITE_TEXT_CHARS}
              disabled={ui.status === "loading"}
              onChange={(event) => setCommitOidsText(event.currentTarget.value)}
              placeholder={presentation.commitListPlaceholder}
              spellCheck={false}
            />
          </label>
        )}
        {(name.length > 0 ||
          newName.length > 0 ||
          targetOid.length > 0 ||
          commitOid.length > 0 ||
          commitOidsText.length > 0) &&
          draft.error && <p role="status">{draft.error}</p>}
        <button
          type="button"
          className="button button--ghost"
          disabled={!canStage}
          onClick={stageOperation}
        >
          Stage operation
        </button>
        <p>
          {(kind === "branch-create" || kind === "tag-create") && (
            <>
              Create target: {selectedCommitOid ?? session?.snapshot.head ?? "no resolved HEAD"} ·{" "}
            </>
          )}
          base: {session?.snapshot.revision ?? "no repository"}
        </p>
        <p>
          {staged.length} / {MAX_GIT_MUTATION_PREVIEW_OPERATIONS} operations staged. Backend hard
          cap: 64 operations.
        </p>
        <GitMutationPreviewOperationList
          items={staged}
          disabled={ui.status === "loading"}
          onMove={moveOperation}
          onRemove={removeOperation}
        />
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: styled lifecycle track, fieldset would alter tray layout */}
      <div className="transaction-tray__pipeline" role="group" aria-label="Preview lifecycle">
        {["draft", "validate", "preview", "confirm", "apply"].map((stage) => {
          const active =
            (stage === "draft" && staged.length > 0) ||
            (stage === "validate" && ui.status === "loading") ||
            (stage === "preview" && (ui.status === "ready" || ui.status === "confirmed")) ||
            (stage === "confirm" && ui.status === "confirmed");
          return (
            <span key={stage} data-active={active || undefined}>
              {stage}
            </span>
          );
        })}
      </div>

      <div className="transaction-tray__actions">
        <button
          type="button"
          className="button button--ghost"
          disabled={!canPreview}
          onClick={() => void previewDraft()}
        >
          {ui.status === "loading" ? "Previewing…" : "Preview ordered operations"}
        </button>
        {ui.status === "ready" && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void confirmPreview()}
          >
            Confirm preview only
          </button>
        )}
        {displayedPreview && (
          <button type="button" className="button button--ghost" onClick={clearPreview}>
            Clear preview
          </button>
        )}
        <button type="button" className="button button--danger" disabled>
          Apply to repository
        </button>
      </div>

      {nativeBridge === undefined && (
        <p role="status">Native disposable-copy preview is unavailable in this runtime.</p>
      )}
      {ui.status === "error" && <p role="alert">{ui.message}</p>}
      {ui.status === "confirmed" && (
        <p role="status">
          Disposable preview confirmed. Its sandbox has been destroyed; apply remains unavailable.
        </p>
      )}
      {displayedPreview && <GitMutationPreviewResult preview={displayedPreview} />}
    </section>
  );
}
