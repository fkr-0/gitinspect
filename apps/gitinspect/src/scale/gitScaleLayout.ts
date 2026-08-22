import type {
  ElementId,
  GraphDataset,
  GraphEdgeRecord,
  GraphNodeRecord,
  LayoutDiagnostic,
  LayoutResult,
  Vec3,
} from "@gitinspect/graph-elements";

import { layoutGitDataset } from "../domain/gitLayout";

const HISTORY_EDGE_KINDS = new Set(["history", "merge-parent"]);
const TARGET_EDGE_KINDS = new Set(["ref-target", "tag-target", "stash-base"]);

export type GitScaleLayoutMode = "direct" | "macro";

export interface GitScaleLayoutOptions {
  readonly seed?: number;
  readonly directNodeLimit?: number;
  readonly macroGenerationWindow?: number;
  readonly previous?: LayoutResult;
}

export interface GitScaleLayoutResult {
  readonly layout: LayoutResult;
  readonly mode: GitScaleLayoutMode;
  readonly topologyKey: string;
  readonly logicalNodeCount: number;
  readonly layoutNodeCount: number;
}

interface MacroBucket {
  readonly id: string;
  readonly index: number;
  readonly members: ElementId[];
  committedAtMs: number;
}

interface CollapsedEdge {
  readonly source: ElementId;
  readonly target: ElementId;
  readonly kind: string;
  readonly directed: boolean;
  memberEdgeCount: number;
  firstParent: boolean;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.floor(value));
}

function hashStep(hash: number, value: string): number {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 0x01000193) >>> 0;
  }
  return next >>> 0;
}

function stableHash(value: string, seed: number): number {
  return hashStep((0x811c9dc5 ^ seed) >>> 0, value);
}

