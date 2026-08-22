import { describe, expect, it } from "vitest";

import {
  createDemoRepositoryService,
  createDemoSnapshot,
  NativeRepositoryService,
  type RepositoryPathSelection,
} from "./repository";
import { repositorySnapshotToGraphDataset } from "../domain/graphAdapter";

describe("demo repository adapter", () => {
  it("returns deterministic snapshots for the same path", async () => {
    const service = createDemoRepositoryService();
    const first = await service.openRepository("/work/example");
    const second = await service.openRepository("/work/example/");

    expect(first).toEqual(second);
    expect(first.snapshot.schemaVersion).toBe(1);
    expect(first.snapshot.commits.length).toBeGreaterThan(4);
    expect(first.snapshot.revision).toMatch(/^demo-[0-9a-f]{8}$/);
  });

  it("rejects empty repository paths", () => {
    expect(() => createDemoSnapshot("   ")).toThrow(/repository path/i);
  });

  it("keeps native folder/file selection and IPC behind the same service seam", async () => {
    const snapshot = createDemoSnapshot("/native/example");
    let selection: RepositoryPathSelection | undefined;
    const service = new NativeRepositoryService({
      chooseRepositoryPath: async (next) => {
        selection = next;
        return "/native/example";
      },
      openRepository: async () => ({ key: "native:repository-1", snapshot }),
      refreshRepository: async (session) => session,
    });

    expect(
      await service.chooseRepositoryPath({ mode: "folder", expectedKind: "worktree" }),
    ).toBe("/native/example");
    expect(selection).toEqual({ mode: "folder", expectedKind: "worktree" });
    expect((await service.openRepository("/native/example")).key).toBe(
      "native:repository-1",
    );
  });

  it("adapts the snapshot into a complete generic graph without renderer types", () => {
    const snapshot = createDemoSnapshot("/work/example");
    const dataset = repositorySnapshotToGraphDataset(snapshot);

    expect(dataset.revision).toBe(snapshot.revision);
    expect(dataset.nodes.filter((node) => node.kind === "commit")).toHaveLength(
      snapshot.commits.length,
    );
    expect(dataset.edges.some((edge) => edge.kind === "merge-parent")).toBe(true);
    expect(dataset.edges.filter((edge) => edge.kind === "ref-target")).toHaveLength(
      snapshot.refs.length,
    );
  });
});
