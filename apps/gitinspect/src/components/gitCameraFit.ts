import type { CameraState, ElementId, Vec3 } from "@gitinspect/graph-elements";

export interface GitCameraFitBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface GitCameraFitOptions {
  readonly fovDegrees?: number;
  readonly padding?: number;
  readonly minDistance?: number;
  readonly maxDistance?: number;
  readonly attachedNodeId?: ElementId;
  readonly target?: Vec3;
}

export interface GitCameraFitResult {
  readonly camera: CameraState;
  readonly distance: number;
  readonly aspect: number;
  readonly bounds: GitCameraFitBounds;
}

const DEFAULT_FOV_DEGREES = 48;
const DEFAULT_PADDING = 1.18;
const DEFAULT_MIN_DISTANCE = 8;
const DEFAULT_MAX_DISTANCE = 6_400;
const MIN_CONTEXT_FRACTION = 0.58;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function center(bounds: GitCameraFitBounds): Vec3 {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

function span(bounds: GitCameraFitBounds): Vec3 {
  return [
    Math.max(0, bounds.max[0] - bounds.min[0]),
    Math.max(0, bounds.max[1] - bounds.min[1]),
    Math.max(0, bounds.max[2] - bounds.min[2]),
  ];
}

export function gitCameraBoundsForPositions(
  positions: ReadonlyMap<ElementId, Vec3>,
  ids?: ReadonlySet<ElementId>,
): GitCameraFitBounds | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let count = 0;
  for (const [id, position] of positions) {
    if (ids !== undefined && !ids.has(id)) continue;
    minX = Math.min(minX, position[0]);
    minY = Math.min(minY, position[1]);
    minZ = Math.min(minZ, position[2]);
    maxX = Math.max(maxX, position[0]);
    maxY = Math.max(maxY, position[1]);
    maxZ = Math.max(maxZ, position[2]);
    count += 1;
  }
  if (count === 0) return undefined;
  const min: Vec3 = [minX, minY, minZ];
  const max: Vec3 = [maxX, maxY, maxZ];
  return Object.freeze({ min, max });
}

export function gitTopologyVisibilityRange(bounds: GitCameraFitBounds): Readonly<{
  far: number;
  fogNear: number;
  fogFar: number;
}> {
  const boundsSpan = span(bounds);
  const fieldSpan = Math.max(boundsSpan[0], boundsSpan[1], boundsSpan[2]);
  return Object.freeze({
    far: Math.max(500, fieldSpan * 3 + 100),
    fogNear: Math.max(22, fieldSpan * 0.6),
    fogFar: Math.max(80, fieldSpan * 2.5 + 80),
  });
}

/**
 * A selected neighborhood remains centered on its own topology but cannot collapse into a
 * tunnel-vision framing: each axis keeps a deterministic fraction of the repository overview.
 */
export function contextualGitCameraBounds(
  overview: GitCameraFitBounds,
  focus: GitCameraFitBounds,
  minimumContextFraction = MIN_CONTEXT_FRACTION,
): GitCameraFitBounds {
  const safeFraction = clamp(minimumContextFraction, 0, 1);
  const overviewSpan = span(overview);
  const focusSpan = span(focus);
  const focusCenter = center(focus);
  const half: Vec3 = [
    Math.max(focusSpan[0] / 2, (overviewSpan[0] * safeFraction) / 2),
    Math.max(focusSpan[1] / 2, (overviewSpan[1] * safeFraction) / 2),
    Math.max(focusSpan[2] / 2, (overviewSpan[2] * safeFraction) / 2),
  ];
  const min: Vec3 = [
    focusCenter[0] - half[0],
    focusCenter[1] - half[1],
    focusCenter[2] - half[2],
  ];
  const max: Vec3 = [
    focusCenter[0] + half[0],
    focusCenter[1] + half[1],
    focusCenter[2] + half[2],
  ];
  return Object.freeze({ min, max });
}

/**
 * Fit a Railfield from +Z. X therefore stays oldest→newest left-to-right and Y remains the
 * branch-lane axis; semantic Z depth only contributes to the required camera distance.
 */
export function fitGitCameraToBounds(
  bounds: GitCameraFitBounds,
  viewportAspect: number,
  options: GitCameraFitOptions = {},
): GitCameraFitResult {
  const aspect = finitePositive(viewportAspect, 1);
  const fovDegrees = clamp(finitePositive(options.fovDegrees, DEFAULT_FOV_DEGREES), 5, 120);
  const padding = finitePositive(options.padding, DEFAULT_PADDING);
  const minDistance = finitePositive(options.minDistance, DEFAULT_MIN_DISTANCE);
  const maxDistance = Math.max(
    minDistance,
    finitePositive(options.maxDistance, DEFAULT_MAX_DISTANCE),
  );
  const halfFov = (fovDegrees * Math.PI) / 360;
  const tangent = Math.max(1e-6, Math.tan(halfFov));
  const target = options.target ?? center(bounds);
  const halfX = Math.max(
    0.6,
    Math.abs(bounds.min[0] - target[0]),
    Math.abs(bounds.max[0] - target[0]),
  );
  const halfY = Math.max(
    0.6,
    Math.abs(bounds.min[1] - target[1]),
    Math.abs(bounds.max[1] - target[1]),
  );
  const halfZ = Math.max(
    Math.abs(bounds.min[2] - target[2]),
    Math.abs(bounds.max[2] - target[2]),
  );
  const distanceForWidth = halfX / (tangent * aspect);
  const distanceForHeight = halfY / tangent;
  const distance = clamp(
    halfZ + Math.max(distanceForWidth, distanceForHeight) * padding + 1,
    minDistance,
    maxDistance,
  );
  const camera: CameraState = {
    mode: "attached",
    position: [target[0], target[1], target[2] + distance],
    target,
    ...(options.attachedNodeId === undefined ? {} : { attachedNodeId: options.attachedNodeId }),
    zoom: 1,
  };
  return Object.freeze({ camera: Object.freeze(camera), distance, aspect, bounds });
}

export function isInheritedCinematicCamera(camera: CameraState): boolean {
  return (
    camera.mode === "attached" &&
    camera.attachedNodeId === undefined &&
    camera.zoom === 1 &&
    camera.position[0] === 10 &&
    camera.position[1] === 6 &&
    camera.position[2] === 16 &&
    camera.target[0] === 0 &&
    camera.target[1] === 0 &&
    camera.target[2] === 0
  );
}
