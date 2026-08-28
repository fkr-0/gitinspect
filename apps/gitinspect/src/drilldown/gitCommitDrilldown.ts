import type {
  GitCommitDiff,
  GitCommitFileChange,
  GitCommitFileDetail,
  GitCommitRecord,
  GitRepositorySnapshot,
} from "@gitinspect/contracts";
import type {
  ChildWorldResolver,
  GraphDataset,
  GraphEdgeRecord,
  GraphNodeRecord,
  WorldNavigationFrame,
} from "@gitinspect/graph-elements";

import { GitCommitDiffCache } from "../inspection/gitCommitDiffCache";
import type { RepositoryService, RepositorySession } from "../services/repository";

const ROOT_COMMIT_PREFIX = "commit:";
const CHILD_COMMIT_PREFIX = "commit-core:";
const FILE_PREFIX = "commit-file:";
const PARENT_PREFIX = "commit-parent:";
const CONTEXT_REF_PREFIX = "commit-ref:";
const FILE_CORE_PREFIX = "file-core:";
const FILE_HUNK_PREFIX = "file-hunk:";
const FILE_BLOB_PREFIX = "file-blob:";

function firstLine(message: string): string {
  return message.split("\n", 1)[0]?.trim() || "(no commit message)";
}

function commitOidFromElementId(elementId: string): string | undefined {
  if (!elementId.startsWith(ROOT_COMMIT_PREFIX)) return undefined;
  const oid = elementId.slice(ROOT_COMMIT_PREFIX.length);
  return oid.length > 0 ? oid : undefined;
}

function fileNodeId(oid: string, path: string): string {
  return `${FILE_PREFIX}${oid}:${encodeURIComponent(path)}`;
}

function fileCoreNodeId(oid: string, path: string): string {
  return `${FILE_CORE_PREFIX}${oid}:${encodeURIComponent(path)}`;
}

function fileHunkNodeId(oid: string, path: string, index: number): string {
  return `${FILE_HUNK_PREFIX}${oid}:${encodeURIComponent(path)}:${index}`;
}

function fileBlobNodeId(oid: string, path: string, side: "old" | "new"): string {
  return `${FILE_BLOB_PREFIX}${oid}:${encodeURIComponent(path)}:${side}`;
}

function commitFileTargetFromElementId(
  elementId: string,
): { readonly oid: string; readonly path: string } | undefined {
  if (!elementId.startsWith(FILE_PREFIX)) return undefined;
  const remainder = elementId.slice(FILE_PREFIX.length);
  const separator = remainder.indexOf(":");
  if (separator <= 0 || separator === remainder.length - 1) return undefined;
  const oid = remainder.slice(0, separator);
  try {
    const path = decodeURIComponent(remainder.slice(separator + 1));
    return path.length > 0 ? { oid, path } : undefined;
  } catch {
    return undefined;
  }
}

function fileKind(change: GitCommitFileChange): string {
  return `changed-file-${change.kind}`;
}

function fileWeight(change: GitCommitFileChange): number {
  const touchedLines = change.additions + change.deletions;
  return 1 + Math.log1p(touchedLines + (change.bytes ?? 0) / 4096);
}

function commitNode(commit: GitCommitRecord): GraphNodeRecord {
  return {
    id: `${CHILD_COMMIT_PREFIX}${commit.oid}`,
    kind: "commit-core",
    label: firstLine(commit.message),
    group: "commit-core",
    weight: 3,
    positionHint: [0, 0, 0],
    properties: {
      oid: commit.oid,
      treeOid: commit.treeOid,
      parents: commit.parents,
      authorName: commit.authorName,
      ...(commit.authorEmail === undefined ? {} : { authorEmail: commit.authorEmail }),
      authoredAtMs: commit.authoredAtMs,
      committedAtMs: commit.committedAtMs,
      message: commit.message,
      signatureStatus: commit.signatureStatus,
      isMerge: commit.parents.length > 1,
    },
  };
}

function fileNodes(oid: string, files: readonly GitCommitFileChange[]): GraphNodeRecord[] {
  return files.map((change, index) => {
    const angle = (index / Math.max(files.length, 1)) * Math.PI * 2;
    const radius = 6 + Math.min(8, Math.log1p(files.length));
    return {
      id: fileNodeId(oid, change.path),
      kind: fileKind(change),
      label: change.path,
      group: `status:${change.status}`,
      weight: fileWeight(change),
      positionHint: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
      properties: {
        path: change.path,
        fileKind: change.kind,
        status: change.status,
        additions: change.additions,
        deletions: change.deletions,
        ...(change.bytes === undefined ? {} : { bytes: change.bytes }),
        boundedSummaryOnly: true,
      },
    };
  });
}

function parentNodes(snapshot: GitRepositorySnapshot, commit: GitCommitRecord): GraphNodeRecord[] {
  const loaded = new Map(snapshot.commits.map((candidate) => [candidate.oid, candidate]));
  return commit.parents.map((oid, index) => {
    const parent = loaded.get(oid);
    return {
      id: `${PARENT_PREFIX}${oid}`,
      kind: "commit-parent-context",
      label: parent ? firstLine(parent.message) : `${oid.slice(0, 10)}…`,
      group: "parent-context",
      positionHint: [-8, 2 - index * 4, 0],
      properties: {
        oid,
        loaded: parent !== undefined,
        parentIndex: index,
      },
    };
  });
}

