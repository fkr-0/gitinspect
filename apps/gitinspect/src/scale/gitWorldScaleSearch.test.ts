import { describe, expect, it } from "vitest";

import { GitWorldScaleSearchAdapter } from "./gitWorldScaleSearch";
import { createSyntheticGitHistory } from "./synthetic";

describe("GitWorldScaleSearchAdapter", () => {
  it("keeps filtering, search highlighting, and LOD promotion as separate derived views", () => {
    const dataset = createSyntheticGitHistory(4_000);
    const adapter = new GitWorldScaleSearchAdapter({ directNodeLimit: 512 });
    const selected = "commit:00000000000a";
    const model = adapter.project({
      dataset,
      camera: { position: [0, -2_000, 0] },
      selectedIds: new Set([selected]),
      filters: {
        objectKinds: ["commit"],
        authors: ["Author 7"],
      },
      search: {
        text: "subsystem 3",
        mode: "substring",
        limit: 32,
      },
    });

    expect(model.filter?.ids.size).toBeGreaterThan(32);
    expect(model.search?.results.length).toBeLessThanOrEqual(32);
    expect(model.search?.results.every((result) => model.filter?.ids.has(result.id))).toBe(true);
    expect(model.highlights.hitIds).toEqual(model.search?.hitIds);
    expect(model.scale.stats.eligibleNodeCount).toBe(model.filter?.ids.size);
    // The selected identity is outside the filter here and therefore not rendered;
    // filters remain authoritative while selection promotion applies within the eligible set.
    expect(model.scale.lodPlan.full.some((entry) => entry.id === selected)).toBe(false);
    expect(model.scale.logicalDataset).toBe(dataset);
  });

  it("promotes search hits when no filter excludes them", () => {
    const dataset = createSyntheticGitHistory(3_000);
    const adapter = new GitWorldScaleSearchAdapter({ directNodeLimit: 512 });
    const model = adapter.project({
      dataset,
      camera: { position: [50_000, 50_000, 50_000] },
      search: {
        text: "synthetic commit 2999",
        mode: "exact",
        limit: 8,
      },
    });
    const hit = model.search?.results[0]?.id;
    expect(hit).toBe("commit:000000000bb7");
    expect(model.scale.lodPlan.full.some((entry) => entry.id === hit)).toBe(true);
    expect(model.scale.renderDataset.nodes.some((node) => node.id === hit)).toBe(true);
  });
});
