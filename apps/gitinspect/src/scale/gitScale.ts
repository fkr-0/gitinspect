import {
  planLod,
  type ElementId,
  type GraphDataset,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type LodLogicalNode,
  type LodRenderPlan,
  type LodThresholds,
  type Vec3,
} from "@gitinspect/graph-elements";

import { gitTopologyPromotionIds } from "../domain/gitTopology";
import {
  gitScaleTopologyKey,
  layoutGitDatasetForScale,
  type GitScaleLayoutMode,
} from "./gitScaleLayout";

export interface GitScalePlannerOptions {
  readonly seed?: number;
  readonly directNodeLimit?: number;
  readonly macroGenerationWindow?: number;
  readonly thresholds?: Partial<LodThresholds>;
  readonly bucketSize?: number;
}

export interface GitScalePlanningInput {
  readonly dataset: GraphDataset;
  readonly camera: { readonly position: Vec3 };
  readonly selectedIds?: ReadonlySet<ElementId>;
  readonly hoveredIds?: ReadonlySet<ElementId>;
  readonly searchHitIds?: ReadonlySet<ElementId>;
  /** Optional logical filter result. Omitted means all logical nodes participate. */
  readonly includedIds?: ReadonlySet<ElementId>;
  readonly thresholds?: Partial<LodThresholds>;
  readonly bucketSize?: number;
}

export interface GitAggregateDrillTarget {
  readonly aggregateId: ElementId;
  readonly drillTargetId: ElementId;
  readonly memberIds: readonly ElementId[];
  readonly count: number;
}

export interface GitScaleTimings {
  readonly topologyKeyMs: number;
  readonly layoutMs: number;
  readonly lodPlannerMs: number;
  readonly projectionMs: number;
  readonly totalMs: number;
}

export interface GitScaleStats {
  readonly logicalNodeCount: number;
  readonly eligibleNodeCount: number;
  readonly renderNodeCount: number;
  readonly renderEdgeCount: number;
  readonly fullNodeCount: number;
  readonly simplifiedNodeCount: number;
  readonly aggregateBucketCount: number;
  readonly hiddenNodeCount: number;
  readonly retainedLogicalIdentityCount: number;
  readonly estimatedPlanBytes: number;
  readonly estimatedProjectionBytes: number;
  readonly layoutMode: GitScaleLayoutMode;
  readonly layoutLogicalNodeCount: number;
  readonly layoutNodeCount: number;
  readonly layoutCacheHit: boolean;
  readonly reusedLodMetadata: number;
  readonly rebuiltLodMetadata: number;
}

export interface GitScaleModel {
  /** Original immutable logical dataset; search/inspection should continue to use this. */
  readonly logicalDataset: GraphDataset;
  /** Derived viewport projection with preserved semantic IDs plus synthetic aggregate IDs. */
  readonly renderDataset: GraphDataset;
  readonly nodePositions: Readonly<Record<ElementId, Vec3>>;
  /** Full topology bounds before render LOD; camera fitting never depends on aggregate centroids. */
  readonly layoutBounds: Readonly<{ readonly min: Vec3; readonly max: Vec3 }>;
  readonly lodPlan: LodRenderPlan;
  readonly aggregateDrillTargets: ReadonlyMap<ElementId, GitAggregateDrillTarget>;
  readonly projectionKey: string;
  readonly stats: GitScaleStats;
  readonly timings: GitScaleTimings;
}

interface LodMetadata {
  readonly fingerprint: string;
  readonly kind: string;
  readonly importance: number;
  readonly semanticBucket: string;
}

interface CollapsedRenderEdge {
  readonly source: ElementId;
  readonly target: ElementId;
  readonly kind: string;
  readonly directed: boolean;
  memberEdgeCount: number;
  headPath: boolean;
  firstParent: boolean;
  secondParent: boolean;
}

