import type { ElementId, Vec3, VisualPrimitive } from "@gitinspect/contracts";

export type MeshPrimitive = Exclude<VisualPrimitive, "line" | "particles" | "label">;

export interface SemanticRenderIdentity {
  readonly ownerId: ElementId;
  readonly elementId: string;
  readonly interactionKey?: string;
}

export interface PlannedNodeInstance extends SemanticRenderIdentity {
  readonly position: Vec3;
  readonly scale: Vec3;
  readonly color: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface PlannedNodeBatch {
  readonly key: string;
  readonly primitive: MeshPrimitive;
  readonly opacity: number;
  readonly emissive: string;
  readonly instances: readonly PlannedNodeInstance[];
}

export interface PlannedNodeLabel extends SemanticRenderIdentity {
  readonly text: string;
  readonly position: Vec3;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface NodeRenderPlan {
  readonly batches: readonly PlannedNodeBatch[];
  readonly labels: readonly PlannedNodeLabel[];
  readonly ignored: readonly SemanticRenderIdentity[];
}

export type EdgePathForm = "straight" | "polyline" | "wavy";
export type EdgeLinePattern = "solid" | "dashed" | "dotted";
export type EdgeHead = "arrow" | "diamond" | "none";

export interface ResolvedEdgeStyle {
  readonly registryStyleId: string;
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly pattern: EdgeLinePattern;
  readonly animated: boolean;
  readonly animationSpeed: number;
  readonly dashSize: number;
  readonly gapSize: number;
  readonly pathForm: EdgePathForm;
  readonly waveAmplitude: number;
  readonly waveFrequency: number;
  readonly waveSegments: number;
  readonly head: EdgeHead;
  readonly headScale: number;
}

export interface PlannedEdgeSegment extends SemanticRenderIdentity {
  readonly edgeId: ElementId;
  readonly segmentIndex: number;
  readonly start: Vec3;
  readonly end: Vec3;
}

export interface PlannedEdgeBatch {
  readonly key: string;
  readonly style: ResolvedEdgeStyle;
  readonly segments: readonly PlannedEdgeSegment[];
}

export interface PlannedEdgeHead extends SemanticRenderIdentity {
  readonly edgeId: ElementId;
  readonly kind: Exclude<EdgeHead, "none">;
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly color: string;
  readonly opacity: number;
  readonly scale: number;
}

export interface PlannedEdgeHeadBatch {
  readonly key: string;
  readonly kind: Exclude<EdgeHead, "none">;
  readonly color: string;
  readonly opacity: number;
  readonly heads: readonly PlannedEdgeHead[];
}

export interface EdgeRenderDiagnostic {
  readonly edgeId: ElementId;
  readonly reason: "missing-descriptor" | "missing-source-position" | "missing-target-position";
}

export interface EdgeRenderPlan {
  readonly batches: readonly PlannedEdgeBatch[];
  readonly headBatches: readonly PlannedEdgeHeadBatch[];
  readonly diagnostics: readonly EdgeRenderDiagnostic[];
}

export type EdgeRouteMap = ReadonlyMap<ElementId, readonly Vec3[]>;
