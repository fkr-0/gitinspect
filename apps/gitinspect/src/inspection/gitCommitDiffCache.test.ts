import type { GitCommitDiff, GitCommitFileDetail } from "@gitinspect/contracts";
import { describe, expect, it, vi } from "vitest";

import type {
  RepositoryChange,
  RepositoryPathSelection,
  RepositoryService,
  RepositorySession,
  RepositoryWatchStop,
} from "../services/repository";
import { GitCommitDiffCache } from "./gitCommitDiffCache";

const OID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OID_C = "cccccccccccccccccccccccccccccccccccccccc";

function session(revision = "rev-1"): RepositorySession {
  return {
    key: "repository:1",
    snapshot: {
      schemaVersion: 1,
      repositoryPath: "/repo",
      gitDir: "/repo/.git",
      revision,
      commits: [],
      refs: [],
      remotes: [],
      hooks: [],
      truncated: false,
    },
  };
}

function diff(oid: string): GitCommitDiff {
  return { oid, files: [], truncated: false };
}

function fileDetail(oid: string, path: string): GitCommitFileDetail {
  return {
    oid,
    path,
    status: "modified",
    kind: "text",
    contentStatus: "text",
    hunks: [],
    truncated: false,
  };
}

class FakeRepositoryService implements RepositoryService {
  readonly mode = "demo" as const;
  readonly getCommitDiffMock =
    vi.fn<(session: RepositorySession, oid: string) => Promise<GitCommitDiff>>();
  readonly getCommitFileDetailMock =
    vi.fn<
      (session: RepositorySession, oid: string, path: string) => Promise<GitCommitFileDetail>
    >();

  async chooseRepositoryPath(_selection: RepositoryPathSelection): Promise<string> {
    return "/repo";
  }

  async openRepository(_path: string): Promise<RepositorySession> {
    throw new Error("not used");
  }

  async refreshRepository(_session: RepositorySession): Promise<RepositorySession> {
    throw new Error("not used");
  }

  getCommitDiff(sessionValue: RepositorySession, oid: string): Promise<GitCommitDiff> {
    return this.getCommitDiffMock(sessionValue, oid);
  }

  getCommitFileDetail(
    sessionValue: RepositorySession,
    oid: string,
    path: string,
  ): Promise<GitCommitFileDetail> {
    return this.getCommitFileDetailMock(sessionValue, oid, path);
  }

  async watchRepository(
    _session: RepositorySession,
    _onChange: (change: RepositoryChange) => void,
  ): Promise<RepositoryWatchStop> {
    return async () => undefined;
  }
}

describe("GitCommitDiffCache", () => {
  it("deduplicates concurrent requests and scopes entries to repository revision", async () => {
    const service = new FakeRepositoryService();
    let resolvePending: ((value: GitCommitDiff) => void) | undefined;
    service.getCommitDiffMock.mockImplementation((_session, oid) => {
      if (oid === OID_A && resolvePending === undefined) {
        return new Promise((resolve) => {
          resolvePending = resolve;
        });
      }
      return Promise.resolve(diff(oid));
    });
    const cache = new GitCommitDiffCache(service);
    const current = session();

    const first = cache.get(current, OID_A);
    const second = cache.get(current, OID_A);
    expect(second).toBe(first);
    expect(service.getCommitDiffMock).toHaveBeenCalledTimes(1);
    resolvePending?.(diff(OID_A));
    await expect(first).resolves.toEqual(diff(OID_A));

    await cache.get(session("rev-2"), OID_A);
    expect(service.getCommitDiffMock).toHaveBeenCalledTimes(2);
  });

  it("uses bounded LRU retention instead of growing with inspected history", async () => {
    const service = new FakeRepositoryService();
    service.getCommitDiffMock.mockImplementation(async (_session, oid) => diff(oid));
    const cache = new GitCommitDiffCache(service, { maxEntries: 2 });
    const current = session();

    await cache.get(current, OID_A);
    await cache.get(current, OID_B);
    await cache.get(current, OID_A);
    await cache.get(current, OID_C);
    expect(cache.size).toBe(2);

    await cache.get(current, OID_A);
    expect(service.getCommitDiffMock).toHaveBeenCalledTimes(3);
    await cache.get(current, OID_B);
    expect(service.getCommitDiffMock).toHaveBeenCalledTimes(4);
  });

  it("drops failed requests so a later inspection can retry", async () => {
    const service = new FakeRepositoryService();
    service.getCommitDiffMock
      .mockRejectedValueOnce(new Error("diff unavailable"))
      .mockResolvedValueOnce(diff(OID_A));
    const cache = new GitCommitDiffCache(service);

    await expect(cache.get(session(), OID_A)).rejects.toThrow("diff unavailable");
    await expect(cache.get(session(), OID_A)).resolves.toEqual(diff(OID_A));
    expect(service.getCommitDiffMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates bounded file detail by revision, commit, and path", async () => {
    const service = new FakeRepositoryService();
    service.getCommitFileDetailMock.mockImplementation(async (_session, oid, path) =>
      fileDetail(oid, path),
    );
    const cache = new GitCommitDiffCache(service, { maxFileEntries: 2 });
    const current = session();

    const first = cache.getFileDetail(current, OID_A, "a.txt");
    const second = cache.getFileDetail(current, OID_A, "a.txt");
    expect(second).toBe(first);
    await first;
    expect(service.getCommitFileDetailMock).toHaveBeenCalledTimes(1);

    await cache.getFileDetail(current, OID_A, "b.txt");
    await cache.getFileDetail(current, OID_A, "c.txt");
    expect(cache.fileDetailSize).toBe(2);
    await cache.getFileDetail(current, OID_A, "a.txt");
    expect(service.getCommitFileDetailMock).toHaveBeenCalledTimes(4);

    await cache.getFileDetail(session("rev-2"), OID_A, "a.txt");
    expect(service.getCommitFileDetailMock).toHaveBeenCalledTimes(5);
  });

  it("evicts failed file-detail requests so selection can retry", async () => {
    const service = new FakeRepositoryService();
    service.getCommitFileDetailMock
      .mockRejectedValueOnce(new Error("detail unavailable"))
      .mockResolvedValueOnce(fileDetail(OID_A, "a.txt"));
    const cache = new GitCommitDiffCache(service);

    await expect(cache.getFileDetail(session(), OID_A, "a.txt")).rejects.toThrow(
      "detail unavailable",
    );
    await expect(cache.getFileDetail(session(), OID_A, "a.txt")).resolves.toEqual(
      fileDetail(OID_A, "a.txt"),
    );
    expect(service.getCommitFileDetailMock).toHaveBeenCalledTimes(2);
  });
});
