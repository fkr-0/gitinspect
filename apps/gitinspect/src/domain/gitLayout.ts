import {
  LayoutEngine,
  type ElementId,
  type GraphDataset,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type LayoutConstraints,
  type LayoutResult,
  type Vec3,
} from "@gitinspect/graph-elements";

const HISTORY_EDGE_KINDS = new Set(["history", "merge-parent"]);
const ORBIT_NODE_KINDS = new Set([
  "local-branch",
  "remote-branch",
  "tag",
  "stash",
]);

function propertyString(node: GraphNodeRecord, key: string): string | undefined {
  const value = node.properties[key];
  return typeof value === "string" ? value : undefined;
}

function propertyNumber(node: GraphNodeRecord, key: string): number | undefined {
  const value = node.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stableHash(value: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function targetOf(
  dataset: GraphDataset,
  sourceId: ElementId,
  kinds: ReadonlySet<string>,
): ElementId | undefined {
  return dataset.edges.find(
    (edge) => edge.source === sourceId && kinds.has(edge.kind),
  )?.target;
}

function firstParentByChild(dataset: GraphDataset): ReadonlyMap<ElementId, ElementId> {
  const result = new Map<ElementId, ElementId>();
  for (const edge of dataset.edges) {
    if (!HISTORY_EDGE_KINDS.has(edge.kind)) continue;
    if (edge.properties.parentIndex === 0 || edge.properties.firstParent === true) {
      result.set(edge.target, edge.source);
    }
  }
  return result;
}

function assignCommitLanes(
  dataset: GraphDataset,
  preferredParents: ReadonlyMap<ElementId, ElementId>,
): Readonly<Record<ElementId, string>> {
  const lanes: Record<ElementId, string> = {};
  const refs = dataset.nodes
    .filter((node) => node.kind === "local-branch" || node.kind === "remote-branch")
    .sort((left, right) => {
      const rank = (node: GraphNodeRecord) => node.kind === "local-branch" ? 0 : 1;
      return rank(left) - rank(right) || left.id.localeCompare(right.id);
    });

  for (const ref of refs) {
    const target = targetOf(dataset, ref.id, new Set(["ref-target"]));
    if (!target) continue;
    const lane = propertyString(ref, "name") ?? ref.id;
    let cursor: ElementId | undefined = target;
    const visited = new Set<ElementId>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      lanes[cursor] ??= lane;
      cursor = preferredParents.get(cursor);
    }
  }

  return lanes;
}

export function gitLayoutConstraints(dataset: GraphDataset): LayoutConstraints {
  const temporalHints: Record<ElementId, number> = {};
  const preferredParentsMap = firstParentByChild(dataset);
  const preferredParents: Record<ElementId, ElementId> = Object.fromEntries(preferredParentsMap);
  const laneAffinity: Record<ElementId, string> = {
    ...assignCommitLanes(dataset, preferredParentsMap),
  };

  for (const node of dataset.nodes) {
    if (node.kind === "commit") {
      const committedAtMs = propertyNumber(node, "committedAtMs");
      if (committedAtMs !== undefined) temporalHints[node.id] = committedAtMs;
    }

    if (ORBIT_NODE_KINDS.has(node.kind)) {
      const target = targetOf(
        dataset,
        node.id,
        new Set(["ref-target", "tag-target", "stash-base"]),
      );
      laneAffinity[node.id] = target
        ? laneAffinity[target] ?? `orbit:${target}`
        : `orbit:${node.id}`;
    } else if (node.kind === "head") {
      const target = targetOf(dataset, node.id, new Set(["head-symbolic", "head-resolved"]));
      laneAffinity[node.id] = target ? `head:${target}` : "head";
    } else if (node.kind === "remote") {
      laneAffinity[node.id] = `remote-island:${node.id}`;
    }
  }

  return {
    spacing: { x: 3.5, y: 5.5, z: 3.5 },
    weights: {
      temporalHints: 0.08,
      preferredParentContinuity: 4,
      groupAffinity: 0.35,
      laneAffinity: 5,
      previousPositionStability: 2,
    },
    temporalHints,
    preferredParents,
    laneAffinity,
  };
}

function layoutTopologyDataset(dataset: GraphDataset): GraphDataset {
  const edges: GraphEdgeRecord[] = dataset.edges.map((edge) =>
    HISTORY_EDGE_KINDS.has(edge.kind)
      ? edge
      : { ...edge, directed: false },
  );
  return { ...dataset, edges };
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function orbitOffset(node: GraphNodeRecord, seed: number): Vec3 {
  const unit = stableHash(node.id, seed) / 0xffffffff;
  const angle = unit * Math.PI * 2;
  const radius = node.kind === "stash" ? 4.6 : node.kind === "tag" ? 3.8 : 5.4;
  const vertical = node.kind === "tag" ? 1.8 : node.kind === "stash" ? -1.2 : 0.9;
  return [Math.cos(angle) * radius, vertical, Math.sin(angle) * radius];
}

function boundsFor(positions: Readonly<Record<ElementId, Vec3>>): LayoutResult["bounds"] {
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

export function layoutGitDataset(
  dataset: GraphDataset,
  seed = 0x474954,
  previous?: LayoutResult,
): LayoutResult {
  const engine = new LayoutEngine();
  const base = engine.layout({
    dataset: layoutTopologyDataset(dataset),
    seed,
    constraints: gitLayoutConstraints(dataset),
    ...(previous ? { previous } : {}),
  });
  const positions: Record<ElementId, Vec3> = { ...base.nodePositions };

  for (const node of dataset.nodes) {
    if (!ORBIT_NODE_KINDS.has(node.kind)) continue;
    const target = targetOf(
      dataset,
      node.id,
      new Set(["ref-target", "tag-target", "stash-base"]),
    );
    const targetPosition = target ? positions[target] : undefined;
    if (targetPosition) positions[node.id] = add(targetPosition, orbitOffset(node, seed));
  }

  const head = dataset.nodes.find((node) => node.kind === "head");
  if (head) {
    const target = targetOf(dataset, head.id, new Set(["head-symbolic", "head-resolved"]));
    const targetPosition = target ? positions[target] : undefined;
    if (targetPosition) positions[head.id] = add(targetPosition, [0, 3.2, 0]);
  }

  const localBounds = boundsFor(positions);
  const remotes = dataset.nodes
    .filter((node) => node.kind === "remote")
    .sort((left, right) => left.id.localeCompare(right.id));
  const centerY = (localBounds.min[1] + localBounds.max[1]) / 2;
  remotes.forEach((remote, index) => {
    const zJitter = ((stableHash(remote.id, seed ^ 0x9e3779b9) % 9) - 4) * 3.5;
    positions[remote.id] = [localBounds.max[0] + 18 + index * 11, centerY, zJitter];
  });

  return {
    ...base,
    nodePositions: Object.freeze(positions),
    bounds: boundsFor(positions),
  };
}
