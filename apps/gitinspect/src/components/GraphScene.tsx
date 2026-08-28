import { Canvas } from "@react-three/fiber";
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

import {
  ViewportCameraBridge,
  type ViewportTopologyFitRequest,
} from "./ViewportCameraBridge";
import {
  ViewportProjectionBridge,
  type ViewportProjectionPoint,
} from "./ViewportProjectionBridge";

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
  readonly onProjectionChange: (
    points: ReadonlyMap<ElementId, ViewportProjectionPoint>,
  ) => void;
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
}: GraphSceneProps) {
  return (
    <Canvas
      className="viewport__canvas"
      camera={{ position: cameraState.position, fov: 48, near: 0.1, far: visibilityRange.far }}
      dpr={[1, 1.75]}
    >
      <ViewportCameraBridge
        controller={controller}
        cameraState={cameraState}
        cameraMode={cameraMode}
        pointerMode={pointerMode}
        selectedElementId={selectedElementId}
        nodePositions={nodePositions}
        {...(topologyFit === undefined ? {} : { topologyFit })}
        onCameraStateChange={onCameraStateChange}
      />
      <ViewportProjectionBridge
        elementIds={projectedLabelIds}
        nodePositions={nodePositions}
        onProjectionChange={onProjectionChange}
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
  );
}
