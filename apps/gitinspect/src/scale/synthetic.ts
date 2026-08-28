import type { GraphDataset, GraphEdgeRecord, GraphNodeRecord } from "@gitinspect/graph-elements";

function commitId(index: number): string {
  return `commit:${index.toString(16).padStart(12, "0")}`;
}

export function createSyntheticBranchingGitHistory(commitCount = 4_000): GraphDataset {
  if (commitCount < 64) throw new Error("branching history requires at least 64 commits");
  const base = createSyntheticGitHistory(commitCount);
  const divergeIndex = Math.floor(commitCount * 0.35);
  const mergeIndex = Math.floor(commitCount * 0.65);
  const featureIds = ["commit:feature-scale-0", "commit:feature-scale-1"] as const;
  const featureOids = [`${"f".repeat(39)}0`, `${"f".repeat(39)}1`] as const;
  const nodes = base.nodes.map((node) => {
    if (node.id !== commitId(mergeIndex)) return node;
    const parents = Array.isArray(node.properties.parents)
      ? node.properties.parents.filter((value): value is string => typeof value === "string")
      : [];
    return {
      ...node,
      group: "merge",
      properties: {
        ...node.properties,
        parents: [...parents, featureOids[1]],
        isMerge: true,
      },
    };
  });
  nodes.push(
    {
      id: featureIds[0],
      kind: "commit",
      label: "Scale feature peel",
      group: "feature-scale",
      properties: {
        oid: featureOids[0],
        parents: [oid(divergeIndex)],
        committedAtMs: 1_700_000_000_000 + (divergeIndex + 1) * 60_000,
        message: "Scale feature peel",
        files: [],
        tags: [],
        localBranches: [],
        remoteBranches: [],
        isMerge: false,
        isHead: false,
      },
    },
    {
      id: featureIds[1],
      kind: "commit",
      label: "Scale feature tip",
      group: "feature-scale",
      properties: {
        oid: featureOids[1],
        parents: [featureOids[0]],
        committedAtMs: 1_700_000_000_000 + (divergeIndex + 2) * 60_000,
        message: "Scale feature tip",
        files: [],
        tags: [],
        localBranches: ["refs/heads/feature-scale"],
        remoteBranches: [],
        isMerge: false,
        isHead: false,
      },
    },
    {
      id: "ref:refs/heads/feature-scale",
      kind: "local-branch",
      label: "feature-scale",
      group: "refs",
      properties: { name: "refs/heads/feature-scale", targetOid: featureOids[1] },
    },
  );
  const edges = base.edges.map((edge) => {
    const firstParent = edge.properties.firstParent === true || edge.properties.parentIndex === 0;
    const withHeadPath =
      (edge.kind === "history" || edge.kind === "merge-parent") && firstParent
        ? { ...edge, properties: { ...edge.properties, headPath: true } }
        : edge;
    return withHeadPath.target === commitId(mergeIndex) && firstParent
      ? { ...withHeadPath, kind: "merge-parent" }
      : withHeadPath;
  });
  edges.push(
    {
      id: `history:${divergeIndex}:feature-scale:0`,
      source: commitId(divergeIndex),
      target: featureIds[0],
      kind: "history",
      directed: true,
      properties: { parentIndex: 0, firstParent: true },
    },
    {
      id: "history:feature-scale:0:1",
      source: featureIds[0],
      target: featureIds[1],
      kind: "history",
      directed: true,
      properties: { parentIndex: 0, firstParent: true },
    },
    {
      id: `history:feature-scale:1:${mergeIndex}:1`,
      source: featureIds[1],
      target: commitId(mergeIndex),
      kind: "merge-parent",
      directed: true,
      properties: { parentIndex: 1, firstParent: false },
    },
    {
      id: "ref-target:refs/heads/feature-scale",
      source: "ref:refs/heads/feature-scale",
      target: featureIds[1],
      kind: "ref-target",
      directed: true,
      properties: { refKind: "local-branch" },
    },
  );
  return Object.freeze({
    revision: `${base.revision}:branching`,
    nodes: Object.freeze(nodes.sort((left, right) => left.id.localeCompare(right.id))),
    edges: Object.freeze(edges.sort((left, right) => left.id.localeCompare(right.id))),
  });
}

function oid(index: number): string {
  return index.toString(16).padStart(40, "0");
}

