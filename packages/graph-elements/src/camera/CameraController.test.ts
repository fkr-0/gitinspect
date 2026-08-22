import { describe, expect, it } from "vitest";

import { CameraController } from "./CameraController";

describe("CameraController", () => {
  it("traverses between caller-selected attached nodes without changing orientation", () => {
    const camera = new CameraController({
      mode: "attached",
      position: [0, 0, -10],
      target: [0, 0, 0],
      attachedNodeId: "a",
      zoom: 1,
    });
    const before = camera.snapshot().orientation;

    camera.traverseTo({ nodeId: "b", target: [10, 2, 4], durationSeconds: 1 });
    const halfway = camera.tick(0.5);
    expect(halfway.transitioning).toBe(true);
    expect(halfway.target).toEqual([5, 1, 2]);
    expect(halfway.orientation).toEqual(before);

    const complete = camera.tick(0.5);
    expect(complete.transitioning).toBe(false);
    expect(complete.attachedNodeId).toBe("b");
    expect(complete.target).toEqual([10, 2, 4]);
    expect(complete.position).toEqual([10, 2, -6]);
    expect(complete.orientation).toEqual(before);
  });

  it("keeps cursor/camera mouse mode independent from camera navigation mode", () => {
    const camera = new CameraController({
      mode: "attached",
      position: [0, 0, -5],
      target: [0, 0, 0],
      attachedNodeId: "a",
      zoom: 1,
    });

    camera.setMouseMode("cursor");
    camera.enterFreeFlight();
    expect(camera.snapshot()).toMatchObject({ mode: "free-flight", mouseMode: "cursor" });

    camera.returnToAttached({ nodeId: "a", target: [0, 0, 0] });
    expect(camera.snapshot()).toMatchObject({ mode: "attached", mouseMode: "cursor" });
  });

  it("applies free-flight acceleration, damping and look while retaining roll state", () => {
    const camera = new CameraController(
      {
        mode: "attached",
        position: [0, 0, -5],
        target: [0, 0, 0],
        attachedNodeId: "a",
        zoom: 1,
      },
      { acceleration: 10, damping: 2 },
    );
    camera.enterFreeFlight();

    const state = camera.tick(0.1, {
      movement: [0, 0, 1],
      look: [0.2, 0.1, 0.3],
      speedScale: 2,
    });

    expect(state.position).not.toEqual([0, 0, -5]);
    expect(state.velocity[2]).toBeGreaterThan(0);
    expect(state.orientation).toMatchObject({ yaw: expect.any(Number), pitch: expect.any(Number), roll: 0.3 });
  });

  it("orbits and zooms in attached mode around the same target", () => {
    const camera = new CameraController({
      mode: "attached",
      position: [0, 0, -10],
      target: [0, 0, 0],
      attachedNodeId: "a",
      zoom: 1,
    });

    camera.orbit(Math.PI / 2, 0);
    camera.zoomBy(2);
    const state = camera.snapshot();

    expect(state.target).toEqual([0, 0, 0]);
    expect(state.zoom).toBe(2);
    expect(Math.hypot(...state.position)).toBeCloseTo(5);
  });
});
