import type {
  GitCommitDiff,
  GitCommitFileDetail,
  GitRepositorySnapshot,
} from "@gitinspect/contracts";
import {
  WorldNavigationStack,
  type GraphDataset,
  type WorldNavigationFrame,
} from "@gitinspect/graph-elements";
import { describe, expect, it, vi } from "vitest";

import type {
  RepositoryChange,
  RepositoryPathSelection,
  RepositoryService,
  RepositorySession,
  RepositoryWatchStop,
} from "../services/repository";
import { GitCommitDiffCache } from "../inspection/gitCommitDiffCache";
import {
  GitCommitDrilldownResolver,
  commitDiffToDrilldownDataset,
  commitFileDetailToDrilldownDataset,
} from "./gitCommitDrilldown";

const ROOT_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PARENT_A = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PARENT_B = "cccccccccccccccccccccccccccccccccccccccc";

function snapshot(revision = "rev-1"): GitRepositorySnapshot {
  return {
    schemaVersion: 1,
    repositoryPath: "/repo",
    gitDir: "/repo/.git",
    head: ROOT_OID,
    headRef: "refs/heads/main",
    revision,
    commits: [
      {
        oid: ROOT_OID,
        treeOid: "dddddddddddddddddddddddddddddddddddddddd",
        parents: [PARENT_A, PARENT_B],
        authorName: "Ada",
        authorEmail: "ada@example.test",
        authoredAtMs: 10,
        committedAtMs: 11,
        message: "Merge bounded drilldown\n\nDetails",
        signatureStatus: "valid",
        files: [],
      },
      {
        oid: PARENT_A,
        treeOid: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        parents: [],
        authorName: "Lin",
        authoredAtMs: 5,
        committedAtMs: 6,
        message: "Parent A",
        signatureStatus: "unsigned",
        files: [],
      },
    ],
    refs: [
      {
        name: "refs/heads/main",
        targetOid: ROOT_OID,
        kind: "local-branch",
      },
      {
        name: "refs/tags/v1",
        targetOid: ROOT_OID,
        kind: "tag",
      },
    ],
    remotes: [],
    hooks: [],
    truncated: false,
  };
}

function diff(files = true): GitCommitDiff {
  return {
    oid: ROOT_OID,
    parentOid: PARENT_A,
    files: files
      ? [
          {
            path: "src/main.ts",
            kind: "text",
            additions: 12,
            deletions: 4,
            status: "modified",
          },
          {
            path: "fixtures/sample.bin",
            kind: "binary",
            additions: 0,
            deletions: 0,
            bytes: 8192,
            status: "added",
          },
        ]
      : [],
    truncated: false,
  };
}

function fileDetail(): GitCommitFileDetail {
  return {
    oid: ROOT_OID,
    parentOid: PARENT_A,
    path: "src/main.ts",
    status: "modified",
    kind: "text",
    oldOid: "1111111111111111111111111111111111111111",
    newOid: "2222222222222222222222222222222222222222",
    oldBytes: 120,
    newBytes: 144,
    contentStatus: "text",
    hunks: [
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 4,
        lines: [
          { kind: "context", oldLine: 10, newLine: 10, content: "keep\n" },
          { kind: "deletion", oldLine: 11, content: "old\n" },
          { kind: "addition", newLine: 11, content: "new\n" },
          { kind: "addition", newLine: 12, content: "more\n" },
        ],
      },
      {
        oldStart: 40,
        oldLines: 1,
        newStart: 41,
        newLines: 1,
        lines: [{ kind: "addition", newLine: 41, content: "tail\n" }],
      },
    ],
    truncated: false,
  };
}

