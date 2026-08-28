import type { GraphDataset } from "@gitinspect/contracts";
import { describe, expect, it } from "vitest";
import { LayoutEngine } from "./index.js";

function dataset(
  ids: readonly string[],
  edges: readonly (readonly [string, string, string])[],
): GraphDataset {
  return {
    revision: ids.join(":"),
    nodes: ids.map((id) => ({
      id,
      kind: "node",
      properties: {},
      ...(id.startsWith("g") ? { group: "group" } : {}),
    })),
    edges: edges.map(([id, source, target]) => ({
      id,
      source,
      target,
      directed: true,
      kind: "dependency",
      properties: {},
    })),
  };
}

describe("LayoutEngine", () => {
  it("is deterministic and keeps directed dependencies monotonic on Y", () => {
    const graph = dataset(
      ["a", "b", "c", "d"],
      [
        ["ab", "a", "b"],
        ["ac", "a", "c"],
        ["bd", "b", "d"],
        ["cd", "c", "d"],
      ],
    );
    const engine = new LayoutEngine();
    const constraints = {
      temporalHints: { a: 10, b: 30, c: 20, d: 40 },
      preferredParents: { b: "a", c: "a", d: "b" },
      laneAffinity: { b: "left", c: "right" },
    } as const;
    const first = engine.layout({ dataset: graph, seed: 42, constraints });
    const second = engine.layout({ dataset: graph, seed: 42, constraints });
    expect(second.nodePositions).toEqual(first.nodePositions);
    for (const edge of graph.edges) {
      expect(first.nodePositions[edge.target]?.[1]).toBeGreaterThan(
        first.nodePositions[edge.source]?.[1] ?? Infinity,
      );
    }
    expect(first.nodePositions.b?.[0]).not.toBe(first.nodePositions.c?.[0]);
  });

  it("diagnoses cycles and disconnected components without throwing", () => {
    const graph = dataset(
      ["a", "b", "lonely"],
      [
        ["ab", "a", "b"],
        ["ba", "b", "a"],
      ],
    );
    const result = new LayoutEngine().layout({ dataset: graph, seed: 3 });
    expect(result.nodePositions.a).toBeDefined();
    expect(result.nodePositions.lonely).toBeDefined();
    expect(result.diagnostics.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["cycle", "disconnected"]),
    );
  });

  it("preserves old nodes closely when a small addition is laid out with a previous result", () => {
    const engine = new LayoutEngine();
    const initial = dataset(
      ["a", "b", "c"],
      [
        ["ab", "a", "b"],
        ["bc", "b", "c"],
      ],
    );
    const before = engine.layout({ dataset: initial, seed: 99 });
    const expanded = dataset(
      ["a", "b", "c", "new"],
      [
        ["ab", "a", "b"],
        ["bc", "b", "c"],
        ["cn", "c", "new"],
      ],
    );
    const after = engine.layout({ dataset: expanded, seed: 99, previous: before });
    for (const id of ["a", "b", "c"] as const) {
      const oldPosition = before.nodePositions[id];
      const newPosition = after.nodePositions[id];
      expect(oldPosition).toBeDefined();
      expect(newPosition).toBeDefined();
      if (oldPosition !== undefined && newPosition !== undefined) {
        expect(Math.abs(oldPosition[0] - newPosition[0])).toBeLessThan(80);
        expect(Math.abs(oldPosition[2] - newPosition[2])).toBeLessThan(80);
        expect(newPosition[1]).toBe(oldPosition[1]);
      }
    }
  });

  it("honors pinned nodes and reports explicit ordering conflicts", () => {
    const graph = dataset(["a", "b"], [["ab", "a", "b"]]);
    const result = new LayoutEngine().layout({
      dataset: graph,
      seed: 1,
      constraints: { pinnedNodes: { b: [1, -1, 2] } },
    });
    expect(result.nodePositions.b).toEqual([1, -1, 2]);
    expect(result.diagnostics.some((entry) => entry.kind === "pinned-order-conflict")).toBe(true);
  });

  it("lays out a synthetic 1k-node dependency history within a unit-CI budget", () => {
    const ids = Array.from(
      { length: 1_000 },
      (_, index) => `n-${index.toString().padStart(4, "0")}`,
    );
    const edges = ids
      .slice(1)
      .map((target, index) => [`e-${index}`, ids[index] ?? "", target] as const);
    const graph = dataset(ids, edges);
    const started = Date.now();
    const result = new LayoutEngine().layout({ dataset: graph, seed: 0x5eed });
    const elapsedMs = Date.now() - started;
    expect(Object.keys(result.nodePositions)).toHaveLength(1_000);
    expect(result.nodePositions[ids.at(-1) ?? ""]?.[1]).toBeGreaterThan(
      result.nodePositions[ids[0] ?? ""]?.[1] ?? Infinity,
    );
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
