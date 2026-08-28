import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { ElementId, Vec3 } from "@gitinspect/graph-elements";
import { Vector3, type Camera } from "three";

const PROJECTION_EPSILON_PERCENT = 0.05;

export interface ViewportProjectionPoint {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly visible: boolean;
}

interface ViewportProjectionBridgeProps {
  readonly elementIds: readonly ElementId[];
  readonly nodePositions: ReadonlyMap<ElementId, Vec3>;
  readonly onProjectionChange: (
    points: ReadonlyMap<ElementId, ViewportProjectionPoint>,
  ) => void;
}

/** Project the one authoritative GraphWorld coordinate through the active Three camera. */
export function projectWorldPosition(position: Vec3, camera: Camera): ViewportProjectionPoint {
  const projected = new Vector3(position[0], position[1], position[2]).project(camera);
  const x = (projected.x + 1) * 50;
  const y = (1 - projected.y) * 50;
  return Object.freeze({
    x,
    y,
    depth: projected.z,
    visible:
      projected.z >= -1 &&
      projected.z <= 1 &&
      x >= 0 &&
      x <= 100 &&
      y >= 0 &&
      y <= 100,
  });
}

export function sameViewportProjection(
  left: ReadonlyMap<ElementId, ViewportProjectionPoint>,
  right: ReadonlyMap<ElementId, ViewportProjectionPoint>,
  epsilon = PROJECTION_EPSILON_PERCENT,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, a] of left) {
    const b = right.get(id);
    if (!b) return false;
    if (
      a.visible !== b.visible ||
      Math.abs(a.x - b.x) > epsilon ||
      Math.abs(a.y - b.y) > epsilon ||
      Math.abs(a.depth - b.depth) > 0.001
    ) {
      return false;
    }
  }
  return true;
}

/**
 * DOM labels remain useful for crisp text and accessible hit surfaces, but they no longer own a
 * second layout. This bridge updates them only when the active camera projection actually changes.
 */
export function ViewportProjectionBridge({
  elementIds,
  nodePositions,
  onProjectionChange,
}: ViewportProjectionBridgeProps) {
  const { camera } = useThree();
  const previousRef = useRef<ReadonlyMap<ElementId, ViewportProjectionPoint>>(new Map());

  useFrame(() => {
    // ViewportCameraBridge mutates the active camera in-frame; refresh its world matrix before
    // deriving crisp DOM label positions so the overlay cannot trail authoritative GraphWorld.
    camera.updateMatrixWorld();
    const next = new Map<ElementId, ViewportProjectionPoint>();
    for (const id of elementIds) {
      const position = nodePositions.get(id);
      if (!position) continue;
      next.set(id, projectWorldPosition(position, camera));
    }
    if (sameViewportProjection(previousRef.current, next)) return;
    previousRef.current = next;
    onProjectionChange(next);
  });

  return null;
}
