import type {
  EdgeRouteMap,
  ElementId,
  GraphDataset,
  GraphEdgeRecord,
  GraphNodeRecord,
  LayoutConstraints,
  LayoutDiagnostic,
  LayoutResult,
  Vec3,
} from "@gitinspect/graph-elements";

const HISTORY_EDGE_KINDS = new Set(["history", "merge-parent"]);
const HISTORY_NODE_KINDS = new Set(["commit", "commit-boundary"]);
const TARGET_EDGE_KINDS = new Set(["ref-target", "tag-target", "stash-base"]);
const REF_NODE_KINDS = new Set(["local-branch", "remote-branch", "tag", "stash"]);

// Git Railfield coordinate grammar:
//   X = topological chronology, oldest -> newest
//   Y = stable branch lane, current HEAD first-parent spine = lane 0
//   Z = semantic depth, history plane = 0, local signals forward, remote signals behind
export const GIT_RAILFIELD_GEOMETRY = Object.freeze({
  commitSpacing: 3.4,
  branchLaneSpacing: 2.8,
  localSignalDepth: 0.65,
  remoteSignalDepth: -0.65,
  tagSignalDepth: 1,
  stashSignalDepth: 0.85,
  remotePlatformDepth: -1.55,
});
const COMMIT_SPACING = GIT_RAILFIELD_GEOMETRY.commitSpacing;
const BRANCH_LANE_SPACING = GIT_RAILFIELD_GEOMETRY.branchLaneSpacing;
const LOCAL_SIGNAL_DEPTH = GIT_RAILFIELD_GEOMETRY.localSignalDepth;
const REMOTE_SIGNAL_DEPTH = GIT_RAILFIELD_GEOMETRY.remoteSignalDepth;
const TAG_SIGNAL_DEPTH = GIT_RAILFIELD_GEOMETRY.tagSignalDepth;
const STASH_SIGNAL_DEPTH = GIT_RAILFIELD_GEOMETRY.stashSignalDepth;
const REMOTE_PLATFORM_DEPTH = GIT_RAILFIELD_GEOMETRY.remotePlatformDepth;
const POSITION_EPSILON = 1e-6;

