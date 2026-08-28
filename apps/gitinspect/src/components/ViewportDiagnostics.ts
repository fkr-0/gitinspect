import type { ElementId, Vec3 } from "@gitinspect/graph-elements";

export type ViewportDiagnosticStage =
  | "viewport-render"
  | "scene-created"
  | "r3f-size"
  | "camera-restore"
  | "camera-intent"
  | "topology-fit"
  | "camera-frame"
  | "projection-frame"
  | "projection-publish";

export interface ViewportDiagnosticEvent {
  readonly stage: ViewportDiagnosticStage;
  readonly atMs: number;
  readonly visibilityState: string;
  readonly documentHasFocus: boolean;
  readonly selectedElementId?: ElementId;
  readonly authoritativeTransformedIds?: readonly ElementId[];
  readonly projectedLabelIds?: readonly ElementId[];
  readonly topologyFitKey?: string;
  readonly topologyFitTargetElementId?: ElementId;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly canvasWidth?: number;
  readonly canvasHeight?: number;
  readonly r3fWidth?: number;
  readonly r3fHeight?: number;
  readonly r3fAspect?: number;
  readonly cameraPosition?: Vec3;
  readonly cameraTarget?: Vec3;
  readonly cameraAttachedNodeId?: ElementId;
  readonly projectionPointCount?: number;
  readonly visibleProjectionCount?: number;
  readonly projectionPointIds?: readonly ElementId[];
  readonly visibleProjectionIds?: readonly ElementId[];
}

export type ViewportDiagnosticHandler = (event: ViewportDiagnosticEvent) => void;

export function viewportDiagnosticEnvironment() {
  return {
    atMs: typeof performance === "undefined" ? 0 : performance.now(),
    visibilityState: typeof document === "undefined" ? "unavailable" : document.visibilityState,
    documentHasFocus: typeof document !== "undefined" && document.hasFocus(),
  } as const;
}
