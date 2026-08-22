import type { ElementId, LodBucket, Vec3 } from "@gitinspect/contracts";

export type LodTier = "full" | "simplified" | "aggregate" | "hidden";

export interface LodLogicalNode {
  readonly id: ElementId;
  readonly position: Vec3;
  readonly kind: string;
  readonly importance?: number;
  readonly semanticBucket?: string;
}

export interface LodCamera {
  readonly position: Vec3;
}

export interface LodThresholds {
  readonly fullDistance: number;
  readonly simplifiedDistance: number;
  readonly aggregateDistance: number;
  readonly importanceDistanceScale: number;
}

export interface LodPromotionState {
  readonly selectedIds?: ReadonlySet<ElementId>;
  readonly hoveredIds?: ReadonlySet<ElementId>;
  readonly searchHitIds?: ReadonlySet<ElementId>;
}

export interface LodPlanningInput extends LodPromotionState {
  readonly nodes: readonly LodLogicalNode[];
  readonly camera: LodCamera;
  readonly thresholds?: Partial<LodThresholds>;
  readonly bucketSize?: number;
  readonly promotedTier?: "full" | "simplified";
  readonly preserveHiddenIds?: boolean;
}

export interface LodNodePlan {
  readonly id: ElementId;
  readonly tier: "full" | "simplified";
  readonly distance: number;
}

export interface LodAggregatePlan extends LodBucket {
  readonly tier: "aggregate";
  readonly semanticBucket: string;
}

export interface LodHiddenPlan {
  readonly tier: "hidden";
  readonly count: number;
  readonly memberIds?: readonly ElementId[];
}

export interface LodPlanningStats {
  readonly logicalNodeCount: number;
  readonly retainedIdentityReferences: number;
  readonly aggregateBucketCount: number;
  readonly estimatedPlanBytes: number;
}

export interface LodRenderPlan {
  readonly full: readonly LodNodePlan[];
  readonly simplified: readonly LodNodePlan[];
  readonly aggregates: readonly LodAggregatePlan[];
  readonly hidden: LodHiddenPlan;
  readonly stats: LodPlanningStats;
}

const DEFAULT_THRESHOLDS: LodThresholds = Object.freeze({
  fullDistance: 50,
  simplifiedDistance: 250,
  aggregateDistance: 1500,
  importanceDistanceScale: 1,
});

