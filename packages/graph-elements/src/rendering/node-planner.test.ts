import type { NodeVisualDescriptor } from "@gitinspect/contracts";
import { describe, expect, it } from "vitest";
import { planNodeRendering } from "./node-planner";

describe("planNodeRendering", () => {
  it("batches compatible mesh primitives while preserving semantic identities", () => {
    const descriptors: readonly NodeVisualDescriptor[] = [
      {
        nodeId: "node-a",
        elements: [
          { id: "body", primitive: "box", color: "#ff0000", interactionKey: "body:a" },
          { id: "caption", primitive: "label", label: "A", position: [0, 2, 0] },
        ],
      },
      {
        nodeId: "node-b",
        elements: [{ id: "body", primitive: "box", color: "#00ff00", interactionKey: "body:b" }],
      },
    ];
    const positions = new Map([
      ["node-a", [1, 0, 0] as const],
      ["node-b", [4, 0, 0] as const],
    ]);

    const plan = planNodeRendering(descriptors, positions);

    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]?.instances).toHaveLength(2);
    expect(
      plan.batches[0]?.instances.map((instance) => [
        instance.ownerId,
        instance.interactionKey,
        instance.position,
      ]),
    ).toEqual([
      ["node-a", "body:a", [1, 0, 0]],
      ["node-b", "body:b", [4, 0, 0]],
    ]);
    expect(plan.labels).toEqual([
      expect.objectContaining({
        ownerId: "node-a",
        elementId: "caption",
        text: "A",
        position: [1, 2, 0],
      }),
    ]);
  });

  it("splits material-incompatible opacity/emissive groups and ignores non-node primitives deterministically", () => {
    const plan = planNodeRendering([
      {
        nodeId: "node-a",
        elements: [
          { id: "opaque", primitive: "sphere", opacity: 1 },
          { id: "ghost", primitive: "sphere", opacity: 0.4 },
          { id: "glow", primitive: "sphere", emissive: "#00ffff" },
          { id: "unsupported", primitive: "particles", interactionKey: "particle-root" },
        ],
      },
    ]);

    expect(plan.batches.map((batch) => batch.key)).toEqual(
      [...plan.batches.map((batch) => batch.key)].sort(),
    );
    expect(plan.batches).toHaveLength(3);
    expect(plan.ignored).toEqual([
      { ownerId: "node-a", elementId: "unsupported", interactionKey: "particle-root" },
    ]);
  });
});
