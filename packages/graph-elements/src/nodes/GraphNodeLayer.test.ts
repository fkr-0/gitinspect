import { describe, expect, it } from "vitest";

import type { PlannedNodeBatch } from "../rendering/types";
import { nodeInteractionForInstance } from "./GraphNodeLayer";

const batch: PlannedNodeBatch = {
  key: "sphere|opaque",
  primitive: "sphere",
  opacity: 1,
  emissive: "#000000",
  instances: [
    {
      ownerId: "commit:a",
      elementId: "body",
      interactionKey: "commit:a:body",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#ffffff",
      metadata: {},
    },
    {
      ownerId: "lod-aggregate:history",
      elementId: "body",
      interactionKey: "aggregate:history:body",
      position: [1, 0, 0],
      scale: [1, 1, 1],
      color: "#ffffff",
      metadata: {},
    },
  ],
};

describe("GraphNodeLayer semantic interaction seam", () => {
  it("maps an instanced render hit to its stable semantic identity and pick reference", () => {
    expect(nodeInteractionForInstance(batch, 1, { alt: true })).toEqual({
      reference: { objectId: "sphere|opaque", instanceId: 1 },
      identity: batch.instances[1],
      modifiers: { alt: true },
    });
  });

  it("rejects stale or out-of-range instance ids instead of inventing identity", () => {
    expect(nodeInteractionForInstance(batch, 99)).toBeUndefined();
  });

  it("keeps modifier-rich semantic identity generic for click, hover, or context consumers", () => {
    expect(nodeInteractionForInstance(batch, 0, { shift: true, meta: true })).toEqual({
      reference: { objectId: "sphere|opaque", instanceId: 0 },
      identity: batch.instances[0],
      modifiers: { shift: true, meta: true },
    });
  });
});
