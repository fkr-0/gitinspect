import { describe, expect, it } from "vitest";
import type { GraphDataset, GraphNodeRecord } from "@gitinspect/graph-elements";

import { GitSearchIndex, createSearchHighlightOverlay } from "./gitSearch";

function node(
  id: string,
  kind: string,
  properties: GraphNodeRecord["properties"],
  label?: string,
): GraphNodeRecord {
  return {
    id,
    kind,
    ...(label ? { label } : {}),
    properties,
  };
}

function fixture(revision = "r1"): GraphDataset {
  return {
    revision,
    nodes: [
      node(
        "commit:a",
        "commit",
        {
          oid: "a",
          message: "Fix parser race",
          authorName: "Ada Lovelace",
          committedAtMs: 1_700_000_000_000,
          signatureStatus: "valid",
          localBranches: ["refs/heads/main"],
          tags: ["refs/tags/v1.0.0"],
          files: [{ path: "src/parser.ts", kind: "text", additions: 4, deletions: 1 }],
          isMerge: false,
        },
        "Fix parser race",
      ),
      node(
        "commit:b",
        "commit",
        {
          oid: "b",
          message: "Merge rendering work",
          authorName: "Grace Hopper",
          committedAtMs: 1_710_000_000_000,
          signatureStatus: "unsigned",
          remoteBranches: ["refs/remotes/origin/rendering"],
          files: [],
          isMerge: true,
        },
        "Merge rendering work",
      ),
      node(
        "ref:refs/heads/main",
        "local-branch",
        {
          name: "refs/heads/main",
          targetOid: "a",
          upstream: "refs/remotes/origin/main",
        },
        "main",
      ),
      node(
        "ref:refs/tags/v1.0.0",
        "tag",
        {
          name: "refs/tags/v1.0.0",
          targetOid: "a",
        },
        "v1.0.0",
      ),
      node(
        "remote:origin",
        "remote",
        {
          name: "origin",
          fetchUrls: ["ssh://example.invalid/gitinspect.git"],
          pushUrls: ["ssh://example.invalid/gitinspect.git"],
        },
        "origin",
      ),
    ],
    edges: [],
  };
}

describe("GitSearchIndex", () => {
  it("searches deterministically with exact, substring, and bounded fuzzy modes", () => {
    const dataset = fixture();
    const index = new GitSearchIndex();

    expect(
      index
        .search(dataset, { text: "refs/heads/main", mode: "exact" })
        .results.map((result) => result.id),
    ).toEqual(["commit:a", "ref:refs/heads/main"]);
    expect(
      index
        .search(dataset, { text: "parser", mode: "substring" })
        .results.map((result) => result.id),
    ).toEqual(["commit:a"]);
    const first = index.search(dataset, {
      text: "parsr",
      mode: "fuzzy",
      fuzzyMaxDistance: 1,
      fuzzyDocumentBudget: 128,
      fuzzyTokenBudget: 512,
    });
    const second = index.search(dataset, {
      text: "parsr",
      mode: "fuzzy",
      fuzzyMaxDistance: 1,
      fuzzyDocumentBudget: 128,
      fuzzyTokenBudget: 512,
    });
    expect(first.results.map((result) => result.id)).toEqual(["commit:a"]);
    expect(second.results).toEqual(first.results);
    expect(first.stats.fuzzyTruncated).toBe(false);
  });

  it("supports object, author, date, ref, signature, loaded-path, and merge filters", () => {
    const dataset = fixture();
    const index = new GitSearchIndex();
    const result = index.search(dataset, {
      filters: {
        objectKinds: ["commit"],
        authors: ["ada"],
        dateRange: { fromMs: 1_690_000_000_000, toMs: 1_705_000_000_000 },
        refs: ["main"],
        signatureStates: ["valid"],
        changedPaths: ["parser.ts"],
        merge: false,
      },
    });
    expect(result.results.map((entry) => entry.id)).toEqual(["commit:a"]);

    expect(
      index.search(dataset, { filters: { merge: true } }).results.map((entry) => entry.id),
    ).toEqual(["commit:b"]);

    expect([...index.filter(dataset, { objectKinds: ["commit"] }).ids]).toEqual([
      "commit:a",
      "commit:b",
    ]);
  });

  it("reuses unchanged search documents across revision refreshes and invalidates changed nodes only", () => {
    const first = fixture("r1");
    const index = new GitSearchIndex();
    const initial = index.update(first);
    expect(initial).toMatchObject({ rebuiltDocuments: 5, reusedDocuments: 0, removedDocuments: 0 });
    expect(initial.estimatedIndexBytes).toBeGreaterThan(0);

    const changedCommit: GraphNodeRecord = {
      ...first.nodes[1]!,
      label: "Merge renderer work",
      properties: { ...first.nodes[1]!.properties, message: "Merge renderer work" },
    };
    const refreshed: GraphDataset = {
      revision: "r2",
      nodes: [first.nodes[0]!, changedCommit, first.nodes[2]!, first.nodes[3]!],
      edges: first.edges,
    };
    expect(index.update(refreshed)).toMatchObject({
      revision: "r2",
      indexedDocuments: 4,
      rebuiltDocuments: 1,
      reusedDocuments: 3,
      removedDocuments: 1,
    });
    expect(index.update(refreshed).estimatedIndexBytes).toBeLessThan(initial.estimatedIndexBytes);
  });

  it("creates a highlight overlay without mutating the logical dataset or semantic IDs", () => {
    const dataset = fixture();
    const beforeNodes = dataset.nodes;
    const index = new GitSearchIndex();
    const outcome = index.search(dataset, { text: "render", mode: "substring" });
    const overlay = createSearchHighlightOverlay(outcome);

    expect(dataset.nodes).toBe(beforeNodes);
    expect(dataset.nodes.map((entry) => entry.id)).toEqual([
      "commit:a",
      "commit:b",
      "ref:refs/heads/main",
      "ref:refs/tags/v1.0.0",
      "remote:origin",
    ]);
    expect([...overlay.hitIds]).toEqual(["commit:b"]);
    expect(overlay.byId.get("commit:b")?.rank).toBe(0);
  });
});
