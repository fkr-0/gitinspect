import { describe, expect, it } from "vitest";
import type { GraphDataset } from "@gitinspect/graph-elements";

import { GitScalePlanner } from "./gitScale";
import { layoutGitDatasetForScale } from "./gitScaleLayout";
import { createSyntheticBranchingGitHistory, createSyntheticGitHistory } from "./synthetic";

function id(index: number): string {
  return `commit:${index.toString(16).padStart(12, "0")}`;
}

describe("GitScalePlanner", () => {
  it("promotes selected, hovered, and search-hit identities without changing logical IDs", () => {
    const dataset = createSyntheticGitHistory(160);
    const planner = new GitScalePlanner({ directNodeLimit: 512 });
    const selected = id(70);
    const hovered = id(80);
    const searchHit = id(90);
    const model = planner.plan({
      dataset,
      camera: { position: [50_000, 50_000, 50_000] },
      thresholds: { fullDistance: 1, simplifiedDistance: 2, aggregateDistance: 3 },
      selectedIds: new Set([selected]),
      hoveredIds: new Set([hovered]),
      searchHitIds: new Set([searchHit]),
    });

    const fullIds = new Set(model.lodPlan.full.map((entry) => entry.id));
    expect(fullIds.has(selected)).toBe(true);
    expect(fullIds.has(hovered)).toBe(true);
    expect(fullIds.has(searchHit)).toBe(true);
    expect(fullIds.has("head:HEAD")).toBe(true);
    expect(fullIds.has("ref:refs/heads/main")).toBe(true);
    expect(model.logicalDataset).toBe(dataset);
    expect(
      model.renderDataset.nodes
        .filter((node) => [selected, hovered, searchHit].includes(node.id))
        .map((node) => node.id)
        .sort(),
    ).toEqual([selected, hovered, searchHit].sort());
    expect(dataset.nodes.find((node) => node.id === selected)?.kind).toBe("commit");
  });

  it("produces stable aggregate identities, semantic counts, and drill targets", () => {
    const dataset = createSyntheticGitHistory(4_000);
    const planner = new GitScalePlanner({ directNodeLimit: 512, macroGenerationWindow: 128 });
    const options = {
      dataset,
      camera: { position: [0, -2_000, 0] as const },
      thresholds: { fullDistance: 20, simplifiedDistance: 80, aggregateDistance: 20_000 },
      bucketSize: 300,
    };
    const first = planner.plan(options);
    const second = planner.plan(options);

    expect(first.lodPlan.aggregates.length).toBeGreaterThan(0);
    expect(second.lodPlan.aggregates).toEqual(first.lodPlan.aggregates);
    expect(second.projectionKey).toBe(first.projectionKey);
    expect(second.stats.layoutCacheHit).toBe(true);
    expect(second.stats.reusedLodMetadata).toBe(first.stats.eligibleNodeCount);
    const aggregate = first.lodPlan.aggregates[0]!;
    const renderedId = `lod-aggregate:${aggregate.id}`;
    expect(first.aggregateDrillTargets.get(renderedId)).toEqual({
      aggregateId: renderedId,
      drillTargetId: aggregate.memberIds[0],
      memberIds: aggregate.memberIds,
      count: aggregate.count,
    });
  });

  it("reuses layout and unchanged LOD metadata across revision-only refreshes", () => {
    const firstDataset = createSyntheticGitHistory(3_000);
    const planner = new GitScalePlanner({ directNodeLimit: 512 });
    const first = planner.plan({ dataset: firstDataset, camera: { position: [0, 0, 0] } });
    const refreshed: GraphDataset = {
      ...firstDataset,
      revision: "synthetic-3000-refresh",
    };
    const second = planner.plan({ dataset: refreshed, camera: { position: [0, 0, 0] } });

    expect(first.stats.layoutCacheHit).toBe(false);
    expect(second.stats.layoutCacheHit).toBe(true);
    expect(second.stats.rebuiltLodMetadata).toBe(0);
    expect(second.stats.reusedLodMetadata).toBe(second.stats.eligibleNodeCount);
  });

  it("accepts a logical filter set without mutating the source dataset", () => {
    const dataset = createSyntheticGitHistory(120);
    const included = new Set([id(10), id(11), id(12)]);
    const planner = new GitScalePlanner();
    const model = planner.plan({
      dataset,
      camera: { position: [0, 0, 0] },
      includedIds: included,
      selectedIds: new Set([id(11)]),
    });

    expect(model.stats.eligibleNodeCount).toBe(3);
    expect(model.lodPlan.stats.logicalNodeCount).toBe(3);
    expect(model.logicalDataset.nodes).toBe(dataset.nodes);
    expect(model.lodPlan.full.some((entry) => entry.id === id(11))).toBe(true);
  });

  it("preserves Git structural anchors and selected neighborhoods while linear runs aggregate", () => {
    const base = createSyntheticBranchingGitHistory(4_000);
    const taggedCommit = id(1_200);
    const dataset: GraphDataset = {
      ...base,
      revision: `${base.revision}:anchors`,
      nodes: [
        ...base.nodes,
        {
          id: "boundary:truncated-before",
          kind: "commit-boundary",
          label: "History truncated before this point",
          properties: { truncatedBoundary: true },
        },
        {
          id: "ref:refs/tags/scale-anchor",
          kind: "tag",
          label: "scale-anchor",
          properties: { name: "refs/tags/scale-anchor" },
        },
      ],
      edges: [
        ...base.edges,
        {
          id: "tag-target:scale-anchor",
          source: "ref:refs/tags/scale-anchor",
          target: taggedCommit,
          kind: "tag-target",
          directed: true,
          properties: {},
        },
      ],
    };
    const planner = new GitScalePlanner({ directNodeLimit: 512, macroGenerationWindow: 128 });
    const mergeIndex = Math.floor(4_000 * 0.65);
    const selected = "commit:feature-scale-1";
    const model = planner.plan({
      dataset,
      camera: { position: [20_000, 20_000, 20_000] },
      thresholds: { fullDistance: 1, simplifiedDistance: 2, aggregateDistance: 100_000 },
      selectedIds: new Set([selected]),
      bucketSize: 160,
    });
    const fullIds = new Set(model.lodPlan.full.map((entry) => entry.id));
    const selectedContext = [
      selected,
      "commit:feature-scale-0",
      `commit:${Math.floor(4_000 * 0.35).toString(16).padStart(12, "0")}`,
      id(mergeIndex),
      "ref:refs/heads/feature-scale",
      "head:HEAD",
      "ref:refs/heads/main",
      "ref:refs/remotes/origin/main",
      "boundary:truncated-before",
      "ref:refs/tags/scale-anchor",
      taggedCommit,
    ];
    for (const anchor of selectedContext) expect(fullIds.has(anchor), anchor).toBe(true);
    expect(fullIds.has(id(1_201))).toBe(false);
    expect(model.lodPlan.aggregates.length).toBeGreaterThan(0);
    expect(model.stats.renderNodeCount).toBeLessThan(model.stats.logicalNodeCount / 2);
    const collapsedHeadPath = model.renderDataset.edges.find(
      (edge) => edge.properties.collapsed === true && edge.properties.headPath === true,
    );
    expect(collapsedHeadPath).toBeDefined();
  });
});

