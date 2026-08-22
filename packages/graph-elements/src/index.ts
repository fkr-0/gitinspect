import type {} from "./rendering/r3f-jsx";

export type {
  CameraMode,
  CameraState,
  EdgeVisualDescriptor,
  ElementId,
  GraphDataset,
  GraphEdgeRecord,
  GraphNodeRecord,
  LodBucket,
  NodeVisualDescriptor,
  SelectionGranularity,
  SelectionState,
  Vec3,
  VisualElementDescriptor,
  VisualPrimitive,
} from "@gitinspect/contracts";

export { GraphWorld, DEFAULT_GRAPH_BACKGROUND, DEFAULT_GRAPH_LIGHTING } from "./world/GraphWorld";
export type {
  GraphBackgroundConfig,
  GraphFogConfig,
  GraphLightingConfig,
  GraphWorldProps,
} from "./world/GraphWorld";
export { resolveNodePositions } from "./world/mapping";
export type { DataMapper, GraphDatasetView, MappingContext } from "./world/mapping";

export { GraphNodeLayer } from "./nodes/GraphNodeLayer";
export type { GraphNodeLayerProps } from "./nodes/GraphNodeLayer";
export { GraphEdgeLayer } from "./edges/GraphEdgeLayer";
export type { GraphEdgeLayerProps } from "./edges/GraphEdgeLayer";
export {
  DEFAULT_EDGE_STYLES,
  EdgeStyleRegistry,
  defaultEdgeStyleRegistry,
} from "./edges/EdgeStyleRegistry";
export type { EdgeStyleDefinition } from "./edges/EdgeStyleRegistry";
export { planNodeRendering } from "./rendering/node-planner";
export { planEdgeRendering } from "./rendering/edge-planner";
export type {
  EdgeHead,
  EdgeLinePattern,
  EdgePathForm,
  EdgeRenderDiagnostic,
  EdgeRenderPlan,
  EdgeRouteMap,
  MeshPrimitive,
  NodeRenderPlan,
  PlannedEdgeBatch,
  PlannedEdgeHead,
  PlannedEdgeHeadBatch,
  PlannedEdgeSegment,
  PlannedNodeBatch,
  PlannedNodeInstance,
  PlannedNodeLabel,
  ResolvedEdgeStyle,
  SemanticRenderIdentity,
} from "./rendering/types";

export * from "./camera";
export * from "./interaction";
export * from "./labels";
export * from "./layout";
export * from "./lod";
export * from "./transactions";
export * from "./drilldown";
