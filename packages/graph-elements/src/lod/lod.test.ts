import { describe, expect, it } from "vitest";
import type { LodLogicalNode } from "./index.js";
import { computeLodTier, planLod } from "./index.js";

function synthetic(count: number): readonly LodLogicalNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index.toString().padStart(6, "0")}`,
    kind: index % 3 === 0 ? "alpha" : "beta",
    semanticBucket: `lane-${index % 8}`,
    position: [index % 100, Math.floor(index / 100), (index * 17) % 100],
    importance: index % 997 === 0 ? 2 : 0,
  }));
}

describe("LOD planning", () => {
  it("computes detail tiers from distance and importance", () => {
    const camera = { position: [0, 0, 0] as const };
    const thresholds = {
      fullDistance: 10,
      simplifiedDistance: 20,
      aggregateDistance: 40,
      importanceDistanceScale: 1,
    };
    expect(computeLodTier({ id: "near", kind: "n", position: [5, 0, 0] }, camera, thresholds)).toBe(
      "full",
    );
    expect(computeLodTier({ id: "mid", kind: "n", position: [15, 0, 0] }, camera, thresholds)).toBe(
      "simplified",
    );
    expect(computeLodTier({ id: "far", kind: "n", position: [30, 0, 0] }, camera, thresholds)).toBe(
      "aggregate",
    );
    expect(
      computeLodTier({ id: "gone", kind: "n", position: [50, 0, 0] }, camera, thresholds),
    ).toBe("hidden");
    expect(
      computeLodTier(
        { id: "important", kind: "n", position: [30, 0, 0], importance: 3 },
        camera,
        thresholds,
      ),
    ).toBe("full");
  });

  it("builds deterministic spatial/semantic buckets and preserves member IDs", () => {
    const nodes: readonly LodLogicalNode[] = [
      { id: "c", kind: "commit", semanticBucket: "history", position: [31, 0, 0] },
      { id: "a", kind: "commit", semanticBucket: "history", position: [32, 1, 0] },
      { id: "b", kind: "ref", semanticBucket: "refs", position: [33, 1, 0] },
    ];
    const options = {
      nodes,
      camera: { position: [0, 0, 0] as const },
      thresholds: { fullDistance: 1, simplifiedDistance: 2, aggregateDistance: 100 },
      bucketSize: 100,
    };
    const first = planLod(options);
    const second = planLod(options);
    expect(second.aggregates).toEqual(first.aggregates);
    expect(first.aggregates).toHaveLength(2);
    expect(
      first.aggregates.find((bucket) => bucket.semanticBucket === "history")?.memberIds,
    ).toEqual(["a", "c"]);
  });

  it("promotes selected, hovered, and search-hit nodes out of aggregate/hidden tiers", () => {
    const nodes: readonly LodLogicalNode[] = [
      { id: "selected", kind: "n", position: [5000, 0, 0] },
      { id: "hovered", kind: "n", position: [5000, 1, 0] },
      { id: "search", kind: "n", position: [5000, 2, 0] },
      { id: "hidden", kind: "n", position: [5000, 3, 0] },
    ];
    const plan = planLod({
      nodes,
      camera: { position: [0, 0, 0] },
      selectedIds: new Set(["selected"]),
      hoveredIds: new Set(["hovered"]),
      searchHitIds: new Set(["search"]),
    });
    expect(plan.full.map((entry) => entry.id)).toEqual(["hovered", "search", "selected"]);
    expect(plan.hidden.count).toBe(1);
  });

  for (const count of [1_000, 10_000, 100_000]) {
    it(`plans ${count.toLocaleString()} logical nodes with linear bounded state`, () => {
      const nodes = synthetic(count);
      const started = Date.now();
      const plan = planLod({
        nodes,
        camera: { position: [50, -1000, 50] },
        thresholds: { fullDistance: 25, simplifiedDistance: 100, aggregateDistance: 5_000 },
        bucketSize: 250,
      });
      const elapsedMs = Date.now() - started;
      expect(plan.stats.logicalNodeCount).toBe(count);
      expect(plan.stats.retainedIdentityReferences).toBeLessThanOrEqual(count);
      expect(plan.stats.estimatedPlanBytes).toBeLessThan(count * 256 + 2_000_000);
      expect(elapsedMs).toBeLessThan(5_000);
    });
  }
});
