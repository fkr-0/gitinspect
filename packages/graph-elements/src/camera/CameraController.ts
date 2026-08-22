import type { CameraMode, CameraState, ElementId, Vec3 } from "@gitinspect/contracts";

export type MouseMode = "camera" | "cursor";

export interface CameraOrientation {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export interface CameraControllerSnapshot extends CameraState {
  readonly orientation: CameraOrientation;
  readonly velocity: Vec3;
  readonly mouseMode: MouseMode;
  readonly transitioning: boolean;
}

export interface CameraControllerOptions {
  readonly acceleration?: number;
  readonly damping?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly maxPitchRadians?: number;
  readonly traversalDurationSeconds?: number;
}

export interface AttachRequest {
  readonly nodeId: ElementId;
  readonly target: Vec3;
}

export interface TraverseRequest extends AttachRequest {
  readonly durationSeconds?: number;
}

export interface FreeFlightInput {
  /** Local-space movement: x=right, y=up, z=forward. */
  readonly movement?: Vec3;
  /** Look deltas in radians. Roll is optional but retained in controller state. */
  readonly look?: readonly [yaw: number, pitch: number, roll?: number];
  readonly speedScale?: number;
  /** Caller-supplied scene scale, useful for macro/micro world traversal. */
  readonly worldScale?: number;
}

interface MutableCameraState {
  mode: CameraMode;
  position: Vec3;
  target: Vec3;
  attachedNodeId: ElementId | undefined;
  zoom: number;
  orientation: CameraOrientation;
  velocity: Vec3;
  mouseMode: MouseMode;
}

interface TraversalTransition {
  readonly nodeId: ElementId;
  readonly fromPosition: Vec3;
  readonly fromTarget: Vec3;
  readonly toPosition: Vec3;
  readonly toTarget: Vec3;
  readonly durationSeconds: number;
  elapsedSeconds: number;
}

const DEFAULT_OPTIONS: Required<CameraControllerOptions> = {
  acceleration: 18,
  damping: 7,
  minZoom: 0.1,
  maxZoom: 32,
  maxPitchRadians: Math.PI / 2 - 0.01,
  traversalDurationSeconds: 0.35,
};

const EPSILON = 1e-9;

export class CameraController {
  private readonly options: Required<CameraControllerOptions>;
  private state: MutableCameraState;
  private transition: TraversalTransition | undefined;
  private attachedDistance: number;

  public constructor(initial: CameraState, options: CameraControllerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    const orientation = orientationFromDirection(sub(initial.target, initial.position));
    this.attachedDistance =
      Math.max(EPSILON, distance(initial.position, initial.target)) *
      clamp(initial.zoom, this.options.minZoom, this.options.maxZoom);
    this.state = {
      mode: initial.mode,
      position: copy(initial.position),
      target: copy(initial.target),
      attachedNodeId: initial.mode === "attached" ? initial.attachedNodeId : undefined,
      zoom: clamp(initial.zoom, this.options.minZoom, this.options.maxZoom),
      orientation,
      velocity: [0, 0, 0],
      mouseMode: "camera",
    };
  }

  public snapshot(): CameraControllerSnapshot {
    const base = {
      mode: this.state.mode,
      position: copy(this.state.position),
      target: copy(this.state.target),
      zoom: this.state.zoom,
      orientation: { ...this.state.orientation },
      velocity: copy(this.state.velocity),
      mouseMode: this.state.mouseMode,
      transitioning: this.transition !== undefined,
    };
    return this.state.attachedNodeId === undefined
      ? base
      : { ...base, attachedNodeId: this.state.attachedNodeId };
  }

  public setMouseMode(mode: MouseMode): void {
    this.state.mouseMode = mode;
  }

  public toggleMouseMode(): MouseMode {
    this.state.mouseMode = this.state.mouseMode === "camera" ? "cursor" : "camera";
    return this.state.mouseMode;
  }

  public attachTo(request: AttachRequest): void {
    this.transition = undefined;
    const offset = sub(this.state.position, this.state.target);
    this.state.mode = "attached";
    this.state.target = copy(request.target);
    this.state.position = add(request.target, offset);
    this.state.attachedNodeId = request.nodeId;
    this.state.velocity = [0, 0, 0];
    this.attachedDistance = Math.max(EPSILON, length(offset)) * this.state.zoom;
  }

  /**
   * Traverse to a caller-selected node. Adjacency and graph semantics intentionally
   * stay outside the camera controller.
   */
  public traverseTo(request: TraverseRequest): void {
    if (this.state.mode !== "attached") {
      throw new Error("Camera traversal requires attached mode");
    }

    const durationSeconds = request.durationSeconds ?? this.options.traversalDurationSeconds;
    if (durationSeconds <= 0) {
      this.attachTo(request);
      return;
    }

    const offset = sub(this.state.position, this.state.target);
    this.transition = {
      nodeId: request.nodeId,
      fromPosition: copy(this.state.position),
      fromTarget: copy(this.state.target),
      toPosition: add(request.target, offset),
      toTarget: copy(request.target),
      durationSeconds,
      elapsedSeconds: 0,
    };
  }

  public orbit(deltaYaw: number, deltaPitch: number): void {
    if (this.state.mode !== "attached") {
      return;
    }
    this.transition = undefined;
    this.state.orientation = {
      ...this.state.orientation,
      yaw: normalizeAngle(this.state.orientation.yaw + deltaYaw),
      pitch: clamp(
        this.state.orientation.pitch + deltaPitch,
        -this.options.maxPitchRadians,
        this.options.maxPitchRadians,
      ),
    };
    this.repositionAttachedCamera();
  }