function contextRefNodes(snapshot: GitRepositorySnapshot, oid: string): GraphNodeRecord[] {
  return snapshot.refs
    .filter((ref) => ref.targetOid === oid)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((ref, index) => ({
      id: `${CONTEXT_REF_PREFIX}${encodeURIComponent(ref.name)}`,
      kind: `context-${ref.kind}`,
      label: ref.name.replace(/^refs\/(heads|remotes|tags)\//, ""),
      group: "ref-context",
      positionHint: [8, 3 - index * 3, 0],
      properties: {
        name: ref.name,
        targetOid: ref.targetOid,
        refKind: ref.kind,
        ...(ref.symbolicTarget === undefined ? {} : { symbolicTarget: ref.symbolicTarget }),
        ...(ref.upstream === undefined ? {} : { upstream: ref.upstream }),
      },
    }));
}

function buildEdges(
  commit: GitCommitRecord,
  diff: GitCommitDiff,
  contextRefs: readonly GraphNodeRecord[],
): GraphEdgeRecord[] {
  const coreId = `${CHILD_COMMIT_PREFIX}${commit.oid}`;
  const fileEdges: GraphEdgeRecord[] = diff.files.map((change) => ({
    id: `commit-change:${commit.oid}:${encodeURIComponent(change.path)}`,
    source: coreId,
    target: fileNodeId(commit.oid, change.path),
    kind: `commit-change-${change.status}`,
    directed: true,
    weight: fileWeight(change),
    properties: {
      path: change.path,
      status: change.status,
    },
  }));
  const parentEdges: GraphEdgeRecord[] = commit.parents.map((oid, index) => ({
    id: `commit-parent-context:${oid}:${commit.oid}:${index}`,
    source: `${PARENT_PREFIX}${oid}`,
    target: coreId,
    kind: index === 0 ? "first-parent-context" : "merge-parent-context",
    directed: true,
    properties: { parentIndex: index },
  }));
  const refEdges: GraphEdgeRecord[] = contextRefs.map((ref) => ({
    id: `commit-ref-context:${ref.id}:${commit.oid}`,
    source: ref.id,
    target: coreId,
    kind: "ref-context",
    directed: true,
    properties: {},
  }));
  return [...fileEdges, ...parentEdges, ...refEdges].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export function commitDiffToDrilldownDataset(
  snapshot: GitRepositorySnapshot,
  commit: GitCommitRecord,
  diff: GitCommitDiff,
): GraphDataset {
  const files = fileNodes(commit.oid, diff.files);
  const parents = parentNodes(snapshot, commit);
  const refs = contextRefNodes(snapshot, commit.oid);
  const nodes = [commitNode(commit), ...files, ...parents, ...refs].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return {
    revision: `${snapshot.revision}:commit:${commit.oid}`,
    nodes,
    edges: buildEdges(commit, diff, refs),
  };
}

export function commitFileDetailToDrilldownDataset(
  snapshotRevision: string,
  detail: GitCommitFileDetail,
): GraphDataset {
  const coreId = fileCoreNodeId(detail.oid, detail.path);
  const core: GraphNodeRecord = {
    id: coreId,
    kind: "file-detail-core",
    label: detail.path,
    group: `file:${detail.status}`,
    weight: 3,
    positionHint: [0, 0, 0],
    properties: {
      oid: detail.oid,
      path: detail.path,
      status: detail.status,
      fileKind: detail.kind,
      contentStatus: detail.contentStatus,
      hunkCount: detail.hunks.length,
      truncated: detail.truncated,
      boundedDetail: true,
      ...(detail.oldOid === undefined ? {} : { oldOid: detail.oldOid }),
      ...(detail.newOid === undefined ? {} : { newOid: detail.newOid }),
      ...(detail.oldBytes === undefined ? {} : { oldBytes: detail.oldBytes }),
      ...(detail.newBytes === undefined ? {} : { newBytes: detail.newBytes }),
    },
  };
  const hunks: GraphNodeRecord[] = detail.hunks.map((hunk, index) => {
    const additions = hunk.lines.filter((line) => line.kind === "addition").length;
    const deletions = hunk.lines.filter((line) => line.kind === "deletion").length;
    const angle = (index / Math.max(detail.hunks.length, 1)) * Math.PI * 2;
    const radius = 6 + Math.min(5, Math.log1p(detail.hunks.length));
    return {
      id: fileHunkNodeId(detail.oid, detail.path, index),
      kind: "diff-hunk",
      label: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      group: "patch-hunk",
      weight: 1 + Math.log1p(hunk.lines.length),
      positionHint: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
      properties: {
        oid: detail.oid,
        path: detail.path,
        hunkIndex: index,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lineCount: hunk.lines.length,
        additions,
        deletions,
        boundedPatchMetadata: true,
      },
    };
  });
  const blobCandidates = [
    { side: "old" as const, oid: detail.oldOid, bytes: detail.oldBytes, x: -8 },
    { side: "new" as const, oid: detail.newOid, bytes: detail.newBytes, x: 8 },
  ];
  const blobs: GraphNodeRecord[] = blobCandidates.flatMap(({ side, oid, bytes, x }) =>
    oid === undefined
      ? []
      : [
          {
            id: fileBlobNodeId(detail.oid, detail.path, side),
            kind: "file-blob-context",
            label: `${side} ${oid.slice(0, 10)}…`,
            group: `blob:${side}`,
            weight: 1.5,
            positionHint: [x, -4, 0] as const,
            properties: {
              commitOid: detail.oid,
              path: detail.path,
              side,
              oid,
              ...(bytes === undefined ? {} : { bytes }),
              contentStatus: detail.contentStatus,
              boundedMetadataOnly: true,
            },
          },
        ],
  );
  const edges: GraphEdgeRecord[] = [
    ...hunks.map((node, index) => ({
      id: `file-hunk-edge:${detail.oid}:${encodeURIComponent(detail.path)}:${index}`,
      source: coreId,
      target: node.id,
      kind: "file-hunk",
      directed: true,
      properties: { hunkIndex: index },
    })),
    ...blobs.map((node) => ({
      id: `file-blob-edge:${node.id}`,
      source: node.id,
      target: coreId,
      kind: "file-blob-context",
      directed: true,
      properties: {},
    })),
  ];
  return {
    revision: `${snapshotRevision}:commit:${detail.oid}:file:${encodeURIComponent(detail.path)}`,
    nodes: [core, ...hunks, ...blobs].sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function childFrame(
  session: RepositorySession,
  commit: GitCommitRecord,
  diff: GitCommitDiff,
): WorldNavigationFrame {
  const dataset = commitDiffToDrilldownDataset(session.snapshot, commit, diff);
  const coreId = `${CHILD_COMMIT_PREFIX}${commit.oid}`;
  return {
    datasetIdentity: `${session.key}:${session.snapshot.revision}:commit:${commit.oid}`,
    dataset,
    mapperKey: "git-commit-drilldown-v1",
    layoutKey: "git-commit-files-v1",
    selectionId: coreId,
    camera: {
      mode: "attached",
      position: [0, 4, 18],
      target: [0, 0, 0],
      attachedNodeId: coreId,
      zoom: 1,
    },
  };
}

function fileDetailFrame(
  session: RepositorySession,
  detail: GitCommitFileDetail,
): WorldNavigationFrame {
  const dataset = commitFileDetailToDrilldownDataset(session.snapshot.revision, detail);
  const coreId = fileCoreNodeId(detail.oid, detail.path);
  return {
    datasetIdentity: `${session.key}:${dataset.revision}`,
    dataset,
    mapperKey: "git-file-detail-drilldown-v1",
    layoutKey: "git-file-hunks-v1",
    selectionId: coreId,
    camera: {
      mode: "attached",
      position: [0, 3, 15],
      target: [0, 0, 0],
      attachedNodeId: coreId,
      zoom: 1,
    },
  };
}

export class GitCommitDrilldownResolver {
  private readonly diffCache: GitCommitDiffCache;

  constructor(
    repositoryService: RepositoryService,
    private readonly currentSession: () => RepositorySession,
    diffCache?: GitCommitDiffCache,
  ) {
    this.diffCache = diffCache ?? new GitCommitDiffCache(repositoryService);
  }

  readonly resolve: ChildWorldResolver = async ({ parent, elementId }) => {
    const session = this.currentSession();
    const oid = commitOidFromElementId(elementId);
    if (oid) {
      if (parent.dataset.revision !== session.snapshot.revision) return undefined;
      const commit = session.snapshot.commits.find((candidate) => candidate.oid === oid);
      if (!commit) return undefined;

      const diff = await this.diffCache.get(session, oid);
      if (!this.sessionStillCurrent(session)) return undefined;
      return childFrame(session, commit, diff);
    }

    const fileTarget = commitFileTargetFromElementId(elementId);
    if (!fileTarget) return undefined;
    if (parent.dataset.revision !== `${session.snapshot.revision}:commit:${fileTarget.oid}`) {
      return undefined;
    }
    const sourceNode = parent.dataset.nodes.find((node) => node.id === elementId);
    if (
      !sourceNode?.kind.startsWith("changed-file-") ||
      sourceNode.properties.path !== fileTarget.path
    ) {
      return undefined;
    }

    const detail = await this.diffCache.getFileDetail(session, fileTarget.oid, fileTarget.path);
    if (!this.sessionStillCurrent(session)) return undefined;
    if (detail.oid !== fileTarget.oid || detail.path !== fileTarget.path) return undefined;
    return fileDetailFrame(session, detail);
  };

  private sessionStillCurrent(session: RepositorySession): boolean {
    const current = this.currentSession();
    return current.key === session.key && current.snapshot.revision === session.snapshot.revision;
  }

  clear(): void {
    this.diffCache.clear();
  }
}
