import type {
  GitCommitRecord,
  GitRefRecord,
  GitRemoteRecord,
  GitRepositorySnapshot,
} from "@gitinspect/contracts";

import type { RepositorySession } from "./repository";

type CompactSignatureStatus = 0 | 1 | 2 | 3;

export type CompactGitCommitRecord = readonly [
  oid: number,
  treeOid: number,
  parents: readonly number[],
  authorName: number,
  authorEmail: number | null,
  authoredAtMs: number,
  committedAtMs: number,
  message: number,
  signatureStatus: CompactSignatureStatus,
];

export interface CompactGitRepositorySnapshot {
  readonly schemaVersion: number;
  readonly repositoryPath: string;
  readonly gitDir: string;
  readonly head?: string;
  readonly headRef?: string;
  readonly revision: string;
  readonly strings: readonly string[];
  readonly commits: readonly CompactGitCommitRecord[];
  readonly refs: readonly GitRefRecord[];
  readonly remotes: readonly GitRemoteRecord[];
  readonly hooks: readonly string[];
  readonly truncated: boolean;
}

export interface CompactGitCommitBatch {
  readonly strings: readonly string[];
  readonly commits: readonly CompactGitCommitRecord[];
}

export interface CompactRepositoryAppendDelta {
  readonly baseRevision: string;
  readonly baseHead: string;
  readonly revision: string;
  readonly head: string;
  readonly headRef: string;
  readonly commits: CompactGitCommitBatch;
  readonly refs: readonly GitRefRecord[];
  readonly remotes: readonly GitRemoteRecord[];
  readonly hooks: readonly string[];
  readonly dropCommitCount: number;
  readonly truncated: boolean;
}

export interface CompactRepositorySession {
  readonly key: string;
  readonly snapshot: CompactGitRepositorySnapshot;
}

export type CompactRepositoryRefreshResult =
  | { readonly status: "unchanged"; readonly revision: string }
  | { readonly status: "changed"; readonly session: CompactRepositorySession };

export type CompactRepositoryDeltaRefreshResult =
  | { readonly status: "unchanged"; readonly revision: string }
  | { readonly status: "delta"; readonly delta: CompactRepositoryAppendDelta }
  | { readonly status: "full"; readonly session: CompactRepositorySession };

const SIGNATURE_STATUS = ["valid", "invalid", "unknown", "unsigned"] as const;

function stringAt(strings: readonly string[], index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= strings.length) {
    throw new Error(`Invalid compact repository string index: ${index}`);
  }
  const value = strings[index];
  if (value === undefined) throw new Error(`Invalid compact repository string index: ${index}`);
  return value;
}

function signatureStatus(code: number): GitCommitRecord["signatureStatus"] {
  const status = SIGNATURE_STATUS[code];
  if (!status) throw new Error(`Invalid compact repository signature status: ${code}`);
  return status;
}

function decodeCommit(
  strings: readonly string[],
  compact: CompactGitCommitRecord,
): GitCommitRecord {
  if (compact.length !== 9) throw new Error("Invalid compact repository commit tuple");
  const [
    oid,
    treeOid,
    parents,
    authorName,
    authorEmail,
    authoredAtMs,
    committedAtMs,
    message,
    status,
  ] = compact;
  return {
    oid: stringAt(strings, oid),
    treeOid: stringAt(strings, treeOid),
    parents: parents.map((index) => stringAt(strings, index)),
    authorName: stringAt(strings, authorName),
    ...(authorEmail === null ? {} : { authorEmail: stringAt(strings, authorEmail) }),
    authoredAtMs,
    committedAtMs,
    message: stringAt(strings, message),
    signatureStatus: signatureStatus(status),
    files: [],
  };
}

export function decodeCompactCommitBatch(batch: CompactGitCommitBatch): readonly GitCommitRecord[] {
  return batch.commits.map((commit) => decodeCommit(batch.strings, commit));
}