interface MutableBucket {
  readonly id: string;
  readonly semanticBucket: string;
  readonly memberIds: ElementId[];
  readonly kindCounts: Map<string, number>;
  sumX: number;
  sumY: number;
  sumZ: number;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function thresholdsFor(input: LodPlanningInput): LodThresholds {
  const fullDistance = positive(input.thresholds?.fullDistance, DEFAULT_THRESHOLDS.fullDistance);
  const simplifiedDistance = Math.max(
    fullDistance,
    positive(input.thresholds?.simplifiedDistance, DEFAULT_THRESHOLDS.simplifiedDistance),
  );
  const aggregateDistance = Math.max(
    simplifiedDistance,
    positive(input.thresholds?.aggregateDistance, DEFAULT_THRESHOLDS.aggregateDistance),
  );
  return {
    fullDistance,
    simplifiedDistance,
    aggregateDistance,
    importanceDistanceScale: positive(
      input.thresholds?.importanceDistanceScale,
      DEFAULT_THRESHOLDS.importanceDistanceScale,
    ),
  };
}

function promoted(id: ElementId, input: LodPlanningInput): boolean {
  return (
    input.selectedIds?.has(id) === true ||
    input.hoveredIds?.has(id) === true ||
    input.searchHitIds?.has(id) === true
  );
}

export function computeLodTier(
  node: LodLogicalNode,
  camera: LodCamera,
  thresholds: LodThresholds = DEFAULT_THRESHOLDS,
): LodTier {
  const rawDistance = distance(node.position, camera.position);
  const importance = Math.max(0, node.importance ?? 0);
  const effectiveDistance = rawDistance / (1 + importance * thresholds.importanceDistanceScale);
  if (effectiveDistance <= thresholds.fullDistance) return "full";
  if (effectiveDistance <= thresholds.simplifiedDistance) return "simplified";
  if (effectiveDistance <= thresholds.aggregateDistance) return "aggregate";
  return "hidden";
}

function bucketKey(node: LodLogicalNode, bucketSize: number): { readonly id: string; readonly semantic: string } {
  const x = Math.floor(node.position[0] / bucketSize);
  const y = Math.floor(node.position[1] / bucketSize);
  const z = Math.floor(node.position[2] / bucketSize);
  const semantic = node.semanticBucket ?? node.kind;
  return { id: `${semantic}:${x}:${y}:${z}`, semantic };
}

export function planLod(input: LodPlanningInput): LodRenderPlan {
  const thresholds = thresholdsFor(input);
  const bucketSize = positive(input.bucketSize, Math.max(1, thresholds.simplifiedDistance));
  const full: LodNodePlan[] = [];
  const simplified: LodNodePlan[] = [];
  const aggregateBuckets = new Map<string, MutableBucket>();
  const hiddenIds: ElementId[] | undefined = input.preserveHiddenIds === true ? [] : undefined;
  let hiddenCount = 0;

  for (const node of input.nodes) {
    const nodeDistance = distance(node.position, input.camera.position);
    let tier = computeLodTier(node, input.camera, thresholds);
    if (promoted(node.id, input)) tier = input.promotedTier ?? "full";
    if (tier === "full") {
      full.push({ id: node.id, tier, distance: nodeDistance });
    } else if (tier === "simplified") {
      simplified.push({ id: node.id, tier, distance: nodeDistance });
    } else if (tier === "aggregate") {
      const key = bucketKey(node, bucketSize);
      let bucket = aggregateBuckets.get(key.id);
      if (bucket === undefined) {
        bucket = {
          id: key.id,
          semanticBucket: key.semantic,
          memberIds: [],
          kindCounts: new Map(),
          sumX: 0,
          sumY: 0,
          sumZ: 0,
        };
        aggregateBuckets.set(key.id, bucket);
      }
      bucket.memberIds.push(node.id);
      bucket.kindCounts.set(node.kind, (bucket.kindCounts.get(node.kind) ?? 0) + 1);
      bucket.sumX += node.position[0];
      bucket.sumY += node.position[1];
      bucket.sumZ += node.position[2];
    } else {
      hiddenCount += 1;
      hiddenIds?.push(node.id);
    }
  }

  full.sort((a, b) => a.id.localeCompare(b.id));
  simplified.sort((a, b) => a.id.localeCompare(b.id));
  const aggregates: LodAggregatePlan[] = [...aggregateBuckets.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((bucket) => {
      bucket.memberIds.sort((a, b) => a.localeCompare(b));
      const count = bucket.memberIds.length;
      const dominantKind = [...bucket.kindCounts]
        .sort(([aKind, aCount], [bKind, bCount]) => bCount - aCount || aKind.localeCompare(bKind))[0]?.[0] ?? "unknown";
      return {
        id: bucket.id,
        tier: "aggregate",
        semanticBucket: bucket.semanticBucket,
        memberIds: Object.freeze(bucket.memberIds),
        centroid: [bucket.sumX / count, bucket.sumY / count, bucket.sumZ / count],
        count,
        dominantKind,
      };
    });
  hiddenIds?.sort((a, b) => a.localeCompare(b));
  const retainedIdentityReferences =
    full.length +
    simplified.length +
    aggregates.reduce((sum, bucket) => sum + bucket.memberIds.length, 0) +
    (hiddenIds?.length ?? 0);
  // A conservative accounting model for planner-owned scalar/reference storage, useful for CI regressions.
  const estimatedPlanBytes =
    retainedIdentityReferences * 24 + aggregates.length * 160 + (full.length + simplified.length) * 32 + 256;
  const hidden: LodHiddenPlan =
    hiddenIds === undefined
      ? { tier: "hidden", count: hiddenCount }
      : { tier: "hidden", count: hiddenCount, memberIds: Object.freeze(hiddenIds) };
  return Object.freeze({
    full: Object.freeze(full),
    simplified: Object.freeze(simplified),
    aggregates: Object.freeze(aggregates),
    hidden: Object.freeze(hidden),
    stats: Object.freeze({
      logicalNodeCount: input.nodes.length,
      retainedIdentityReferences,
      aggregateBucketCount: aggregates.length,
      estimatedPlanBytes,
    }),
  });
}
