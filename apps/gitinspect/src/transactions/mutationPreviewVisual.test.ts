import { describe, expect, it } from "vitest";

import type { DataMapper, GraphDataset, GraphNodeRecord, MappingContext } from "@gitinspect/graph-elements";

import type { GitMutationPreview } from "./gitMutationPreview";
import {
  createMutationPreviewMapper,
  gitMutationPreviewAffectedIds,
  mutationPreviewGraphDataset,
  mutationPreviewSelectionId,
} from "./mutationPreviewVisual";

function preview(baseRevision = "base-revision"): GitMutationPreview {
  return {
    sandboxId: "sandbox-visual",
    transactionId: "tx-visual",
    baseRevision,
    operationDigest: `sha256:${"b".repeat(64)}`,
    canonicalOperations: ["tag-move", "rebase-reorder"],
    before: { refs: [], commitCount: 2, truncated: false },
    after: { refs: [], commitCount: 2, truncated: false },
    changedRefs: [
      {
        name: "refs/tags/release",
        beforeOid: "1".repeat(40),
        afterOid: "2".repeat(40),
      },
    ],
    droppedCommits: [{ oldOid: "6".repeat(40), operationIndex: 2 }],
    graphDelta: {
      commits: [
        {
          oid: "4".repeat(40),
          parents: ["5".repeat(40)],
          message: "rewritten preview commit",
          authorName: "Preview Author",
          authoredAtMs: 1,
          committedAtMs: 2,
        },
      ],
      refs: [{ name: "refs/tags/release", targetOid: "4".repeat(40), kind: "tag" }],
      truncated: false,
    },
    rewrittenCommits: [
      { oldOid: "3".repeat(40), newOid: "4".repeat(40), operationIndex: 1 },
    ],
    hashCascade: [
      {
        oldOid: "3".repeat(40),
        newOid: "4".repeat(40),
        operationIndex: 1,
        reason: "rebase-reorder",
        newParentOid: "5".repeat(40),
      },
    ],
    warnings: [],
    failures: [],
    success: true,
    previewToken: "preview:visual",
  };
}

