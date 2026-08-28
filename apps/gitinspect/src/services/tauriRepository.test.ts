import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitRepositorySnapshot } from "@gitinspect/contracts";

import type { CompactGitCommitRecord, CompactGitRepositorySnapshot } from "./compactRepository";
import { createDemoSnapshot } from "./repository";
import { createTauriRepositoryService } from "./tauriRepository";

function compactSnapshot(snapshot: GitRepositorySnapshot): CompactGitRepositorySnapshot {
  const strings: string[] = [];
  const indices = new Map<string, number>();
  const intern = (value: string): number => {
    const existing = indices.get(value);
    if (existing !== undefined) return existing;
    const index = strings.length;
    strings.push(value);
    indices.set(value, index);
    return index;
  };
  const signatureCodes = {
    valid: 0,
    invalid: 1,
    unknown: 2,
    unsigned: 3,
  } as const;
  const commits: CompactGitCommitRecord[] = snapshot.commits.map((commit) => [
    intern(commit.oid),
    intern(commit.treeOid),
    commit.parents.map(intern),
    intern(commit.authorName),
    commit.authorEmail === undefined ? null : intern(commit.authorEmail),
    commit.authoredAtMs,
    commit.committedAtMs,
    intern(commit.message),
    signatureCodes[commit.signatureStatus],
  ]);
  return {
    schemaVersion: 1,
    repositoryPath: snapshot.repositoryPath,
    gitDir: snapshot.gitDir,
    ...(snapshot.head === undefined ? {} : { head: snapshot.head }),
    ...(snapshot.headRef === undefined ? {} : { headRef: snapshot.headRef }),
    revision: snapshot.revision,
    strings,
    commits,
    refs: snapshot.refs,
    remotes: snapshot.remotes,
    hooks: snapshot.hooks,
    truncated: snapshot.truncated,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Tauri repository bridge", () => {
  it("maps repository operations onto the narrow native command/event contract", async () => {
    const snapshot = createDemoSnapshot("/native/repo");
    const compact = { key: "repository:1", snapshot: compactSnapshot(snapshot) };
    const invocations: Array<{ command: string; args: unknown }> = [];
    let eventHandler:
      | ((event: { event: string; id: number; payload: unknown }) => void)
      | undefined;
    const unlisten = vi.fn();

    vi.stubGlobal("window", {
      __TAURI__: {
        core: {
          invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
            invocations.push({ command, args });
            switch (command) {
              case "choose_repository_path":
                return "/native/repo";
              case "open_repository_compact":
                return compact;
              case "refresh_repository_compact_delta":
                return {
                  status: "unchanged",
                  revision: snapshot.revision,
                };
              case "get_commit_diff":
                return {
                  oid: snapshot.commits[0]!.oid,
                  files: snapshot.commits[0]!.files,
                  truncated: false,
                };
              case "get_commit_file_detail":
                return {
                  oid: snapshot.commits[0]!.oid,
                  path: "src/world.ts",
                  status: "modified",
                  kind: "text",
                  contentStatus: "text",
                  hunks: [],
                  truncated: false,
                };
              case "start_repository_watch":
                return { watchId: "watch:1" };
              case "stop_repository_watch":
                return undefined;
              default:
                throw new Error(`unexpected command ${command}`);
            }
          }),
        },
        event: {
          listen: vi.fn(async (_name: string, handler: typeof eventHandler) => {
            eventHandler = handler;
            return unlisten;
          }),
        },
      },
    });

    const service = createTauriRepositoryService();
    expect(service?.mode).toBe("native");
    expect(await service!.chooseRepositoryPath({ mode: "folder", expectedKind: "worktree" })).toBe(
      "/native/repo",
    );
    const opened = await service!.openRepository("/native/repo");
    const refreshed = await service!.refreshRepository(opened);
    expect(refreshed).toBe(opened);
    expect(opened.snapshot.commits.every((commit) => commit.files.length === 0)).toBe(true);
    const diff = await service!.getCommitDiff(opened, snapshot.commits[0]!.oid);
    expect(diff.oid).toBe(snapshot.commits[0]!.oid);
    const detail = await service!.getCommitFileDetail(
      opened,
      snapshot.commits[0]!.oid,
      "src/world.ts",
    );
    expect(detail.path).toBe("src/world.ts");

    const changes: unknown[] = [];
    const stop = await service!.watchRepository(opened, (change) => changes.push(change));
    eventHandler?.({
      event: "repository://changed",
      id: 1,
      payload: {
        repositoryId: "repository:other",
        previousRevision: snapshot.revision,
        reasons: ["refs"],
      },
    });
    const matching = {
      repositoryId: opened.key,
      previousRevision: snapshot.revision,
      reasons: ["head", "refs"],
    };
    eventHandler?.({ event: "repository://changed", id: 2, payload: matching });
    expect(changes).toEqual([matching]);

    await stop();
    await stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(invocations).toContainEqual({
      command: "refresh_repository_compact_delta",
      args: { repositoryId: opened.key, expectedRevision: snapshot.revision },
    });
    expect(invocations).toContainEqual({
      command: "open_repository_compact",
      args: { path: "/native/repo" },
    });
    expect(invocations).toContainEqual({
      command: "get_commit_diff",
      args: { repositoryId: opened.key, oid: snapshot.commits[0]!.oid, options: null },
    });
    expect(invocations).toContainEqual({
      command: "get_commit_file_detail",
      args: {
        repositoryId: opened.key,
        oid: snapshot.commits[0]!.oid,
        path: "src/world.ts",
        options: null,
      },
    });
    expect(invocations.filter(({ command }) => command === "stop_repository_watch")).toEqual([
      { command: "stop_repository_watch", args: { watchId: "watch:1" } },
    ]);
  });

  it("stays unavailable in the browser without the Tauri global", () => {
    vi.stubGlobal("window", {});
    expect(createTauriRepositoryService()).toBeUndefined();
  });
});
