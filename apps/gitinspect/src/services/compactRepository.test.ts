import { describe, expect, it } from "vitest";

import {
  decodeCompactRepositorySnapshot,
  type CompactGitRepositorySnapshot,
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
});
