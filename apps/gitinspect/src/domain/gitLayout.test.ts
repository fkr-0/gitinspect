import { describe, expect, it } from "vitest";
import type { GraphDataset } from "@gitinspect/graph-elements";

import { createDemoSnapshot } from "../services/repository";
import { repositorySnapshotToGraphDataset } from "./graphAdapter";
import {
  GIT_RAILFIELD_GEOMETRY,
  gitEdgeRoutes,
  gitLayoutConstraints,
  gitRailTopology,
  layoutGitDataset,
} from "./gitLayout";

describe("Git layout adapter", () => {
  it("makes chronology monotonic on X and keeps the HEAD first-parent spine on lane zero", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const constraints = gitLayoutConstraints(dataset);
    const result = layoutGitDataset(dataset, 17);

    for (const edge of dataset.edges.filter(
      (edge) => edge.kind === "history" || edge.kind === "merge-parent",
    )) {
      const source = result.nodePositions[edge.source];
      const target = result.nodePositions[edge.target];
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(target![0]).toBeGreaterThan(source![0]);
      if (edge.properties.headPath === true) {
        expect(source![1]).toBe(0);
        expect(target![1]).toBe(0);
      }
    }
    expect(Object.keys(constraints.preferredParents ?? {}).length).toBeGreaterThan(0);
  });

  it("peels a branch into a stable parallel lane and routes merge convergence explicitly", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const result = layoutGitDataset(dataset, 23);
    const positions = new Map(Object.entries(result.nodePositions));
    const routes = gitEdgeRoutes(dataset, positions);
    const merge = dataset.nodes.find(
      (node) => node.kind === "commit" && node.properties.isMerge === true,
    );
    const parents = dataset.edges
      .filter((edge) => edge.target === merge?.id && edge.kind === "merge-parent")
      .sort(
        (left, right) => Number(left.properties.parentIndex) - Number(right.properties.parentIndex),
      );
    expect(merge).toBeDefined();
    expect(parents).toHaveLength(2);

    const firstParent = result.nodePositions[parents[0]!.source]!;
    const secondParent = result.nodePositions[parents[1]!.source]!;
    const junction = result.nodePositions[merge!.id]!;
    expect(firstParent[1]).toBe(junction[1]);
    expect(secondParent[1]).not.toBe(junction[1]);
    expect(routes.has(parents[0]!.id)).toBe(false);
    expect(routes.get(parents[1]!.id)).toHaveLength(2);
  });

  it("attaches refs as compact commit signals instead of turning them into empty space", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const result = layoutGitDataset(dataset, 23);
    const targetEdges = dataset.edges.filter((edge) =>
      ["ref-target", "tag-target", "stash-base", "head-symbolic", "head-resolved"].includes(
        edge.kind,
      ),
    );
    const remote = dataset.nodes.find((node) => node.kind === "remote");
    expect(remote).toBeDefined();

    for (const edge of targetEdges) {
      const source = result.nodePositions[edge.source]!;
      const target = result.nodePositions[edge.target]!;
      const distance = Math.hypot(
        source[0] - target[0],
        source[1] - target[1],
        source[2] - target[2],
      );
      expect(distance, edge.id).toBeLessThan(2);
    }

    const remoteRef = dataset.nodes.find((node) => node.kind === "remote-branch");
    expect(remoteRef).toBeDefined();
    const remotePosition = result.nodePositions[remote!.id]!;
    const remoteRefPosition = result.nodePositions[remoteRef!.id]!;
    expect(Math.abs(remotePosition[0] - remoteRefPosition[0])).toBeLessThan(2);
    expect(remotePosition[2]).toBeLessThan(remoteRefPosition[2]);
  });

  it("keeps the deterministic demo inside a dense bounded Railfield envelope", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/demo/gitinspect"));
    const result = layoutGitDataset(dataset, 23);
    const span = result.bounds.max.map((value, index) => value - result.bounds.min[index]!) as [
      number,
      number,
      number,
    ];

    expect(span[0]).toBeLessThan(20);
    expect(span[1]).toBeLessThan(10);
    expect(span[2]).toBeLessThan(4);
  });

  it("keeps a 512-commit synthetic first-parent rail locally bounded without hash scatter", () => {
    const count = 512;
    const dataset: GraphDataset = {
      revision: "railfield-scale-512",
      nodes: Array.from({ length: count }, (_, index) => ({
        id: `commit:${index.toString().padStart(4, "0")}`,
        kind: "commit",
        properties: { isHead: index === count - 1 },
      })),
      edges: Array.from({ length: count - 1 }, (_, index) => ({
        id: `history:${index}:${index + 1}`,
        kind: "history",
        source: `commit:${index.toString().padStart(4, "0")}`,
        target: `commit:${(index + 1).toString().padStart(4, "0")}`,
        directed: true,
        properties: { parentIndex: 0, firstParent: true, headPath: true },
      })),
    };
    const result = layoutGitDataset(dataset, 23);
    const positions = new Map(Object.entries(result.nodePositions));
    const routes = gitEdgeRoutes(dataset, positions);
    const edgeLengths = dataset.edges.map((edge) => {
      const source = positions.get(edge.source)!;
      const target = positions.get(edge.target)!;
      return Math.hypot(
        target[0] - source[0],
        target[1] - source[1],
        target[2] - source[2],
      );
    });

    expect(Math.max(...edgeLengths)).toBeCloseTo(3.4, 8);
    expect(dataset.nodes.every((node) => positions.get(node.id)?.[1] === 0)).toBe(true);
    expect(dataset.nodes.every((node) => positions.get(node.id)?.[2] === 0)).toBe(true);
    expect(routes.size).toBe(0);
  });

  it("exposes the same topology lanes and generations used by Railfield layout", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/demo/gitinspect"));
    const topology = gitRailTopology(dataset);
    const layout = layoutGitDataset(dataset, 23);
    for (const node of dataset.nodes.filter((candidate) => candidate.kind === "commit")) {
      const generation = topology.generations.get(node.id);
      const lane = topology.laneByCommit.get(node.id);
      const position = layout.nodePositions[node.id];
      expect(generation).toBeDefined();
      expect(lane).toBeDefined();
      expect(position).toBeDefined();
      expect(position![1]).toBe(lane! * GIT_RAILFIELD_GEOMETRY.branchLaneSpacing);
      expect(position![2]).toBe(0);
    }
  });

  it("is deterministic for a fixed dataset and seed", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    expect(layoutGitDataset(dataset, 99).nodePositions).toEqual(
      layoutGitDataset(dataset, 99).nodePositions,
    );
  });
});
