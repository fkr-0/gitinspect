import type { GitCommitDiff, GitRepositorySnapshot } from "@gitinspect/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphViewport } from "../components/GraphViewport";
import { commitDiffToDrilldownDataset } from "../drilldown/gitCommitDrilldown";
import {
  InspectionLimitError,
  parseInspectionExport,
  serializeInspectionExport,
} from "../inspection/inspectionExport";
import { createDemoSnapshot } from "../services/repository";
import {
  childNavigationFromHref,
  hrefWithSelection,
  selectionFromHref,
} from "../state/selectionUrl";
import { repositorySnapshotToGraphDataset } from "./graphAdapter";

const hostileMessage = `<img src=x onerror=alert(1)>\u001b[31m\u202e${"Z".repeat(700)}`;
const hostilePath = "src/\u200bconstructor\uff0f__proto__.tsx";
const hostileRef = "refs/heads/\u202e__proto__\u2215constructor";

function hostileSnapshot(): GitRepositorySnapshot {
  const base = createDemoSnapshot("/fixture");
  const commit = base.commits[0]!;
  return {
    ...base,
    commits: [
      {
        ...commit,
        message: hostileMessage,
        authorName: "<svg onload=alert(1)>\u2066",
        files: [
          { path: hostilePath, kind: "text", status: "modified", additions: 1, deletions: 0 },
        ],
      },
      ...base.commits.slice(1),
    ],
    refs: [{ ...base.refs[0]!, name: hostileRef }, ...base.refs.slice(1)],
  };
}

describe("hostile repository data through actual viewport and drilldown", () => {
  it("renders the real viewport's server-side component tree without constructing hostile DOM nodes", () => {
    const dataset = repositorySnapshotToGraphDataset(hostileSnapshot());
    const markup = renderToStaticMarkup(
      <GraphViewport
        dataset={dataset}
        selectedElementId={undefined}
        search=""
        onSelect={() => {}}
      />,
    );
    expect(markup).toContain("viewport");
    expect(markup).not.toMatch(/<img\b|<svg\s+onload|onerror=/i);
    expect(markup).not.toContain("\u202e");
    expect(markup).not.toContain("\u001b");
  });

  it("bounds drilldown labels and rejects unsafe selection links while preserving safe opaque IDs", () => {
    const snapshot = hostileSnapshot();
    const commit = snapshot.commits[0]!;
    const diff: GitCommitDiff = {
      oid: commit.oid,
      files: [{ path: hostilePath, kind: "text", status: "modified", additions: 1, deletions: 0 }],
      truncated: false,
    };
    const child = commitDiffToDrilldownDataset(snapshot, commit, diff);
    const labels = child.nodes.flatMap((node) => (node.label === undefined ? [] : [node.label]));
    expect(labels.some((label) => label.includes("\\u{200B}"))).toBe(true);
    expect(labels.every((label) => Array.from(label).length <= 241)).toBe(true);
    for (const character of ["\u0000", "\u001b", "\u007f", "\u202e"]) {
      expect(labels.join(" ")).not.toContain(character);
    }
    for (const candidate of [
      hostilePath,
      hostileRef,
      hostileMessage,
      "__proto__\u202econstructor",
    ]) {
      const href = hrefWithSelection("https://example.test/inspect", candidate);
      expect(selectionFromHref(href)).toBeUndefined();
    }
    const safe = `commit:${commit.oid}`;
    expect(selectionFromHref(hrefWithSelection("https://example.test/", safe))).toBe(safe);
    const malicious = new URL("https://example.test/?world=file");
    malicious.searchParams.set("worldTarget", hostilePath);
    expect(childNavigationFromHref(malicious.toString()).status).toBe("invalid");
  });

  it("round trips sanitized inspection labels; refuses prototype-key and extra-field import", () => {
    const dataset = repositorySnapshotToGraphDataset(hostileSnapshot());
    const node = dataset.nodes.find((entry) => entry.kind === "commit")!;
    const json = serializeInspectionExport({
      repositoryPath: "/fixture",
      repositoryRevision: "r1",
      navigationDepth: 0,
      node: { ...node, properties: { message: hostileMessage, path: hostilePath } },
    });
    const inspection = parseInspectionExport(json);
    expect(inspection.element.label).not.toContain("\u202e");
    expect(inspection.element.label?.length).toBeLessThanOrEqual(241);
    expect(json).not.toContain("<img");
    expect(json).toContain("\\u003cimg");
    for (const key of ["__proto__", "constructor"]) {
      const poisoned = JSON.parse(json);
      Object.defineProperty(poisoned.element.properties, key, {
        value: { injected: true },
        enumerable: true,
        configurable: true,
      });
      expect(() => parseInspectionExport(JSON.stringify(poisoned))).toThrow(InspectionLimitError);
    }
    const extra = JSON.parse(json);
    extra.unexpected = "ignored?";
    expect(() => parseInspectionExport(JSON.stringify(extra))).toThrow(InspectionLimitError);
  });
});
