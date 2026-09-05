import type {
  DataMapper,
  ElementId,
  GraphDataset,
  MappingContext,
  Vec3,
} from "@gitinspect/graph-elements";

import { gitVisualMapper } from "../domain/gitVisualMapper";
import { GitSearchIndex, type GitSearchQuery } from "../search/gitSearch";
import { GitScalePlanner, type GitScaleModel } from "./gitScale";

export interface GitScaleBenchmarkInput {
  readonly dataset: GraphDataset;
  readonly camera?: { readonly position: Vec3 };
  readonly searchQuery?: GitSearchQuery;
  readonly fuzzyProbe?: Omit<GitSearchQuery, "mode">;
  readonly mapper?: DataMapper;
}

export interface GitBoundedFuzzyBenchmarkResult {
  readonly elapsedMs: number;
  readonly documentsScanned: number;
  readonly tokensCompared: number;
  readonly truncated: boolean;
  readonly hitCount: number;
}

export interface GitScaleBenchmarkResult {
  readonly revision: string;
  readonly logicalNodeCount: number;
  readonly layoutMode: GitScaleModel["stats"]["layoutMode"];
  readonly layoutLogicalNodeCount: number;
  readonly layoutNodeCount: number;
  readonly topologyKeyMs: number;
  readonly layoutMs: number;
  readonly plannerMs: number;
  readonly projectionMs: number;
  readonly scaleTotalMs: number;
  readonly searchIndexMs: number;
  readonly searchQueryMs: number;
  readonly searchMs: number;
  readonly mapperMs: number;
  readonly renderNodeCount: number;
  readonly renderEdgeCount: number;
  readonly retainedLogicalIdentityCount: number;
  readonly aggregateBucketCount: number;
  readonly mappedVisualElementCount: number;
  readonly mappedEdgeCount: number;
  readonly estimatedPlanBytes: number;
  readonly estimatedProjectionBytes: number;
  readonly estimatedSearchIndexBytes: number;
  readonly searchHitCount: number;
  readonly searchMatchedDocuments: number;
  readonly searchPeakRetainedResults: number;
  readonly fuzzyProbe?: GitBoundedFuzzyBenchmarkResult;
}

function now(): number {
  return performance.now();
}

function mapProjection(
  model: GitScaleModel,
  mapper: DataMapper,
): {
  readonly mappedVisualElementCount: number;
  readonly mappedEdgeCount: number;
} {
  const positions = new Map<ElementId, Vec3>(Object.entries(model.nodePositions));
  const context: MappingContext = {
    dataset: model.renderDataset,
    revision: model.renderDataset.revision,
    nodePositions: positions,
  };
  let mappedVisualElementCount = 0;
  for (const node of model.renderDataset.nodes) {
    mappedVisualElementCount += mapper.mapNode(node, context).elements.length;
  }
  for (const edge of model.renderDataset.edges) mapper.mapEdge(edge, context);
  return { mappedVisualElementCount, mappedEdgeCount: model.renderDataset.edges.length };
}

export function benchmarkGitScale(input: GitScaleBenchmarkInput): GitScaleBenchmarkResult {
  const searchIndex = new GitSearchIndex();
  const searchIndexStarted = now();
  const indexStats = searchIndex.update(input.dataset);
  const searchIndexMs = now() - searchIndexStarted;
  const searchQueryStarted = now();
  const search = searchIndex.search(
    input.dataset,
    input.searchQuery ?? {
      text: "synthetic commit",
      mode: "substring",
      limit: 64,
    },
  );
  const searchQueryMs = now() - searchQueryStarted;
  const searchMs = searchIndexMs + searchQueryMs;
  let fuzzyProbe: GitBoundedFuzzyBenchmarkResult | undefined;
  if (input.fuzzyProbe) {
    const fuzzyStarted = now();
    const fuzzy = searchIndex.search(input.dataset, {
      ...input.fuzzyProbe,
      mode: "fuzzy",
    });
    fuzzyProbe = Object.freeze({
      elapsedMs: now() - fuzzyStarted,
      documentsScanned: fuzzy.stats.documentsScanned,
      tokensCompared: fuzzy.stats.fuzzyTokensCompared,
      truncated: fuzzy.stats.fuzzyTruncated,
      hitCount: fuzzy.hitIds.size,
    });
  }

  const planner = new GitScalePlanner();
  const model = planner.plan({
    dataset: input.dataset,
    camera: input.camera ?? { position: [0, 0, 0] },
    searchHitIds: search.hitIds,
  });

  const mapperStarted = now();
  const mapped = mapProjection(model, input.mapper ?? gitVisualMapper);
  const mapperMs = now() - mapperStarted;
  return Object.freeze({
    revision: input.dataset.revision,
    logicalNodeCount: input.dataset.nodes.length,
    layoutMode: model.stats.layoutMode,
    layoutLogicalNodeCount: model.stats.layoutLogicalNodeCount,
    layoutNodeCount: model.stats.layoutNodeCount,
    topologyKeyMs: model.timings.topologyKeyMs,
    layoutMs: model.timings.layoutMs,
    plannerMs: model.timings.lodPlannerMs,
    projectionMs: model.timings.projectionMs,
    scaleTotalMs: model.timings.totalMs,
    searchIndexMs,
    searchQueryMs,
    searchMs,
    mapperMs,
    renderNodeCount: model.stats.renderNodeCount,
    renderEdgeCount: model.stats.renderEdgeCount,
    retainedLogicalIdentityCount: model.stats.retainedLogicalIdentityCount,
    aggregateBucketCount: model.stats.aggregateBucketCount,
    mappedVisualElementCount: mapped.mappedVisualElementCount,
    mappedEdgeCount: mapped.mappedEdgeCount,
    estimatedPlanBytes: model.stats.estimatedPlanBytes,
    estimatedProjectionBytes: model.stats.estimatedProjectionBytes,
    estimatedSearchIndexBytes: indexStats.estimatedIndexBytes,
    searchHitCount: search.hitIds.size,
    searchMatchedDocuments: search.stats.matchedDocuments,
    searchPeakRetainedResults: search.stats.peakRetainedResults,
    ...(fuzzyProbe ? { fuzzyProbe } : {}),
  });
}
