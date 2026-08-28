import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";

import { projectWorldPosition, sameViewportProjection } from "./ViewportProjectionBridge";

function camera(): PerspectiveCamera {
  const result = new PerspectiveCamera(50, 2, 0.1, 100);
  result.position.set(0, 0, 10);
  result.lookAt(0, 0, 0);
  result.updateProjectionMatrix();
  result.updateMatrixWorld(true);
  return result;
}

describe("ViewportProjectionBridge", () => {
  it("projects the authoritative world origin to the active camera center", () => {
    expect(projectWorldPosition([0, 0, 0], camera())).toMatchObject({
      x: 50,
      y: 50,
      visible: true,
    });
  });

  it("moves DOM coordinates when the camera projection changes instead of hashing identity", () => {
    const firstCamera = camera();
    const secondCamera = camera();
    secondCamera.position.set(4, 0, 10);
    secondCamera.lookAt(0, 0, 0);
    secondCamera.updateMatrixWorld(true);

    const first = projectWorldPosition([2, 0, 0], firstCamera);
    const second = projectWorldPosition([2, 0, 0], secondCamera);
    expect(first.visible).toBe(true);
    expect(second.visible).toBe(true);
    expect(first.x).not.toBe(second.x);
  });

  it("suppresses sub-pixel-equivalent frame churn while detecting meaningful projection changes", () => {
    const base = new Map([
      ["commit:a", { x: 50, y: 50, depth: 0.5, visible: true }],
    ] as const);
    const tiny = new Map([
      ["commit:a", { x: 50.02, y: 49.98, depth: 0.5005, visible: true }],
    ] as const);
    const moved = new Map([
      ["commit:a", { x: 52, y: 50, depth: 0.5, visible: true }],
    ] as const);

    expect(sameViewportProjection(base, tiny)).toBe(true);
    expect(sameViewportProjection(base, moved)).toBe(false);
  });
});