  /** A factor >1 zooms in; a factor <1 zooms out. */
  public zoomBy(factor: number): number {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error("Zoom factor must be a positive finite number");
    }
    this.state.zoom = clamp(
      this.state.zoom * factor,
      this.options.minZoom,
      this.options.maxZoom,
    );
    if (this.state.mode === "attached") {
      this.transition = undefined;
      this.repositionAttachedCamera();
    }
    return this.state.zoom;
  }

  public enterFreeFlight(): void {
    this.transition = undefined;
    this.state.mode = "free-flight";
    this.state.attachedNodeId = undefined;
    this.state.velocity = [0, 0, 0];
  }

  /** Focuses a world-space point while preserving the current orientation frame. */
  public focus(point: Vec3, distanceFromPoint = this.attachedDistance / this.state.zoom): void {
    const safeDistance = Math.max(EPSILON, distanceFromPoint);
    const forward = forwardVector(this.state.orientation);
    this.state.target = copy(point);
    this.state.position = sub(point, scale(forward, safeDistance));
    this.state.velocity = [0, 0, 0];
  }

  public focusElement(point: Vec3, distanceFromPoint?: number): void {
    if (distanceFromPoint === undefined) this.focus(point);
    else this.focus(point, distanceFromPoint);
  }

  public returnToAttached(request: AttachRequest): void {
    this.attachTo(request);
  }

  public tick(deltaSeconds: number, input: FreeFlightInput = {}): CameraControllerSnapshot {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new Error("deltaSeconds must be a non-negative finite number");
    }

    if (this.transition !== undefined) {
      this.advanceTraversal(deltaSeconds);
    }

    if (this.state.mode === "free-flight") {
      this.advanceFreeFlight(deltaSeconds, input);
    }

    return this.snapshot();
  }

  private advanceTraversal(deltaSeconds: number): void {
    const transition = this.transition;
    if (transition === undefined) return;

    transition.elapsedSeconds += deltaSeconds;
    const t = clamp(transition.elapsedSeconds / transition.durationSeconds, 0, 1);
    const eased = t * t * (3 - 2 * t);
    this.state.position = lerp(transition.fromPosition, transition.toPosition, eased);
    this.state.target = lerp(transition.fromTarget, transition.toTarget, eased);

    if (t >= 1) {
      this.state.attachedNodeId = transition.nodeId;
      this.attachedDistance =
        Math.max(EPSILON, distance(this.state.position, this.state.target)) * this.state.zoom;
      this.transition = undefined;
    }
  }

  private advanceFreeFlight(deltaSeconds: number, input: FreeFlightInput): void {
    const look = input.look ?? [0, 0, 0];
    this.state.orientation = {
      yaw: normalizeAngle(this.state.orientation.yaw + look[0]),
      pitch: clamp(
        this.state.orientation.pitch + look[1],
        -this.options.maxPitchRadians,
        this.options.maxPitchRadians,
      ),
      roll: normalizeAngle(this.state.orientation.roll + (look[2] ?? 0)),
    };

    const movement = input.movement ?? [0, 0, 0];
    const speedScale = Math.max(0, input.speedScale ?? 1);
    const worldScale = Math.max(0, input.worldScale ?? 1);
    const worldAcceleration = localMovementToWorld(movement, this.state.orientation);
    this.state.velocity = add(
      this.state.velocity,
      scale(
        worldAcceleration,
        this.options.acceleration * speedScale * worldScale * deltaSeconds,
      ),
    );

    this.state.position = add(this.state.position, scale(this.state.velocity, deltaSeconds));
    const decay = Math.exp(-this.options.damping * deltaSeconds);
    this.state.velocity = scale(this.state.velocity, decay);
    this.state.target = add(this.state.position, forwardVector(this.state.orientation));
  }

  private repositionAttachedCamera(): void {
    const distanceFromTarget = this.attachedDistance / this.state.zoom;
    this.state.position = sub(
      this.state.target,
      scale(forwardVector(this.state.orientation), distanceFromTarget),
    );
  }
}

function localMovementToWorld(movement: Vec3, orientation: CameraOrientation): Vec3 {
  const forward = forwardVector(orientation);
  const right: Vec3 = [Math.cos(orientation.yaw), 0, -Math.sin(orientation.yaw)];
  const up = normalize(cross(forward, right));
  return add(add(scale(right, movement[0]), scale(up, movement[1])), scale(forward, movement[2]));
}

function orientationFromDirection(direction: Vec3): CameraOrientation {
  const normalized = normalize(direction);
  return {
    yaw: Math.atan2(normalized[0], normalized[2]),
    pitch: Math.asin(clamp(normalized[1], -1, 1)),
    roll: 0,
  };
}

function forwardVector(orientation: CameraOrientation): Vec3 {
  const cosPitch = Math.cos(orientation.pitch);
  return [
    Math.sin(orientation.yaw) * cosPitch,
    Math.sin(orientation.pitch),
    Math.cos(orientation.yaw) * cosPitch,
  ];
}

function normalizeAngle(angle: number): number {
  let result = angle % (Math.PI * 2);
  if (result > Math.PI) result -= Math.PI * 2;
  if (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function copy(value: Vec3): Vec3 {
  return [value[0], value[1], value[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(value: Vec3, scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function length(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

function normalize(value: Vec3): Vec3 {
  const magnitude = length(value);
  return magnitude <= EPSILON ? [0, 0, 1] : scale(value, 1 / magnitude);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
