import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RepositorySession } from "../services/repository";
import {
  commitGitMutationDraftHistory,
  createGitMutationDraftHistory,
  GitMutationPreviewOperationList,
  GitMutationPreviewResult,
  GitMutationPreviewTray,
  GitMutationPreviewTrayController,
  gitMutationPreviewCommitOidList,
  gitMutationPreviewDraftPresentation,
  gitMutationPreviewOperation,
  MAX_GIT_MUTATION_PREVIEW_OPERATIONS,
  MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS,
  redoGitMutationDraftHistory,
  undoGitMutationDraftHistory,
} from "./GitMutationPreviewTray";
import type {
  GitMutationPreview,
  GitMutationPreviewBridge,
  GitMutationPreviewOperation,
} from "./gitMutationPreview";

const revision = `sha256:${"a".repeat(64)}`;
const session = {
  key: "repository:11",
  snapshot: {
    schemaVersion: 1,
    repositoryPath: "/repo",
    gitDir: "/repo/.git",
    head: "c".repeat(40),
    headRef: "refs/heads/main",
    revision,
    commits: [],
    refs: [],
    remotes: [],
    hooks: [],
    truncated: false,
  },
} satisfies RepositorySession;

function preview(
  transactionId: string,
  operations: readonly GitMutationPreviewOperation[] = [{ kind: "branch-create", name: "topic" }],
): GitMutationPreview {
  return {
    sandboxId: "sandbox-1",
    transactionId,
    baseRevision: revision,
    operationDigest: `sha256:${"b".repeat(64)}`,
    canonicalOperations: operations.map(
      (operation) => `${operation.kind}:${JSON.stringify(operation)}`,
    ),
    before: { refs: [], commitCount: 1, truncated: false },
    after: {
      refs: [{ name: "refs/heads/topic", targetOid: "c".repeat(40) }],
      commitCount: 1,
      truncated: false,
    },
    changedRefs: [{ name: "refs/heads/topic", afterOid: "c".repeat(40) }],
    rewrittenCommits: [],
    hashCascade: [],
    warnings: [],
    failures: [],
    success: true,
    previewToken: "preview:opaque",
  };
}

function bridge(): GitMutationPreviewBridge & {
  createSandbox: ReturnType<typeof vi.fn>;
  preview: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  cancelSandbox: ReturnType<typeof vi.fn>;
} {
  return {
    createSandbox: vi.fn(async () => ({ sandboxId: "sandbox-1", baseRevision: revision })),
    preview: vi.fn(
      async (
        _sandboxId: string,
        transactionId: string,
        operations: GitMutationPreviewOperation[],
      ) => preview(transactionId, operations),
    ),
    confirm: vi.fn(async () => ({ token: "preview-confirmation-only" })),
    cancelSandbox: vi.fn(async () => true),
  };
}

