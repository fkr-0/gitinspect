import type { GitRepositorySnapshot } from "@gitinspect/contracts";
import { describe, expect, it } from "vitest";
import {
  InspectionLimitError,
  parseInspectionExport,
  serializeInspectionExport,
} from "../inspection/inspectionExport";
import { createDemoSnapshot } from "../services/repository";
import { gitVisualMapper } from "./gitVisualMapper";
import { repositorySnapshotToGraphDataset } from "./graphAdapter";

const hostile = {
  message: `<img src=x onerror=alert(1)>\u001b[31m\u202e${"X".repeat(1000)}`,
  author: "author\u0000\u2066<script>\u2069",
  ref: "refs/heads/\u202eunsafe\u2215branch",
  filename: "src/\u200bconstructor\uff0f__proto__.ts",
};

function fixture(): GitRepositorySnapshot {
  const base = createDemoSnapshot("/fixture");
  const first = base.commits[0]!;
  return {
    ...base,
    commits: [
      {
        ...first,
        message: hostile.message,
        authorName: hostile.author,
        files: [
          {
            path: hostile.filename,
            kind: "text" as const,
            status: "modified" as const,
            additions: 1,
            deletions: 0,
          },
        ],
      },
      ...base.commits.slice(1),
    ],
    refs: [{ ...base.refs[0]!, name: hostile.ref }, ...base.refs.slice(1)],
  };
}

describe("repository-hostile graph and export fixture", () => {
  it("bounds graph and three.js descriptor labels without interpreting markup", () => {
    const dataset = repositorySnapshotToGraphDataset(fixture());
    const commit = dataset.nodes.find(
      (node) => node.kind === "commit" && node.properties.message === hostile.message,
    )!;
    const ref = dataset.nodes.find((node) => node.properties.name === hostile.ref)!;
    expect(commit.label).toContain("<img src=x onerror=alert(1)>");
    expect(commit.label).not.toContain("\u001b");
    expect(commit.label).not.toContain("\u202e");
    expect(commit.label?.endsWith("…")).toBe(true);
    expect(ref.label).toContain("\\u{202E}");
    expect(ref.label).toContain("\\u{2215}");
    const descriptor = gitVisualMapper.mapNode(commit, {
      dataset,
      revision: dataset.revision,
      nodePositions: new Map(dataset.nodes.map((node) => [node.id, [0, 0, 0] as const])),
    });
    expect(descriptor.elements.length).toBeGreaterThan(0);
    expect(descriptor.elements.every((element) => typeof element.primitive === "string")).toBe(
      true,
    );
  });

  it("exports sanitized labels and rejects prototype-shaped properties", () => {
    const dataset = repositorySnapshotToGraphDataset(fixture());
    const commit = dataset.nodes.find((node) => node.properties.message === hostile.message)!;
    const json = serializeInspectionExport({
      repositoryPath: "/fixture",
      repositoryRevision: "revision",
      navigationDepth: 0,
      node: { ...commit, properties: { plain: hostile.filename } },
    });
    const parsed = parseInspectionExport(json);
    expect(parsed.element.label).toBe(commit.label);
    expect(json).not.toContain("<img");
    expect(json).not.toContain("\u202e");
    expect(json).toContain("\\u003cimg");
    for (const key of ["__proto__", "constructor"]) {
      const malicious = JSON.parse(`{"${key}":{"polluted":true}}`);
      expect(() =>
        serializeInspectionExport({
          repositoryPath: "/fixture",
          repositoryRevision: "revision",
          navigationDepth: 0,
          node: { ...commit, properties: malicious },
        }),
      ).toThrow(InspectionLimitError);
    }
  });
});