function rootFrame(revision = "rev-1"): WorldNavigationFrame {
  const dataset: GraphDataset = {
    revision,
    nodes: [{ id: `commit:${ROOT_OID}`, kind: "commit", properties: {} }],
    edges: [],
  };
  return {
    datasetIdentity: `root:${revision}`,
    dataset,
    mapperKey: "git-root",
    layoutKey: "git-root-layout",
    camera: {
      mode: "free-flight",
      position: [1, 2, 3],
      target: [4, 5, 6],
      zoom: 2,
    },
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

  getCommitDiff(session: RepositorySession, oid: string): Promise<GitCommitDiff> {
    return this.getCommitDiffMock(session, oid);
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

function session(revision = "rev-1"): RepositorySession {
  return { key: "repo-1", snapshot: snapshot(revision) };
}

describe("commitDiffToDrilldownDataset", () => {
  it("creates stable changed-file, parent, and ref context without blob content", () => {
    const repository = snapshot();
    const commit = repository.commits[0];
    if (!commit) throw new Error("fixture missing commit");

    const dataset = commitDiffToDrilldownDataset(repository, commit, diff());

    expect(dataset.revision).toBe(`rev-1:commit:${ROOT_OID}`);
    expect(dataset.nodes.find((node) => node.kind === "commit-core")?.label).toBe(
      "Merge bounded drilldown",
    );
    expect(dataset.nodes.filter((node) => node.kind.startsWith("changed-file-"))).toHaveLength(2);
    expect(
      dataset.nodes.find((node) => node.kind === "changed-file-binary")?.properties,
    ).toMatchObject({
      path: "fixtures/sample.bin",
      bytes: 8192,
      boundedSummaryOnly: true,
    });
    expect(dataset.nodes.filter((node) => node.kind === "commit-parent-context")).toHaveLength(2);
    expect(dataset.nodes.filter((node) => node.kind.startsWith("context-"))).toHaveLength(2);
    expect(JSON.stringify(dataset)).not.toContain("blobContent");
  });

  it("can share the same bounded diff cache with another inspection consumer", async () => {
    const service = new FakeRepositoryService();
    service.getCommitDiffMock.mockResolvedValue(diff());
    const current = session();
    const sharedCache = new GitCommitDiffCache(service, { maxEntries: 4 });
    const resolver = new GitCommitDrilldownResolver(service, () => current, sharedCache);

    const inspectorRequest = sharedCache.get(current, ROOT_OID);
    const childRequest = resolver.resolve({
      parent: rootFrame(),
      elementId: `commit:${ROOT_OID}`,
    });

    await inspectorRequest;
    await expect(childRequest).resolves.toMatchObject({
      datasetIdentity: `repo-1:rev-1:commit:${ROOT_OID}`,
    });
    expect(service.getCommitDiffMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty/root-like diff inspectable as a commit-core world", () => {
    const repository = snapshot();
    const commit = repository.commits[0];
    if (!commit) throw new Error("fixture missing commit");

    const dataset = commitDiffToDrilldownDataset(repository, commit, diff(false));

    expect(dataset.nodes.some((node) => node.id === `commit-core:${ROOT_OID}`)).toBe(true);
    expect(dataset.nodes.some((node) => node.kind.startsWith("changed-file-"))).toBe(false);
    expect(dataset.edges.filter((edge) => edge.kind.includes("parent-context"))).toHaveLength(2);
  });

  it("derives a bounded file world with hunk and blob metadata but no duplicated patch text", () => {
    const detail = fileDetail();
    const dataset = commitFileDetailToDrilldownDataset("rev-1", detail);

    expect(dataset.revision).toBe(`rev-1:commit:${ROOT_OID}:file:src%2Fmain.ts`);
    expect(dataset.nodes.filter((node) => node.kind === "diff-hunk")).toHaveLength(2);
    expect(dataset.nodes.filter((node) => node.kind === "file-blob-context")).toHaveLength(2);
    expect(
      dataset.nodes.find((node) => node.kind === "file-detail-core")?.properties,
    ).toMatchObject({
      path: "src/main.ts",
      hunkCount: 2,
      boundedDetail: true,
    });
    expect(dataset.nodes.find((node) => node.kind === "diff-hunk")?.properties).toMatchObject({
      hunkIndex: 0,
      lineCount: 4,
      additions: 2,
      deletions: 1,
    });
    expect(JSON.stringify(dataset)).not.toContain("keep\\n");
    expect(JSON.stringify(dataset)).not.toContain("old\\n");
  });
});

describe("GitCommitDrilldownResolver", () => {
  it("caches a bounded lazy diff by repository session + revision + commit", async () => {
    const service = new FakeRepositoryService();
    service.getCommitDiffMock.mockResolvedValue(diff());
    let current = session();
    const resolver = new GitCommitDrilldownResolver(service, () => current);
    const parent = rootFrame();

    const first = await resolver.resolve({ parent, elementId: `commit:${ROOT_OID}` });
    const second = await resolver.resolve({ parent, elementId: `commit:${ROOT_OID}` });

    expect(first?.datasetIdentity).toBe(`repo-1:rev-1:commit:${ROOT_OID}`);
    expect(second?.datasetIdentity).toBe(first?.datasetIdentity);
    expect(service.getCommitDiffMock).toHaveBeenCalledTimes(1);
    current = session("rev-2");
    await resolver.resolve({ parent: rootFrame("rev-2"), elementId: `commit:${ROOT_OID}` });
    expect(service.getCommitDiffMock).toHaveBeenCalledTimes(2);
  });

  it("rejects stale async diff results when repository revision changes", async () => {
    const service = new FakeRepositoryService();
    let resolveDiff: ((value: GitCommitDiff) => void) | undefined;
    service.getCommitDiffMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDiff = resolve;
      }),
    );
    let current = session();
    const resolver = new GitCommitDrilldownResolver(service, () => current);

    const pending = resolver.resolve({ parent: rootFrame(), elementId: `commit:${ROOT_OID}` });
    current = session("rev-2");
    resolveDiff?.(diff());

    await expect(pending).resolves.toBeUndefined();
  });

  it("integrates with WorldNavigationStack and restores the exact parent frame on back", async () => {
    const service = new FakeRepositoryService();
    service.getCommitDiffMock.mockResolvedValue(diff());
    const current = session();
    const resolver = new GitCommitDrilldownResolver(service, () => current);
    const parent = rootFrame();
    const navigation = new WorldNavigationStack(parent, resolver.resolve);

    await expect(navigation.enter(`commit:${ROOT_OID}`)).resolves.toBe(true);
    expect(navigation.depth).toBe(1);
    expect(navigation.current.mapperKey).toBe("git-commit-drilldown-v1");
    expect(navigation.current.selectionId).toBe(`commit-core:${ROOT_OID}`);
    expect(navigation.current.camera.attachedNodeId).toBe(`commit-core:${ROOT_OID}`);

    expect(navigation.back()).toBe(true);
    expect(navigation.current.datasetIdentity).toBe(parent.datasetIdentity);
    expect(navigation.current.mapperKey).toBe(parent.mapperKey);
    expect(navigation.current.layoutKey).toBe(parent.layoutKey);
    expect(navigation.current.camera).toEqual(parent.camera);
  });

  it("reuses bounded file detail to enter a nested hunk/blob world and restores file selection on back", async () => {
    const service = new FakeRepositoryService();
    service.getCommitDiffMock.mockResolvedValue(diff());
    service.getCommitFileDetailMock.mockResolvedValue(fileDetail());
    const current = session();
    const sharedCache = new GitCommitDiffCache(service);
    const resolver = new GitCommitDrilldownResolver(service, () => current, sharedCache);
    const navigation = new WorldNavigationStack(rootFrame(), resolver.resolve);
    const fileId = `commit-file:${ROOT_OID}:src%2Fmain.ts`;

    await expect(navigation.enter(`commit:${ROOT_OID}`)).resolves.toBe(true);
    navigation.replace({ ...navigation.current, selectionId: fileId });
    const inspectorRequest = sharedCache.getFileDetail(current, ROOT_OID, "src/main.ts");
    await expect(navigation.enter(fileId)).resolves.toBe(true);
    await inspectorRequest;

    expect(navigation.depth).toBe(2);
    expect(navigation.current.mapperKey).toBe("git-file-detail-drilldown-v1");
    expect(navigation.current.selectionId).toBe(`file-core:${ROOT_OID}:src%2Fmain.ts`);
    expect(
      navigation.current.dataset.nodes.filter((node) => node.kind === "diff-hunk"),
    ).toHaveLength(2);
    expect(service.getCommitFileDetailMock).toHaveBeenCalledTimes(1);

    expect(navigation.back()).toBe(true);
    expect(navigation.depth).toBe(1);
    expect(navigation.current.selectionId).toBe(fileId);
  });

  it("rejects stale async file-detail worlds when the repository revision changes", async () => {
    const service = new FakeRepositoryService();
    service.getCommitDiffMock.mockResolvedValue(diff());
    let resolveDetail: ((value: GitCommitFileDetail) => void) | undefined;
    service.getCommitFileDetailMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
    );
    let current = session();
    const resolver = new GitCommitDrilldownResolver(service, () => current);
    const child = await resolver.resolve({ parent: rootFrame(), elementId: `commit:${ROOT_OID}` });
    if (!child) throw new Error("fixture failed to resolve commit world");

    const pending = resolver.resolve({
      parent: child,
      elementId: `commit-file:${ROOT_OID}:src%2Fmain.ts`,
    });
    current = session("rev-2");
    resolveDetail?.(fileDetail());

    await expect(pending).resolves.toBeUndefined();
  });

  it("ignores non-commit elements and parent frames from another repository revision", async () => {
    const service = new FakeRepositoryService();
    service.getCommitDiffMock.mockResolvedValue(diff());
    const current = session();
    const resolver = new GitCommitDrilldownResolver(service, () => current);

    await expect(
      resolver.resolve({ parent: rootFrame(), elementId: "ref:refs/heads/main" }),
    ).resolves.toBeUndefined();
    await expect(
      resolver.resolve({ parent: rootFrame("stale"), elementId: `commit:${ROOT_OID}` }),
    ).resolves.toBeUndefined();
    expect(service.getCommitDiffMock).not.toHaveBeenCalled();
  });
});