export function createSyntheticGitHistory(commitCount: number): GraphDataset {
  if (!Number.isInteger(commitCount) || commitCount < 1) {
    throw new Error("commitCount must be a positive integer");
  }
  const nodes: GraphNodeRecord[] = [];
  const edges: GraphEdgeRecord[] = [];
  const startedAt = 1_700_000_000_000;

  for (let index = 0; index < commitCount; index += 1) {
    const parentIndex = index - 1;
    const mergeParentIndex = index > 32 && index % 997 === 0 ? index - 31 : undefined;
    const parents = [
      ...(parentIndex >= 0 ? [oid(parentIndex)] : []),
      ...(mergeParentIndex !== undefined ? [oid(mergeParentIndex)] : []),
    ];
    const branchName = index === commitCount - 1 ? "refs/heads/main" : undefined;
    nodes.push({
      id: commitId(index),
      kind: "commit",
      label: `Synthetic commit ${index}`,
      group: mergeParentIndex !== undefined ? "merge" : "history",
      weight: index % 997 === 0 ? 2 : 1,
      properties: {
        oid: oid(index),
        parents,
        authorName: `Author ${index % 17}`,
        authoredAtMs: startedAt + index * 60_000,
        committedAtMs: startedAt + index * 60_000,
        message: `Synthetic commit ${index} touches subsystem ${index % 23}`,
        signatureStatus: index % 13 === 0 ? "valid" : "unsigned",
        files:
          index % 37 === 0
            ? [
                {
                  path: `src/module-${index % 101}.ts`,
                  kind: "text",
                  additions: index % 11,
                  deletions: index % 5,
                },
              ]
            : [],
        tags: index > 0 && index % 10_000 === 0 ? [`refs/tags/checkpoint-${index}`] : [],
        localBranches: branchName ? [branchName] : [],
        remoteBranches: [],
        isMerge: mergeParentIndex !== undefined,
        isHead: index === commitCount - 1,
      },
    });
    if (parentIndex >= 0) {
      edges.push({
        id: `history:${parentIndex}:${index}:0`,
        source: commitId(parentIndex),
        target: commitId(index),
        kind: mergeParentIndex !== undefined ? "merge-parent" : "history",
        directed: true,
        weight: 1.2,
        properties: { parentIndex: 0, firstParent: true },
      });
    }
    if (mergeParentIndex !== undefined) {
      edges.push({
        id: `history:${mergeParentIndex}:${index}:1`,
        source: commitId(mergeParentIndex),
        target: commitId(index),
        kind: "merge-parent",
        directed: true,
        properties: { parentIndex: 1, firstParent: false },
      });
    }
  }

  const tip = commitId(commitCount - 1);
  const remoteTarget = commitId(Math.max(0, commitCount - 2));
  nodes.push(
    {
      id: "ref:refs/heads/main",
      kind: "local-branch",
      label: "main",
      group: "refs",
      properties: {
        name: "refs/heads/main",
        targetOid: oid(commitCount - 1),
        upstream: "refs/remotes/origin/main",
      },
    },
    {
      id: "ref:refs/remotes/origin/main",
      kind: "remote-branch",
      label: "origin/main",
      group: "refs",
      properties: {
        name: "refs/remotes/origin/main",
        targetOid: oid(Math.max(0, commitCount - 2)),
        remote: "origin",
      },
    },
    {
      id: "remote:origin",
      kind: "remote",
      label: "origin",
      group: "remotes",
      properties: {
        name: "origin",
        fetchUrls: ["ssh://example.invalid/synthetic.git"],
        pushUrls: ["ssh://example.invalid/synthetic.git"],
      },
    },
    {
      id: "head:HEAD",
      kind: "head",
      label: "HEAD",
      group: "refs",
      properties: {
        targetOid: oid(commitCount - 1),
        symbolicTarget: "refs/heads/main",
      },
    },
  );
  edges.push(
    {
      id: "ref-target:refs/heads/main",
      source: "ref:refs/heads/main",
      target: tip,
      kind: "ref-target",
      directed: true,
      properties: { refKind: "local-branch" },
    },
    {
      id: "ref-target:refs/remotes/origin/main",
      source: "ref:refs/remotes/origin/main",
      target: remoteTarget,
      kind: "ref-target",
      directed: true,
      properties: { refKind: "remote-branch" },
    },
    {
      id: "tracking:main:origin-main",
      source: "ref:refs/heads/main",
      target: "ref:refs/remotes/origin/main",
      kind: "remote-tracking",
      directed: false,
      properties: {},
    },
    {
      id: "remote-membership:origin:main",
      source: "remote:origin",
      target: "ref:refs/remotes/origin/main",
      kind: "remote-membership",
      directed: true,
      properties: {},
    },
    {
      id: "head-symbolic:main",
      source: "head:HEAD",
      target: "ref:refs/heads/main",
      kind: "head-symbolic",
      directed: true,
      properties: {},
    },
  );

  return Object.freeze({
    revision: `synthetic-${commitCount}`,
    nodes: Object.freeze(nodes.sort((left, right) => left.id.localeCompare(right.id))),
    edges: Object.freeze(edges.sort((left, right) => left.id.localeCompare(right.id))),
  });
}
