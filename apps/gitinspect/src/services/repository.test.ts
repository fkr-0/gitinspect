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
    expect(first.snapshot.head).toBe(first.snapshot.commits[0]?.oid);
    expect(first.snapshot.headRef).toBe("refs/heads/main");
    expect(first.snapshot.revision).toMatch(/^demo-[0-9a-f]{8}$/);
  });

  it("rejects empty repository paths", () => {
    expect(() => createDemoSnapshot("   ")).toThrow(/repository path/i);
  });

  it("keeps native folder/file selection and IPC behind the same service seam", async () => {
    const snapshot = createDemoSnapshot("/native/example");
    let selection: RepositoryPathSelection | undefined;
    let watched = false;
    const service = new NativeRepositoryService({
      chooseRepositoryPath: async (next) => {
        selection = next;
        return "/native/example";
      },
      openRepository: async () => ({ key: "native:repository-1", snapshot }),
      refreshRepository: async (session) => session,
      getCommitDiff: async (_session, oid) => ({
        oid,
        files: snapshot.commits[0]?.files ?? [],
        truncated: false,
      }),
      runPlugins: async (session) => ({
        schemaVersion: 1,
        apiVersion: 1,
        repositoryRevision: session.snapshot.revision,
        plugins: [],
        summary: {
          enabledPlugins: 0,
          disabledPlugins: 0,
          infoFindings: 0,
          warningFindings: 0,
          errorFindings: 0,
        },
        diagnostics: [],
        truncated: false,
      }),
      getCommitFileDetail: async (_session, oid, path) => ({
        oid,
        path,
        status: "modified",
        kind: "text",
        contentStatus: "text",
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [{ kind: "addition", newLine: 1, content: "native detail\n" }],
          },
        ],
        truncated: false,
      }),
      watchRepository: async (_session, onChange) => {
        watched = true;
        onChange({
          repositoryId: "native:repository-1",
          previousRevision: snapshot.revision,
          reasons: ["refs"],
        });
        return async () => undefined;
      },
    });

    expect(await service.chooseRepositoryPath({ mode: "folder", expectedKind: "worktree" })).toBe(
      "/native/example",
    );
    expect(selection).toEqual({ mode: "folder", expectedKind: "worktree" });
    const session = await service.openRepository("/native/example");
    expect(session.key).toBe("native:repository-1");
    expect((await service.getCommitDiff(session, snapshot.commits[0]!.oid)).oid).toBe(
      snapshot.commits[0]!.oid,
    );
    expect(
      (await service.getCommitFileDetail(session, snapshot.commits[0]!.oid, "src/world.ts")).path,
    ).toBe("src/world.ts");
    expect((await service.runPlugins(session)).repositoryRevision).toBe(snapshot.revision);
    const stop = await service.watchRepository(session, () => undefined);
    expect(watched).toBe(true);
    await stop();
  });

  it("adapts the snapshot into a complete generic graph without renderer types", () => {
    const snapshot = createDemoSnapshot("/work/example");
    const dataset = repositorySnapshotToGraphDataset(snapshot);

    expect(dataset.revision).toBe(snapshot.revision);
    expect(dataset.nodes.filter((node) => node.kind === "commit")).toHaveLength(
      snapshot.commits.length,
    );
    expect(dataset.edges.some((edge) => edge.kind === "merge-parent")).toBe(true);
    expect(
      dataset.edges.filter((edge) =>
        ["ref-target", "tag-target", "stash-base"].includes(edge.kind),
      ),
    ).toHaveLength(snapshot.refs.length);
  });
});
