import { describe, expect, it } from "vitest";

import { LabelSystem, type LabelDescriptor } from "./LabelSystem";

const labels: readonly LabelDescriptor[] = [
  {
    id: "near-important",
    text: "near",
    elementId: "a",
    position: [0, 0, 2],
    importance: 10,
    maxLod: 2,
  },
  { id: "far", text: "far", elementId: "b", position: [0, 0, 100], importance: 9, maxDistance: 20 },
  { id: "low", text: "low", elementId: "c", position: [0, 0, 3], importance: 1 },
  {
    id: "selected-far",
    text: "selected",
    elementId: "d",
    position: [0, 0, 200],
    importance: 0,
    maxDistance: 10,
    maxLod: 0,
  },
];

describe("LabelSystem", () => {
  it("filters by distance/LOD/importance while promoting selected labels", () => {
    const system = new LabelSystem({ minImportance: 2, maxVisible: 10 });
    const plan = system.evaluate(labels, {
      cameraPosition: [0, 0, 0],
      lod: 1,
      selectedIds: new Set(["d"]),
    });

    expect(plan.visible.map((entry) => entry.descriptor.id)).toEqual([
      "selected-far",
      "near-important",
    ]);
    expect(plan.hidden).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: expect.objectContaining({ id: "far" }),
          hiddenReason: "distance",
        }),
        expect.objectContaining({
          descriptor: expect.objectContaining({ id: "low" }),
          hiddenReason: "importance",
        }),
      ]),
    );
  });

  it("applies a deterministic visible-label budget after priority sorting", () => {
    const system = new LabelSystem({ maxVisible: 2 });
    const plan = system.evaluate(
      [
        { id: "b", text: "B", position: [0, 0, 3], importance: 5 },
        { id: "a", text: "A", position: [0, 0, 2], importance: 5 },
        { id: "c", text: "C", position: [0, 0, 1], importance: 4 },
      ],
      { cameraPosition: [0, 0, 0], lod: 0 },
    );

    expect(plan.visible.map((entry) => entry.descriptor.id)).toEqual(["a", "b"]);
    expect(plan.hidden).toEqual([
      expect.objectContaining({
        descriptor: expect.objectContaining({ id: "c" }),
        hiddenReason: "budget",
      }),
    ]);
  });

  it("exposes a collision-policy seam before budgeting", () => {
    const system = new LabelSystem({
      maxVisible: 5,
      collisionPolicy: (candidate, accepted) =>
        !accepted.some(
          (other) =>
            candidate.descriptor.collisionGroup !== undefined &&
            candidate.descriptor.collisionGroup === other.descriptor.collisionGroup,
        ),
    });
    const plan = system.evaluate(
      [
        {
          id: "high",
          text: "high",
          position: [0, 0, 1],
          importance: 10,
          collisionGroup: "screen-cell-1",
        },
        {
          id: "low",
          text: "low",
          position: [0, 0, 2],
          importance: 1,
          collisionGroup: "screen-cell-1",
        },
      ],
      { cameraPosition: [0, 0, 0], lod: 0 },
    );

    expect(plan.visible.map((entry) => entry.descriptor.id)).toEqual(["high"]);
    expect(plan.hidden[0]).toMatchObject({ hiddenReason: "collision", descriptor: { id: "low" } });
  });
});
