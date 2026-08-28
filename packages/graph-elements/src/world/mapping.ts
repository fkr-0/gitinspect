import type {
  ElementId,
  EdgeVisualDescriptor,
  GraphDataset,
  GraphEdgeRecord,
  GraphNodeRecord,
  NodeVisualDescriptor,
  SelectionState,
  Vec3,
} from "@gitinspect/contracts";

export interface GraphDatasetView<
  TNode extends GraphNodeRecord = GraphNodeRecord,
  TEdge extends GraphEdgeRecord = GraphEdgeRecord,
> {
  readonly revision: string;
  readonly nodes: readonly TNode[];
  readonly edges: readonly TEdge[];
}

export interface MappingContext<
  TNode extends GraphNodeRecord = GraphNodeRecord,
  TEdge extends GraphEdgeRecord = GraphEdgeRecord,
> {
  readonly dataset: GraphDatasetView<TNode, TEdge>;
  readonly revision: string;
  readonly nodePositions: ReadonlyMap<ElementId, Vec3>;
}

export interface DataMapper<
  TNode extends GraphNodeRecord = GraphNodeRecord,
  TEdge extends GraphEdgeRecord = GraphEdgeRecord,
> {
  mapNode(node: TNode, context: MappingContext<TNode, TEdge>): NodeVisualDescriptor;
  mapEdge(edge: TEdge, context: MappingContext<TNode, TEdge>): EdgeVisualDescriptor;
  relatedSelectionIds?(
    selection: SelectionState,
    dataset: GraphDatasetView<TNode, TEdge>,
  ): readonly ElementId[];
  childWorld?(
    node: TNode,
    context: MappingContext<TNode, TEdge>,
  ): Promise<GraphDataset | undefined>;
}

const ORIGIN: Vec3 = [0, 0, 0];

export function resolveNodePositions<TNode extends GraphNodeRecord>(
  nodes: readonly TNode[],
  positions?: ReadonlyMap<ElementId, Vec3>,
): ReadonlyMap<ElementId, Vec3> {
  if (positions) {
    const resolved = new Map<ElementId, Vec3>();
    for (const node of nodes) {
      resolved.set(node.id, positions.get(node.id) ?? node.positionHint ?? ORIGIN);
    }
    return resolved;
  }

  return new Map(nodes.map((node) => [node.id, node.positionHint ?? ORIGIN] as const));
}
