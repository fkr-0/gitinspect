import { describe, expect, it } from "vitest";
import type {
  DataMapper,
  GraphDataset,
  MappingContext,
} from "@gitinspect/graph-elements";

import type { GitSearchHighlightOverlay } from "./gitSearch";
import { createSearchHighlightMapper } from "./highlightMapper";

describe("createSearchHighlightMapper", () => {
  it("highlights descriptor copies while preserving semantic and visual IDs", () => {
    const dataset: GraphDataset = {
      revision: "r1",
      nodes: [{ id: "commit:a", kind: "commit", properties: {} }],
      edges: [],
    };
    const context: MappingContext = {
      dataset,
      revision: dataset.revision,
      nodePositions: new Map([["commit:a", [0, 0, 0] as const]]),
    };
    const originalElement = {
      id: "commit:a:plate",
      primitive: "box" as const,
      color: "#fff",
      opacity: 0.5,
      interactionKey: "commit:a",
    };
    const base: DataMapper = {
      mapNode: (node) => ({ nodeId: node.id, elements: [originalElement] }),
      mapEdge: (edge) => ({ edgeId: edge.id, style: "solid", color: "#fff", width: 1 }),
    };
    const overlay: GitSearchHighlightOverlay = {
      hitIds: new Set(["commit:a"]),
      byId: new Map([["commit:a", { rank: 0, score: 80, match: "substring" }]]),
    };
    const mapper = createSearchHighlightMapper(base, overlay);
    const mapped = mapper.mapNode(dataset.nodes[0]!, context);

    expect(mapped.nodeId).toBe("commit:a");
    expect(mapped.elements[0]?.id).toBe("commit:a:plate");
    expect(mapped.elements[0]?.interactionKey).toBe("commit:a");
    expect(mapped.elements[0]?.emissive).toBe("#ffd166");
    expect(mapped.elements[0]?.opacity).toBe(0.92);
    expect(mapped.elements[0]?.metadata).toMatchObject({ searchHighlight: true, searchRank: 0 });
    expect(originalElement).toEqual({
      id: "commit:a:plate",
      primitive: "box",
      color: "#fff",
      opacity: 0.5,
      interactionKey: "commit:a",
    });
  });
});
