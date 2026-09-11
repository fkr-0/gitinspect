import { describe, expect, it } from "vitest";
import type { GitRepositorySnapshot } from "@gitinspect/contracts";

import { computeRepositoryRevision, verifyRepositoryRevision } from "./repositoryRevision";

function metadataFixture(): GitRepositorySnapshot {
  return {
    schemaVersion: 1,
    repositoryPath: "/repo",
    gitDir: "/repo/.git",
    head: "abc",
    headRef: "refs/heads/main",
    revision: "sha256:a58c459b77eda34b22b694b5d974f2c2470c1ec635186566e0a99b747031b8ec",
    commits: [],
    refs: [
      {
        name: "refs/heads/main",
        targetOid: "abc",
        kind: "local-branch",
        upstream: "refs/remotes/origin/main",
      },
      { name: "refs/tags/v1", targetOid: "def", kind: "tag" },
    ],
    remotes: [
      {
        name: "origin",
        fetchUrls: ["ssh://example.invalid/repo.git"],
        pushUrls: ["ssh://push.example.invalid/repo.git"],
      },
    ],
    hooks: ["commit-msg", "pre-commit"],
    truncated: false,
  };
}

describe("repository structural revision", () => {
  it("matches the Rust gitinspect-snapshot-v1 fixed vector", async () => {
    const snapshot = metadataFixture();
    await expect(computeRepositoryRevision(snapshot)).resolves.toBe(snapshot.revision);
    await expect(verifyRepositoryRevision(snapshot)).resolves.toBeUndefined();
  });

  it("fails closed when revision-defining metadata changes without its digest", async () => {
    const snapshot = metadataFixture();
    const tampered = {
      ...snapshot,
      refs: snapshot.refs.map((reference) =>
        reference.name === "refs/heads/main" ? { ...reference, targetOid: "def" } : reference,
      ),
    };
    await expect(verifyRepositoryRevision(tampered)).rejects.toThrow(/fingerprint mismatch/i);
  });

  it("binds metadata order rather than silently normalizing a reordered transport", async () => {
    const snapshot = metadataFixture();
    await expect(verifyRepositoryRevision({ ...snapshot, refs: [...snapshot.refs].reverse() })).rejects.toThrow(
      /fingerprint mismatch/i,
    );
  });
});
