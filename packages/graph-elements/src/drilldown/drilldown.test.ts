import type { CameraState, GraphDataset } from "@gitinspect/contracts";
import { describe, expect, it } from "vitest";
import { WorldNavigationStack, type WorldNavigationFrame } from "./index.js";

const camera = (x: number): CameraState => ({
  mode: "attached",
  position: [x, 2, 3],
  target: [x, 0, 0],
  attachedNodeId: `n${x}`,
  zoom: 1,
});

const dataset = (revision: string): GraphDataset => ({ revision, nodes: [], edges: [] });

const frame = (identity: string, x: number): WorldNavigationFrame => ({
  datasetIdentity: identity,
  dataset: dataset(identity),
  mapperKey: `mapper:${identity}`,
  layoutKey: `layout:${identity}`,
  camera: camera(x),
});

describe("WorldNavigationStack", () => {
  it("enters async child worlds and restores dataset/mapper/layout/camera on back", async () => {
    const root = frame("root", 1);
    const child = frame("child", 9);
    const navigation = new WorldNavigationStack(root, async ({ elementId }) =>
      elementId === "open" ? child : undefined,
    );
    await expect(navigation.enter("open")).resolves.toBe(true);
    expect(navigation.current.datasetIdentity).toBe("child");
    expect(navigation.depth).toBe(1);
    expect(navigation.back()).toBe(true);
    expect(navigation.current).toEqual(root);
    expect(navigation.current.camera).toEqual(camera(1));
    expect(navigation.depth).toBe(0);
  });

  it("replace swaps only the current world and preserves prior navigation history", async () => {
    const child = frame("child", 2);
    const navigation = new WorldNavigationStack(frame("root", 1), async () => child);
    await navigation.enter("anything");
    navigation.replace(frame("replacement", 3));
    expect(navigation.current.datasetIdentity).toBe("replacement");
    expect(navigation.depth).toBe(1);
    expect(navigation.back()).toBe(true);
    expect(navigation.current.datasetIdentity).toBe("root");
  });

  it("restores optional semantic selection with the exact navigation frame", async () => {
    const root = { ...frame("root", 1), selectionId: "root-node" };
    const child = { ...frame("child", 2), selectionId: "child-node" };
    const navigation = new WorldNavigationStack(root, async () => child);

    await expect(navigation.enter("anything")).resolves.toBe(true);
    expect(navigation.current.selectionId).toBe("child-node");
    expect(navigation.back()).toBe(true);
    expect(navigation.current.selectionId).toBe("root-node");
  });

  it("does not apply a stale async child after navigation changed", async () => {
    let resolveChild: ((value: WorldNavigationFrame | undefined) => void) | undefined;
    const navigation = new WorldNavigationStack(
      frame("root", 1),
      () =>
        new Promise((resolve) => {
          resolveChild = resolve;
        }),
    );
    const entering = navigation.enter("slow");
    navigation.replace(frame("replacement", 5));
    resolveChild?.(frame("late", 8));
    await expect(entering).resolves.toBe(false);
    expect(navigation.current.datasetIdentity).toBe("replacement");
  });
});
