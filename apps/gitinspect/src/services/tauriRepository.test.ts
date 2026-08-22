import { afterEach, describe, expect, it, vi } from "vitest";

import { createDemoSnapshot } from "./repository";
import { createTauriRepositoryService } from "./tauriRepository";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Tauri repository bridge", () => {
  it("maps repository operations onto the narrow native command/event contract", async () => {
    const snapshot = createDemoSnapshot("/native/repo");
    const session = { key: "repository:1", snapshot };
    const invocations: Array<{ command: string; args: unknown }> = [];
    let eventHandler: ((event: { event: string; id: number; payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();

    vi.stubGlobal("window", {
      __TAURI__: {
        core: {
          invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
            invocations.push({ command, args });
            switch (command) {
              case "choose_repository_path": return "/native/repo";
              case "open_repository": return session;
              case "refresh_repository": return session;
              case "get_commit_diff": return {
                oid: snapshot.commits[0]!.oid,
                files: snapshot.commits[0]!.files,
                truncated: false,
              };
              case "start_repository_watch": return { watchId: "watch:1" };
              case "stop_repository_watch": return undefined;
              default: throw new Error(`unexpected command ${command}`);
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
    await service!.refreshRepository(opened);
    const diff = await service!.getCommitDiff(opened, snapshot.commits[0]!.oid);
    expect(diff.oid).toBe(snapshot.commits[0]!.oid);

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
      command: "refresh_repository",
      args: { repositoryId: opened.key, expectedRevision: snapshot.revision },
    });
    expect(invocations).toContainEqual({
      command: "get_commit_diff",
      args: { repositoryId: opened.key, oid: snapshot.commits[0]!.oid, options: null },
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
