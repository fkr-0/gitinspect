import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type {
  CameraController,
  CameraMode,
  CameraState,
  ElementId,
  MouseMode,
  Vec3,
} from "@gitinspect/graph-elements";

import { fitGitCameraToBounds, type GitCameraFitBounds } from "./gitCameraFit";
import {
  type ViewportDiagnosticHandler,
  viewportDiagnosticEnvironment,
} from "./ViewportDiagnostics";

const DEFAULT_LOD_SAMPLE_DISTANCE = 8;
const LOOK_SENSITIVITY = 0.004;
const WHEEL_SENSITIVITY = 0.001;

export interface ViewportCameraIntent {
  readonly cameraMode: CameraMode;
  readonly pointerMode: MouseMode;
  readonly selectedElementId: ElementId | undefined;
  readonly nodePositions: ReadonlyMap<ElementId, Vec3>;
}

export function observeReducedMotion(
  query: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">,
  onChange: (reduced: boolean) => void,
): () => void {
  const update = () => onChange(query.matches);
  query.addEventListener("change", update);
  update();
  return () => query.removeEventListener("change", update);
}

export function applyViewportTopologyFit(
  controller: CameraController,
  request: ViewportTopologyFitRequest,
  nodePositions: ReadonlyMap<ElementId, Vec3>,
  viewportAspect: number,
  pointerMode: MouseMode,
): CameraState {
  const target =
    request.targetElementId === undefined ? undefined : nodePositions.get(request.targetElementId);
  const fitted = fitGitCameraToBounds(request.bounds, viewportAspect, {
    ...(target === undefined ? {} : { target }),
    ...(target === undefined || request.targetElementId === undefined
      ? {}
      : { attachedNodeId: request.targetElementId }),
  });
  controller.restore(fitted.camera);
  controller.setMouseMode(pointerMode);
  return controller.snapshot();
}

export interface ViewportTopologyFitRequest {
  readonly key: string;
  readonly bounds: GitCameraFitBounds;
  readonly targetElementId?: ElementId;
}

interface ViewportCameraBridgeProps extends ViewportCameraIntent {
  readonly recoveryAttempt?: number;
  readonly controller: CameraController;
  readonly cameraState: CameraState;
  readonly topologyFit?: ViewportTopologyFitRequest;
  readonly onCameraStateChange: (camera: CameraState) => void;
  readonly onDiagnosticEvent?: ViewportDiagnosticHandler;
}

function samePosition(left: Vec3, right: Vec3): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

export function cameraProjectionSampleChanged(
  previous: Vec3,
  next: Vec3,
  minimumDistance = DEFAULT_LOD_SAMPLE_DISTANCE,
): boolean {
  if (minimumDistance <= 0) return !samePosition(previous, next);
  return (
    Math.hypot(next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]) >=
    minimumDistance
  );
}

/**
 * Apply app-owned interaction intent to the generic camera controller.
 * Semantic adjacency/traversal policy stays with the caller; this adapter only
 * attaches to the already-resolved selected render identity when it is present.
 */
