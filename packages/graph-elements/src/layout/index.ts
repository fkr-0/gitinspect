import type { ElementId, GraphDataset, GraphEdgeRecord, Vec3 } from "@gitinspect/contracts";

export interface LayoutWeights {
  readonly temporalHints: number;
  readonly preferredParentContinuity: number;
  readonly groupAffinity: number;
  readonly laneAffinity: number;
  readonly previousPositionStability: number;
}

export interface LayoutSpacing {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface LayoutConstraints {
  readonly spacing?: Partial<LayoutSpacing>;
  readonly weights?: Partial<LayoutWeights>;
  readonly temporalHints?: Readonly<Record<ElementId, number>>;
  readonly preferredParents?: Readonly<Record<ElementId, ElementId>>;
  readonly laneAffinity?: Readonly<Record<ElementId, string>>;
  readonly pinnedNodes?: Readonly<Record<ElementId, Vec3>>;
}

export interface LayoutPreviousResult {
  readonly nodePositions: Readonly<Record<ElementId, Vec3>>;
}

export interface LayoutInput {
  readonly dataset: GraphDataset;
  readonly seed: number;
  readonly constraints?: LayoutConstraints;
  readonly previous?: LayoutPreviousResult;
}

export type LayoutDiagnosticKind =
  | "cycle"
  | "disconnected"
  | "missing-edge-endpoint"
  | "pinned-order-conflict";

export interface LayoutDiagnostic {
  readonly kind: LayoutDiagnosticKind;
  readonly message: string;
  readonly nodeIds: readonly ElementId[];
  readonly edgeIds?: readonly ElementId[];
}

export interface LayoutCluster {
  readonly id: string;
  readonly memberIds: readonly ElementId[];
  readonly layer: number;
}

export interface LayoutBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface LayoutResult extends LayoutPreviousResult {
  readonly clusters: readonly LayoutCluster[];
  readonly bounds: LayoutBounds;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

const DEFAULT_SPACING: LayoutSpacing = Object.freeze({ x: 8, y: 10, z: 8 });
const DEFAULT_WEIGHTS: LayoutWeights = Object.freeze({
  temporalHints: 0.2,
  preferredParentContinuity: 0.8,
  groupAffinity: 0.7,
  laneAffinity: 1,
  previousPositionStability: 0.9,
});

interface Component {
  readonly id: number;
  readonly nodes: readonly ElementId[];
  readonly cyclic: boolean;
}

interface LaneTarget {
  readonly x: number;
  readonly z: number;
  readonly weight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolveSpacing(input: LayoutConstraints | undefined): LayoutSpacing {
  return {
    x: Math.max(0.001, finiteNonNegative(input?.spacing?.x, DEFAULT_SPACING.x)),
    y: Math.max(0.001, finiteNonNegative(input?.spacing?.y, DEFAULT_SPACING.y)),
    z: Math.max(0.001, finiteNonNegative(input?.spacing?.z, DEFAULT_SPACING.z)),
  };
}

function resolveWeights(input: LayoutConstraints | undefined): LayoutWeights {
  return {
    temporalHints: finiteNonNegative(input?.weights?.temporalHints, DEFAULT_WEIGHTS.temporalHints),
    preferredParentContinuity: finiteNonNegative(
      input?.weights?.preferredParentContinuity,
      DEFAULT_WEIGHTS.preferredParentContinuity,
    ),
    groupAffinity: finiteNonNegative(input?.weights?.groupAffinity, DEFAULT_WEIGHTS.groupAffinity),
    laneAffinity: finiteNonNegative(input?.weights?.laneAffinity, DEFAULT_WEIGHTS.laneAffinity),
    previousPositionStability: finiteNonNegative(
      input?.weights?.previousPositionStability,
      DEFAULT_WEIGHTS.previousPositionStability,
    ),
  };
}

function hashString(value: string, seed: number): number {
  let hash = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function lanePoint(key: string, seed: number, spacing: LayoutSpacing): Vec3 {
  const xHash = hashString(`x:${key}`, seed);
  const zHash = hashString(`z:${key}`, seed ^ 0x9e3779b9);
  // Stable sparse integer lanes minimize movement when unrelated nodes are added.
  const xLane = (xHash % 257) - 128;
  const zLane = (zHash % 257) - 128;
  return [xLane * spacing.x, 0, zLane * spacing.z];
}

function buildAdjacency(dataset: GraphDataset): {
  readonly outgoing: ReadonlyMap<ElementId, readonly GraphEdgeRecord[]>;
  readonly validEdges: readonly GraphEdgeRecord[];
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const nodesById = new Map(dataset.nodes.map((node) => [node.id, node] as const));
  const outgoingMutable = new Map<ElementId, GraphEdgeRecord[]>();
  const diagnostics: LayoutDiagnostic[] = [];
  const validEdges: GraphEdgeRecord[] = [];

  for (const node of dataset.nodes) {
    outgoingMutable.set(node.id, []);
  }
  for (const edge of dataset.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      diagnostics.push({
        kind: "missing-edge-endpoint",
        message: `Edge ${edge.id} references an absent endpoint and was ignored by layout.`,
        nodeIds: [edge.source, edge.target],
        edgeIds: [edge.id],
      });
      continue;
    }
    validEdges.push(edge);
    if (edge.directed) outgoingMutable.get(edge.source)?.push(edge);
  }
  const normalize = (
    entries: Map<ElementId, GraphEdgeRecord[]>,
  ): ReadonlyMap<ElementId, readonly GraphEdgeRecord[]> => {
    for (const edges of entries.values()) edges.sort((a, b) => a.id.localeCompare(b.id));
    return entries;
  };
  return {
    outgoing: normalize(outgoingMutable),
    validEdges,
    diagnostics,
  };
}

function stronglyConnectedComponents(
  nodeIds: readonly ElementId[],
  outgoing: ReadonlyMap<ElementId, readonly GraphEdgeRecord[]>,
): readonly Component[] {
  let index = 0;
  const indices = new Map<ElementId, number>();
  const lowLinks = new Map<ElementId, number>();
  const stack: ElementId[] = [];
  const onStack = new Set<ElementId>();
  const raw: ElementId[][] = [];

  const visit = (nodeId: ElementId): void => {
    indices.set(nodeId, index);
    lowLinks.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const edge of outgoing.get(nodeId) ?? []) {
      const target = edge.source === nodeId ? edge.target : edge.source;
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) ?? 0, indices.get(target) ?? 0));
      }
    }

    if (lowLinks.get(nodeId) === indices.get(nodeId)) {
      const members: ElementId[] = [];
      while (stack.length > 0) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        members.push(member);
        if (member === nodeId) break;
      }
      members.sort((a, b) => a.localeCompare(b));
      raw.push(members);
    }
  };

  for (const nodeId of [...nodeIds].sort((a, b) => a.localeCompare(b))) {
    if (!indices.has(nodeId)) visit(nodeId);
  }

  raw.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
  return raw.map((nodes, componentId) => {
    const memberSet = new Set(nodes);
    const selfLoop = nodes.some((nodeId) =>
      (outgoing.get(nodeId) ?? []).some((edge) => {
        const target = edge.source === nodeId ? edge.target : edge.source;
        return target === nodeId && memberSet.has(target);
      }),
    );
    return { id: componentId, nodes, cyclic: nodes.length > 1 || selfLoop };
  });
}