export function applyCompactRepositoryAppendDelta(
  session: RepositorySession,
  delta: CompactRepositoryAppendDelta,
): RepositorySession {
  const base = session.snapshot;
  if (delta.baseRevision !== base.revision) {
    throw new Error(
      `Compact repository delta base revision mismatch: ${delta.baseRevision} != ${base.revision}`,
    );
  }
  if (!base.head) throw new Error("Compact repository delta requires a resolved base HEAD");
  if (delta.baseHead !== base.head) {
    throw new Error(
      `Compact repository delta base HEAD mismatch: ${delta.baseHead} != ${base.head}`,
    );
  }
  if (!base.headRef || delta.headRef !== base.headRef) {
    throw new Error("Compact repository delta cannot switch the authoritative HEAD ref");
  }
  if (delta.revision === base.revision) {
    throw new Error("Compact repository delta must advance the repository revision");
  }
  if (!Number.isSafeInteger(delta.dropCommitCount) || delta.dropCommitCount < 0) {
    throw new Error(`Invalid compact repository delta drop count: ${delta.dropCommitCount}`);
  }
  if (delta.dropCommitCount > base.commits.length) {
    throw new Error("Compact repository delta drops more commits than the base snapshot contains");
  }

  const appended = decodeCompactCommitBatch(delta.commits);
  const firstAppended = appended[0];
  if (appended.length === 0 || !firstAppended || firstAppended.oid !== delta.head) {
    throw new Error("Compact repository delta does not start at refreshed HEAD");
  }
  for (let index = 0; index < appended.length; index += 1) {
    const commit = appended[index];
    if (!commit) throw new Error("Compact repository delta has unexpected gap");
    const nextCommit = appended[index + 1];
    const expectedParent = index + 1 < appended.length && nextCommit ? nextCommit.oid : base.head;
    if (commit.parents.length !== 1 || commit.parents[0] !== expectedParent) {
      throw new Error("Compact repository delta is not a linear append from the base HEAD");
    }
  }
  const headRef = delta.refs.find((reference) => reference.name === delta.headRef);
  if (!headRef || headRef.targetOid !== delta.head) {
    throw new Error("Compact repository delta HEAD ref metadata is inconsistent");
  }

  const retained = base.commits.slice(0, base.commits.length - delta.dropCommitCount);
  const retainedOids = new Set(retained.map((commit) => commit.oid));
  if (appended.some((commit) => retainedOids.has(commit.oid))) {
    throw new Error("Compact repository delta duplicates a retained base commit");
  }
  return {
    key: session.key,
    snapshot: {
      schemaVersion: base.schemaVersion,
      repositoryPath: base.repositoryPath,
      gitDir: base.gitDir,
      head: delta.head,
      headRef: delta.headRef,
      revision: delta.revision,
      commits: [...appended, ...retained],
      refs: delta.refs,
      remotes: delta.remotes,
      hooks: delta.hooks,
      truncated: delta.truncated,
    },
  };
}

export function decodeCompactRepositorySnapshot(
  compact: CompactGitRepositorySnapshot,
): GitRepositorySnapshot {
  if (compact.schemaVersion !== 1) {
    throw new Error(`Unsupported compact repository schema version: ${compact.schemaVersion}`);
  }
  return {
    schemaVersion: 1,
    repositoryPath: compact.repositoryPath,
    gitDir: compact.gitDir,
    ...(compact.head === undefined ? {} : { head: compact.head }),
    ...(compact.headRef === undefined ? {} : { headRef: compact.headRef }),
    revision: compact.revision,
    commits: compact.commits.map((commit) => decodeCommit(compact.strings, commit)),
    refs: compact.refs,
    remotes: compact.remotes,
    hooks: compact.hooks,
    truncated: compact.truncated,
  };
}

export function decodeCompactRepositorySession(
  compact: CompactRepositorySession,
): RepositorySession {
  return {
    key: compact.key,
    snapshot: decodeCompactRepositorySnapshot(compact.snapshot),
  };
}
