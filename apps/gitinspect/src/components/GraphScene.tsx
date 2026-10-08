import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import {
  GraphWorld,
  type CameraController,
  type CameraMode,
  type CameraState,
  type DataMapper,
  type EdgeRouteMap,
  type EdgeStyleRegistry,
  type ElementId,
  type GraphDataset,
  type GraphEdgeInteractionHandlers,
  type GraphNodeInteractionHandlers,
  type MouseMode,
  type Vec3,
} from "@gitinspect/graph-elements";

import { ViewportCameraBridge, type ViewportTopologyFitRequest } from "./ViewportCameraBridge";
import { ViewportProjectionBridge, type ViewportProjectionPoint } from "./ViewportProjectionBridge";
import {
  type ViewportDiagnosticHandler,
  viewportDiagnosticEnvironment,
} from "./ViewportDiagnostics";

export interface GraphSceneProps {
  readonly dataset: GraphDataset;
  readonly mapper: DataMapper;
  readonly nodePositions: ReadonlyMap<ElementId, Vec3>;
  readonly edgeRoutes: EdgeRouteMap;
  readonly edgeStyleRegistry: EdgeStyleRegistry;
  readonly controller: CameraController;
  readonly cameraState: CameraState;
  readonly cameraMode: CameraMode;
  readonly pointerMode: MouseMode;
  readonly selectedElementId: ElementId | undefined;
  readonly topologyFit?: ViewportTopologyFitRequest;
  readonly projectedLabelIds: readonly ElementId[];
  readonly visibilityRange: {
    readonly far: number;
    readonly fogNear: number;
    readonly fogFar: number;
  };
  readonly nodeInteraction?: GraphNodeInteractionHandlers;
  readonly edgeInteraction?: GraphEdgeInteractionHandlers;
  readonly onCameraStateChange: (camera: CameraState) => void;
  readonly onProjectionChange: (points: ReadonlyMap<ElementId, ViewportProjectionPoint>) => void;
  readonly onDiagnosticEvent?: ViewportDiagnosticHandler;
}

/** Bind context lifecycle to an actual canvas, permitting browser restoration. */
export function bindWebGLContextLifecycle(
  canvas: HTMLCanvasElement,
  onLost: () => void,
  onRestored: () => void,
): () => void {
  const lost = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  return () => {
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
  };
}

/**
 * Heavy WebGL/R3F scene boundary. GraphViewport intentionally lazy-loads this
 * component so repository navigation, inspection, and accessible shell UI can
 * become interactive without downloading Three.js first.
 */
export function GraphScene({
  dataset,
  mapper,
  nodePositions,
  edgeRoutes,
  edgeStyleRegistry,
  controller,
  cameraState,
  cameraMode,
  pointerMode,
  selectedElementId,
  topologyFit,
  projectedLabelIds,
  visibilityRange,
  nodeInteraction,
  edgeInteraction,
  onCameraStateChange,
  onProjectionChange,
  onDiagnosticEvent,
}: GraphSceneProps) {
  const [contextLost, setContextLost] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasElement;
    if (!canvas) return;
    return bindWebGLContextLifecycle(
      canvas,
      () => setContextLost(true),
      () => {
        setContextLost(false);
        setRecoveryAttempt((attempt) => attempt + 1);
      },
    );
  }, [canvasElement]);
  return (
    <div
      className="viewport__scene"
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <Canvas
        className="viewport__canvas"
        camera={{ position: cameraState.position, fov: 48, near: 0.1, far: visibilityRange.far }}
        dpr={[1, 1.75]}
        onCreated={(state) => {
          setCanvasElement(state.gl.domElement);
          if (!onDiagnosticEvent) return;
          const rect = state.gl.domElement.getBoundingClientRect();
          onDiagnosticEvent({
            stage: "scene-created",
            ...viewportDiagnosticEnvironment(),
            ...(selectedElementId ? { selectedElementId } : {}),
            projectedLabelIds: projectedLabelIds.slice(0, 48),
            ...(topologyFit?.key ? { topologyFitKey: topologyFit.key } : {}),
            ...(topologyFit?.targetElementId
              ? { topologyFitTargetElementId: topologyFit.targetElementId }
              : {}),
            r3fWidth: state.size.width,
            r3fHeight: state.size.height,
            r3fAspect: state.size.height > 0 ? state.size.width / state.size.height : 0,
            canvasWidth: rect.width,
            canvasHeight: rect.height,
            cameraPosition: [
              state.camera.position.x,
              state.camera.position.y,
              state.camera.position.z,
            ],
          });
        }}
      >
        <ViewportCameraBridge
          recoveryAttempt={recoveryAttempt}
          controller={controller}
          cameraState={cameraState}
          cameraMode={cameraMode}
          pointerMode={pointerMode}
          selectedElementId={selectedElementId}
          nodePositions={nodePositions}
          {...(topologyFit === undefined ? {} : { topologyFit })}
          onCameraStateChange={onCameraStateChange}
          {...(onDiagnosticEvent ? { onDiagnosticEvent } : {})}
        />
        <ViewportProjectionBridge
          elementIds={projectedLabelIds}
          nodePositions={nodePositions}
          onProjectionChange={onProjectionChange}
          {...(onDiagnosticEvent ? { onDiagnosticEvent } : {})}
        />
        <GraphWorld
          dataset={dataset}
          mapper={mapper}
          nodePositions={nodePositions}
          edgeRoutes={edgeRoutes}
          edgeStyleRegistry={edgeStyleRegistry}
          background={{
            color: "#080b0f",
            fog: {
              color: "#080b0f",
              near: visibilityRange.fogNear,
              far: visibilityRange.fogFar,
            },
          }}
          {...(nodeInteraction === undefined ? {} : { nodeInteraction })}
          {...(edgeInteraction === undefined ? {} : { edgeInteraction })}
        />
      </Canvas>
      {contextLost && (
        <div
          role="alert"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeContent: "center",
            padding: 24,
            background: "#080b0f",
            color: "#fff",
            textAlign: "center",
            zIndex: 2,
          }}
        >
          <strong>3D graphics context lost</strong>
          <p>
            The browser is restoring WebGL. Repository data is safe; the scene will return when
            restoration succeeds.
          </p>
        </div>
      )}
    </div>
  );
}