describe("GitMutationPreviewTray", () => {
  it("keeps bounded draft undo/redo history and clears redo after a new edit", () => {
    const first = { kind: "branch-delete", name: "topic/old" } as const;
    const second = { kind: "tag-delete", name: "v-old" } as const;
    const third = { kind: "cherry-pick", commitOid: "a".repeat(40) } as const;
    let history = createGitMutationDraftHistory<GitMutationPreviewOperation>();
    history = commitGitMutationDraftHistory(history, [first]);
    history = commitGitMutationDraftHistory(history, [first, second]);

    history = undoGitMutationDraftHistory(history);
    expect(history.present).toEqual([first]);
    expect(history.future).toEqual([[first, second]]);

    history = redoGitMutationDraftHistory(history);
    expect(history.present).toEqual([first, second]);

    history = undoGitMutationDraftHistory(history);
    history = commitGitMutationDraftHistory(history, [first, third]);
    expect(history.present).toEqual([first, third]);
    expect(history.future).toEqual([]);
  });

  it("validates and normalizes every bounded ref/rewrite draft without path or argv authority", () => {
    expect(
      gitMutationPreviewOperation("branch-create", {
        name: "  topic/demo  ",
        targetOid: "d".repeat(40),
      }),
    ).toEqual({
      kind: "branch-create",
      name: "topic/demo",
      targetOid: "d".repeat(40),
    });
    expect(gitMutationPreviewOperation("branch-delete", { name: " old/topic " })).toEqual({
      kind: "branch-delete",
      name: "old/topic",
    });
    expect(
      gitMutationPreviewOperation("branch-rename", {
        name: " old/topic ",
        newName: " new/topic ",
      }),
    ).toEqual({ kind: "branch-rename", oldName: "old/topic", newName: "new/topic" });
    expect(
      gitMutationPreviewOperation("tag-create", { name: " v-next ", targetOid: "c".repeat(40) }),
    ).toEqual({
      kind: "tag-create",
      name: "v-next",
      targetOid: "c".repeat(40),
    });
    expect(gitMutationPreviewOperation("tag-delete", { name: " v-old " })).toEqual({
      kind: "tag-delete",
      name: "v-old",
    });
    expect(
      gitMutationPreviewOperation("tag-move", { name: " v-next ", targetOid: "e".repeat(40) }),
    ).toEqual({ kind: "tag-move", name: "v-next", targetOid: "e".repeat(40) });
    expect(gitMutationPreviewOperation("cherry-pick", { commitOid: "A".repeat(40) })).toEqual({
      kind: "cherry-pick",
      commitOid: "a".repeat(40),
    });
    expect(
      gitMutationPreviewOperation("rebase-reorder", {
        branch: " topic/rewrite ",
        ontoOid: "B".repeat(40),
        commitOids: ["D".repeat(40), "C".repeat(40)],
      }),
    ).toEqual({
      kind: "rebase-reorder",
      branch: "topic/rewrite",
      ontoOid: "b".repeat(40),
      commitOids: ["d".repeat(40), "c".repeat(40)],
    });
    expect(
      gitMutationPreviewOperation("squash", {
        branch: "topic/rewrite",
        ontoOid: "b".repeat(40),
        commitOids: ["c".repeat(40), "d".repeat(40)],
      }),
    ).toMatchObject({ kind: "squash", commitOids: ["c".repeat(40), "d".repeat(40)] });
    expect(
      gitMutationPreviewOperation("fixup", {
        branch: "topic/rewrite",
        ontoOid: "b".repeat(40),
        commitOids: ["c".repeat(40), "d".repeat(40)],
      }),
    ).toMatchObject({ kind: "fixup", commitOids: ["c".repeat(40), "d".repeat(40)] });
    expect(
      gitMutationPreviewCommitOidList(`${"c".repeat(40)}\n${"d".repeat(40)}, ${"e".repeat(40)}`),
    ).toEqual(["c".repeat(40), "d".repeat(40), "e".repeat(40)]);

    expect(() => gitMutationPreviewOperation("branch-create", { name: "topic" })).toThrow(
      "full target object ID",
    );
    expect(() => gitMutationPreviewOperation("tag-create", { name: "v1" })).toThrow(
      "full target object ID",
    );
    expect(() => gitMutationPreviewOperation("branch-delete", { name: "--delete" })).toThrow(
      "safe Git ref name",
    );
    expect(() =>
      gitMutationPreviewOperation("branch-rename", { name: "topic", newName: "topic" }),
    ).toThrow("distinct names");
    expect(() => gitMutationPreviewOperation("tag-move", { name: "v1" })).toThrow(
      "full target object ID",
    );
    expect(() =>
      gitMutationPreviewOperation("tag-move", { name: "v1", targetOid: "deadbeef" }),
    ).toThrow("full hexadecimal");
    expect(() => gitMutationPreviewOperation("cherry-pick", {})).toThrow("full commit object ID");
    expect(() => gitMutationPreviewOperation("cherry-pick", { commitOid: "deadbeef" })).toThrow(
      "full hexadecimal",
    );
    expect(() =>
      gitMutationPreviewOperation("rebase-reorder", {
        branch: "--unsafe",
        ontoOid: "b".repeat(40),
        commitOids: ["c".repeat(40)],
      }),
    ).toThrow("safe Git ref name");
    expect(() =>
      gitMutationPreviewOperation("rebase-reorder", {
        branch: "topic",
        ontoOid: "deadbeef",
        commitOids: ["c".repeat(40)],
      }),
    ).toThrow("full hexadecimal");
    expect(() =>
      gitMutationPreviewOperation("squash", {
        branch: "topic",
        ontoOid: "b".repeat(40),
        commitOids: [],
      }),
    ).toThrow("at least one full commit object ID");
    expect(() =>
      gitMutationPreviewOperation("fixup", {
        branch: "topic",
        ontoOid: "b".repeat(40),
        commitOids: ["C".repeat(40), "c".repeat(40)],
      }),
    ).toThrow("duplicates are not allowed");
    expect(() =>
      gitMutationPreviewOperation("rebase-reorder", {
        branch: "topic",
        ontoOid: "b".repeat(40),
        commitOids: Array.from(
          { length: MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS + 1 },
          (_, index) => index.toString(16).padStart(40, "0"),
        ),
      }),
    ).toThrow(`limited to ${MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS}`);
  });

  it("defines operation-specific authoring labels for ref and rewrite operation kinds", () => {
    expect(gitMutationPreviewDraftPresentation("branch-create").primaryLabel).toBe("Branch name");
    expect(gitMutationPreviewDraftPresentation("branch-delete").primaryLabel).toContain("delete");
    expect(gitMutationPreviewDraftPresentation("branch-rename")).toMatchObject({
      primaryLabel: "Current branch name",
      secondaryLabel: "New branch name",
    });
    expect(gitMutationPreviewDraftPresentation("tag-create").primaryLabel).toBe("Tag name");
    expect(gitMutationPreviewDraftPresentation("tag-delete").primaryLabel).toContain("delete");
    expect(gitMutationPreviewDraftPresentation("tag-move")).toMatchObject({
      primaryLabel: "Tag name to move",
      targetLabel: "Target object ID",
    });
    expect(gitMutationPreviewDraftPresentation("cherry-pick")).toMatchObject({
      commitLabel: "Commit object ID",
    });
    expect(gitMutationPreviewDraftPresentation("rebase-reorder")).toMatchObject({
      primaryLabel: "Branch name",
      targetLabel: "Onto object ID",
      commitListLabel: "Commit object IDs in desired order",
    });
    expect(gitMutationPreviewDraftPresentation("squash").commitListLabel).toContain("branch order");
    expect(gitMutationPreviewDraftPresentation("fixup").commitListLabel).toContain("branch order");
  });

  it("previews multiple operations in the exact staged order and confirms only the preview proof", async () => {
    const backend = bridge();
    const controller = new GitMutationPreviewTrayController();
    const operations = [
      { kind: "branch-delete", name: "remove-first" },
      { kind: "cherry-pick", commitOid: "a".repeat(40) },
      { kind: "tag-move", name: "release", targetOid: "d".repeat(40) },
      {
        kind: "rebase-reorder",
        branch: "topic/reorder",
        ontoOid: "b".repeat(40),
        commitOids: ["e".repeat(40), "c".repeat(40)],
      },
      { kind: "branch-rename", oldName: "topic-old", newName: "topic-new" },
      {
        kind: "squash",
        branch: "topic/squash",
        ontoOid: "b".repeat(40),
        commitOids: ["c".repeat(40), "d".repeat(40)],
      },
      { kind: "tag-delete", name: "remove-last" },
      {
        kind: "fixup",
        branch: "topic/fixup",
        ontoOid: "b".repeat(40),
        commitOids: ["c".repeat(40), "d".repeat(40)],
      },
    ] satisfies readonly GitMutationPreviewOperation[];

    const result = await controller.preview({ session, bridge: backend, operations });

    expect(result?.success).toBe(true);
    expect(backend.createSandbox).toHaveBeenCalledWith(session.key, revision);
    expect(backend.preview).toHaveBeenCalledWith("sandbox-1", expect.any(String), operations);
    expect(backend.confirm).not.toHaveBeenCalled();

    await controller.confirm(revision);
    expect(backend.confirm).toHaveBeenCalledWith("sandbox-1", expect.any(String), "preview:opaque");
    expect(backend.cancelSandbox).toHaveBeenCalledWith("sandbox-1");
    expect("apply" in controller).toBe(false);
  });

  it("enforces the tighter tray batch bound before creating a sandbox", async () => {
    const backend = bridge();
    const controller = new GitMutationPreviewTrayController();
    await expect(controller.preview({ session, bridge: backend, operations: [] })).rejects.toThrow(
      "Stage at least one",
    );

    const tooMany = Array.from({ length: MAX_GIT_MUTATION_PREVIEW_OPERATIONS + 1 }, (_, index) => ({
      kind: "branch-create" as const,
      name: `topic-${index}`,
    }));
    await expect(
      controller.preview({ session, bridge: backend, operations: tooMany }),
    ).rejects.toThrow(`limited to ${MAX_GIT_MUTATION_PREVIEW_OPERATIONS}`);
    expect(backend.createSandbox).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight multi-operation preview when reset before sandbox creation completes", async () => {
    let resolveSandbox: ((value: { sandboxId: string; baseRevision: string }) => void) | undefined;
    const backend = bridge();
    backend.createSandbox.mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolveSandbox = resolve;
        }),
    );
    const controller = new GitMutationPreviewTrayController();
    const pending = controller.preview({
      session,
      bridge: backend,
      operations: [
        { kind: "cherry-pick", commitOid: "c".repeat(40) },
        {
          kind: "rebase-reorder",
          branch: "topic/reorder",
          ontoOid: "b".repeat(40),
          commitOids: ["d".repeat(40), "c".repeat(40)],
        },
      ],
    });
    await vi.waitFor(() => expect(backend.createSandbox).toHaveBeenCalledTimes(1));
    const reset = controller.reset();
    resolveSandbox?.({ sandboxId: "sandbox-late", baseRevision: revision });
    await reset;
    await expect(pending).resolves.toBeUndefined();
    expect(backend.preview).not.toHaveBeenCalled();
    expect(backend.cancelSandbox).toHaveBeenCalledWith("sandbox-late");
    expect(backend.confirm).not.toHaveBeenCalled();
  });

  it("presents ordered staged operations and the independent UI/backend bounds", () => {
    const operations = [
      { kind: "branch-delete", name: "topic/old" },
      { kind: "cherry-pick", commitOid: "a".repeat(40) },
      {
        kind: "rebase-reorder",
        branch: "topic/reorder",
        ontoOid: "b".repeat(40),
        commitOids: ["d".repeat(40), "c".repeat(40)],
      },
      { kind: "tag-delete", name: "v-old" },
      { kind: "tag-move", name: "v-next", targetOid: "d".repeat(40) },
    ] satisfies readonly GitMutationPreviewOperation[];
    const list = renderToStaticMarkup(
      <GitMutationPreviewOperationList
        items={operations.map((operation, index) => ({ id: `operation-${index}`, operation }))}
      />,
    );
    expect(list.indexOf("1. Delete branch topic/old")).toBeLessThan(
      list.indexOf(`2. Cherry-pick ${"a".repeat(40)}`),
    );
    expect(list).toContain(
      `3. Reorder ${"d".repeat(40)} → ${"c".repeat(40)} on topic/reorder onto ${"b".repeat(40)}`,
    );
    expect(list).toContain(`5. Move tag v-next → ${"d".repeat(40)}`);

    const html = renderToStaticMarkup(
      <GitMutationPreviewTray open session={session} bridge={bridge()} />,
    );
    expect(html).toContain("Ordered sandbox-only Git mutations");
    expect(html).toContain(
      `${MAX_GIT_MUTATION_PREVIEW_OPERATIONS} branch/tag ref or commit-rewrite`,
    );
    expect(html).toContain(
      `${MAX_GIT_MUTATION_PREVIEW_REWRITE_COMMITS} explicit commit object IDs`,
    );
    expect(html).toContain(`Create target: ${"c".repeat(40)}`);
    expect(html).toContain("Delete branch");
    expect(html).toContain("Rename branch");
    expect(html).toContain("Delete tag");
    expect(html).toContain("Move tag");
    expect(html).toContain("Cherry-pick commit");
    expect(html).toContain("Reorder branch commits");
    expect(html).toContain("Squash branch commits");
    expect(html).toContain("Fixup branch commits");
    expect(html).toContain("Backend hard cap: 64 operations");
    expect(html).toContain("Undo draft");
    expect(html).toContain("Redo draft");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Preview ordered operations");
    expect(html).toContain("Apply to repository");
    expect(html).toContain("disabled");
    expect(html).toContain("No original-repository apply command");
  });

  it("presents structured rewrite, hash-cascade, warning, and conflict evidence without diff content", () => {
    const oldOid = "1".repeat(40);
    const newOid = "2".repeat(40);
    const parentOid = "3".repeat(40);
    const evidence: GitMutationPreview = {
      ...preview("tx-evidence", [{ kind: "cherry-pick", commitOid: oldOid }]),
      success: false,
      rewrittenCommits: [{ oldOid, newOid, operationIndex: 0 }],
      hashCascade: [
        {
          oldOid,
          newOid,
          operationIndex: 0,
          reason: "cherry-pick",
          newParentOid: parentOid,
        },
      ],
      warnings: ["rewrite warning"],
      failures: [
        {
          operationIndex: 0,
          operationKind: "cherry-pick",
          code: "conflict",
          message: "cherry-pick stopped on conflicts",
          conflicts: ["src/conflict.ts", "docs/conflict.md"],
        },
      ],
    };

    const html = renderToStaticMarkup(<GitMutationPreviewResult preview={evidence} />);
    expect(html).toContain("Preview has conflicts");
    expect(html).toContain(`Rewrite operation 1: ${oldOid} → ${newOid}`);
    expect(html).toContain(`Hash cascade operation 1 · cherry-pick: ${oldOid} → ${newOid}`);
    expect(html).toContain(`parent ${parentOid}`);
    expect(html).toContain("Warning: rewrite warning");
    expect(html).toContain("cherry-pick · conflict");
    expect(html).toContain("Conflicts: src/conflict.ts, docs/conflict.md");
    expect(html).not.toContain("diff --git");
  });
});
