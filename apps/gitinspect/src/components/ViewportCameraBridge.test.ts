import { describe, expect, it } from "vitest";
import { CameraController } from "@gitinspect/graph-elements";

import {
  applyViewportCameraIntent,
  applyViewportTopologyFit,
  cameraProjectionSampleChanged,
  observeReducedMotion,
} from "./ViewportCameraBridge";

describe("ViewportCameraBridge controller integration", () => {
  it("observes reduced-motion preference changes immediately and unregisters on teardown", () => {
    const events = new EventTarget();
    let matches = false;
    const query = {
      get matches() {
        return matches;
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    } as Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
    const observed: boolean[] = [];
    const stop = observeReducedMotion(query, (reduced) => observed.push(reduced));
    matches = true;
    events.dispatchEvent(new Event("change"));
    matches = false;
    events.dispatchEvent(new Event("change"));
    stop();
    matches = true;
    events.dispatchEvent(new Event("change"));
    expect(observed).toEqual([false, true, false]);
  });
  it("keeps LOD camera replanning bounded by a world-distance sample threshold", () => {
    expect(cameraProjectionSampleChanged([0, 0, 0], [7.9, 0, 0])).toBe(false);
    expect(cameraProjectionSampleChanged([0, 0, 0], [8, 0, 0])).toBe(true);
    expect(cameraProjectionSampleChanged([0, 0, 0], [0, 0, 0], 0)).toBe(false);
  });

  it("converges studio pointer and camera modes on one controller", () => {
    const controller = new CameraController({
      mode: "attached",
      position: [10, 6, 16],
      target: [0, 0, 0],
      zoom: 1,
    });
    const positions = new Map([["commit:a", [4, 2, -3] as const]]);

    applyViewportCameraIntent(controller, {
      cameraMode: "free-flight",
      pointerMode: "camera",
      selectedElementId: "commit:a",
      nodePositions: positions,
    });
    expect(controller.snapshot()).toMatchObject({ mode: "free-flight", mouseMode: "camera" });

    const attached = applyViewportCameraIntent(controller, {
      cameraMode: "attached",
      pointerMode: "cursor",
      selectedElementId: "commit:a",
      nodePositions: positions,
    });
    expect(attached).toMatchObject({
      mode: "attached",
      mouseMode: "cursor",
      attachedNodeId: "commit:a",
      target: [4, 2, -3],
    });
  });

  it("traverses an already-attached camera when logical selection changes", () => {
    const controller = new CameraController({
      mode: "attached",
      position: [0, 0, -10],
      target: [0, 0, 0],
      attachedNodeId: "commit:a",
      zoom: 1,
    });
    const positions = new Map([
      ["commit:a", [0, 0, 0] as const],
      ["commit:b", [12, 3, 2] as const],
    ]);

    applyViewportCameraIntent(controller, {
      cameraMode: "attached",
      pointerMode: "camera",
      selectedElementId: "commit:b",
      nodePositions: positions,
    });

    expect(controller.snapshot().transitioning).toBe(true);
    expect(controller.tick(1)).toMatchObject({
      attachedNodeId: "commit:b",
      target: [12, 3, 2],
      transitioning: false,
    });
  });

  it("fits topology bounds around the selected node while preserving attached camera semantics", () => {
    const controller = new CameraController({
      mode: "attached",
      position: [10, 6, 16],
      target: [0, 0, 0],
      zoom: 1,
    });
    const positions = new Map([["commit:b", [5, 2.8, 0] as const]]);
    const fitted = applyViewportTopologyFit(
      controller,
      {
        key: "rev:commit:b",
        bounds: { min: [-4, -2.8, -1], max: [7, 4, 1] },
        targetElementId: "commit:b",
      },
      positions,
      1.6,
      "cursor",
    );

    expect(fitted).toMatchObject({
      mode: "attached",
      attachedNodeId: "commit:b",
      target: [5, 2.8, 0],
      mouseMode: "cursor",
    });
    expect(fitted.position[0]).toBe(5);
    expect(fitted.position[1]).toBe(2.8);
    expect(fitted.position[2]).toBeGreaterThan(0);
  });
});