function now(): number {
  return performance.now();
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function metadataFingerprint(node: GraphNodeRecord): string {
  return [
    node.id,
    node.kind,
    node.group ?? "",
    String(node.weight ?? ""),
    String(node.properties.isMerge === true),
    String(node.properties.isHead === true),
    String(node.properties.signatureStatus ?? ""),
    ...stringArray(node.properties.tags),
    ...stringArray(node.properties.localBranches),
    ...stringArray(node.properties.remoteBranches),
  ].join("\u0001");
}

function metadataFor(node: GraphNodeRecord, fingerprint: string): LodMetadata {
  let importance = Math.max(0, node.weight ?? 0);
  switch (node.kind) {
    case "head":
      importance += 20;
      break;
    case "local-branch":
      importance += 9;
      break;
    case "tag":
      importance += 8;
      break;
    case "remote-branch":
      importance += 7;
      break;
    case "stash":
      importance += 6;
      break;
    case "remote":
      importance += 5;
      break;
    case "commit-boundary":
      importance += 3;
      break;
    default:
      break;
  }
  if (node.properties.isHead === true) importance += 12;
  if (node.properties.isMerge === true) importance += 2;
  importance += Math.min(5, stringArray(node.properties.tags).length * 2);
  importance += Math.min(3, stringArray(node.properties.localBranches).length);
  importance += Math.min(2, stringArray(node.properties.remoteBranches).length);
  if (node.properties.signatureStatus === "invalid") importance += 2;

  const localBranch = stringArray(node.properties.localBranches)[0];
  const remoteBranch = stringArray(node.properties.remoteBranches)[0];
  const semanticBucket =
    node.kind === "commit"
      ? `commit:${localBranch ?? remoteBranch ?? node.group ?? "history"}`
      : `${node.kind}:${node.group ?? "default"}`;
  return { fingerprint, kind: node.kind, importance, semanticBucket };
}

function simplifiedNode(node: GraphNodeRecord): GraphNodeRecord {
  return {
    id: node.id,
    kind: "lod-simplified",
    ...(node.label ? { label: node.label } : {}),
    ...(node.group ? { group: node.group } : {}),
    ...(node.weight !== undefined ? { weight: node.weight } : {}),
    properties: {
      lodTier: "simplified",
      originalKind: node.kind,
    },
  };
}

function aggregateId(bucketId: string): ElementId {
  return `lod-aggregate:${bucketId}`;
}

function hashProjection(parts: Iterable<string>): string {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

function projectDataset(
  dataset: GraphDataset,
  positions: Readonly<Record<ElementId, Vec3>>,
  lodPlan: LodRenderPlan,
): {
  readonly renderDataset: GraphDataset;
  readonly renderPositions: Readonly<Record<ElementId, Vec3>>;
  readonly aggregateDrillTargets: ReadonlyMap<ElementId, GitAggregateDrillTarget>;
  readonly projectionKey: string;
} {
  const nodesById = new Map(dataset.nodes.map((node) => [node.id, node] as const));
  const endpointMap = new Map<ElementId, ElementId>();
  const renderNodes: GraphNodeRecord[] = [];
  const renderPositions: Record<ElementId, Vec3> = {};
  const aggregateDrillTargets = new Map<ElementId, GitAggregateDrillTarget>();

  for (const entry of lodPlan.full) {
    const node = nodesById.get(entry.id);
    const position = positions[entry.id];
    if (!node || !position) continue;
    endpointMap.set(entry.id, entry.id);
    renderNodes.push(node);
    renderPositions[entry.id] = position;
  }
  for (const entry of lodPlan.simplified) {
    const node = nodesById.get(entry.id);
    const position = positions[entry.id];
    if (!node || !position) continue;
    endpointMap.set(entry.id, entry.id);
    renderNodes.push(simplifiedNode(node));
    renderPositions[entry.id] = position;
  }
  for (const bucket of lodPlan.aggregates) {
    const id = aggregateId(bucket.id);
    const drillTargetId = bucket.memberIds[0];
    if (!drillTargetId) continue;
    for (const memberId of bucket.memberIds) endpointMap.set(memberId, id);
    renderNodes.push({
      id,
      kind: "lod-aggregate",
      label: `${bucket.count} ${bucket.dominantKind}`,
      group: "lod-aggregate",
      weight: bucket.count,
      properties: {
        lodTier: "aggregate",
        semanticBucket: bucket.semanticBucket,
        count: bucket.count,
        dominantKind: bucket.dominantKind,
        memberIds: bucket.memberIds,
        drillTargetId,
      },
    });
    renderPositions[id] = bucket.centroid;
    aggregateDrillTargets.set(id, {
      aggregateId: id,
      drillTargetId,
      memberIds: bucket.memberIds,
      count: bucket.count,
    });
  }

  const directEdges: GraphEdgeRecord[] = [];
  const collapsed = new Map<string, CollapsedRenderEdge>();
  for (const edge of dataset.edges) {
    const source = endpointMap.get(edge.source);
    const target = endpointMap.get(edge.target);
    if (!source || !target || source === target) continue;
    if (source === edge.source && target === edge.target) {
      directEdges.push(edge);
      continue;
    }
    const key = `${edge.kind}\u0000${source}\u0000${target}\u0000${edge.directed ? "1" : "0"}`;
    let aggregate = collapsed.get(key);
    if (!aggregate) {
      aggregate = {
        source,
        target,
        kind: edge.kind,
        directed: edge.directed,
        memberEdgeCount: 0,
        headPath: false,
        firstParent: false,
        secondParent: false,
      };
      collapsed.set(key, aggregate);
    }
    aggregate.memberEdgeCount += 1;
    aggregate.headPath ||= edge.properties.headPath === true;
    const isFirstParent =
      edge.properties.firstParent === true || edge.properties.parentIndex === 0;
    aggregate.firstParent ||= isFirstParent;
    aggregate.secondParent ||=
      (edge.kind === "merge-parent" || edge.properties.parentIndex !== undefined) && !isFirstParent;
  }
  const collapsedEdges: GraphEdgeRecord[] = [...collapsed.values()]
    .sort((left, right) => {
      const leftKey = `${left.kind}:${left.source}:${left.target}`;
      const rightKey = `${right.kind}:${right.source}:${right.target}`;
      return leftKey.localeCompare(rightKey);
    })
    .map((edge) => {
      return {
        id: `lod-edge:${edge.kind}:${edge.source}:${edge.target}`,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        directed: edge.directed,
        properties: {
          collapsed: true,
          memberEdgeCount: edge.memberEdgeCount,
          ...(edge.headPath ? { headPath: true } : {}),
          ...(edge.firstParent && !edge.secondParent
            ? { firstParent: true, parentIndex: 0 }
            : {}),
          ...(edge.secondParent && !edge.firstParent
            ? { firstParent: false, parentIndex: 1 }
            : {}),
        },
      };
    });
  renderNodes.sort((left, right) => left.id.localeCompare(right.id));
  const edges = [...directEdges, ...collapsedEdges].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const projectionKey = hashProjection([
    dataset.revision,
    ...lodPlan.full.map((entry) => `f:${entry.id}`),
    ...lodPlan.simplified.map((entry) => `s:${entry.id}`),
    ...lodPlan.aggregates.map((entry) => `a:${entry.id}:${entry.count}`),
  ]);
  return {
    renderDataset: Object.freeze({
      revision: dataset.revision,
      nodes: Object.freeze(renderNodes),
      edges: Object.freeze(edges),
    }),
    renderPositions: Object.freeze(renderPositions),
    aggregateDrillTargets,
    projectionKey,
  };
}

export class GitScalePlanner {
  private readonly options: GitScalePlannerOptions;
  private readonly metadataCache = new Map<ElementId, LodMetadata>();
  private lastTopologyKey: string | undefined;
  private lastLayout: ReturnType<typeof layoutGitDatasetForScale> | undefined;

  constructor(options: GitScalePlannerOptions = {}) {
    this.options = options;
  }

  plan(input: GitScalePlanningInput): GitScaleModel {
    const totalStarted = now();
    const topologyStarted = now();
    const topologyKey = gitScaleTopologyKey(input.dataset);
    const topologyKeyMs = now() - topologyStarted;
    const layoutCacheHit = topologyKey === this.lastTopologyKey && this.lastLayout !== undefined;
    const layoutStarted = now();
    const cachedLayout = this.lastLayout;
    const layoutResult =
      layoutCacheHit && cachedLayout
        ? cachedLayout
        : layoutGitDatasetForScale(input.dataset, {
            ...(this.options.seed !== undefined ? { seed: this.options.seed } : {}),
            ...(this.options.directNodeLimit !== undefined
              ? { directNodeLimit: this.options.directNodeLimit }
              : {}),
            ...(this.options.macroGenerationWindow !== undefined
              ? { macroGenerationWindow: this.options.macroGenerationWindow }
              : {}),
            ...(this.lastLayout?.layout ? { previous: this.lastLayout.layout } : {}),
          });
    const layoutMs = now() - layoutStarted;
    if (!layoutCacheHit) {
      this.lastTopologyKey = topologyKey;
      this.lastLayout = layoutResult;
    }

    const liveIds = new Set(input.dataset.nodes.map((node) => node.id));
    for (const id of this.metadataCache.keys()) {
      if (!liveIds.has(id)) this.metadataCache.delete(id);
    }
    let reusedLodMetadata = 0;
    let rebuiltLodMetadata = 0;
    const logicalNodes: LodLogicalNode[] = [];
    for (const node of input.dataset.nodes) {
      if (input.includedIds && !input.includedIds.has(node.id)) continue;
      const position = layoutResult.layout.nodePositions[node.id];
      if (!position) continue;
      const fingerprint = metadataFingerprint(node);
      let metadata = this.metadataCache.get(node.id);
      if (metadata?.fingerprint === fingerprint) {
        reusedLodMetadata += 1;
      } else {
        metadata = metadataFor(node, fingerprint);
        this.metadataCache.set(node.id, metadata);
        rebuiltLodMetadata += 1;
      }
      logicalNodes.push({
        id: node.id,
        position,
        kind: metadata.kind,
        importance: metadata.importance,
        semanticBucket:
          node.kind === "commit" || node.kind === "commit-boundary"
            ? `${metadata.semanticBucket}:lane:${position[1].toFixed(3)}`
            : metadata.semanticBucket,
      });
    }

    const lodStarted = now();
    const thresholds = input.thresholds ?? this.options.thresholds;
    const bucketSize = input.bucketSize ?? this.options.bucketSize;
    const topologyPromotionIds = gitTopologyPromotionIds(
      input.dataset,
      input.selectedIds ?? new Set<ElementId>(),
    );
    const lodPlan = planLod({
      nodes: logicalNodes,
      camera: input.camera,
      ...(thresholds ? { thresholds } : {}),
      ...(bucketSize !== undefined ? { bucketSize } : {}),
      selectedIds: topologyPromotionIds,
      ...(input.hoveredIds ? { hoveredIds: input.hoveredIds } : {}),
      ...(input.searchHitIds ? { searchHitIds: input.searchHitIds } : {}),
      promotedTier: "full",
      preserveHiddenIds: false,
    });
    const lodPlannerMs = now() - lodStarted;

    const projectionStarted = now();
    const projection = projectDataset(input.dataset, layoutResult.layout.nodePositions, lodPlan);
    const projectionMs = now() - projectionStarted;
    const retainedLogicalIdentityCount =
      lodPlan.full.length +
      lodPlan.simplified.length +
      lodPlan.aggregates.reduce((sum, bucket) => sum + bucket.memberIds.length, 0);
    const estimatedProjectionBytes =
      projection.renderDataset.nodes.length * 256 +
      projection.renderDataset.edges.length * 192 +
      retainedLogicalIdentityCount * 16;

    return Object.freeze({
      logicalDataset: input.dataset,
      renderDataset: projection.renderDataset,
      nodePositions: projection.renderPositions,
      layoutBounds: layoutResult.layout.bounds,
      lodPlan,
      aggregateDrillTargets: projection.aggregateDrillTargets,
      projectionKey: projection.projectionKey,
      stats: Object.freeze({
        logicalNodeCount: input.dataset.nodes.length,
        eligibleNodeCount: logicalNodes.length,
        renderNodeCount: projection.renderDataset.nodes.length,
        renderEdgeCount: projection.renderDataset.edges.length,
        fullNodeCount: lodPlan.full.length,
        simplifiedNodeCount: lodPlan.simplified.length,
        aggregateBucketCount: lodPlan.aggregates.length,
        hiddenNodeCount: lodPlan.hidden.count,
        retainedLogicalIdentityCount,
        estimatedPlanBytes: lodPlan.stats.estimatedPlanBytes,
        estimatedProjectionBytes,
        layoutMode: layoutResult.mode,
        layoutLogicalNodeCount: layoutResult.logicalNodeCount,
        layoutNodeCount: layoutResult.layoutNodeCount,
        layoutCacheHit,
        reusedLodMetadata,
        rebuiltLodMetadata,
      }),
      timings: Object.freeze({
        topologyKeyMs,
        layoutMs,
        lodPlannerMs,
        projectionMs,
        totalMs: now() - totalStarted,
      }),
    });
  }
}
