import { describe, expect, it } from "vitest";
import type { GitRepositorySnapshot } from "@gitinspect/contracts";

import { createDemoSnapshot } from "../services/repository";
import { gitGraphIds, repositorySnapshotToGraphDataset } from "./graphAdapter";

function withHeadRef(snapshot: GitRepositorySnapshot, headRef: string): GitRepositorySnapshot {
  return { ...snapshot, headRef } as GitRepositorySnapshot;
}

describe("repositorySnapshotToGraphDataset", () => {
  it("builds stable semantic identities and explicit HEAD/tracking relations", () => {
    const snapshot = withHeadRef(createDemoSnapshot("/work/example"), "refs/heads/main");
    const dataset = repositorySnapshotToGraphDataset(snapshot);

    expect(dataset.nodes.some((node) => node.id === gitGraphIds.head)).toBe(true);
    expect(dataset.edges).toContainEqual(
      expect.objectContaining({
        id: "head-symbolic:refs/heads/main",
        source: gitGraphIds.head,
        target: gitGraphIds.ref("refs/heads/main"),
        kind: "head-symbolic",
      }),
    );
    expect(dataset.edges).toContainEqual(
      expect.objectContaining({
        source: gitGraphIds.ref("refs/heads/main"),
        target: gitGraphIds.ref("refs/remotes/origin/main"),
        kind: "remote-tracking",
        directed: false,
      }),
    );
  });

  it("marks only the resolved HEAD first-parent route as the active history path", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const history = dataset.edges.filter(
      (edge) => edge.kind === "history" || edge.kind === "merge-parent",
    );
    const active = history.filter((edge) => edge.properties.headPath === true);
    const inactive = history.filter((edge) => edge.properties.headPath !== true);

    expect(active).toHaveLength(4);
    expect(active.every((edge) => edge.properties.firstParent === true)).toBe(true);
    expect(inactive).toHaveLength(2);
    expect(
      inactive.some(
        (edge) => edge.properties.parentIndex === 1 && edge.kind === "merge-parent",
      ),
    ).toBe(true);
  });

  it("is deterministic when repository records arrive in a different order", () => {
    const snapshot = createDemoSnapshot("/work/example");
    const shuffled: GitRepositorySnapshot = {
      ...snapshot,
      commits: [...snapshot.commits].reverse(),
      refs: [...snapshot.refs].reverse(),
      remotes: [...snapshot.remotes].reverse(),
    };

    expect(repositorySnapshotToGraphDataset(shuffled)).toEqual(
      repositorySnapshotToGraphDataset(snapshot),
    );
  });

  it("materializes truncated-history boundary nodes instead of dangling edges", () => {
    const snapshot = createDemoSnapshot("/work/example");
    const newest = snapshot.commits[0];
    expect(newest).toBeDefined();
    const truncated: GitRepositorySnapshot = {
      ...snapshot,
      commits: newest ? [newest] : [],
      refs: snapshot.refs.filter((ref) => ref.targetOid === newest?.oid),
      truncated: true,
    };
    const dataset = repositorySnapshotToGraphDataset(truncated);
    const ids = new Set(dataset.nodes.map((node) => node.id));

    for (const edge of dataset.edges) {
      expect(ids.has(edge.source), `missing source ${edge.source}`).toBe(true);
      expect(ids.has(edge.target), `missing target ${edge.target}`).toBe(true);
    }
    expect(dataset.nodes.some((node) => node.kind === "commit-boundary")).toBe(true);
  });

  it("handles a thousand-commit history without index-derived identities", () => {
    const base = createDemoSnapshot("/work/example");
    const commits = Array.from({ length: 1_024 }, (_, index) => {
      const oid = index.toString(16).padStart(40, "0");
      const parent = index === 0 ? undefined : (index - 1).toString(16).padStart(40, "0");
      return {
        ...base.commits[0]!,
        oid,
        treeOid: `f${index.toString(16).padStart(39, "0")}`,
        parents: parent ? [parent] : [],
        committedAtMs: index * 1_000,
        authoredAtMs: index * 1_000,
        message: `commit ${index}`,
        files: [],
      };
    });
    const snapshot: GitRepositorySnapshot = {
      ...base,
      ...(commits.at(-1) ? { head: commits.at(-1)!.oid } : {}),
      commits,
      refs: [],
      remotes: [],
    };
    const dataset = repositorySnapshotToGraphDataset(snapshot);

    expect(dataset.nodes.filter((node) => node.kind === "commit")).toHaveLength(1_024);
    expect(dataset.edges.filter((edge) => edge.kind === "history")).toHaveLength(1_023);
    expect(dataset.nodes[0]?.id).toMatch(/^(commit:|head:)/);
  });
});