function weakComponents(
  nodeIds: readonly ElementId[],
  edges: readonly GraphEdgeRecord[],
): readonly (readonly ElementId[])[] {
  const neighbors = new Map<ElementId, ElementId[]>();
  for (const id of nodeIds) neighbors.set(id, []);
  for (const edge of edges) {
    neighbors.get(edge.source)?.push(edge.target);
    neighbors.get(edge.target)?.push(edge.source);
  }
  const seen = new Set<ElementId>();
  const components: ElementId[][] = [];
  for (const start of [...nodeIds].sort((a, b) => a.localeCompare(b))) {
    if (seen.has(start)) continue;
    const members: ElementId[] = [];
    const queue = [start];
    seen.add(start);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (current === undefined) continue;
      members.push(current);
      for (const neighbor of neighbors.get(current) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    members.sort((a, b) => a.localeCompare(b));
    components.push(members);
  }
  return components;
}

function componentLayers(
  components: readonly Component[],
  edges: readonly GraphEdgeRecord[],
): ReadonlyMap<number, number> {
  const componentByNode = new Map<ElementId, number>();
  for (const component of components) {
    for (const nodeId of component.nodes) componentByNode.set(nodeId, component.id);
  }
  const outgoing = new Map<number, Set<number>>();
  const indegree = new Map<number, number>();
  const layer = new Map<number, number>();
  for (const component of components) {
    outgoing.set(component.id, new Set());
    indegree.set(component.id, 0);
    layer.set(component.id, 0);
  }
  for (const edge of edges) {
    if (!edge.directed) continue;
    const source = componentByNode.get(edge.source);
    const target = componentByNode.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    if (!outgoing.get(source)?.has(target)) {
      outgoing.get(source)?.add(target);
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  const ready = components
    .filter((component) => (indegree.get(component.id) ?? 0) === 0)
    .map((component) => component.id)
    .sort((a, b) => a - b);
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const current = ready[cursor];
    if (current === undefined) continue;
    for (const target of [...(outgoing.get(current) ?? [])].sort((a, b) => a - b)) {
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(current) ?? 0) + 1));
      const nextIndegree = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) ready.push(target);
    }
  }
  return layer;
}

