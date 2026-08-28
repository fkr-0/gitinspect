import { describe, expect, it } from "vitest";

import type { DataMapper, GraphDataset, GraphNodeRecord, MappingContext } from "@gitinspect/graph-elements";

import type { GitMutationPreview } from "./gitMutationPreview";
import {
  createMutationPreviewMapper,
  gitMutationPreviewAffectedIds,
  mutationPreviewGraphDataset,
} from "./mutationPreviewVisual";

function preview(): GitMutationPreview {
  return {
    sandboxId: "sandbox-visual",
    transactionId: "tx-visual",
    baseRevision: `sha256:${"a".repeat(64)}`,
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

    const transformed = mutationPreviewGraphDataset(dataset, preview());
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
      ...preview(),
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
