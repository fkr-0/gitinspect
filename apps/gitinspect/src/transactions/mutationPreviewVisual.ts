import type {
  DataMapper,
  EdgeVisualDescriptor,
  ElementId,
  GraphEdgeRecord,
  GraphNodeRecord,
  MappingContext,
  NodeVisualDescriptor,
  SelectionState,
} from "@gitinspect/graph-elements";

import type { GitMutationPreview } from "./gitMutationPreview";

export interface MutationPreviewVisualStyle {
  readonly emissive?: string;
  readonly minimumOpacity?: number;
  readonly scaleMultiplier?: number;
}

const DEFAULT_STYLE: Required<MutationPreviewVisualStyle> = Object.freeze({
  emissive: "#ff4fd8",
  minimumOpacity: 0.94,
  scaleMultiplier: 1.08,
});

function addOidIds(ids: Set<ElementId>, oid: string | undefined): void {
  if (!oid) return;
  ids.add(`commit:${oid}`);
  ids.add(`commit-boundary:${oid}`);
  ids.add(`object:${oid}`);
}

/**
 * Map bounded backend preview evidence onto identities that can already exist in the live graph.
 * New rewritten objects are not invented here; if they are absent from the authoritative dataset,
 * the textual preview remains the source of truth until a post-preview graph delta is available.
 */
export function gitMutationPreviewAffectedIds(
  preview: GitMutationPreview | undefined,
): ReadonlySet<ElementId> {
  const ids = new Set<ElementId>();
  if (!preview) return ids;

  for (const change of preview.changedRefs) {
    ids.add(`ref:${change.name}`);
    addOidIds(ids, change.beforeOid);
    addOidIds(ids, change.afterOid);
  }
  for (const rewrite of preview.rewrittenCommits) {
    addOidIds(ids, rewrite.oldOid);
    addOidIds(ids, rewrite.newOid);
  }
  for (const entry of preview.hashCascade) {
    addOidIds(ids, entry.oldOid);
    addOidIds(ids, entry.newOid);
    addOidIds(ids, entry.newParentOid);
  }
  return ids;
}

/** Decorate existing 3D node descriptors while preserving all semantic IDs and selection hooks. */
export function createMutationPreviewMapper<
  TNode extends GraphNodeRecord = GraphNodeRecord,
  TEdge extends GraphEdgeRecord = GraphEdgeRecord,
>(
  base: DataMapper<TNode, TEdge>,
  affectedIds: ReadonlySet<ElementId>,
  style: MutationPreviewVisualStyle = {},
): DataMapper<TNode, TEdge> {
  const resolved = {
    emissive: style.emissive ?? DEFAULT_STYLE.emissive,
    minimumOpacity: style.minimumOpacity ?? DEFAULT_STYLE.minimumOpacity,
    scaleMultiplier: style.scaleMultiplier ?? DEFAULT_STYLE.scaleMultiplier,
  };
  return {
    mapNode(node: TNode, context: MappingContext<TNode, TEdge>): NodeVisualDescriptor {
      const descriptor = base.mapNode(node, context);
      if (!affectedIds.has(node.id)) return descriptor;
      return {
        nodeId: descriptor.nodeId,
        elements: descriptor.elements.map((element) => ({
          ...element,
          ...(element.scale === undefined
            ? {}
            : {
                scale: element.scale.map((value) => value * resolved.scaleMultiplier) as [
                  number,
                  number,
                  number,
                ],
              }),
          emissive: resolved.emissive,
          opacity: Math.max(element.opacity ?? 1, resolved.minimumOpacity),
          metadata: { ...element.metadata, mutationPreviewAffected: true },
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
            // biome-ignore lint/style/noNonNullAssertion: guarded by truthy check above.
            return base.relatedSelectionIds!(selection, dataset);
          },
        }
      : {}),
    ...(base.childWorld
      ? {
          childWorld(node: TNode, context: MappingContext<TNode, TEdge>) {
            // biome-ignore lint/style/noNonNullAssertion: guarded by truthy check above.
            return base.childWorld!(node, context);
          },
        }
      : {}),
  };
}