describe("layoutGitDatasetForScale", () => {
  it("keeps direct Git layout for smaller worlds and compacts the layout graph for large histories", () => {
    const small = layoutGitDatasetForScale(createSyntheticGitHistory(1_000), {
      directNodeLimit: 2_048,
    });
    const largeDataset = createSyntheticGitHistory(10_000);
    const large = layoutGitDatasetForScale(largeDataset, {
      directNodeLimit: 2_048,
      macroGenerationWindow: 256,
    });

    expect(small.mode).toBe("direct");
    expect(large.mode).toBe("macro");
    expect(large.layoutNodeCount).toBeLessThan(large.logicalNodeCount / 20);
    expect(Object.keys(large.layout.nodePositions)).toHaveLength(largeDataset.nodes.length);
    for (let index = 1; index < 10_000; index += 499) {
      const parent = large.layout.nodePositions[id(index - 1)]!;
      const child = large.layout.nodePositions[id(index)]!;
      expect(child[0]).toBeGreaterThan(parent[0]);
      expect(child[1]).toBe(parent[1]);
      expect(parent[2]).toBe(0);
      expect(child[2]).toBe(0);
    }
  });

  it("keeps branch lanes and merge convergence explicit in macro mode without identity scatter", () => {
    const dataset = createSyntheticBranchingGitHistory(4_000);
    const first = layoutGitDatasetForScale(dataset, {
      directNodeLimit: 512,
      macroGenerationWindow: 128,
    });
    const second = layoutGitDatasetForScale(dataset, {
      directNodeLimit: 512,
      macroGenerationWindow: 128,
    });
    const featureTip = first.layout.nodePositions["commit:feature-scale-1"]!;
    const mergeIndex = Math.floor(4_000 * 0.65);
    const merge = first.layout.nodePositions[id(mergeIndex)]!;
    const mainBeforeMerge = first.layout.nodePositions[id(mergeIndex - 1)]!;
    const featureRef = first.layout.nodePositions["ref:refs/heads/feature-scale"]!;

    expect(first.mode).toBe("macro");
    expect(second.layout.nodePositions).toEqual(first.layout.nodePositions);
    expect(featureTip[1]).not.toBe(mainBeforeMerge[1]);
    expect(featureTip[2]).toBe(0);
    expect(merge[1]).toBe(mainBeforeMerge[1]);
    expect(merge[2]).toBe(0);
    expect(merge[0]).toBeGreaterThan(featureTip[0]);
    expect(featureRef[0]).toBe(featureTip[0]);
    expect(featureRef[1]).toBeGreaterThan(featureTip[1]);
    expect(featureRef[2]).toBeGreaterThan(featureTip[2]);
  });
});