export function applyViewportCameraIntent(
  controller: CameraController,
  intent: ViewportCameraIntent,
): CameraState {
  controller.setMouseMode(intent.pointerMode);
  const snapshot = controller.snapshot();

  if (intent.cameraMode === "free-flight") {
    if (snapshot.mode !== "free-flight") controller.enterFreeFlight();
    return controller.snapshot();
  }

  const selectedId = intent.selectedElementId;
  const target = selectedId === undefined ? undefined : intent.nodePositions.get(selectedId);
  if (target === undefined || selectedId === undefined) {
    if (snapshot.mode !== "attached") controller.enterAttached();
    return controller.snapshot();
  }

  if (snapshot.mode !== "attached" || snapshot.attachedNodeId === undefined) {
    controller.returnToAttached({ nodeId: selectedId, target });
    return controller.snapshot();
  }

  if (snapshot.attachedNodeId !== selectedId || !samePosition(snapshot.target, target)) {
    controller.traverseTo({ nodeId: selectedId, target });
  }
  return controller.snapshot();
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

export function ViewportCameraBridge({
  recoveryAttempt,
  controller,
  cameraState,
  cameraMode,
  pointerMode,
  selectedElementId,
  nodePositions,
  topologyFit,
  onCameraStateChange,
  onDiagnosticEvent,
}: ViewportCameraBridgeProps) {
  const { camera, gl, size } = useThree();
  const keysRef = useRef(new Set<string>());
  const pendingLookRef = useRef<[number, number]>([0, 0]);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef<[number, number] | undefined>(undefined);
  const lastTopologyFitKeyRef = useRef<string | undefined>(undefined);
  const diagnosticFrameCountRef = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    return observeReducedMotion(query, (reduced) => {
      reducedMotionRef.current = reduced;
    });
  }, []);

  useEffect(() => {
    if (recoveryAttempt === undefined || recoveryAttempt === 0) return;
    const restored = controller.snapshot();
    camera.position.set(...restored.position);
    camera.lookAt(...restored.target);
    onCameraStateChange(restored);
  }, [camera, controller, onCameraStateChange, recoveryAttempt]);

  useEffect(() => {
    diagnosticFrameCountRef.current = 0;
    if (!onDiagnosticEvent) return;
    const rect = gl.domElement.getBoundingClientRect();
    onDiagnosticEvent({
      stage: "r3f-size",
      ...viewportDiagnosticEnvironment(),
      ...(selectedElementId ? { selectedElementId } : {}),
      ...(topologyFit?.key ? { topologyFitKey: topologyFit.key } : {}),
      ...(topologyFit?.targetElementId
        ? { topologyFitTargetElementId: topologyFit.targetElementId }
        : {}),
      r3fWidth: size.width,
      r3fHeight: size.height,
      r3fAspect: size.height > 0 ? size.width / size.height : 0,
      canvasWidth: rect.width,
      canvasHeight: rect.height,
    });
  }, [gl, onDiagnosticEvent, selectedElementId, size.height, size.width, topologyFit]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally narrow — restores camera state only on external cameraState changes
  useEffect(() => {
    controller.restore(cameraState);
    const next = applyViewportCameraIntent(controller, {
      cameraMode,
      pointerMode,
      selectedElementId,
      nodePositions,
    });
    onDiagnosticEvent?.({
      stage: "camera-restore",
      ...viewportDiagnosticEnvironment(),
      ...(selectedElementId ? { selectedElementId } : {}),
      cameraPosition: [...next.position],
      cameraTarget: [...next.target],
      ...(next.attachedNodeId ? { cameraAttachedNodeId: next.attachedNodeId } : {}),
      ...(topologyFit?.key ? { topologyFitKey: topologyFit.key } : {}),
    });
    onCameraStateChange(next);
  }, [cameraState, controller]);

  useEffect(() => {
    const next = applyViewportCameraIntent(controller, {
      cameraMode,
      pointerMode,
      selectedElementId,
      nodePositions,
    });
    onDiagnosticEvent?.({
      stage: "camera-intent",
      ...viewportDiagnosticEnvironment(),
      ...(selectedElementId ? { selectedElementId } : {}),
      cameraPosition: [...next.position],
      cameraTarget: [...next.target],
      ...(next.attachedNodeId ? { cameraAttachedNodeId: next.attachedNodeId } : {}),
    });
    onCameraStateChange(next);
  }, [
    cameraMode,
    controller,
    nodePositions,
    onCameraStateChange,
    onDiagnosticEvent,
    pointerMode,
    selectedElementId,
  ]);

  useEffect(() => {
    if (
      cameraMode !== "attached" ||
      topologyFit === undefined ||
      lastTopologyFitKeyRef.current === topologyFit.key
    ) {
      return;
    }
    lastTopologyFitKeyRef.current = topologyFit.key;
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const next = applyViewportTopologyFit(
      controller,
      topologyFit,
      nodePositions,
      aspect,
      pointerMode,
    );
    onDiagnosticEvent?.({
      stage: "topology-fit",
      ...viewportDiagnosticEnvironment(),
      ...(selectedElementId ? { selectedElementId } : {}),
      topologyFitKey: topologyFit.key,
      ...(topologyFit.targetElementId
        ? { topologyFitTargetElementId: topologyFit.targetElementId }
        : {}),
      r3fWidth: size.width,
      r3fHeight: size.height,
      r3fAspect: aspect,
      cameraPosition: [...next.position],
      cameraTarget: [...next.target],
      ...(next.attachedNodeId ? { cameraAttachedNodeId: next.attachedNodeId } : {}),
    });
    onCameraStateChange(next);
  }, [
    cameraMode,
    controller,
    nodePositions,
    onCameraStateChange,
    onDiagnosticEvent,
    pointerMode,
    selectedElementId,
    size.height,
    size.width,
    topologyFit,
  ]);

  useEffect(() => {
    const canvas = gl.domElement;
    const previousCursor = canvas.style.cursor;

    if (pointerMode !== "camera") {
      keysRef.current.clear();
      pendingLookRef.current = [0, 0];
      draggingRef.current = false;
      lastPointerRef.current = undefined;
      canvas.style.cursor = "default";
      if (typeof document !== "undefined" && document.pointerLockElement === canvas) {
        document.exitPointerLock?.();
      }
      return () => {
        canvas.style.cursor = previousCursor;
      };
    }

    canvas.style.cursor = "grab";
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      draggingRef.current = true;
      lastPointerRef.current = [event.clientX, event.clientY];
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture?.(event.pointerId);
      const pointerLock = canvas.requestPointerLock?.();
      if (pointerLock && typeof pointerLock.catch === "function") {
        void pointerLock.catch(() => undefined);
      }
    };
    const endPointer = (event: PointerEvent) => {
      draggingRef.current = false;
      lastPointerRef.current = undefined;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture?.(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const locked = typeof document !== "undefined" && document.pointerLockElement === canvas;
      if (!locked && !draggingRef.current) return;
      const previous = lastPointerRef.current;
      const deltaX = locked
        ? event.movementX
        : previous === undefined
          ? 0
          : event.clientX - previous[0];
      const deltaY = locked
        ? event.movementY
        : previous === undefined
          ? 0
          : event.clientY - previous[1];
      lastPointerRef.current = [event.clientX, event.clientY];
      if (cameraMode === "attached") {
        controller.orbit(-deltaX * LOOK_SENSITIVITY, -deltaY * LOOK_SENSITIVITY);
      } else {
        pendingLookRef.current[0] -= deltaX * LOOK_SENSITIVITY;
        pendingLookRef.current[1] -= deltaY * LOOK_SENSITIVITY;
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (cameraMode !== "attached") return;
      event.preventDefault();
      controller.zoomBy(Math.exp(-event.deltaY * WHEEL_SENSITIVITY));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      keysRef.current.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.code);
    };
    const onBlur = () => keysRef.current.clear();

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPointer);
      canvas.removeEventListener("pointercancel", endPointer);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      keysRef.current.clear();
      pendingLookRef.current = [0, 0];
      draggingRef.current = false;
      lastPointerRef.current = undefined;
      canvas.style.cursor = previousCursor;
      if (typeof document !== "undefined" && document.pointerLockElement === canvas) {
        document.exitPointerLock?.();
      }
    };
  }, [cameraMode, controller, gl, pointerMode]);

  useFrame((_, deltaSeconds) => {
    const keys = keysRef.current;
    const movement: Vec3 =
      pointerMode === "camera" && cameraMode === "free-flight"
        ? [
            Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
            Number(keys.has("KeyE")) - Number(keys.has("KeyQ")),
            Number(keys.has("KeyW")) - Number(keys.has("KeyS")),
          ]
        : [0, 0, 0];
    const look = pendingLookRef.current;
    pendingLookRef.current = [0, 0];
    const reduced = reducedMotionRef.current;
    const snapshot = controller.tick(
      reduced && cameraMode === "attached" ? 1_000_000 : Math.min(Math.max(deltaSeconds, 0), 0.1),
      {
        movement,
        look: [look[0], look[1]],
        speedScale: keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1,
      },
    );

    camera.position.set(...snapshot.position);
    camera.lookAt(...snapshot.target);
    if (onDiagnosticEvent && diagnosticFrameCountRef.current < 12) {
      diagnosticFrameCountRef.current += 1;
      onDiagnosticEvent({
        stage: "camera-frame",
        ...viewportDiagnosticEnvironment(),
        ...(selectedElementId ? { selectedElementId } : {}),
        ...(topologyFit?.key ? { topologyFitKey: topologyFit.key } : {}),
        r3fWidth: size.width,
        r3fHeight: size.height,
        r3fAspect: size.height > 0 ? size.width / size.height : 0,
        cameraPosition: [...snapshot.position],
        cameraTarget: [...snapshot.target],
        ...(snapshot.attachedNodeId ? { cameraAttachedNodeId: snapshot.attachedNodeId } : {}),
      });
    }
    onCameraStateChange(snapshot);
  });

  return null;
}
