import type {
  GitCommitDiff,
  GitCommitRecord,
  GitRepositorySnapshot,
} from "@gitinspect/contracts";

export type RepositoryPathKind = "worktree" | "git-dir" | "bare";
export type RepositoryPathSelectionMode = "folder" | "file";

export interface RepositoryPathSelection {
  readonly mode: RepositoryPathSelectionMode;
  readonly expectedKind?: RepositoryPathKind;
}

export interface RepositorySession {
  readonly key: string;
  readonly snapshot: GitRepositorySnapshot;
}

export interface RepositoryChange {
  readonly repositoryId: string;
  readonly previousRevision: string;
  readonly reasons: readonly string[];
}

export type RepositoryWatchStop = () => Promise<void>;

export interface RepositoryService {
  readonly mode: "demo" | "native";
  chooseRepositoryPath(selection: RepositoryPathSelection): Promise<string | undefined>;
  openRepository(path: string): Promise<RepositorySession>;
  refreshRepository(session: RepositorySession): Promise<RepositorySession>;
  getCommitDiff(session: RepositorySession, oid: string): Promise<GitCommitDiff>;
  watchRepository(
    session: RepositorySession,
    onChange: (change: RepositoryChange) => void,
  ): Promise<RepositoryWatchStop>;
}

const commits: readonly GitCommitRecord[] = [
  {
    oid: "9c5d2f2c0d73e25f64895c9c125c7f1eaef2f4a1",
    treeOid: "7adbb3a7e362a6912b636903fd933be3b33a5e55",
    parents: ["72c554457fb2479b2678309543717911414021c7"],
    authorName: "A. Rivera",
    authoredAtMs: 1_772_580_000_000,
    committedAtMs: 1_772_580_120_000,
    message: "Integrate repository world shell",
    signatureStatus: "valid",
    files: [
      {
        path: "src/world.ts",
        kind: "text",
        additions: 84,
        deletions: 12,
        status: "modified",
      },
    ],
  },
  {
    oid: "72c554457fb2479b2678309543717911414021c7",
    treeOid: "5859065c083f5dfbd57cc0d5c94594e789e1c0d6",
    parents: [
      "2fbaf329e1d1332cc3b99370b1f67f2ddd98ad3e",
      "123dc2deead1e5eb72e803ae41590dd96562b4d2",
    ],
    authorName: "M. Chen",
    authoredAtMs: 1_772_493_600_000,
    committedAtMs: 1_772_493_780_000,
    message: "Merge camera traversal prototype",
    signatureStatus: "unsigned",
    files: [
      {
        path: "src/camera.ts",
        kind: "text",
        additions: 121,
        deletions: 31,
        status: "modified",
      },
    ],
  },
  {
    oid: "123dc2deead1e5eb72e803ae41590dd96562b4d2",
    treeOid: "c0b30ea05cfc77e28dd12108838dc64491d8946d",
    parents: ["4d764aa9b659f2d85770ed66ec5cb56f4572510d"],
    authorName: "N. Okafor",
    authoredAtMs: 1_772_407_200_000,
    committedAtMs: 1_772_407_260_000,
    message: "Prototype attached camera mode",
    signatureStatus: "unsigned",
    files: [
      {
        path: "src/camera/attached.ts",
        kind: "text",
        additions: 76,
        deletions: 4,
        status: "added",
      },
    ],
  },
  {
    oid: "2fbaf329e1d1332cc3b99370b1f67f2ddd98ad3e",
    treeOid: "bd279ea8eea28465819a57876379fcc2b2261962",
    parents: ["4d764aa9b659f2d85770ed66ec5cb56f4572510d"],
    authorName: "A. Rivera",
    authoredAtMs: 1_772_320_800_000,
    committedAtMs: 1_772_320_860_000,
    message: "Add deterministic layered layout",
    signatureStatus: "valid",
    files: [
      {
        path: "src/layout.ts",
        kind: "text",
        additions: 143,
        deletions: 18,
        status: "modified",
      },
      {
        path: "fixtures/layout.bin",
        kind: "binary",
        additions: 0,
        deletions: 0,
        bytes: 18_240,
        status: "added",
      },
    ],
  },
  {
    oid: "4d764aa9b659f2d85770ed66ec5cb56f4572510d",
    treeOid: "36bcbb8018787e90f1af3b332678a3170d1bcc7e",
    parents: ["fb082bccae32c77a2e70f2b5d292f6d242d72f6b"],
    authorName: "S. Patel",
    authoredAtMs: 1_772_234_400_000,
    committedAtMs: 1_772_234_430_000,
    message: "Define graph element contracts",
    signatureStatus: "unknown",
    files: [
      {
        path: "src/contracts.ts",
        kind: "text",
        additions: 205,
        deletions: 0,
        status: "added",
      },
    ],
  },
  {
    oid: "fb082bccae32c77a2e70f2b5d292f6d242d72f6b",
    treeOid: "4645c8b6d6d18460f778748ca918147c21d9ad2d",
    parents: [],
    authorName: "S. Patel",
    authoredAtMs: 1_772_148_000_000,
    committedAtMs: 1_772_148_000_000,
    message: "Initialize visualization workspace",
    signatureStatus: "unsigned",
    files: [
      {
        path: "README.md",
        kind: "text",
        additions: 42,
        deletions: 0,
        status: "added",
      },
    ],
  },
];

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new Error("Choose a repository path before opening it.");
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

