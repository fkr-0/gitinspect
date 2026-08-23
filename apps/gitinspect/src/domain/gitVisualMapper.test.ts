import { describe, expect, it } from "vitest";
import { planNodeRendering, type GraphNodeRecord, type SelectionState } from "@gitinspect/graph-elements";

import { createDemoSnapshot } from "../services/repository";
import { repositorySnapshotToGraphDataset } from "./graphAdapter";
import { gitVisualMapper, relatedGitSelectionIds } from "./gitVisualMapper";
import { gitEdgeStyleRegistry } from "./gitVisualTheme";

function mappingContext(dataset: ReturnType<typeof repositorySnapshotToGraphDataset>) {
  return {
    dataset,
    revision: dataset.revision,
    nodePositions: new Map(dataset.nodes.map((node) => [node.id, [0, 0, 0] as const])),
  };
}

describe("Git visual mapper", () => {
  it("maps commit file classes and keeps file-level interaction identities", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const commit = dataset.nodes.find((node) => node.kind === "commit" && Array.isArray(node.properties.files) && node.properties.files.length > 1);
    expect(commit).toBeDefined();

    const descriptor = gitVisualMapper.mapNode(commit!, mappingContext(dataset));
    const fileElements = descriptor.elements.filter((element) => element.metadata?.role === "changed-file");
    expect(fileElements.some((element) => element.primitive === "box")).toBe(true);
    expect(fileElements.some((element) => element.primitive === "sphere")).toBe(true);
    expect(fileElements.every((element) => element.interactionKey?.startsWith("file:") === true)).toBe(true);
    expect(descriptor.elements.filter((element) => element.metadata?.role === "branch-indicator").every((element) => element.interactionKey?.startsWith("ref:") === true)).toBe(true);
    expect(descriptor.elements.some((element) => element.metadata?.role === "signature")).toBe(true);
  });

  it("resolves modifier granularities through Git relation semantics", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const commit = dataset.nodes.find(
      (node) =>
        node.kind === "commit" &&
        dataset.edges.some(
          (edge) => edge.target === node.id && edge.properties.firstParent === true,
        ) &&
        dataset.edges.some((edge) => edge.target === node.id && edge.kind === "ref-target"),
    );
    expect(commit).toBeDefined();
    const oid = String(commit!.properties.oid);
    const file = (commit!.properties.files as readonly { readonly path: string }[])[0];
    expect(file).toBeDefined();
    const base = {
      elementId: commit!.id,
      interactionKey: `file:${oid}:${file!.path}`,
      relatedIds: [],
    } satisfies Omit<SelectionState, "granularity">;

    expect(relatedGitSelectionIds({ ...base, granularity: "sub-element" }, dataset)).toEqual([
      `file:${oid}:${file!.path}`,
    ]);
    expect(relatedGitSelectionIds({ ...base, granularity: "node" }, dataset)).toEqual([commit!.id]);

    const edgeGroup = relatedGitSelectionIds({ ...base, granularity: "edge-group" }, dataset);
    expect(edgeGroup.length).toBeGreaterThan(0);
    expect(edgeGroup.every((id) => dataset.edges.some((edge) => edge.id === id))).toBe(true);
    expect(edgeGroup.some((id) => id.startsWith("ref-target:"))).toBe(true);

    const chain = relatedGitSelectionIds({ ...base, granularity: "chain" }, dataset);
    expect(chain[0]).toBe(commit!.id);
    expect(chain.some((id) => id.startsWith("history:"))).toBe(true);

    const cluster = relatedGitSelectionIds({ ...base, granularity: "cluster" }, dataset);
    expect(cluster).toContain(commit!.id);
    expect(cluster.some((id) => id.startsWith("ref:"))).toBe(true);
    expect(cluster.some((id) => id.startsWith("ref-target:"))).toBe(true);
  });

  it("uses branch and tag identities to resolve their own relations and first-parent chains", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const branch = dataset.nodes.find((node) => node.kind === "local-branch");
    const tag = dataset.nodes.find((node) => node.kind === "tag");
    expect(branch).toBeDefined();
    expect(tag).toBeDefined();
    const selection = {
      elementId: branch!.id,
      interactionKey: branch!.id,
      relatedIds: [],
    } satisfies Omit<SelectionState, "granularity">;

    const edgeGroup = relatedGitSelectionIds({ ...selection, granularity: "edge-group" }, dataset);
    expect(edgeGroup.some((id) => id.startsWith("ref-target:"))).toBe(true);
    const chain = relatedGitSelectionIds({ ...selection, granularity: "chain" }, dataset);
    expect(chain[0]).toBe(branch!.id);
    expect(chain.some((id) => id.startsWith("commit:"))).toBe(true);

    const tagSelection = {
      elementId: tag!.id,
      interactionKey: tag!.id,
      relatedIds: [],
    } satisfies Omit<SelectionState, "granularity">;
    const tagEdges = relatedGitSelectionIds(
      { ...tagSelection, granularity: "edge-group" },
      dataset,
    );
    expect(tagEdges.some((id) => id.startsWith("ref-target:refs/tags/"))).toBe(true);
    const tagChain = relatedGitSelectionIds({ ...tagSelection, granularity: "chain" }, dataset);
    expect(tagChain[0]).toBe(tag!.id);
    expect(tagChain.some((id) => id.startsWith("commit:"))).toBe(true);
  });

  it("gives Git node classes recurring distinct primitive grammar", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const context = mappingContext(dataset);
    const local = dataset.nodes.find((node) => node.kind === "local-branch")!;
    const remote = dataset.nodes.find((node) => node.kind === "remote")!;
    const tag = dataset.nodes.find((node) => node.kind === "tag")!;

    const localDescriptor = gitVisualMapper.mapNode(local, context);
    const remoteDescriptor = gitVisualMapper.mapNode(remote, context);
    const tagDescriptor = gitVisualMapper.mapNode(tag, context);
    expect(localDescriptor.elements.some((element) => element.metadata?.role === "branch-stripe")).toBe(true);
    expect(remoteDescriptor.elements.some((element) => element.metadata?.role === "remote-platform")).toBe(true);
    expect(tagDescriptor.elements.some((element) => element.primitive === "octahedron")).toBe(true);
  });

  it("maps semantic edge classes to configurable registered edge styles", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const context = mappingContext(dataset);
    for (const edge of dataset.edges) {
      const descriptor = gitVisualMapper.mapEdge(edge, context);
      expect(gitEdgeStyleRegistry.has(descriptor.style), `${edge.kind}: ${descriptor.style}`).toBe(true);
    }
    const merge = dataset.edges.find((edge) => edge.kind === "merge-parent");
    const tag = dataset.edges.find((edge) => edge.kind === "tag-target");
    expect(merge).toBeDefined();
    expect(tag).toBeDefined();
    expect(gitVisualMapper.mapEdge(merge!, context).style).toBe("git-merge");
    expect(gitVisualMapper.mapEdge(tag!, context).head).toBe("diamond");
  });

  it("keeps render-planning batch count bounded for one thousand simple commits", () => {
    const dataset = repositorySnapshotToGraphDataset(createDemoSnapshot("/work/example"));
    const baseCommit = dataset.nodes.find((node) => node.kind === "commit")!;
    const commits: GraphNodeRecord[] = Array.from({ length: 1_000 }, (_, index) => ({
      ...baseCommit,
      id: `commit:${index.toString(16).padStart(40, "0")}`,
      properties: {
        ...baseCommit.properties,
        oid: index.toString(16).padStart(40, "0"),
        files: [],
        tags: [],
        localBranches: [],
        remoteBranches: [],
        isMerge: false,
      },
    }));
    const synthetic = { revision: "visual-1k", nodes: commits, edges: [] };
    const context = mappingContext(synthetic);
    const descriptors = commits.map((node) => gitVisualMapper.mapNode(node, context));
    const plan = planNodeRendering(descriptors);

    expect(plan.batches.length).toBeLessThan(12);
    expect(plan.labels).toHaveLength(4_000);
  });
});
