import type { EdgeVisualDescriptor, ElementId, GraphEdgeRecord, Vec3 } from "@gitinspect/contracts";
import { defaultEdgeStyleRegistry, type EdgeStyleRegistry } from "../edges/EdgeStyleRegistry";
import type {
  EdgeRenderPlan,
  EdgeRouteMap,
  PlannedEdgeBatch,
  PlannedEdgeHead,
  PlannedEdgeHeadBatch,
  PlannedEdgeSegment,
  ResolvedEdgeStyle,
} from "./types";

const EPSILON = 1e-9;

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v: Vec3, scalar: number): Vec3 {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 {
  const magnitude = length(v);
  return magnitude <= EPSILON ? [0, 1, 0] : scale(v, 1 / magnitude);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function equal(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a[0] - b[0]) <= EPSILON &&
    Math.abs(a[1] - b[1]) <= EPSILON &&
    Math.abs(a[2] - b[2]) <= EPSILON
  );
}

function dedupeConsecutive(points: readonly Vec3[]): Vec3[] {
  const result: Vec3[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (result.length === 0 || !last || !equal(last, point)) {
      result.push(point);
    }
  }
  return result;
}

function routedPoints(source: Vec3, target: Vec3, route: readonly Vec3[] | undefined): Vec3[] {
  if (!route || route.length === 0) return [source, target];
  const interior = route.filter((point) => !equal(point, source) && !equal(point, target));
  return dedupeConsecutive([source, ...interior, target]);
}

function waveAxis(direction: Vec3): Vec3 {
  const worldUp: Vec3 = [0, 1, 0];
  let axis = cross(direction, worldUp);
  if (length(axis) <= EPSILON) axis = cross(direction, [1, 0, 0]);
  return normalize(axis);
}

function waveSegment(start: Vec3, end: Vec3, style: ResolvedEdgeStyle): Vec3[] {
  const delta = subtract(end, start);
  const distance = length(delta);
  if (distance <= EPSILON || style.waveAmplitude <= EPSILON) return [start, end];
  const axis = waveAxis(normalize(delta));
  const points: Vec3[] = [];
  const segments = style.waveSegments;

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const base = add(start, scale(delta, t));
    const envelope = Math.sin(Math.PI * t);
    const phase = Math.sin(t * style.waveFrequency * Math.PI * 2);
    points.push(add(base, scale(axis, style.waveAmplitude * envelope * phase)));
  }

  return points;
}

function pathPoints(
  source: Vec3,
  target: Vec3,
  route: readonly Vec3[] | undefined,
  style: ResolvedEdgeStyle,
): Vec3[] {
  if (style.pathForm === "straight") return [source, target];

  const routed = routedPoints(source, target, route);
  if (style.pathForm === "polyline") return routed;

  const result: Vec3[] = [];
  for (let index = 0; index < routed.length - 1; index += 1) {
    const start = routed[index];
    const end = routed[index + 1];
    if (!start || !end) continue;
    const segment = waveSegment(start, end, style);
    if (index > 0) segment.shift();
    result.push(...segment);
  }
  return result;
}

function styleBatchKey(style: ResolvedEdgeStyle): string {
  return [
    style.registryStyleId,
    style.color.toLowerCase(),
    style.width.toFixed(4),
    style.opacity.toFixed(4),
    style.pattern,
    style.animated ? `flow:${style.animationSpeed.toFixed(4)}` : "static",
    `dash:${style.dashSize.toFixed(4)}:${style.gapSize.toFixed(4)}`,
  ].join("|");
}

function headBatchKey(head: PlannedEdgeHead): string {
  return `${head.kind}|${head.color.toLowerCase()}|o:${head.opacity.toFixed(4)}`;
}

function semantic(edgeId: ElementId): {
  ownerId: ElementId;
  elementId: string;
  interactionKey: string;
} {
  return { ownerId: edgeId, elementId: edgeId, interactionKey: edgeId };
}

export function planEdgeRendering(
  edges: readonly GraphEdgeRecord[],
  descriptors: readonly EdgeVisualDescriptor[],
  nodePositions: ReadonlyMap<ElementId, Vec3>,
  registry: EdgeStyleRegistry = defaultEdgeStyleRegistry,
  routes?: EdgeRouteMap,
): EdgeRenderPlan {
  const descriptorsById = new Map(
    descriptors.map((descriptor) => [descriptor.edgeId, descriptor] as const),
  );
  const batchMap = new Map<string, { style: ResolvedEdgeStyle; segments: PlannedEdgeSegment[] }>();
  const headMap = new Map<string, { exemplar: PlannedEdgeHead; heads: PlannedEdgeHead[] }>();
  const diagnostics: EdgeRenderPlan["diagnostics"][number][] = [];

  for (const edge of edges) {
    const descriptor = descriptorsById.get(edge.id);
    if (!descriptor) {
      diagnostics.push({ edgeId: edge.id, reason: "missing-descriptor" });
      continue;
    }

    const source = nodePositions.get(edge.source);
    if (!source) {
      diagnostics.push({ edgeId: edge.id, reason: "missing-source-position" });
      continue;
    }
    const target = nodePositions.get(edge.target);
    if (!target) {
      diagnostics.push({ edgeId: edge.id, reason: "missing-target-position" });
      continue;
    }

    const style = registry.resolve(descriptor);
    const points = pathPoints(source, target, routes?.get(edge.id), style);
    if (points.length < 2) continue;
    const key = styleBatchKey(style);
    let batch = batchMap.get(key);
    if (!batch) {
      batch = { style, segments: [] };
      batchMap.set(key, batch);
    }

    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (!start || !end) continue;
      batch.segments.push({
        ...semantic(edge.id),
        edgeId: edge.id,
        segmentIndex: index,
        start,
        end,
      });
    }

    if (style.head !== "none") {
      const previous = points[points.length - 2];
      if (!previous) continue;
      const head: PlannedEdgeHead = {
        ...semantic(edge.id),
        edgeId: edge.id,
        kind: style.head,
        position: target,
        direction: normalize(subtract(target, previous)),
        color: style.color,
        opacity: style.opacity,
        scale: Math.max(0.12, style.width * 0.08) * style.headScale,
      };
      const headKey = headBatchKey(head);
      let group = headMap.get(headKey);
      if (!group) {
        group = { exemplar: head, heads: [] };
        headMap.set(headKey, group);
      }
      group.heads.push(head);
    }
  }

  const batches: PlannedEdgeBatch[] = [...batchMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, batch]) => ({ key, ...batch }));
  const headBatches: PlannedEdgeHeadBatch[] = [...headMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      kind: group.exemplar.kind,
      color: group.exemplar.color,
      opacity: group.exemplar.opacity,
      heads: group.heads,
    }));

  return { batches, headBatches, diagnostics };
}
