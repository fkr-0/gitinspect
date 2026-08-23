import { describe, expect, it, vi } from "vitest";

import type { RepositorySession } from "../services/repository";
import {
  createGitMutationPreviewTransaction,
  type GitMutationPreview,
  type GitMutationPreviewBridge,
} from "./gitMutationPreview";

const revision = `sha256:${"a".repeat(64)}`;
const session = {
  key: "repository:7",
  snapshot: {
    schemaVersion: 1,
    repositoryPath: "/ignored/original",
    gitDir: "/ignored/original/.git",
    revision,
    commits: [],
    refs: [],
    remotes: [],
    hooks: [],
    truncated: false,
  },
} satisfies RepositorySession;

function preview(success = true): GitMutationPreview {
  return {
    sandboxId: "sandbox-1-1",
    transactionId: "tx-safe",
    baseRevision: revision,
    operationDigest: `sha256:${"b".repeat(64)}`,
    canonicalOperations: ["branch-create:name=topic;target=HEAD"],
    before: { refs: [], commitCount: 0, truncated: false },
    after: {
      refs: [{ name: "refs/heads/topic", targetOid: "c".repeat(40) }],
      commitCount: 0,
      truncated: false,
    },
    changedRefs: [{ name: "refs/heads/topic", afterOid: "c".repeat(40) }],
    rewrittenCommits: [],
    hashCascade: [],
    warnings: [],
    failures: success
      ? []
      : [
          {
            operationIndex: 0,
            operationKind: "cherry-pick",
            code: "conflict",
            message: "conflict",
            conflicts: ["x.txt"],
          },
        ],
    success,
    previewToken: "preview:opaque",
  };
}

function bridge(result = preview()): GitMutationPreviewBridge & {
  createSandbox: ReturnType<typeof vi.fn>;
  preview: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  cancelSandbox: ReturnType<typeof vi.fn>;
} {
  return {
    createSandbox: vi.fn(async () => ({ sandboxId: "sandbox-1-1", baseRevision: revision })),
    preview: vi.fn(async (_sandboxId: string, transactionId: string) => ({
      ...result,
      transactionId,
    })),
    confirm: vi.fn(async () => ({ token: "confirm:opaque" })),
    cancelSandbox: vi.fn(async () => true),
  };
}

describe("Git mutation preview transaction adapter", () => {
  it("stages into the generic copy-only TransactionManager and confirms backend preview proof", async () => {
    const backend = bridge();
    const manager = createGitMutationPreviewTransaction(session, backend, "tx-safe");
    manager.addOperation({ kind: "branch-create", name: "topic" });

    const result = await manager.preview(revision);
    expect(result.changedRefs).toHaveLength(1);
    expect(manager.state).toBe("previewed");
    expect(backend.createSandbox).toHaveBeenCalledWith("repository:7", revision);
    expect(backend.preview).toHaveBeenCalledWith("sandbox-1-1", "tx-safe", [
      { kind: "branch-create", name: "topic" },
    ]);

    await expect(manager.confirm(revision)).resolves.toBe("confirm:opaque");
    expect(backend.confirm).toHaveBeenCalledWith("sandbox-1-1", "tx-safe", "preview:opaque");
    expect(backend.cancelSandbox).toHaveBeenCalledWith("sandbox-1-1");

    await expect(manager.apply(revision)).rejects.toThrow("intentionally unavailable");
    expect(manager.state).toBe("failed");
    expect(backend.cancelSandbox).toHaveBeenCalledTimes(1);
  });

  it("refuses confirmation for structured conflicts and cleans up on cancellation", async () => {
    const backend = bridge(preview(false));
    const manager = createGitMutationPreviewTransaction(session, backend, "tx-safe");
    manager.addOperation({ kind: "cherry-pick", commitOid: "c".repeat(40) });
    await manager.preview(revision);
    expect(backend.cancelSandbox).toHaveBeenCalledWith("sandbox-1-1");
    await expect(manager.confirm(revision)).rejects.toThrow("failed/conflicting");
    expect(backend.confirm).not.toHaveBeenCalled();

    const cleanBackend = bridge();
    const cancellable = createGitMutationPreviewTransaction(session, cleanBackend, "tx-cancel");
    cancellable.addOperation({ kind: "tag-delete", name: "v1" });
    await cancellable.preview(revision);
    await cancellable.cancel();
    expect(cleanBackend.cancelSandbox).toHaveBeenCalledWith("sandbox-1-1");
  });

  it("never exposes original target mode or arbitrary path/argv inputs", () => {
    const manager = createGitMutationPreviewTransaction(session, bridge(), "tx-safe");
    expect(manager.targetMode).toBe("copy");
    expect(Object.keys(manager.snapshot())).not.toContain("path");
    expect(Object.keys(manager.snapshot())).not.toContain("argv");
  });
});
