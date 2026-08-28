import type {
  ElementId,
  GraphDataset,
  LayoutDiagnostic,
  LayoutResult,
  Vec3,
} from "@gitinspect/graph-elements";

import {
  GIT_RAILFIELD_GEOMETRY,
  gitRailTopology,
  layoutGitDataset,
} from "../domain/gitLayout";

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
): GitScaleLayoutResult {
  const topology = gitRailTopology(dataset);
  const generations = topology.generations;
  const buckets = new Map<number, MacroBucket>();

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
      };
      buckets.set(index, bucket);
    }
    bucket.members.push(node.id);
  }
  const positions: Record<ElementId, Vec3> = {};
  const generationValues = [...generations.values()];
  const minGeneration = generationValues.length > 0 ? Math.min(...generationValues) : 0;
  const maxGeneration = generationValues.length > 0 ? Math.max(...generationValues) : 0;
  const minBucket = Math.floor(minGeneration / generationWindow);
  const maxBucket = Math.floor(maxGeneration / generationWindow);
  const bucketCenter = (minBucket + maxBucket) / 2;
  const macroBucketSpacing = 4.8;
  const macroInnerSpan = 4;
  const xForGeneration = (generation: number): number => {
    const bucket = Math.floor(generation / generationWindow);
    const within = generation - bucket * generationWindow;
    const normalized = generationWindow <= 1 ? 0.5 : within / (generationWindow - 1);
    return (bucket - bucketCenter) * macroBucketSpacing + (normalized - 0.5) * macroInnerSpan;
  };

  for (const node of dataset.nodes) {
    const generation = generations.get(node.id);
    const lane = topology.laneByCommit.get(node.id);
    if (generation === undefined || lane === undefined) continue;
    positions[node.id] = [
      xForGeneration(generation),
      lane * GIT_RAILFIELD_GEOMETRY.branchLaneSpacing,
      0,
    ];
  }

  const targetBySource = new Map<ElementId, ElementId>();
  for (const edge of dataset.edges) {
    if (TARGET_EDGE_KINDS.has(edge.kind) && !targetBySource.has(edge.source)) {
      targetBySource.set(edge.source, edge.target);
    }
  }
  const attachmentsByTarget = new Map<ElementId, ElementId[]>();
  for (const [source, target] of targetBySource) {
    const attached = attachmentsByTarget.get(target) ?? [];
    attached.push(source);
    attachmentsByTarget.set(target, attached);
  }
  const attachmentRank = (kind: string): number =>
    kind === "local-branch" ? 0 : kind === "tag" ? 1 : kind === "remote-branch" ? 2 : 3;
  for (const [target, ids] of attachmentsByTarget) {
    const targetPosition = positions[target];
    if (!targetPosition) continue;
    const nodes = ids
      .map((id) => dataset.nodes.find((node) => node.id === id))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .sort((left, right) => attachmentRank(left.kind) - attachmentRank(right.kind) || left.id.localeCompare(right.id));
    const ordinalByKind = new Map<string, number>();
    for (const node of nodes) {
      const ordinal = ordinalByKind.get(node.kind) ?? 0;
      ordinalByKind.set(node.kind, ordinal + 1);
      const offset: Vec3 =
        node.kind === "local-branch"
          ? [0, 1.35 + ordinal * 0.54, GIT_RAILFIELD_GEOMETRY.localSignalDepth]
          : node.kind === "remote-branch"
            ? [0, -1.3 - ordinal * 0.5, GIT_RAILFIELD_GEOMETRY.remoteSignalDepth]
            : node.kind === "tag"
              ? [0, 1.1 + ordinal * 0.48, GIT_RAILFIELD_GEOMETRY.tagSignalDepth]
              : [0, -1.15 - ordinal * 0.48, GIT_RAILFIELD_GEOMETRY.stashSignalDepth];
      positions[node.id] = [
        targetPosition[0] + offset[0],
        targetPosition[1] + offset[1],
        targetPosition[2] + offset[2],
      ];
    }
  }

  const head = dataset.nodes.find((node) => node.kind === "head");
  if (head) {
    const target = dataset.edges.find(
      (edge) =>
        edge.source === head.id && (edge.kind === "head-symbolic" || edge.kind === "head-resolved"),
    )?.target;
    const targetPosition = target ? positions[target] : undefined;
    if (targetPosition) {
      positions[head.id] = [targetPosition[0], targetPosition[1] + 1.05, targetPosition[2] + 0.24];
    }
  }

  const remotes = dataset.nodes.filter((node) => node.kind === "remote").sort((a, b) => a.id.localeCompare(b.id));
  remotes.forEach((remote, index) => {
    const members = dataset.edges
      .filter((edge) => edge.source === remote.id && edge.kind === "remote-membership")
      .map((edge) => positions[edge.target])
      .filter((position): position is Vec3 => position !== undefined);
    const anchor: Vec3 =
      members.length > 0
        ? [
            members.reduce((sum, point) => sum + point[0], 0) / members.length,
            members.reduce((sum, point) => sum + point[1], 0) / members.length,
            0,
          ]
        : [xForGeneration(maxGeneration), 0, 0];
    positions[remote.id] = [
      anchor[0] + index * 0.9,
      anchor[1] - 1.15,
      GIT_RAILFIELD_GEOMETRY.remotePlatformDepth,
    ];
  });

  const unresolved = dataset.nodes
    .filter((node) => positions[node.id] === undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  unresolved.forEach((node, index) => {
    positions[node.id] = [
      xForGeneration(maxGeneration) + 2.4,
      (index - (unresolved.length - 1) / 2) * 1.1,
      -0.35,
    ];
  });

  for (const bucket of buckets.values()) {
    bucket.members.sort((left, right) => left.localeCompare(right));
  }

  const clusters = [...buckets.values()]
    .sort((left, right) => left.index - right.index)
    .map((bucket) => ({
      id: bucket.id,
      memberIds: Object.freeze([...bucket.members]),
      layer: bucket.index,
    }));
  const diagnostics: readonly LayoutDiagnostic[] = topology.diagnostics;
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
    layoutNodeCount: buckets.size + dataset.nodes.filter((node) => node.kind !== "commit").length,
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
  return buildMacroLayout(dataset, topologyKey, generationWindow);
}
