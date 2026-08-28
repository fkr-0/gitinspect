import type {
  ElementId,
  NodeVisualDescriptor,
  Vec3,
  VisualElementDescriptor,
} from "@gitinspect/contracts";
import type {
  MeshPrimitive,
  NodeRenderPlan,
  PlannedNodeBatch,
  PlannedNodeInstance,
  PlannedNodeLabel,
  SemanticRenderIdentity,
} from "./types";

const ORIGIN: Vec3 = [0, 0, 0];
const UNIT_SCALE: Vec3 = [1, 1, 1];
const DEFAULT_COLOR = "#c8d3df";
const DEFAULT_EMISSIVE = "#000000";
const MESH_PRIMITIVES = new Set<MeshPrimitive>([
  "box",
  "sphere",
  "plane",
  "cylinder",
  "octahedron",
  "torus",
]);

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function clampOpacity(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function identity(nodeId: ElementId, element: VisualElementDescriptor): SemanticRenderIdentity {
  return element.interactionKey === undefined
    ? { ownerId: nodeId, elementId: element.id }
    : { ownerId: nodeId, elementId: element.id, interactionKey: element.interactionKey };
}

function materialBatchKey(primitive: MeshPrimitive, opacity: number, emissive: string): string {
  return `${primitive}|o:${opacity.toFixed(4)}|e:${emissive.toLowerCase()}`;
}

export function planNodeRendering(
  descriptors: readonly NodeVisualDescriptor[],
  nodePositions: ReadonlyMap<ElementId, Vec3> = new Map(),
): NodeRenderPlan {
  const batchMap = new Map<
    string,
    {
      primitive: MeshPrimitive;
      opacity: number;
      emissive: string;
      instances: PlannedNodeInstance[];
    }
  >();
  const labels: PlannedNodeLabel[] = [];
  const ignored: SemanticRenderIdentity[] = [];

  for (const descriptor of descriptors) {
    const nodePosition = nodePositions.get(descriptor.nodeId) ?? ORIGIN;

    for (const element of descriptor.elements) {
      const semantic = identity(descriptor.nodeId, element);
      const position = add(nodePosition, element.position ?? ORIGIN);
      const metadata = element.metadata ?? {};

      if (element.primitive === "label") {
        labels.push({
          ...semantic,
          text: element.label ?? "",
          position,
          metadata,
        });
        continue;
      }

      if (!MESH_PRIMITIVES.has(element.primitive as MeshPrimitive)) {
        ignored.push(semantic);
        continue;
      }

      const primitive = element.primitive as MeshPrimitive;
      const opacity = clampOpacity(element.opacity);
      const emissive = element.emissive ?? DEFAULT_EMISSIVE;
      const key = materialBatchKey(primitive, opacity, emissive);
      let batch = batchMap.get(key);
      if (!batch) {
        batch = { primitive, opacity, emissive, instances: [] };
        batchMap.set(key, batch);
      }

      batch.instances.push({
        ...semantic,
        position,
        scale: element.scale ?? UNIT_SCALE,
        color: element.color ?? DEFAULT_COLOR,
        metadata,
      });
    }
  }

  const batches: PlannedNodeBatch[] = [...batchMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, batch]) => ({ key, ...batch }));

  return { batches, labels, ignored };
}
