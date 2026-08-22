import { describe, expect, it } from "vitest";

import { createDemoSnapshot } from "../services/repository";
import { repositorySnapshotToGraphDataset } from "./graphAdapter";
import { gitLayoutConstraints, layoutGitDataset } from "./gitLayout";

describe("Git layout adapter", () => {
  it("keeps ancestry monotonic while preferring first-parent continuity", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const constraints = gitLayoutConstraints(dataset);
    const result = layoutGitDataset(dataset, 17);

    for (const edge of dataset.edges.filter((edge) => edge.kind === "history" || edge.kind === "merge-parent")) {
      const source = result.nodePositions[edge.source];
      const target = result.nodePositions[edge.target];
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(target![1]).toBeGreaterThan(source![1]);
    }
    expect(Object.keys(constraints.preferredParents ?? {}).length).toBeGreaterThan(0);
  });

  it("orbits refs near their targets and moves remote islands outside local history", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const result = layoutGitDataset(dataset, 23);
    const branch = dataset.nodes.find((node) => node.kind === "local-branch");
    const branchEdge = dataset.edges.find((edge) => edge.source === branch?.id && edge.kind === "ref-target");
    const remote = dataset.nodes.find((node) => node.kind === "remote");
    expect(branch).toBeDefined();
    expect(branchEdge).toBeDefined();
    expect(remote).toBeDefined();

    const branchPosition = result.nodePositions[branch!.id]!;
    const targetPosition = result.nodePositions[branchEdge!.target]!;
    const distance = Math.hypot(
      branchPosition[0] - targetPosition[0],
      branchPosition[1] - targetPosition[1],
      branchPosition[2] - targetPosition[2],
    );
    expect(distance).toBeGreaterThan(3);
    expect(distance).toBeLessThan(7);

    const commitXs = dataset.nodes
      .filter((node) => node.kind === "commit")
      .map((node) => result.nodePositions[node.id]?.[0] ?? -Infinity);
    expect(result.nodePositions[remote!.id]![0]).toBeGreaterThan(Math.max(...commitXs));
  });

  it("is deterministic for a fixed dataset and seed", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    expect(layoutGitDataset(dataset, 99).nodePositions).toEqual(
      layoutGitDataset(dataset, 99).nodePositions,
    );
  });
});
