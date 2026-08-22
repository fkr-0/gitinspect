import type { GitRepositorySnapshot } from "@gitinspect/contracts";
import type {
  GraphDataset,
  GraphEdgeRecord,
  GraphNodeRecord,
} from "@gitinspect/graph-elements";

function commitNodeId(oid: string): string {
  return `commit:${oid}`;
}

export function repositorySnapshotToGraphDataset(
  snapshot: GitRepositorySnapshot,
): GraphDataset {
  const commitNodes: GraphNodeRecord[] = snapshot.commits.map((commit, index) => ({
    id: commitNodeId(commit.oid),
    kind: "commit",
    label: commit.message.split("\n", 1)[0] || commit.oid.slice(0, 10),
    group: commit.parents.length > 1 ? "merge" : "history",
    positionHint: [0, snapshot.commits.length - index, 0],
    properties: {
      oid: commit.oid,
      authorName: commit.authorName,
      authoredAtMs: commit.authoredAtMs,
      parentCount: commit.parents.length,
      changedFiles: commit.files.length,
      signatureStatus: commit.signatureStatus,
    },
  }));

  const refNodes: GraphNodeRecord[] = snapshot.refs.map((ref) => ({
    id: `ref:${ref.name}`,
    kind: ref.kind,
    label: ref.name.replace(/^refs\/(heads|remotes|tags)\//, ""),
    group: "refs",
    properties: {
      name: ref.name,
      targetOid: ref.targetOid,
      upstream: ref.upstream,
      ahead: ref.ahead,
      behind: ref.behind,
    },
  }));

  const remoteNodes: GraphNodeRecord[] = snapshot.remotes.map((remote) => ({
    id: `remote:${remote.name}`,
    kind: "remote",
    label: remote.name,
    group: "remotes",
    properties: {
      fetchUrls: remote.fetchUrls,
      pushUrls: remote.pushUrls,
    },
  }));

  const historyEdges: GraphEdgeRecord[] = snapshot.commits.flatMap((commit) =>
    commit.parents.map((parentOid, parentIndex) => ({
      id: `history:${parentOid}:${commit.oid}:${parentIndex}`,
      source: commitNodeId(parentOid),
      target: commitNodeId(commit.oid),
      kind: commit.parents.length > 1 ? "merge-parent" : "history",
      directed: true,
      properties: { parentIndex },
    })),
  );

  const refEdges: GraphEdgeRecord[] = snapshot.refs.map((ref) => ({
    id: `ref-target:${ref.name}`,
    source: `ref:${ref.name}`,
    target: commitNodeId(ref.targetOid),
    kind: "ref-target",
    directed: true,
    properties: { refKind: ref.kind },
  }));

  return {
    revision: snapshot.revision,
    nodes: [...commitNodes, ...refNodes, ...remoteNodes],
    edges: [...historyEdges, ...refEdges],
  };
}
