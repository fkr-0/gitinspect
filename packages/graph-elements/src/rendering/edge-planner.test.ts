import type { EdgeVisualDescriptor, GraphEdgeRecord } from "@gitinspect/contracts";
import { describe, expect, it } from "vitest";
import { EdgeStyleRegistry } from "../edges/EdgeStyleRegistry";
import { planEdgeRendering } from "./edge-planner";

const edge: GraphEdgeRecord = {
  id: "edge-a",
  source: "a",
  target: "b",
  directed: true,
  kind: "relation",
  properties: {},
};

function descriptor(style = "solid"): EdgeVisualDescriptor {
  return {
    edgeId: edge.id,
    style,
    color: "#eeeeee",
    width: 2,
    head: "arrow",
  };
}

describe("planEdgeRendering", () => {
  it("emits batched straight segments and semantic arrow-head records", () => {
    const plan = planEdgeRendering(
      [edge],
      [descriptor()],
      new Map([
        ["a", [0, 0, 0] as const],
        ["b", [0, 4, 0] as const],
      ]),
    );

    expect(plan.diagnostics).toEqual([]);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.segments).toEqual([
      expect.objectContaining({
        ownerId: "edge-a",
        interactionKey: "edge-a",
        edgeId: "edge-a",
        segmentIndex: 0,
        start: [0, 0, 0],
        end: [0, 4, 0],
      }),
    ]);
    expect(plan.headBatches[0]?.heads[0]).toMatchObject({
      edgeId: "edge-a",
      position: [0, 4, 0],
      direction: [0, 1, 0],
    });
  });

  it("uses supplied polyline routes and groups compatible edges into one batch", () => {
    const edgeB: GraphEdgeRecord = { ...edge, id: "edge-b" };
    const registry = new EdgeStyleRegistry().withStyle("poly", { pathForm: "polyline" });
    const positions = new Map([
      ["a", [0, 0, 0] as const],
      ["b", [4, 4, 0] as const],
    ]);
    const routes = new Map([
      ["edge-a", [[0, 4, 0] as const]],
      ["edge-b", [[4, 0, 0] as const]],
    ]);

    const plan = planEdgeRendering(
      [edge, edgeB],
      [descriptor("poly"), { ...descriptor("poly"), edgeId: "edge-b" }],
      positions,
      registry,
      routes,
    );

    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.segments).toHaveLength(4);
    expect(plan.batches[0]?.segments.map((segment) => segment.edgeId)).toEqual([
      "edge-a",
      "edge-a",
      "edge-b",
      "edge-b",
    ]);
  });

  it("creates deterministic wavy paths and reports missing endpoint positions", () => {
    const registry = new EdgeStyleRegistry().withStyle("wave", {
      pathForm: "wavy",
      waveAmplitude: 0.5,
      waveFrequency: 1,
      waveSegments: 4,
    });
    const positions = new Map([
      ["a", [0, 0, 0] as const],
      ["b", [4, 0, 0] as const],
    ]);
    const first = planEdgeRendering([edge], [descriptor("wave")], positions, registry);
    const second = planEdgeRendering([edge], [descriptor("wave")], positions, registry);

    expect(first).toEqual(second);
    expect(first.batches[0]?.segments).toHaveLength(4);
    expect(first.batches[0]?.segments.some((segment) => segment.end[2] !== 0)).toBe(true);

    const missing = planEdgeRendering([edge], [descriptor()], new Map([["a", [0, 0, 0] as const]]));
    expect(missing.diagnostics).toEqual([{ edgeId: "edge-a", reason: "missing-target-position" }]);
  });
});