function weightedLane(targets: readonly LaneTarget[], fallback: Vec3): readonly [number, number] {
  let total = 0;
  let x = 0;
  let z = 0;
  for (const target of targets) {
    if (target.weight <= 0) continue;
    total += target.weight;
    x += target.x * target.weight;
    z += target.z * target.weight;
  }
  return total > 0 ? [x / total, z / total] : [fallback[0], fallback[2]];
}

function boundsFor(positions: Readonly<Record<ElementId, Vec3>>): LayoutBounds {
  const values = Object.values(positions);
  if (values.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of values) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export class LayoutEngine {
  layout(input: LayoutInput): LayoutResult {
    const spacing = resolveSpacing(input.constraints);
    const weights = resolveWeights(input.constraints);
    const graph = buildAdjacency(input.dataset);
    const nodeIds = input.dataset.nodes.map((node) => node.id);
    const components = stronglyConnectedComponents(nodeIds, graph.outgoing);
    const layers = componentLayers(components, graph.validEdges);
    const componentByNode = new Map<ElementId, Component>();
    for (const component of components) {
      for (const nodeId of component.nodes) componentByNode.set(nodeId, component);
    }
    const diagnostics: LayoutDiagnostic[] = [...graph.diagnostics];
    for (const component of components) {
      if (!component.cyclic) continue;
      const memberSet = new Set(component.nodes);
      const edgeIds = graph.validEdges
        .filter((edge) => memberSet.has(edge.source) && memberSet.has(edge.target))
        .map((edge) => edge.id)
        .sort((a, b) => a.localeCompare(b));
      diagnostics.push({
        kind: "cycle",
        message:
          "A dependency cycle was condensed into one layout layer; strict Y ordering is impossible inside the cycle.",
        nodeIds: component.nodes,
        edgeIds,
      });
    }
    const disconnected = weakComponents(nodeIds, graph.validEdges);
    if (disconnected.length > 1) {
      diagnostics.push({
        kind: "disconnected",
        message: `Dataset contains ${disconnected.length} disconnected components.`,
        nodeIds: disconnected.flat(),
      });
    }

    const previous = input.previous?.nodePositions ?? {};
    const positions: Record<ElementId, Vec3> = {};
    const sortedNodes = [...input.dataset.nodes].sort((a, b) => {
      const aComponent = componentByNode.get(a.id);
      const bComponent = componentByNode.get(b.id);
      const aLayer = aComponent === undefined ? 0 : (layers.get(aComponent.id) ?? 0);
      const bLayer = bComponent === undefined ? 0 : (layers.get(bComponent.id) ?? 0);
      return aLayer - bLayer || a.id.localeCompare(b.id);
    });
    const temporalValues = sortedNodes
      .map((node) => input.constraints?.temporalHints?.[node.id])
      .filter((value): value is number => value !== undefined && Number.isFinite(value));
    const temporalMin = temporalValues.length > 0 ? Math.min(...temporalValues) : 0;
    const temporalMax = temporalValues.length > 0 ? Math.max(...temporalValues) : 0;
    const temporalSpan = Math.max(1, temporalMax - temporalMin);

    for (const node of sortedNodes) {
      const component = componentByNode.get(node.id);
      const layer = component === undefined ? 0 : (layers.get(component.id) ?? 0);
      const ownLane = lanePoint(node.id, input.seed, spacing);
      const targets: LaneTarget[] = [{ x: ownLane[0], z: ownLane[2], weight: 1 }];
      const laneKey = input.constraints?.laneAffinity?.[node.id];
      if (laneKey !== undefined) {
        const lane = lanePoint(`lane:${laneKey}`, input.seed, spacing);
        targets.push({ x: lane[0], z: lane[2], weight: weights.laneAffinity });
      }
      if (node.group !== undefined) {
        const lane = lanePoint(`group:${node.group}`, input.seed, spacing);
        targets.push({ x: lane[0], z: lane[2], weight: weights.groupAffinity });
      }
      const preferredParent = input.constraints?.preferredParents?.[node.id];
      if (preferredParent !== undefined) {
        const parentPosition = positions[preferredParent] ?? previous[preferredParent];
        if (parentPosition !== undefined) {
          targets.push({
            x: parentPosition[0],
            z: parentPosition[2],
            weight: weights.preferredParentContinuity,
          });
        }
      }
      const oldPosition = previous[node.id];
      if (oldPosition !== undefined) {
        targets.push({
          x: oldPosition[0],
          z: oldPosition[2],
          weight: weights.previousPositionStability,
        });
      }
      const [x, z] = weightedLane(targets, ownLane);
      const temporalHint = input.constraints?.temporalHints?.[node.id];
      const temporalNormalized =
        temporalHint === undefined ? 0 : (temporalHint - temporalMin) / temporalSpan - 0.5;
      // Temporal hints may refine a topological layer by at most 40% of layer spacing.
      const temporalOffset =
        clamp(temporalNormalized * weights.temporalHints, -0.4, 0.4) * spacing.y;
      const y = layer * spacing.y + temporalOffset;
      const pinned = input.constraints?.pinnedNodes?.[node.id];
      positions[node.id] = pinned ?? [x, y, z];
    }

    for (const edge of graph.validEdges) {
      if (!edge.directed) continue;
      const sourceComponent = componentByNode.get(edge.source);
      const targetComponent = componentByNode.get(edge.target);
      if (sourceComponent?.id === targetComponent?.id) continue;
      const source = positions[edge.source];
      const target = positions[edge.target];
      if (source === undefined || target === undefined || target[1] > source[1]) continue;
      const pinnedSource = input.constraints?.pinnedNodes?.[edge.source] !== undefined;
      const pinnedTarget = input.constraints?.pinnedNodes?.[edge.target] !== undefined;
      if (pinnedSource || pinnedTarget) {
        diagnostics.push({
          kind: "pinned-order-conflict",
          message: `Pinned coordinates prevent dependency edge ${edge.id} from increasing on Y.`,
          nodeIds: [edge.source, edge.target],
          edgeIds: [edge.id],
        });
      } else {
        // Defensive correction against extreme weighting/rounding; topological layers remain authoritative.
        positions[edge.target] = [
          target[0],
          source[1] + Math.max(0.001, spacing.y * 0.2),
          target[2],
        ];
      }
    }

    const clusters: LayoutCluster[] = components.map((component) => ({
      id: `component:${component.id}`,
      memberIds: component.nodes,
      layer: layers.get(component.id) ?? 0,
    }));
    return Object.freeze({
      nodePositions: Object.freeze(positions),
      clusters: Object.freeze(clusters),
      bounds: boundsFor(positions),
      diagnostics: Object.freeze(diagnostics),
    });
  }
}