describe("mutation preview visualization", () => {
  it("maps ref, old/new rewrite, and cascade evidence onto existing graph identity forms", () => {
    const ids = gitMutationPreviewAffectedIds(preview());
    expect(ids).toContain("ref:refs/tags/release");
    for (const oid of ["1", "2", "3", "4", "5", "6"]) {
      expect(ids).toContain(`commit:${oid.repeat(40)}`);
      expect(ids).toContain(`commit-boundary:${oid.repeat(40)}`);
      expect(ids).toContain(`object:${oid.repeat(40)}`);
    }
  });

  it("adds only authoritative transformed commits and parent/ref edges with stable semantic IDs", () => {
    const parentOid = "5".repeat(40);
    const dataset: GraphDataset = {
      revision: "base-revision",
      nodes: [{ id: `commit:${parentOid}`, kind: "commit", label: "parent", properties: {} }],
      edges: [],
    };
    const transformed = mutationPreviewGraphDataset(dataset, preview());
    expect(transformed?.nodes.some((node) => node.id === `commit:${"4".repeat(40)}`)).toBe(true);
    expect(transformed?.nodes.some((node) => node.id === "ref:refs/tags/release")).toBe(true);
    expect(transformed?.edges).toContainEqual(
      expect.objectContaining({
        id: `history:${parentOid}:${"4".repeat(40)}:0`,
        source: `commit:${parentOid}`,
        target: `commit:${"4".repeat(40)}`,
        kind: "history",
      }),
    );
    expect(transformed?.edges).toContainEqual(
      expect.objectContaining({
        id: "ref-target:refs/tags/release",
        source: "ref:refs/tags/release",
        target: `commit:${"4".repeat(40)}`,
      }),
    );
  });

  it("preserves richer live commit metadata when authoritative delta confirms an existing semantic commit", () => {
    const oid = "4".repeat(40);
    const parentOid = "5".repeat(40);
    const dataset: GraphDataset = {
      revision: "base-existing-commit",
      nodes: [
        {
          id: `commit:${oid}`,
          kind: "commit",
          label: "existing subject",
          group: "mainline",
          weight: 7,
          properties: {
            oid,
            message: "existing subject",
            parents: [parentOid],
            files: [{ path: "src/existing.ts", status: "modified" }],
            tags: ["refs/tags/existing"],
            localBranches: ["refs/heads/main"],
            remoteBranches: ["refs/remotes/origin/main"],
            signatureStatus: "valid",
            isHead: true,
          },
        },
        { id: `commit:${parentOid}`, kind: "commit", label: "parent", properties: {} },
      ],
      edges: [],
    };

    const transformed = mutationPreviewGraphDataset(dataset, preview("base-existing-commit"));
    const commit = transformed?.nodes.find((node) => node.id === `commit:${oid}`);
    expect(commit).toMatchObject({
      id: `commit:${oid}`,
      kind: "commit",
      label: "rewritten preview commit",
      group: "mainline",
      weight: 7,
      properties: {
        oid,
        message: "rewritten preview commit",
        files: [{ path: "src/existing.ts", status: "modified" }],
        tags: ["refs/tags/existing"],
        localBranches: ["refs/heads/main"],
        remoteBranches: ["refs/remotes/origin/main"],
        signatureStatus: "valid",
        isHead: true,
        mutationPreviewAuthoritative: true,
      },
    });
  });

  it("removes backend-confirmed deleted refs and every incident edge without fabricating replacements", () => {
    const targetOid = "7".repeat(40);
    const deletedRef = "refs/heads/obsolete";
    const deletionPreview: GitMutationPreview = {
      ...preview("base-ref-delete"),
      operationDigest: `sha256:${"d".repeat(64)}`,
      canonicalOperations: ["branch-delete"],
      changedRefs: [{ name: deletedRef, beforeOid: targetOid }],
      rewrittenCommits: [],
      hashCascade: [],
      droppedCommits: [],
      graphDelta: { commits: [], refs: [], truncated: false },
    };
    const dataset: GraphDataset = {
      revision: "base-ref-delete",
      nodes: [
        { id: `commit:${targetOid}`, kind: "commit", label: "target", properties: {} },
        {
          id: `ref:${deletedRef}`,
          kind: "local-branch",
          label: "obsolete",
          properties: { name: deletedRef, targetOid },
        },
      ],
      edges: [
        {
          id: `ref-target:${deletedRef}`,
          source: `ref:${deletedRef}`,
          target: `commit:${targetOid}`,
          kind: "ref-target",
          directed: true,
          properties: {},
        },
        {
          id: `tracking:main:${deletedRef}`,
          source: "ref:refs/heads/main",
          target: `ref:${deletedRef}`,
          kind: "remote-tracking",
          directed: false,
          properties: {},
        },
      ],
    };

    const transformed = mutationPreviewGraphDataset(dataset, deletionPreview);
    expect(transformed?.nodes.some((node) => node.id === `ref:${deletedRef}`)).toBe(false);
    expect(transformed?.nodes.some((node) => node.id === `commit:${targetOid}`)).toBe(true);
    expect(
      transformed?.edges.some(
        (edge) => edge.source === `ref:${deletedRef}` || edge.target === `ref:${deletedRef}`,
      ),
    ).toBe(false);
    expect(transformed?.revision).toContain(deletionPreview.operationDigest);
  });

  it("retires complete authoritative rewrite identities, records lineage, and follows unique selection without stale edges", () => {
    const oldOid = "3".repeat(40);
    const newOid = "4".repeat(40);
    const parentOid = "5".repeat(40);
    const parentNode = { id: `commit:${parentOid}`, kind: "commit", label: "parent", properties: {} };
    const dataset: GraphDataset = {
      revision: "base-revision",
      nodes: [
        parentNode,
        { id: `commit:${oldOid}`, kind: "commit", label: "old", properties: { oid: oldOid } },
        {
          id: "ref:refs/tags/release",
          kind: "tag",
          label: "release",
          properties: { name: "refs/tags/release", targetOid: oldOid },
        },
      ],
      edges: [
        {
          id: `history:${parentOid}:${oldOid}:0`,
          source: `commit:${parentOid}`,
          target: `commit:${oldOid}`,
          kind: "history",
          directed: true,
          properties: {},
        },
        {
          id: "ref-target:refs/tags/release",
          source: "ref:refs/tags/release",
          target: `commit:${oldOid}`,
          kind: "tag-target",
          directed: true,
          properties: {},
        },
      ],
    };

    const transformed = mutationPreviewGraphDataset(dataset, preview());
    expect(transformed?.nodes.some((node) => node.id === `commit:${oldOid}`)).toBe(false);
    const rewritten = transformed?.nodes.find((node) => node.id === `commit:${newOid}`);
    expect(rewritten?.properties).toMatchObject({
      mutationPreviewAuthoritative: true,
      mutationPreviewLineageOldOids: [oldOid],
    });
    expect(transformed?.nodes.find((node) => node.id === `commit:${parentOid}`)).toBe(parentNode);
    expect(
      transformed?.edges.some((edge) => edge.source === `commit:${oldOid}` || edge.target === `commit:${oldOid}`),
    ).toBe(false);
    expect(transformed?.edges).toContainEqual(
      expect.objectContaining({
        id: "ref-target:refs/tags/release",
        source: "ref:refs/tags/release",
        target: `commit:${newOid}`,
      }),
    );
    expect(mutationPreviewSelectionId(dataset.revision, `commit:${oldOid}`, preview())).toBe(
      `commit:${newOid}`,
    );
    expect(mutationPreviewSelectionId(dataset.revision, `commit:${parentOid}`, preview())).toBe(
      `commit:${parentOid}`,
    );
  });

  it("fails closed for truncated, conflicted, stale, split, and dropped selection continuity", () => {
    const oldOid = "3".repeat(40);
    const newOid = "4".repeat(40);
    const secondNewOid = "8".repeat(40);
    const parentOid = "5".repeat(40);
    const oldId = `commit:${oldOid}`;
    const dataset: GraphDataset = {
      revision: "base-revision",
      nodes: [
        { id: `commit:${parentOid}`, kind: "commit", label: "parent", properties: {} },
        { id: oldId, kind: "commit", label: "old", properties: { oid: oldOid } },
      ],
      edges: [
        {
          id: `history:${parentOid}:${oldOid}:0`,
          source: `commit:${parentOid}`,
          target: oldId,
          kind: "history",
          directed: true,
          properties: {},
        },
      ],
    };
    const truncated: GitMutationPreview = {
      ...preview(),
      graphDelta: { ...preview().graphDelta, truncated: true },
    };
    const truncatedDataset = mutationPreviewGraphDataset(dataset, truncated);
    expect(truncatedDataset?.nodes.some((node) => node.id === oldId)).toBe(true);
    expect(truncatedDataset?.nodes.some((node) => node.id === `commit:${newOid}`)).toBe(true);
    expect(mutationPreviewSelectionId(dataset.revision, oldId, truncated)).toBe(oldId);

    const conflicted: GitMutationPreview = {
      ...preview(),
      success: false,
      failures: [
        {
          operationIndex: 0,
          operationKind: "rebase-reorder",
          code: "conflict",
          message: "fixture conflict",
          conflicts: ["conflict.txt"],
        },
      ],
    };
    expect(mutationPreviewGraphDataset(dataset, conflicted)).toBe(dataset);
    expect(mutationPreviewSelectionId(dataset.revision, oldId, conflicted)).toBe(oldId);

    const stale = preview("stale-base-revision");
    expect(mutationPreviewGraphDataset(dataset, stale)).toBe(dataset);
    expect(mutationPreviewSelectionId(dataset.revision, oldId, stale)).toBe(oldId);

    const splitPreview: GitMutationPreview = {
      ...preview(),
      canonicalOperations: ["split"],
      rewrittenCommits: [
        { oldOid, newOid, operationIndex: 0 },
        { oldOid, newOid: secondNewOid, operationIndex: 0 },
      ],
      hashCascade: [],
      graphDelta: {
        commits: [
          ...preview().graphDelta.commits,
          {
            oid: secondNewOid,
            parents: [newOid],
            message: "split second",
            authorName: "Preview Author",
            authoredAtMs: 3,
            committedAtMs: 4,
          },
        ],
        refs: [],
        truncated: false,
      },
    };
    const splitDataset = mutationPreviewGraphDataset(dataset, splitPreview);
    expect(splitDataset?.nodes.some((node) => node.id === oldId)).toBe(false);
    expect(splitDataset?.nodes.some((node) => node.id === `commit:${newOid}`)).toBe(true);
    expect(splitDataset?.nodes.some((node) => node.id === `commit:${secondNewOid}`)).toBe(true);
    expect(mutationPreviewSelectionId(dataset.revision, oldId, splitPreview)).toBeUndefined();

    const droppedPreview: GitMutationPreview = {
      ...preview(),
      canonicalOperations: ["drop"],
      rewrittenCommits: [],
      hashCascade: [],
      droppedCommits: [{ oldOid, operationIndex: 0 }],
      graphDelta: { commits: [], refs: [], truncated: false },
    };
    const droppedDataset = mutationPreviewGraphDataset(dataset, droppedPreview);
    expect(droppedDataset?.nodes.some((node) => node.id === oldId)).toBe(false);
    expect(mutationPreviewSelectionId(dataset.revision, oldId, droppedPreview)).toBeUndefined();
  });

  it("replaces a bounded 64-commit rewrite suffix in a 4096-node fixture without stale or fabricated topology", () => {
    const logicalCount = 4_096;
    const rewriteCount = 64;
    const oid = (index: number) => index.toString(16).padStart(40, "0");
    const newOid = (index: number) => `${"f".repeat(32)}${index.toString(16).padStart(8, "0")}`;
    const nodes = Array.from({ length: logicalCount }, (_, index) => ({
      id: `commit:${oid(index)}`,
      kind: "commit",
      label: `commit ${index}`,
      properties: { oid: oid(index) },
    }));
    const edges = Array.from({ length: logicalCount - 1 }, (_, index) => ({
      id: `history:${oid(index)}:${oid(index + 1)}:0`,
      source: `commit:${oid(index)}`,
      target: `commit:${oid(index + 1)}`,
      kind: "history",
      directed: true,
      properties: {},
    }));
    const dataset: GraphDataset = { revision: "large-base", nodes, edges };
    const firstRewrite = logicalCount - rewriteCount;
    const rewrites = Array.from({ length: rewriteCount }, (_, offset) => ({
      oldOid: oid(firstRewrite + offset),
      newOid: newOid(offset),
      operationIndex: 0,
    }));
    const largePreview: GitMutationPreview = {
      ...preview("large-base"),
      before: { refs: [], commitCount: logicalCount, truncated: false },
      after: { refs: [], commitCount: logicalCount, truncated: false },
      changedRefs: [],
      rewrittenCommits: rewrites,
      hashCascade: [],
      droppedCommits: [],
      graphDelta: {
        commits: rewrites.map((rewrite, offset) => ({
          oid: rewrite.newOid,
          parents: [offset === 0 ? oid(firstRewrite - 1) : newOid(offset - 1)],
          message: `rewritten ${offset}`,
          authorName: "Large Fixture",
          authoredAtMs: offset,
          committedAtMs: offset,
        })),
        refs: [],
        truncated: false,
      },
    };

    const transformed = mutationPreviewGraphDataset(dataset, largePreview);
    expect(transformed?.nodes).toHaveLength(logicalCount);
    expect(transformed?.edges).toHaveLength(logicalCount - 1);
    for (const rewrite of rewrites) {
      expect(transformed?.nodes.some((node) => node.id === `commit:${rewrite.oldOid}`)).toBe(false);
      expect(transformed?.nodes.some((node) => node.id === `commit:${rewrite.newOid}`)).toBe(true);
    }
    const retiredIds = new Set(rewrites.map((rewrite) => `commit:${rewrite.oldOid}`));
    expect(
      transformed?.edges.some((edge) => retiredIds.has(edge.source) || retiredIds.has(edge.target)),
    ).toBe(false);
    expect(
      mutationPreviewSelectionId(
        dataset.revision,
        `commit:${rewrites[rewriteCount - 1]!.oldOid}`,
        largePreview,
      ),
    ).toBe(`commit:${rewrites[rewriteCount - 1]!.newOid}`);
  });

  it("decorates only affected 3D node descriptors and preserves semantic IDs", () => {
    const node = { id: `commit:${"3".repeat(40)}`, kind: "commit", properties: {} } satisfies GraphNodeRecord;
    const other = { id: "commit:other", kind: "commit", properties: {} } satisfies GraphNodeRecord;
    const base: DataMapper = {
      mapNode(candidate) {
        return {
          nodeId: candidate.id,
          elements: [
            {
              id: `${candidate.id}:body`,
              primitive: "sphere",
              scale: [1, 2, 3],
              opacity: 0.5,
              metadata: { base: true },
            },
          ],
        };
      },
      mapEdge(edge) {
        return { edgeId: edge.id, style: "history", color: "#fff", width: 1 };
      },
    };
    const context = {
      dataset: { revision: "r", nodes: [node, other], edges: [] },
      revision: "r",
      nodePositions: new Map(),
    } satisfies MappingContext;
    const mapper = createMutationPreviewMapper(base, gitMutationPreviewAffectedIds(preview()));
    const affected = mapper.mapNode(node, context);
    const untouched = mapper.mapNode(other, context);

    expect(affected.nodeId).toBe(node.id);
    expect(affected.elements[0]).toMatchObject({
      emissive: "#ff4fd8",
      opacity: 0.94,
      scale: [1.08, 2.16, 3.24],
      metadata: { base: true, mutationPreviewAffected: true },
    });
    expect(untouched.elements[0]?.emissive).toBeUndefined();
  });
});
