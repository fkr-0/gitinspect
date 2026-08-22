import type { ElementId, Vec3 } from "@gitinspect/contracts";

export interface LabelDescriptor {
  readonly id: string;
  readonly text: string;
  readonly position: Vec3;
  /** Allows one policy to drive persistent world labels and transient tooltips. */
  readonly kind?: "world-label" | "tooltip";
  /** Higher values receive priority when the visible-label budget is constrained. */
  readonly importance: number;
  readonly elementId?: ElementId;
  readonly interactionKey?: string;
  readonly minDistance?: number;
  readonly maxDistance?: number;
  readonly minLod?: number;
  readonly maxLod?: number;
  readonly collisionGroup?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LabelEvaluationContext {
  readonly cameraPosition: Vec3;
  readonly lod: number;
  readonly selectedIds?: ReadonlySet<ElementId>;
  readonly hoveredIds?: ReadonlySet<ElementId>;
  readonly maxVisible?: number;
  readonly minImportance?: number;
}

export interface LabelCandidate {
  readonly descriptor: LabelDescriptor;
  readonly distance: number;
  readonly promoted: boolean;
}

export type LabelHiddenReason = "distance" | "lod" | "importance" | "collision" | "budget";

export interface LabelDecision extends LabelCandidate {
  readonly visible: boolean;
  readonly hiddenReason?: LabelHiddenReason;
}

export interface LabelPlan {
  readonly visible: readonly LabelDecision[];
  readonly hidden: readonly LabelDecision[];
}

export type LabelCollisionPolicy = (
  candidate: LabelCandidate,
  accepted: readonly LabelCandidate[],
  context: LabelEvaluationContext,
) => boolean;

export type LabelBudgetPolicy = (
  candidates: readonly LabelCandidate[],
  maxVisible: number,
  context: LabelEvaluationContext,
) => readonly LabelCandidate[];

export interface LabelSystemOptions {
  readonly maxVisible?: number;
  readonly minImportance?: number;
  /** Return true when the candidate may coexist with already accepted labels. */
  readonly collisionPolicy?: LabelCollisionPolicy;
  readonly budgetPolicy?: LabelBudgetPolicy;
}

const DEFAULT_MAX_VISIBLE = 200;

export class LabelSystem {
  private readonly defaultMaxVisible: number;
  private readonly defaultMinImportance: number;
  private readonly collisionPolicy: LabelCollisionPolicy;
  private readonly budgetPolicy: LabelBudgetPolicy;

  public constructor(options: LabelSystemOptions = {}) {
    this.defaultMaxVisible = normalizeBudget(options.maxVisible ?? DEFAULT_MAX_VISIBLE);
    this.defaultMinImportance = options.minImportance ?? 0;
    this.collisionPolicy = options.collisionPolicy ?? (() => true);
    this.budgetPolicy = options.budgetPolicy ?? defaultBudgetPolicy;
  }

  public evaluate(
    descriptors: readonly LabelDescriptor[],
    context: LabelEvaluationContext,
  ): LabelPlan {
    const candidates: LabelCandidate[] = [];
    const hidden: LabelDecision[] = [];
    const minImportance = context.minImportance ?? this.defaultMinImportance;

    for (const descriptor of descriptors) {
      const candidate = this.candidate(descriptor, context);
      const hiddenReason = candidate.promoted
        ? undefined
        : baseHiddenReason(descriptor, candidate.distance, context.lod, minImportance);
      if (hiddenReason === undefined) {
        candidates.push(candidate);
      } else {
        hidden.push({ ...candidate, visible: false, hiddenReason });
      }
    }

    const sorted = [...candidates].sort(compareCandidates);
    const collisionAccepted: LabelCandidate[] = [];
    for (const candidate of sorted) {
      if (candidate.promoted || this.collisionPolicy(candidate, collisionAccepted, context)) {
        collisionAccepted.push(candidate);
      } else {
        hidden.push({ ...candidate, visible: false, hiddenReason: "collision" });
      }
    }

    const maxVisible = normalizeBudget(context.maxVisible ?? this.defaultMaxVisible);
    const budgeted = this.budgetPolicy(collisionAccepted, maxVisible, context);
    const visibleIds = new Set(budgeted.map((candidate) => candidate.descriptor.id));
    const visible: LabelDecision[] = [];
    for (const candidate of collisionAccepted) {
      if (visibleIds.has(candidate.descriptor.id)) {
        visible.push({ ...candidate, visible: true });
      } else {
        hidden.push({ ...candidate, visible: false, hiddenReason: "budget" });
      }
    }

    return {
      visible: Object.freeze(visible),
      hidden: Object.freeze(hidden),
    };
  }

  private candidate(descriptor: LabelDescriptor, context: LabelEvaluationContext): LabelCandidate {
    const elementId = descriptor.elementId;
    const promoted =
      elementId !== undefined &&
      (context.selectedIds?.has(elementId) === true || context.hoveredIds?.has(elementId) === true);
    return {
      descriptor,
      distance: distance(descriptor.position, context.cameraPosition),
      promoted,
    };
  }
}

function baseHiddenReason(
  descriptor: LabelDescriptor,
  distanceFromCamera: number,
  lod: number,
  minImportance: number,
): LabelHiddenReason | undefined {
  if (
    (descriptor.minDistance !== undefined && distanceFromCamera < descriptor.minDistance) ||
    (descriptor.maxDistance !== undefined && distanceFromCamera > descriptor.maxDistance)
  ) {
    return "distance";
  }
  if (
    (descriptor.minLod !== undefined && lod < descriptor.minLod) ||
    (descriptor.maxLod !== undefined && lod > descriptor.maxLod)
  ) {
    return "lod";
  }
  if (descriptor.importance < minImportance) return "importance";
  return undefined;
}

function compareCandidates(a: LabelCandidate, b: LabelCandidate): number {
  if (a.promoted !== b.promoted) return a.promoted ? -1 : 1;
  if (a.descriptor.importance !== b.descriptor.importance) {
    return b.descriptor.importance - a.descriptor.importance;
  }
  if (a.distance !== b.distance) return a.distance - b.distance;
  return a.descriptor.id.localeCompare(b.descriptor.id);
}

function defaultBudgetPolicy(
  candidates: readonly LabelCandidate[],
  maxVisible: number,
): readonly LabelCandidate[] {
  if (!Number.isFinite(maxVisible)) return candidates;
  return candidates.slice(0, maxVisible);
}

function normalizeBudget(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return value;
  if (!Number.isFinite(value)) throw new Error("Label budget must be finite or positive infinity");
  return Math.max(0, Math.floor(value));
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
