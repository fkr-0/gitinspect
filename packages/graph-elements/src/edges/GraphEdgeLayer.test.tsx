import { describe, expect, it } from "vitest";
import type { PlannedEdgeBatch, PlannedEdgeHeadBatch } from "../rendering/types";

import { edgeInteractionForHead, edgeInteractionForSegment } from "./GraphEdgeLayer";

describe("GraphEdgeLayer semantic interaction adapters", () => {
  it("resolves a wide-line face index to stable edge segment semantics", () => {
    const batch = {
      key: "history-batch",
      style: {},
      segments: [
        {
          ownerId: "history:a:b:0",
          elementId: "history:a:b:0",
          interactionKey: "history:a:b:0",
          edgeId: "history:a:b:0",
          segmentIndex: 0,
          start: [0, 0, 0],
          end: [1, 0, 0],
        },
      ],
    } as unknown as PlannedEdgeBatch;

    expect(edgeInteractionForSegment(batch, 0, { ctrl: true })).toEqual({
      reference: { objectId: "edge-segments:history-batch", instanceId: 0 },
      identity: batch.segments[0],
      modifiers: { ctrl: true },
    });
    expect(edgeInteractionForSegment(batch, 1)).toBeUndefined();
  });

  it("resolves an instanced edge head to the same semantic edge identity", () => {
    const batch = {
      key: "tag-heads",
      kind: "diamond",
      color: "#fff",
      opacity: 1,
      heads: [
        {
          ownerId: "ref-target:refs/tags/v1",
          elementId: "ref-target:refs/tags/v1",
          interactionKey: "ref-target:refs/tags/v1",
          edgeId: "ref-target:refs/tags/v1",
          kind: "diamond",
          position: [1, 2, 3],
          direction: [0, 1, 0],
          color: "#fff",
          opacity: 1,
          scale: 1,
        },
      ],
    } as unknown as PlannedEdgeHeadBatch;

    expect(edgeInteractionForHead(batch, 0, { alt: true })).toEqual({
      reference: { objectId: "edge-heads:tag-heads", instanceId: 0 },
      identity: batch.heads[0],
      modifiers: { alt: true },
    });
    expect(edgeInteractionForHead(batch, 4)).toBeUndefined();
  });
});
