import type {
  DataMapper,
  EdgeVisualDescriptor,
  GraphEdgeRecord,
  GraphNodeRecord,
  MappingContext,
  NodeVisualDescriptor,
  SelectionState,
} from "@gitinspect/graph-elements";

import type { GitSearchHighlightOverlay } from "./gitSearch";

export interface GitSearchHighlightStyle {
  readonly emissive?: string;
  readonly minimumOpacity?: number;
}

const DEFAULT_STYLE: Required<GitSearchHighlightStyle> = Object.freeze({
  emissive: "#ffd166",
  minimumOpacity: 0.92,
});

/** Decorate visual descriptors only; semantic dataset/node/element IDs are preserved. */
export function createSearchHighlightMapper<
  TNode extends GraphNodeRecord = GraphNodeRecord,
  TEdge extends GraphEdgeRecord = GraphEdgeRecord,
>(
  base: DataMapper<TNode, TEdge>,
  highlights: GitSearchHighlightOverlay,
  style: GitSearchHighlightStyle = {},
): DataMapper<TNode, TEdge> {
  const resolved = {
    emissive: style.emissive ?? DEFAULT_STYLE.emissive,
    minimumOpacity: style.minimumOpacity ?? DEFAULT_STYLE.minimumOpacity,
  };
  const mapper: DataMapper<TNode, TEdge> = {
    mapNode(node: TNode, context: MappingContext<TNode, TEdge>): NodeVisualDescriptor {
      const descriptor = base.mapNode(node, context);
      const highlight = highlights.byId.get(node.id);
      if (!highlight) return descriptor;
      return {
        nodeId: descriptor.nodeId,
        elements: descriptor.elements.map((element) => ({
          ...element,
          emissive: resolved.emissive,
          opacity: Math.max(element.opacity ?? 1, resolved.minimumOpacity),
          metadata: {
            ...element.metadata,
            searchHighlight: true,
            searchRank: highlight.rank,
            searchScore: highlight.score,
            searchMatch: highlight.match,
          },
        })),
      };
    },
    mapEdge(edge: TEdge, context: MappingContext<TNode, TEdge>): EdgeVisualDescriptor {
      return base.mapEdge(edge, context);
    },
    ...(base.relatedSelectionIds
      ? {
          relatedSelectionIds(
            selection: SelectionState,
            dataset: Parameters<NonNullable<typeof base.relatedSelectionIds>>[1],
          ) {
            // biome-ignore lint/style/noNonNullAssertion: guarded by truthy check on base.relatedSelectionIds
            return base.relatedSelectionIds!(selection, dataset);
          },
        }
      : {}),
    ...(base.childWorld
      ? {
          childWorld(node: TNode, context: MappingContext<TNode, TEdge>) {
            // biome-ignore lint/style/noNonNullAssertion: guarded by truthy check on base.childWorld
            return base.childWorld!(node, context);
          },
        }
      : {}),
  };
  return mapper;
}
