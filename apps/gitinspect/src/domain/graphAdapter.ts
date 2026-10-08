import type { GitRefRecord, GitRepositorySnapshot } from "@gitinspect/contracts";
import type { GraphDataset, GraphEdgeRecord, GraphNodeRecord } from "@gitinspect/graph-elements";

type SnapshotWithHeadRef = GitRepositorySnapshot & {
  readonly headRef?: string;
};

export const gitGraphIds = {
  commit: (oid: string) => `commit:${oid}`,
  boundaryCommit: (oid: string) => `commit-boundary:${oid}`,
  object: (oid: string) => `object:${oid}`,
  ref: (name: string) => `ref:${name}`,
  remote: (name: string) => `remote:${name}`,
  head: "head:HEAD",
} as const;

import { sanitizeRepositoryDisplay } from "./displaySanitization";

function firstLine(message: string): string {
  return message.split("\n", 1)[0]?.trim() || "(no commit message)";
}

function refLabel(ref: GitRefRecord): string {
  if (ref.kind === "stash") {
    return ref.name.replace(/^refs\/stash@\{/, "stash@{");
  }
  return ref.name.replace(/^refs\/(heads|remotes|tags)\//, "");
}

function remoteForRef(name: string): string | undefined {
  const match = /^refs\/remotes\/([^/]+)\//.exec(name);
  return match?.[1];
}

function targetNodeId(
  oid: string,
  loadedCommits: ReadonlySet<string>,
  boundaryCommits: ReadonlySet<string>,
): string {
  if (loadedCommits.has(oid)) return gitGraphIds.commit(oid);
  if (boundaryCommits.has(oid)) return gitGraphIds.boundaryCommit(oid);
  return gitGraphIds.object(oid);
}

function headFirstParentEdges(snapshot: GitRepositorySnapshot): ReadonlySet<string> {
  const commitsByOid = new Map(snapshot.commits.map((commit) => [commit.oid, commit] as const));
  const result = new Set<string>();
  let cursor = snapshot.head;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const commit = commitsByOid.get(cursor);
    const parent = commit?.parents[0];
    if (!commit || !parent) break;
    result.add(`${parent}\u0000${commit.oid}`);
    cursor = parent;
  }
  return result;
}

export function repositorySnapshotToGraphDataset(snapshot: GitRepositorySnapshot): GraphDataset {
  const headRef = (snapshot as SnapshotWithHeadRef).headRef;
  const activeHistory = headFirstParentEdges(snapshot);
  const loadedCommitOids = new Set(snapshot.commits.map((commit) => commit.oid));
  const boundaryCommitOids = new Set(
    snapshot.commits
      .flatMap((commit) => commit.parents)
      .filter((oid) => !loadedCommitOids.has(oid)),
  );
  const unresolvedObjectOids = new Set(
    snapshot.refs
      .map((ref) => ref.targetOid)
      .filter((oid) => !loadedCommitOids.has(oid) && !boundaryCommitOids.has(oid)),
  );
  if (
    snapshot.head &&
    !loadedCommitOids.has(snapshot.head) &&
    !boundaryCommitOids.has(snapshot.head)
  ) {
    unresolvedObjectOids.add(snapshot.head);
  }

  const refsByTarget = new Map<string, GitRefRecord[]>();
  for (const ref of snapshot.refs) {
    const refs = refsByTarget.get(ref.targetOid) ?? [];
    refs.push(ref);
    refsByTarget.set(ref.targetOid, refs);
  }
  for (const refs of refsByTarget.values()) {
    refs.sort((left, right) => left.name.localeCompare(right.name));
  }

  const commitNodes: GraphNodeRecord[] = snapshot.commits.map((commit) => {
    const targetRefs = refsByTarget.get(commit.oid) ?? [];
    const tags = targetRefs.filter((ref) => ref.kind === "tag").map((ref) => ref.name);
    const localBranches = targetRefs
      .filter((ref) => ref.kind === "local-branch")
      .map((ref) => ref.name);
    const remoteBranches = targetRefs
      .filter((ref) => ref.kind === "remote-branch")
      .map((ref) => ref.name);

    return {
      id: gitGraphIds.commit(commit.oid),
      kind: "commit",
      label: sanitizeRepositoryDisplay(firstLine(commit.message)),
      group: commit.parents.length > 1 ? "merge" : "history",
      weight: 1 + Math.log1p(commit.files.length),
      properties: {
        oid: commit.oid,
        treeOid: commit.treeOid,
        parents: commit.parents,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        authoredAtMs: commit.authoredAtMs,
        committedAtMs: commit.committedAtMs,
        message: commit.message,
        signatureStatus: commit.signatureStatus,
        files: commit.files,
        tags,
        localBranches,
        remoteBranches,
        isMerge: commit.parents.length > 1,
        isHead: snapshot.head === commit.oid,
      },
    };
  });

  const boundaryNodes: GraphNodeRecord[] = [...boundaryCommitOids]
    .sort((left, right) => left.localeCompare(right))
    .map((oid) => ({
      id: gitGraphIds.boundaryCommit(oid),
      kind: "commit-boundary",
      label: `${oid.slice(0, 10)}…`,
      group: "history-boundary",
      properties: { oid, truncatedBoundary: true },
    }));

  const objectNodes: GraphNodeRecord[] = [...unresolvedObjectOids]
    .sort((left, right) => left.localeCompare(right))
    .map((oid) => ({
      id: gitGraphIds.object(oid),
      kind: "git-object",
      label: `${oid.slice(0, 10)}…`,
      group: "unresolved-objects",
      properties: { oid, loaded: false },
    }));

  const refNodes: GraphNodeRecord[] = snapshot.refs.map((ref) => ({
    id: gitGraphIds.ref(ref.name),
    kind: ref.kind,
    label: sanitizeRepositoryDisplay(refLabel(ref)),
    group: ref.kind === "stash" ? "stashes" : "refs",
    properties: {
      name: ref.name,
      targetOid: ref.targetOid,
      symbolicTarget: ref.symbolicTarget,
      upstream: ref.upstream,
      ahead: ref.ahead,
      behind: ref.behind,
      remote: remoteForRef(ref.name),
      annotationDetailsAvailable: false,
    },
  }));

  const remoteNodes: GraphNodeRecord[] = snapshot.remotes.map((remote) => ({
    id: gitGraphIds.remote(remote.name),
    kind: "remote",
    label: sanitizeRepositoryDisplay(remote.name),
    group: "remotes",
    properties: {
      name: remote.name,
      fetchUrls: remote.fetchUrls,
      pushUrls: remote.pushUrls,
    },
  }));

  const headNodes: GraphNodeRecord[] =
    snapshot.head || headRef
      ? [
          {
            id: gitGraphIds.head,
            kind: "head",
            label: "HEAD",
            group: "refs",
            properties: {
              targetOid: snapshot.head,
              symbolicTarget: headRef,
            },
          },
        ]
      : [];

  const historyEdges: GraphEdgeRecord[] = snapshot.commits.flatMap((commit) =>
    commit.parents.map((parentOid, parentIndex) => ({
      id: `history:${parentOid}:${commit.oid}:${parentIndex}`,
      source: targetNodeId(parentOid, loadedCommitOids, boundaryCommitOids),
      target: gitGraphIds.commit(commit.oid),
      kind: commit.parents.length > 1 ? "merge-parent" : "history",
      directed: true,
      weight: parentIndex === 0 ? 1.2 : 1,
      properties: {
        parentIndex,
        firstParent: parentIndex === 0,
        headPath:
          parentIndex === 0 && activeHistory.has(`${parentOid}\u0000${commit.oid}`),
      },
    })),
  );

  const refEdges: GraphEdgeRecord[] = snapshot.refs.map((ref) => ({
    id: `ref-target:${ref.name}`,
    source: gitGraphIds.ref(ref.name),
    target: targetNodeId(ref.targetOid, loadedCommitOids, boundaryCommitOids),
    kind: ref.kind === "tag" ? "tag-target" : ref.kind === "stash" ? "stash-base" : "ref-target",
    directed: true,
    properties: {
      refKind: ref.kind,
      targetOid: ref.targetOid,
    },
  }));

  const refsByName = new Set(snapshot.refs.map((ref) => ref.name));
  const trackingEdges: GraphEdgeRecord[] = snapshot.refs
    .filter((ref) => ref.kind === "local-branch" && ref.upstream && refsByName.has(ref.upstream))
    .map((ref) => ({
      id: `tracking:${ref.name}:${ref.upstream}`,
      source: gitGraphIds.ref(ref.name),
      target: gitGraphIds.ref(ref.upstream as string),
      kind: "remote-tracking",
      directed: false,
      properties: {
        localRef: ref.name,
        upstreamRef: ref.upstream,
        ahead: ref.ahead,
        behind: ref.behind,
      },
    }));

  const knownRemotes = new Set(snapshot.remotes.map((remote) => remote.name));
  const remoteMembershipEdges: GraphEdgeRecord[] = snapshot.refs.flatMap((ref) => {
    const remote = remoteForRef(ref.name);
    if (!remote || !knownRemotes.has(remote)) return [];
    return [
      {
        id: `remote-membership:${remote}:${ref.name}`,
        source: gitGraphIds.remote(remote),
        target: gitGraphIds.ref(ref.name),
        kind: "remote-membership",
        directed: true,
        properties: { remote, ref: ref.name },
      },
    ];
  });

  const headEdges: GraphEdgeRecord[] =
    headNodes.length === 0
      ? []
      : headRef && refsByName.has(headRef)
        ? [
            {
              id: `head-symbolic:${headRef}`,
              source: gitGraphIds.head,
              target: gitGraphIds.ref(headRef),
              kind: "head-symbolic",
              directed: true,
              properties: { symbolicTarget: headRef, targetOid: snapshot.head },
            },
          ]
        : snapshot.head
          ? [
              {
                id: `head-resolved:${snapshot.head}`,
                source: gitGraphIds.head,
                target: targetNodeId(snapshot.head, loadedCommitOids, boundaryCommitOids),
                kind: "head-resolved",
                directed: true,
                properties: { targetOid: snapshot.head },
              },
            ]
          : [];

  const nodes = [
    ...commitNodes,
    ...boundaryNodes,
    ...objectNodes,
    ...refNodes,
    ...remoteNodes,
    ...headNodes,
  ].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [
    ...historyEdges,
    ...refEdges,
    ...trackingEdges,
    ...remoteMembershipEdges,
    ...headEdges,
  ].sort((left, right) => left.id.localeCompare(right.id));

  return {
    revision: snapshot.revision,
    nodes,
    edges,
  };
}
