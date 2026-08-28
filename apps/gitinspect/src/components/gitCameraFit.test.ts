import { describe, expect, it } from "vitest";

import {
  contextualGitCameraBounds,
  fitGitCameraToBounds,
  gitCameraBoundsForPositions,
  gitTopologyVisibilityRange,
  isInheritedCinematicCamera,
} from "./gitCameraFit";

describe("Git topology camera fit", () => {
  const overview = { min: [-6.8, -3.3, -1.55] as const, max: [6.8, 3.3, 1] as const };

  it("fits deterministic Railfield bounds from viewport aspect while preserving axis orientation", () => {
    const first = fitGitCameraToBounds(overview, 16 / 10);
    const second = fitGitCameraToBounds(overview, 16 / 10);
    const tall = fitGitCameraToBounds(overview, 0.7);

    expect(second).toEqual(first);
    expect(first.camera.target).toEqual([0, 0, -0.275]);
    expect(first.camera.position[0]).toBe(first.camera.target[0]);
    expect(first.camera.position[1]).toBe(first.camera.target[1]);
    expect(first.camera.position[2]).toBeGreaterThan(first.camera.target[2]);
    expect(tall.distance).toBeGreaterThan(first.distance);
  });

  it("can center selection while still fitting its surrounding topology bounds", () => {
    const selected = fitGitCameraToBounds(overview, 1.4, {
      target: [5.8, 2.8, 0],
      attachedNodeId: "commit:selected",
    });
    expect(selected.camera.target).toEqual([5.8, 2.8, 0]);
    expect(selected.camera.attachedNodeId).toBe("commit:selected");
    expect(selected.camera.position[0]).toBe(5.8);
    expect(selected.camera.position[1]).toBe(2.8);
    expect(selected.distance).toBeGreaterThan(fitGitCameraToBounds(overview, 1.4).distance);
  });

  it("keeps bounded padding and min/max distances", () => {
    const tighter = fitGitCameraToBounds(overview, 1.4, { padding: 1 });
    const padded = fitGitCameraToBounds(overview, 1.4, { padding: 1.5 });
    const capped = fitGitCameraToBounds(
      { min: [-100_000, -100_000, 0], max: [100_000, 100_000, 0] },
      1,
      { maxDistance: 320 },
    );
    const floored = fitGitCameraToBounds(
      { min: [0, 0, 0], max: [0, 0, 0] },
      1,
      { minDistance: 12 },
    );

    expect(padded.distance).toBeGreaterThan(tighter.distance);
    expect(capped.distance).toBe(320);
    expect(floored.distance).toBe(12);
  });

  it("expands camera far/fog range from topology span instead of a fixed cinematic shell", () => {
    expect(gitTopologyVisibilityRange(overview)).toEqual({
      far: 500,
      fogNear: 22,
      fogFar: 114,
    });
    const medium = gitTopologyVisibilityRange({ min: [-850, -6, -2], max: [850, 6, 2] });
    expect(medium.far).toBe(5_200);
    expect(medium.fogNear).toBe(1_020);
    expect(medium.fogFar).toBe(4_330);
  });

  it("fits a selected neighborhood with a deterministic repository-context floor", () => {
    const focus = { min: [4.5, 2.6, 0], max: [5.1, 3, 0.4] } as const;
    const contextual = contextualGitCameraBounds(overview, focus);
    const overviewSpanX = overview.max[0] - overview.min[0];
    const overviewSpanY = overview.max[1] - overview.min[1];

    expect(contextual.max[0] - contextual.min[0]).toBeGreaterThanOrEqual(overviewSpanX * 0.58);
    expect(contextual.max[1] - contextual.min[1]).toBeGreaterThanOrEqual(overviewSpanY * 0.58);
    expect(contextual.min[0]).toBeLessThanOrEqual(focus.min[0]);
    expect(contextual.max[0]).toBeGreaterThanOrEqual(focus.max[0]);
  });

  it("derives bounds only from requested topology identities", () => {
    const positions = new Map([
      ["commit:a", [-6, 0, 0] as const],
      ["commit:b", [0, 2.8, 0] as const],
      ["head:HEAD", [6, 1.05, 0.24] as const],
    ]);
    expect(gitCameraBoundsForPositions(positions, new Set(["commit:b", "head:HEAD"]))).toEqual({
      min: [0, 1.05, 0],
      max: [6, 2.8, 0.24],
    });
  });

  it("recognizes only the inherited cinematic default as replaceable overview state", () => {
    expect(
      isInheritedCinematicCamera({
        mode: "attached",
        position: [10, 6, 16],
        target: [0, 0, 0],
        zoom: 1,
      }),
    ).toBe(true);
    expect(
      isInheritedCinematicCamera({
        mode: "attached",
        position: [10, 6, 16],
        target: [1, 0, 0],
        zoom: 1,
      }),
    ).toBe(false);
  });
});
