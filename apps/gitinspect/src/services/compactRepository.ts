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

export interface CompactRepositorySession {
  readonly key: string;
  readonly snapshot: CompactGitRepositorySnapshot;
}

export type CompactRepositoryRefreshResult =
  | { readonly status: "unchanged"; readonly revision: string }
  | { readonly status: "changed"; readonly session: CompactRepositorySession };

const SIGNATURE_STATUS = ["valid", "invalid", "unknown", "unsigned"] as const;

function stringAt(strings: readonly string[], index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= strings.length) {
    throw new Error(`Invalid compact repository string index: ${index}`);
  }
  return strings[index]!;
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
