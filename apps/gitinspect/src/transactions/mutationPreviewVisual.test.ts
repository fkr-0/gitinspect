import { describe, expect, it } from "vitest";

import type { DataMapper, GraphNodeRecord, MappingContext } from "@gitinspect/graph-elements";

import type { GitMutationPreview } from "./gitMutationPreview";
import { createMutationPreviewMapper, gitMutationPreviewAffectedIds } from "./mutationPreviewVisual";

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
    for (const oid of ["1", "2", "3", "4", "5"]) {
      expect(ids).toContain(`commit:${oid.repeat(40)}`);
      expect(ids).toContain(`commit-boundary:${oid.repeat(40)}`);
      expect(ids).toContain(`object:${oid.repeat(40)}`);
    }
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
