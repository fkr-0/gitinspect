import { describe, expect, it } from "vitest";

import { createDemoSnapshot } from "../services/repository";
import { repositorySnapshotToGraphDataset } from "./graphAdapter";
import { buildGitTopologyContext, gitTopologyPromotionIds } from "./gitTopology";

describe("Git topology context", () => {
  it("explains a selected merge through parents, children, attachments, and merge ingress", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/demo/gitinspect"));
    const merge = dataset.nodes.find(
      (node) => node.kind === "commit" && node.properties.isMerge === true,
    );
    expect(merge).toBeDefined();
    const context = buildGitTopologyContext(dataset, merge!.id);

    expect(context.immediateParentIds.size).toBe(2);
    expect(context.mergeIngressEdgeIds.size).toBeGreaterThan(0);
    expect([...context.mergeIngressEdgeIds].every((id) => context.focusEdgeIds.has(id))).toBe(true);
    expect(context.focusNodeIds.has(merge!.id)).toBe(true);
    expect(context.labelPriorityById.get(merge!.id)).toBeGreaterThan(1_000);
  });

  it("resolves branch/tag/HEAD signals back to their commit and keeps attached signals local", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/demo/gitinspect"));
    const branch = dataset.nodes.find((node) => node.kind === "local-branch")!;
    const target = dataset.edges.find(
      (edge) => edge.source === branch.id && edge.kind === "ref-target",
    )!;
    const context = buildGitTopologyContext(dataset, branch.id);

    expect(context.selectedCommitId).toBe(target.target);
    expect(context.attachmentIds.has(branch.id)).toBe(true);
    expect(context.focusEdgeIds.has(target.id)).toBe(true);
  });

  it("hard-promotes structural anchors while leaving ordinary linear commits collapsible", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/demo/gitinspect"));
    const promoted = gitTopologyPromotionIds(dataset);
    const merge = dataset.nodes.find(
      (node) => node.kind === "commit" && node.properties.isMerge === true,
    )!;
    const head = dataset.nodes.find((node) => node.kind === "head")!;
    const ordinary = dataset.nodes.find(
      (node) =>
        node.kind === "commit" &&
        node.properties.isMerge !== true &&
        node.properties.isHead !== true &&
        !dataset.edges.some(
          (edge) =>
            ["ref-target", "tag-target", "stash-base", "head-resolved"].includes(edge.kind) &&
            edge.target === node.id,
        ),
    );

    expect(promoted.has(merge.id)).toBe(true);
    expect(promoted.has(head.id)).toBe(true);
    expect(ordinary).toBeDefined();
    expect(promoted.has(ordinary!.id)).toBe(false);
  });
});
