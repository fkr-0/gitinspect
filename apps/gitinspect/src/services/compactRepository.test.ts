import { describe, expect, it } from "vitest";

import {
  applyCompactRepositoryAppendDelta,
  decodeCompactCommitBatch,
  decodeCompactRepositorySnapshot,
  type CompactGitCommitBatch,
  type CompactGitRepositorySnapshot,
  type CompactRepositoryAppendDelta,
} from "./compactRepository";

function fixture(): CompactGitRepositorySnapshot {
  return {
    schemaVersion: 1,
    repositoryPath: "/repo",
    gitDir: "/repo/.git",
    head: "child",
    headRef: "refs/heads/main",
    revision: "sha256:test",
    strings: [
      "child",
      "tree-child",
      "parent",
      "Scale Fixture",
      "scale@example.invalid",
      "child message",
      "tree-parent",
      "parent message",
    ],
    commits: [
      [0, 1, [2], 3, 4, 2000, 2000, 5, 3],
      [2, 6, [], 3, 4, 1000, 1000, 7, 2],
    ],
    refs: [{ name: "refs/heads/main", targetOid: "child", kind: "local-branch" }],
    remotes: [],
    hooks: [],
    truncated: false,
  };
}

describe("compact repository transport", () => {
  it("expands a commit-only batch for append-aware refresh", () => {
    const batch: CompactGitCommitBatch = {
      strings: ["child", "tree-child", "parent", "Scale Fixture", "child message"],
      commits: [[0, 1, [2], 3, null, 2000, 2000, 4, 3]],
    };

    expect(decodeCompactCommitBatch(batch)).toEqual([
      {
        oid: "child",
        treeOid: "tree-child",
        parents: ["parent"],
        authorName: "Scale Fixture",
        authoredAtMs: 2000,
        committedAtMs: 2000,
        message: "child message",
        signatureStatus: "unsigned",
        files: [],
      },
    ]);
  });

  it("applies a validated append delta to the public snapshot exactly", () => {
    const session = {
      key: "repository:1",
      snapshot: decodeCompactRepositorySnapshot(fixture()),
    };
    const refreshed = applyCompactRepositoryAppendDelta(session, {
      baseRevision: "sha256:test",
      baseHead: "child",
      revision: "sha256:next",
      head: "new-child",
      headRef: "refs/heads/main",
      commits: {
        strings: ["new-child", "tree-new", "child", "Scale Fixture", "new message"],
        commits: [[0, 1, [2], 3, null, 3000, 3000, 4, 3]],
      },
      refs: [{ name: "refs/heads/main", targetOid: "new-child", kind: "local-branch" }],
      remotes: [],
      hooks: [],
      dropCommitCount: 1,
      truncated: true,
    });

    expect(refreshed.snapshot.revision).toBe("sha256:next");
    expect(refreshed.snapshot.commits.map((commit) => commit.oid)).toEqual(["new-child", "child"]);
    expect(refreshed.snapshot.truncated).toBe(true);
  });

  it("fails closed on stale or non-linear append deltas", () => {
    const session = {
      key: "repository:1",
      snapshot: decodeCompactRepositorySnapshot(fixture()),
    };
    const delta: CompactRepositoryAppendDelta = {
      baseRevision: "sha256:test",
      baseHead: "child",
      revision: "sha256:next",
      head: "new-child",
      headRef: "refs/heads/main",
      commits: {
        strings: ["new-child", "tree-new", "wrong-parent", "Scale Fixture", "message"],
        commits: [[0, 1, [2], 3, null, 3000, 3000, 4, 3]],
      },
      refs: [{ name: "refs/heads/main", targetOid: "new-child", kind: "local-branch" }],
      remotes: [],
      hooks: [],
      dropCommitCount: 0,
      truncated: false,
    };

    expect(() =>
      applyCompactRepositoryAppendDelta(session, { ...delta, baseRevision: "sha256:stale" }),
    ).toThrow(/base revision mismatch/i);
    expect(() => applyCompactRepositoryAppendDelta(session, delta)).toThrow(/linear append/i);

    const duplicateCommitDelta: CompactRepositoryAppendDelta = {
      ...delta,
      commits: {
        strings: ["new-child", "tree-new", "child", "Scale Fixture", "message"],
        commits: [
          [0, 1, [0], 3, null, 4000, 4000, 4, 3],
          [0, 1, [2], 3, null, 3000, 3000, 4, 3],
        ],
      },
    };
    expect(() => applyCompactRepositoryAppendDelta(session, duplicateCommitDelta)).toThrow(
      /duplicates appended commit/i,
    );
  });

  it("expands into the unchanged public metadata-only snapshot contract", () => {
    const snapshot = decodeCompactRepositorySnapshot(fixture());
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.head).toBe("child");
    expect(snapshot.commits).toEqual([
      {
        oid: "child",
        treeOid: "tree-child",
        parents: ["parent"],
        authorName: "Scale Fixture",
        authorEmail: "scale@example.invalid",
        authoredAtMs: 2000,
        committedAtMs: 2000,
        message: "child message",
        signatureStatus: "unsigned",
        files: [],
      },
      {
        oid: "parent",
        treeOid: "tree-parent",
        parents: [],
        authorName: "Scale Fixture",
        authorEmail: "scale@example.invalid",
        authoredAtMs: 1000,
        committedAtMs: 1000,
        message: "parent message",
        signatureStatus: "unknown",
        files: [],
      },
    ]);
  });

  it("fails closed on malformed string-table references", () => {
    const malformed = fixture();
    const commits = [
      [999, ...malformed.commits[0]!.slice(1)],
    ] as unknown as typeof malformed.commits;
    expect(() => decodeCompactRepositorySnapshot({ ...malformed, commits })).toThrow(
      /string index/i,
    );
  });

  it("fails closed on duplicate commit identities in a full compact snapshot", () => {
    const malformed = fixture();
    expect(() =>
      decodeCompactRepositorySnapshot({
        ...malformed,
        commits: [malformed.commits[0]!, malformed.commits[0]!],
      }),
    ).toThrow(/duplicates commit/i);
  });

  it("fails closed on duplicate or contradictory ref identity in compact metadata", () => {
    const malformed = fixture();
    expect(() =>
      decodeCompactRepositorySnapshot({
        ...malformed,
        refs: [
          ...malformed.refs,
          { name: "refs/heads/main", targetOid: "parent", kind: "local-branch" },
        ],
      }),
    ).toThrow(/duplicates ref/i);

    expect(() =>
      decodeCompactRepositorySnapshot({
        ...malformed,
        refs: [{ ...malformed.refs[0]!, targetOid: "parent" }],
      }),
    ).toThrow(/HEAD ref metadata is inconsistent/i);
  });
});