export interface GitRailTopology {
  readonly generations: ReadonlyMap<ElementId, number>;
  readonly firstParentByChild: ReadonlyMap<ElementId, ElementId>;
  readonly childrenByParent: ReadonlyMap<ElementId, readonly ElementId[]>;
  readonly laneByCommit: ReadonlyMap<ElementId, number>;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

function propertyString(node: GraphNodeRecord, key: string): string | undefined {
  const value = node.properties[key];
  return typeof value === "string" ? value : undefined;
}

function propertyNumber(node: GraphNodeRecord, key: string): number | undefined {
  const value = node.properties[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isHistoryNode(node: GraphNodeRecord): boolean {
  return HISTORY_NODE_KINDS.has(node.kind);
}

function targetOf(
  dataset: GraphDataset,
  sourceId: ElementId,
  kinds: ReadonlySet<string>,
): ElementId | undefined {
  return dataset.edges.find((edge) => edge.source === sourceId && kinds.has(edge.kind))?.target;
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

function historyAdjacency(dataset: GraphDataset): {
  readonly ids: readonly ElementId[];
  readonly childrenByParent: ReadonlyMap<ElementId, readonly ElementId[]>;
  readonly indegree: ReadonlyMap<ElementId, number>;
} {
  const ids = dataset.nodes
    .filter(isHistoryNode)
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
  const idSet = new Set(ids);
  const indegree = new Map<ElementId, number>(ids.map((id) => [id, 0]));
  const mutableChildren = new Map<ElementId, ElementId[]>(ids.map((id) => [id, []]));

  for (const edge of dataset.edges) {
    if (
      !HISTORY_EDGE_KINDS.has(edge.kind) ||
      !idSet.has(edge.source) ||
      !idSet.has(edge.target)
    ) {
      continue;
    }
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    mutableChildren.get(edge.source)?.push(edge.target);
  }
  for (const children of mutableChildren.values()) {
    children.sort((left, right) => left.localeCompare(right));
  }
  return { ids, childrenByParent: mutableChildren, indegree };
}

function commitGenerations(dataset: GraphDataset): {
  readonly generations: ReadonlyMap<ElementId, number>;
  readonly childrenByParent: ReadonlyMap<ElementId, readonly ElementId[]>;
  readonly diagnostics: readonly LayoutDiagnostic[];
} {
  const graph = historyAdjacency(dataset);
  const indegree = new Map(graph.indegree);
  const generations = new Map<ElementId, number>(graph.ids.map((id) => [id, 0]));
  const ready = graph.ids.filter((id) => (indegree.get(id) ?? 0) === 0);

  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const current = ready[cursor];
    if (!current) continue;
    const generation = generations.get(current) ?? 0;
    for (const child of graph.childrenByParent.get(current) ?? []) {
      generations.set(child, Math.max(generations.get(child) ?? 0, generation + 1));
      const nextIndegree = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, nextIndegree);
      if (nextIndegree === 0) ready.push(child);
    }
  }

  const cyclicIds = graph.ids.filter((id) => (indegree.get(id) ?? 0) > 0);
  const diagnostics: LayoutDiagnostic[] = [];
  if (cyclicIds.length > 0) {
    // Git history should be acyclic. Keep malformed/synthetic inputs finite and deterministic,
    // but make the violated invariant explicit instead of inventing a force-layout escape hatch.
    const maxGeneration = Math.max(0, ...generations.values());
    cyclicIds.forEach((id, index) => {
      generations.set(id, maxGeneration + index + 1);
    });
    diagnostics.push({
      kind: "cycle",
      message:
        "Git Railfield received cyclic history; cyclic nodes were placed on deterministic fallback chronology layers.",
      nodeIds: Object.freeze([...cyclicIds]),
    });
  }

  return {
    generations,
    childrenByParent: graph.childrenByParent,
    diagnostics: Object.freeze(diagnostics),
  };
}

function resolvedHeadCommit(dataset: GraphDataset): ElementId | undefined {
  const direct = dataset.nodes.find(
    (node) => node.kind === "commit" && node.properties.isHead === true,
  )?.id;
  if (direct) return direct;

  const head = dataset.nodes.find((node) => node.kind === "head");
  if (!head) return undefined;
  const headEdge = dataset.edges.find(
    (edge) =>
      edge.source === head.id && (edge.kind === "head-symbolic" || edge.kind === "head-resolved"),
  );
  if (!headEdge) return undefined;
  const target = dataset.nodes.find((node) => node.id === headEdge.target);
  if (target && isHistoryNode(target)) return target.id;
  if (!target || !REF_NODE_KINDS.has(target.kind)) return undefined;
  return targetOf(dataset, target.id, TARGET_EDGE_KINDS);
}

function headSpine(
  dataset: GraphDataset,
  preferredParents: ReadonlyMap<ElementId, ElementId>,
): ReadonlySet<ElementId> {
  const result = new Set<ElementId>();
  let cursor = resolvedHeadCommit(dataset);
  while (cursor && !result.has(cursor)) {
    result.add(cursor);
    cursor = preferredParents.get(cursor);
  }
  return result;
}

function alternatingLane(index: number): number {
  const magnitude = Math.ceil(index / 2);
  return index % 2 === 1 ? magnitude : -magnitude;
}

function refRank(node: GraphNodeRecord): number {
  if (node.kind === "local-branch") return 0;
  if (node.kind === "remote-branch") return 1;
  return 2;
}

function assignCommitLanes(
  dataset: GraphDataset,
  generations: ReadonlyMap<ElementId, number>,
  preferredParents: ReadonlyMap<ElementId, ElementId>,
  childrenByParent: ReadonlyMap<ElementId, readonly ElementId[]>,
): ReadonlyMap<ElementId, number> {
  const laneByCommit = new Map<ElementId, number>();
  const spine = headSpine(dataset, preferredParents);
  for (const id of spine) laneByCommit.set(id, 0);

  let nextLaneIndex = 1;
  const assignChain = (start: ElementId): void => {
    if (laneByCommit.has(start)) return;
    const lane = alternatingLane(nextLaneIndex);
    nextLaneIndex += 1;
    let cursor: ElementId | undefined = start;
    const visited = new Set<ElementId>();
    while (cursor && !visited.has(cursor) && !laneByCommit.has(cursor)) {
      visited.add(cursor);
      laneByCommit.set(cursor, lane);
      cursor = preferredParents.get(cursor);
    }
  };

  // Visible branch ownership is the strongest non-HEAD lane cue. The ref only chooses which
  // topological chain gets the next compact lane; object identity never creates coordinates.
  const branchTargets = dataset.nodes
    .filter((node) => node.kind === "local-branch" || node.kind === "remote-branch")
    .sort(
      (left, right) =>
        refRank(left) - refRank(right) ||
        (propertyString(left, "name") ?? left.id).localeCompare(
          propertyString(right, "name") ?? right.id,
        ),
    )
    .flatMap((ref) => {
      const target = targetOf(dataset, ref.id, new Set(["ref-target"]));
      return target ? [target] : [];
    });
  for (const target of branchTargets) assignChain(target);

  // Merged/deleted branches may no longer own a ref. Start from their newest unassigned tip
  // and walk first-parent ancestry until an already-owned junction is reached.
  const residual = [...generations.keys()].sort(
    (left, right) =>
      (generations.get(right) ?? 0) - (generations.get(left) ?? 0) || left.localeCompare(right),
  );
  for (const id of residual) {
    if (laneByCommit.has(id)) continue;
    const hasUnassignedChild = (childrenByParent.get(id) ?? []).some(
      (child) => !laneByCommit.has(child),
    );
    if (!hasUnassignedChild) assignChain(id);
  }
  for (const id of residual) assignChain(id);

  return laneByCommit;
}

export function gitRailTopology(dataset: GraphDataset): GitRailTopology {
  const generationModel = commitGenerations(dataset);
  const preferredParents = firstParentByChild(dataset);
  return {
    generations: generationModel.generations,
    firstParentByChild: preferredParents,
    childrenByParent: generationModel.childrenByParent,
    laneByCommit: assignCommitLanes(
      dataset,
      generationModel.generations,
      preferredParents,
      generationModel.childrenByParent,
    ),
    diagnostics: generationModel.diagnostics,
  };
}

export function gitLayoutConstraints(dataset: GraphDataset): LayoutConstraints {
  const topology = gitRailTopology(dataset);
  const temporalHints: Record<ElementId, number> = {};
  const preferredParents: Record<ElementId, ElementId> = Object.fromEntries(
    topology.firstParentByChild,
  );
  const laneAffinity: Record<ElementId, string> = {};

  for (const node of dataset.nodes) {
    const committedAtMs = propertyNumber(node, "committedAtMs");
    if (node.kind === "commit" && committedAtMs !== undefined) {
      temporalHints[node.id] = committedAtMs;
    }
    const lane = topology.laneByCommit.get(node.id);
    if (lane !== undefined) laneAffinity[node.id] = `git-rail:${lane}`;
  }

  return {
    spacing: { x: COMMIT_SPACING, y: BRANCH_LANE_SPACING, z: 1 },
    weights: {
      temporalHints: 0.08,
      preferredParentContinuity: 4,
      groupAffinity: 0.35,
      laneAffinity: 5,
      previousPositionStability: 0,
    },
    temporalHints,
    preferredParents,
    laneAffinity,
  };
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

function attachmentOffset(kind: string, ordinal: number): Vec3 {
  switch (kind) {
    case "local-branch":
      return [0, 1.35 + ordinal * 0.54, LOCAL_SIGNAL_DEPTH];
    case "remote-branch":
      return [0, -1.3 - ordinal * 0.5, REMOTE_SIGNAL_DEPTH];
    case "tag":
      return [0, 1.1 + ordinal * 0.48, TAG_SIGNAL_DEPTH];
    case "stash":
      return [0, -1.15 - ordinal * 0.48, STASH_SIGNAL_DEPTH];
    default:
      return [0, 0, 0];
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function average(points: readonly Vec3[]): Vec3 | undefined {
  if (points.length === 0) return undefined;
  const sum = points.reduce<Vec3>(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]],
    [0, 0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

function attachmentRank(node: GraphNodeRecord): number {
  switch (node.kind) {
    case "local-branch":
      return 0;
    case "tag":
      return 1;
    case "remote-branch":
      return 2;
    case "stash":
      return 3;
    default:
      return 4;
  }
}

export function layoutGitDataset(
  dataset: GraphDataset,
  _seed = 0x474954,
  _previous?: LayoutResult,
): LayoutResult {
  const topology = gitRailTopology(dataset);
  const positions: Record<ElementId, Vec3> = {};
  const generationValues = [...topology.generations.values()];
  const minGeneration = generationValues.length > 0 ? Math.min(...generationValues) : 0;
  const maxGeneration = generationValues.length > 0 ? Math.max(...generationValues) : 0;
  const generationCenter = (minGeneration + maxGeneration) / 2;

  for (const node of dataset.nodes) {
    const generation = topology.generations.get(node.id);
    const lane = topology.laneByCommit.get(node.id);
    if (generation === undefined || lane === undefined) continue;
    positions[node.id] = [
      (generation - generationCenter) * COMMIT_SPACING,
      lane * BRANCH_LANE_SPACING,
      0,
    ];
  }

  const attachmentsByTarget = new Map<ElementId, GraphNodeRecord[]>();
  for (const node of dataset.nodes) {
    if (!REF_NODE_KINDS.has(node.kind)) continue;
    const target = targetOf(dataset, node.id, TARGET_EDGE_KINDS);
    if (!target) continue;
    const attachments = attachmentsByTarget.get(target) ?? [];
    attachments.push(node);
    attachmentsByTarget.set(target, attachments);
  }
  for (const [targetId, attachments] of attachmentsByTarget) {
    const targetPosition = positions[targetId];
    if (!targetPosition) continue;
    attachments.sort(
      (left, right) =>
        attachmentRank(left) - attachmentRank(right) || left.id.localeCompare(right.id),
    );
    const ordinalByKind = new Map<string, number>();
    for (const attachment of attachments) {
      const ordinal = ordinalByKind.get(attachment.kind) ?? 0;
      ordinalByKind.set(attachment.kind, ordinal + 1);
      positions[attachment.id] = add(targetPosition, attachmentOffset(attachment.kind, ordinal));
    }
  }

  const head = dataset.nodes.find((node) => node.kind === "head");
  if (head) {
    const target = targetOf(dataset, head.id, new Set(["head-symbolic", "head-resolved"]));
    const targetPosition = target ? positions[target] : undefined;
    const resolvedCommit = resolvedHeadCommit(dataset);
    const fallback = resolvedCommit ? positions[resolvedCommit] : undefined;
    const anchor = targetPosition ?? fallback;
    if (anchor) positions[head.id] = add(anchor, [0, 1.05, 0.24]);
  }

  const remotes = dataset.nodes
    .filter((node) => node.kind === "remote")
    .sort((left, right) => left.id.localeCompare(right.id));
  remotes.forEach((remote, index) => {
    const membershipTargets = dataset.edges
      .filter((edge) => edge.source === remote.id && edge.kind === "remote-membership")
      .map((edge) => positions[edge.target])
      .filter((position): position is Vec3 => position !== undefined);
    const anchor = average(membershipTargets) ?? [generationCenter * COMMIT_SPACING, 0, 0];
    positions[remote.id] = [
      anchor[0] + index * 0.9,
      anchor[1] - 1.15,
      REMOTE_PLATFORM_DEPTH,
    ];
  });

  // Unresolved objects are exceptional topology boundaries, not free-space decoration.
  const unresolved = dataset.nodes
    .filter((node) => positions[node.id] === undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  unresolved.forEach((node, index) => {
    positions[node.id] = [
      (maxGeneration - generationCenter + 0.8) * COMMIT_SPACING,
      (index - (unresolved.length - 1) / 2) * 1.1,
      -0.35,
    ];
  });

  const laneMembers = new Map<number, ElementId[]>();
  for (const [id, lane] of topology.laneByCommit) {
    const members = laneMembers.get(lane) ?? [];
    members.push(id);
    laneMembers.set(lane, members);
  }
  const clusters = [...laneMembers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([lane, memberIds]) => ({
      id: `git-rail:${lane}`,
      memberIds: Object.freeze(
        [...memberIds].sort(
          (left, right) =>
            (topology.generations.get(left) ?? 0) - (topology.generations.get(right) ?? 0) ||
            left.localeCompare(right),
        ),
      ),
      layer: lane,
    }));

  return Object.freeze({
    nodePositions: Object.freeze(positions),
    bounds: boundsFor(positions),
    clusters: Object.freeze(clusters),
    diagnostics: topology.diagnostics,
  });
}

function sameLane(source: Vec3, target: Vec3): boolean {
  return Math.abs(source[1] - target[1]) <= POSITION_EPSILON;
}

function ancestryRoute(source: Vec3, target: Vec3): readonly Vec3[] {
  if (sameLane(source, target)) return [];
  const deltaX = target[0] - source[0];
  const departureX = source[0] + deltaX * 0.32;
  const arrivalX = target[0] - deltaX * 0.32;
  return Object.freeze([
    [departureX, source[1], 0] as Vec3,
    [arrivalX, target[1], 0] as Vec3,
  ]);
}

/**
 * Route Git ancestry as rails: straight within a lane, controlled peel/convergence between lanes.
 * Ref/HEAD relations are intentionally short direct tethers because their nodes are attached signals.
 */
export function gitEdgeRoutes(
  dataset: GraphDataset,
  nodePositions: ReadonlyMap<ElementId, Vec3>,
): EdgeRouteMap {
  const routes = new Map<ElementId, readonly Vec3[]>();
  for (const edge of dataset.edges) {
    if (!HISTORY_EDGE_KINDS.has(edge.kind)) continue;
    const source = nodePositions.get(edge.source);
    const target = nodePositions.get(edge.target);
    if (!source || !target) continue;
    const route = ancestryRoute(source, target);
    if (route.length > 0) routes.set(edge.id, route);
  }
  return routes;
}

export function gitHistoryEdges(dataset: GraphDataset): readonly GraphEdgeRecord[] {
  return dataset.edges.filter((edge) => HISTORY_EDGE_KINDS.has(edge.kind));
}
