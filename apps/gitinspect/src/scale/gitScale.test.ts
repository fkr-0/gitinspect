import { describe, expect, it } from "vitest";
import type { GraphDataset } from "@gitinspect/graph-elements";

import { GitScalePlanner } from "./gitScale";
import { layoutGitDatasetForScale } from "./gitScaleLayout";
import { createSyntheticGitHistory } from "./synthetic";

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

    expect(model.lodPlan.full.map((entry) => entry.id)).toEqual([hovered, searchHit, selected].sort());
    expect(model.logicalDataset).toBe(dataset);
    expect(model.renderDataset.nodes.filter((node) => [selected, hovered, searchHit].includes(node.id)).map((node) => node.id).sort())
      .toEqual([selected, hovered, searchHit].sort());
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
});

describe("layoutGitDatasetForScale", () => {
  it("keeps direct Git layout for smaller worlds and compacts the layout graph for large histories", () => {
    const small = layoutGitDatasetForScale(createSyntheticGitHistory(1_000), { directNodeLimit: 2_048 });
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
      expect(child[1]).toBeGreaterThan(parent[1]);
    }
  });
});