export function gitScaleTopologyKey(dataset: GraphDataset): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const node of dataset.nodes) {
    const relevant = [
      node.id,
      node.kind,
      node.group ?? "",
      String(finiteNumber(node.properties.committedAtMs) ?? ""),
    ].join("\u0001");
    first = hashStep(first, relevant);
    second = hashStep(second, `${relevant}\u0002${node.weight ?? ""}`);
  }
  for (const edge of dataset.edges) {
    const relevant = [
      edge.id,
      edge.source,
      edge.target,
      edge.kind,
      edge.directed ? "1" : "0",
      edge.properties.firstParent === true || edge.properties.parentIndex === 0 ? "1" : "0",
    ].join("\u0001");
    first = hashStep(first, relevant);
    second = hashStep(second ^ 0x85ebca6b, relevant);
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function commitGenerations(dataset: GraphDataset): ReadonlyMap<ElementId, number> {
  const commits = new Set(
    dataset.nodes.filter((node) => node.kind === "commit").map((node) => node.id),
  );
  const indegree = new Map<ElementId, number>();
  const children = new Map<ElementId, ElementId[]>();
  const generation = new Map<ElementId, number>();
  for (const id of commits) {
    indegree.set(id, 0);
    children.set(id, []);
    generation.set(id, 0);
  }
  for (const edge of dataset.edges) {
    if (!HISTORY_EDGE_KINDS.has(edge.kind) || !commits.has(edge.source) || !commits.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    children.get(edge.source)?.push(edge.target);
  }
  for (const values of children.values()) values.sort((left, right) => left.localeCompare(right));

  const queue = [...commits]
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort((left, right) => left.localeCompare(right));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (!current) continue;
    const currentGeneration = generation.get(current) ?? 0;
    for (const child of children.get(current) ?? []) {
      generation.set(child, Math.max(generation.get(child) ?? 0, currentGeneration + 1));
      const nextIndegree = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, nextIndegree);
      if (nextIndegree === 0) queue.push(child);
    }
  }

  // Git commit history is acyclic. This fallback keeps malformed/synthetic cycles deterministic
  // without recursing or blocking the large-history path.
  let maxGeneration = 0;
  for (const value of generation.values()) maxGeneration = Math.max(maxGeneration, value);
  let fallbackGeneration = maxGeneration + 1;
  for (const id of [...commits].sort((left, right) => left.localeCompare(right))) {
    if ((indegree.get(id) ?? 0) > 0) {
      generation.set(id, fallbackGeneration);
      fallbackGeneration += 1;
    }
  }
  return generation;
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

function buildMacroLayout(
  dataset: GraphDataset,
  topologyKey: string,
  generationWindow: number,
  seed: number,
): GitScaleLayoutResult {
  const generations = commitGenerations(dataset);
  const buckets = new Map<number, MacroBucket>();
  const bucketByCommit = new Map<ElementId, ElementId>();

  for (const node of dataset.nodes) {
    if (node.kind !== "commit") continue;
    const generation = generations.get(node.id) ?? 0;
    const index = Math.floor(generation / generationWindow);
    let bucket = buckets.get(index);
    if (!bucket) {
      bucket = {
        id: `scale-layout:commit-bucket:${index}`,
        index,
        members: [],
        committedAtMs: 0,
      };
      buckets.set(index, bucket);
    }
    bucket.members.push(node.id);
    bucket.committedAtMs = Math.max(
      bucket.committedAtMs,
      finiteNumber(node.properties.committedAtMs) ?? 0,
    );
    bucketByCommit.set(node.id, bucket.id);
  }

  const macroNodes: GraphNodeRecord[] = [...buckets.values()]
    .sort((left, right) => left.index - right.index)
    .map((bucket) => {
      bucket.members.sort((left, right) => left.localeCompare(right));
      return {
        id: bucket.id,
        kind: "commit",
        label: `${bucket.members.length} commits`,
        group: "macro-history",
        weight: bucket.members.length,
        properties: {
          committedAtMs: bucket.committedAtMs,
          macroGeneration: bucket.index,
          memberCount: bucket.members.length,
        },
      };
    });
  for (const node of dataset.nodes) {
    if (node.kind !== "commit") macroNodes.push(node);
  }

  const endpoint = (id: ElementId): ElementId => bucketByCommit.get(id) ?? id;
  const collapsed = new Map<string, CollapsedEdge>();
  for (const edge of dataset.edges) {
    const source = endpoint(edge.source);
    const target = endpoint(edge.target);
    if (source === target) continue;
    const key = `${edge.kind}\u0000${source}\u0000${target}\u0000${edge.directed ? "1" : "0"}`;
    let aggregate = collapsed.get(key);
    if (!aggregate) {
      aggregate = {
        source,
        target,
        kind: edge.kind,
        directed: edge.directed,
        memberEdgeCount: 0,
        firstParent: false,
      };
      collapsed.set(key, aggregate);
    }
    aggregate.memberEdgeCount += 1;
    aggregate.firstParent ||= edge.properties.firstParent === true || edge.properties.parentIndex === 0;
  }

  const macroEdges: GraphEdgeRecord[] = [...collapsed.values()]
    .sort((left, right) => {
      const leftKey = `${left.kind}:${left.source}:${left.target}`;
      const rightKey = `${right.kind}:${right.source}:${right.target}`;
      return leftKey.localeCompare(rightKey);
    })
    .map((edge) => {
      return {
        id: `scale-layout-edge:${edge.kind}:${edge.source}:${edge.target}`,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        directed: edge.directed,
        properties: {
          memberEdgeCount: edge.memberEdgeCount,
          ...(edge.firstParent ? { firstParent: true, parentIndex: 0 } : {}),
        },
      };
    });
  const macroDataset: GraphDataset = {
    revision: `${dataset.revision}:macro:${topologyKey}`,
    nodes: macroNodes,
    edges: macroEdges,
  };
  const macroLayout = layoutGitDataset(macroDataset, seed);
  const positions: Record<ElementId, Vec3> = {};

  for (const bucket of [...buckets.values()].sort((left, right) => left.index - right.index)) {
    const macroPosition = macroLayout.nodePositions[bucket.id] ?? [0, 0, 0];
    for (const id of bucket.members) {
      const generation = generations.get(id) ?? 0;
      const xOffset = ((stableHash(id, seed) % 9) - 4) * 0.52;
      const zOffset = ((stableHash(id, seed ^ 0x9e3779b9) % 9) - 4) * 0.52;
      positions[id] = [
        macroPosition[0] + xOffset,
        generation * 1.5,
        macroPosition[2] + zOffset,
      ];
    }
  }
  for (const node of dataset.nodes) {
    if (node.kind === "commit") continue;
    positions[node.id] = macroLayout.nodePositions[node.id] ?? node.positionHint ?? [0, 0, 0];
  }

  const targetBySource = new Map<ElementId, ElementId>();
  for (const edge of dataset.edges) {
    if (TARGET_EDGE_KINDS.has(edge.kind) && !targetBySource.has(edge.source)) {
      targetBySource.set(edge.source, edge.target);
    }
  }
  for (const node of dataset.nodes) {
    if (node.kind !== "local-branch" && node.kind !== "remote-branch" && node.kind !== "tag" && node.kind !== "stash") {
      continue;
    }
    const target = targetBySource.get(node.id);
    const targetPosition = target ? positions[target] : undefined;
    const own = positions[node.id];
    if (!targetPosition || !own) continue;
    const yOffset = node.kind === "stash" ? -1.2 : node.kind === "tag" ? 1.8 : 1;
    positions[node.id] = [own[0], targetPosition[1] + yOffset, own[2]];
  }

  const head = dataset.nodes.find((node) => node.kind === "head");
  if (head) {
    const target = dataset.edges.find(
      (edge) => edge.source === head.id && (edge.kind === "head-symbolic" || edge.kind === "head-resolved"),
    )?.target;
    const targetPosition = target ? positions[target] : undefined;
    const own = positions[head.id];
    if (targetPosition && own) positions[head.id] = [own[0], targetPosition[1] + 3.2, own[2]];
  }

  for (const node of dataset.nodes) {
    if (node.kind !== "commit-boundary") continue;
    const target = dataset.edges.find(
      (edge) => edge.source === node.id && HISTORY_EDGE_KINDS.has(edge.kind),
    )?.target;
    const targetPosition = target ? positions[target] : undefined;
    const own = positions[node.id];
    if (targetPosition && own) positions[node.id] = [own[0], targetPosition[1] - 1.5, own[2]];
  }

  const clusters = [...buckets.values()]
    .sort((left, right) => left.index - right.index)
    .map((bucket) => ({
      id: bucket.id,
      memberIds: Object.freeze([...bucket.members]),
      layer: bucket.index,
    }));
  const diagnostics: readonly LayoutDiagnostic[] = macroLayout.diagnostics;
  return {
    layout: Object.freeze({
      nodePositions: Object.freeze(positions),
      clusters: Object.freeze(clusters),
      bounds: boundsFor(positions),
      diagnostics,
    }),
    mode: "macro",
    topologyKey,
    logicalNodeCount: dataset.nodes.length,
    layoutNodeCount: macroDataset.nodes.length,
  };
}

export function layoutGitDatasetForScale(
  dataset: GraphDataset,
  options: GitScaleLayoutOptions = {},
): GitScaleLayoutResult {
  const seed = options.seed ?? 0x474954;
  const directNodeLimit = positiveInteger(options.directNodeLimit, 2_048, 128);
  const generationWindow = positiveInteger(options.macroGenerationWindow, 256, 16);
  const topologyKey = gitScaleTopologyKey(dataset);
  if (dataset.nodes.length <= directNodeLimit) {
    const layout = layoutGitDataset(dataset, seed, options.previous);
    return {
      layout,
      mode: "direct",
      topologyKey,
      logicalNodeCount: dataset.nodes.length,
      layoutNodeCount: dataset.nodes.length,
    };
  }
  return buildMacroLayout(dataset, topologyKey, generationWindow, seed);
}