export function createDemoSnapshot(path: string): GitRepositorySnapshot {
  const repositoryPath = normalizePath(path);
  const suffix = repositoryPath === "/" ? "" : "/";
  return {
    schemaVersion: 1,
    repositoryPath,
    gitDir: `${repositoryPath}${suffix}.git`,
    ...(commits[0] ? { head: commits[0].oid } : {}),
    headRef: "refs/heads/main",
    revision: `demo-${stableHash(repositoryPath)}`,
    commits,
    refs: [
      {
        name: "refs/heads/main",
        targetOid: commits[0]?.oid ?? "",
        kind: "local-branch",
        upstream: "refs/remotes/origin/main",
        ahead: 2,
        behind: 0,
      },
      {
        name: "refs/heads/camera-lab",
        targetOid: commits[2]?.oid ?? "",
        kind: "local-branch",
      },
      {
        name: "refs/remotes/origin/main",
        targetOid: commits[1]?.oid ?? "",
        kind: "remote-branch",
      },
      {
        name: "refs/tags/v0.1.0-alpha",
        targetOid: commits[4]?.oid ?? "",
        kind: "tag",
      },
    ],
    remotes: [
      {
        name: "origin",
        fetchUrls: ["ssh://example.invalid/gitinspect.git"],
        pushUrls: ["ssh://example.invalid/gitinspect.git"],
      },
    ],
    hooks: ["pre-commit", "commit-msg"],
    truncated: false,
  };
}

export interface NativeRepositoryBridge {
  chooseRepositoryPath(selection: RepositoryPathSelection): Promise<string | undefined>;
  openRepository(path: string): Promise<RepositorySession>;
  refreshRepository(session: RepositorySession): Promise<RepositorySession>;
  getCommitDiff(session: RepositorySession, oid: string): Promise<GitCommitDiff>;
  watchRepository(
    session: RepositorySession,
    onChange: (change: RepositoryChange) => void,
  ): Promise<RepositoryWatchStop>;
}

export class NativeRepositoryService implements RepositoryService {
  readonly mode = "native" as const;

  constructor(private readonly bridge: NativeRepositoryBridge) {}

  chooseRepositoryPath(selection: RepositoryPathSelection): Promise<string | undefined> {
    return this.bridge.chooseRepositoryPath(selection);
  }

  openRepository(path: string): Promise<RepositorySession> {
    return this.bridge.openRepository(path);
  }

  refreshRepository(session: RepositorySession): Promise<RepositorySession> {
    return this.bridge.refreshRepository(session);
  }

  getCommitDiff(session: RepositorySession, oid: string): Promise<GitCommitDiff> {
    return this.bridge.getCommitDiff(session, oid);
  }

  watchRepository(
    session: RepositorySession,
    onChange: (change: RepositoryChange) => void,
  ): Promise<RepositoryWatchStop> {
    return this.bridge.watchRepository(session, onChange);
  }
}

export class DemoRepositoryService implements RepositoryService {
  readonly mode = "demo" as const;

  async chooseRepositoryPath(_selection: RepositoryPathSelection): Promise<string> {
    return "/demo/gitinspect";
  }

  async openRepository(path: string): Promise<RepositorySession> {
    const snapshot = createDemoSnapshot(path);
    return {
      key: `demo:${stableHash(snapshot.repositoryPath)}`,
      snapshot,
    };
  }

  async refreshRepository(session: RepositorySession): Promise<RepositorySession> {
    return this.openRepository(session.snapshot.repositoryPath);
  }

  async getCommitDiff(session: RepositorySession, oid: string): Promise<GitCommitDiff> {
    const commit = session.snapshot.commits.find((candidate) => candidate.oid === oid);
    if (!commit) throw new Error(`Unknown demo commit: ${oid}`);
    return {
      oid,
      ...(commit.parents[0] ? { parentOid: commit.parents[0] } : {}),
      files: commit.files,
      truncated: false,
    };
  }

  async watchRepository(
    _session: RepositorySession,
    _onChange: (change: RepositoryChange) => void,
  ): Promise<RepositoryWatchStop> {
    return async () => undefined;
  }
}

export function createDemoRepositoryService(): RepositoryService {
  return new DemoRepositoryService();
}
