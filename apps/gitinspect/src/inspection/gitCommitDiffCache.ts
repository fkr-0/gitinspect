import type { GitCommitDiff, GitCommitFileDetail } from "@gitinspect/contracts";

import type { RepositoryService, RepositorySession } from "../services/repository";

const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_FILE_ENTRIES = 16;

function cacheKey(session: RepositorySession, oid: string): string {
  return `${session.key}\u0000${session.snapshot.revision}\u0000${oid}`;
}

function fileCacheKey(session: RepositorySession, oid: string, path: string): string {
  return `${cacheKey(session, oid)}\u0000${path}`;
}

export interface GitCommitDiffCacheOptions {
  readonly maxEntries?: number;
  readonly maxFileEntries?: number;
}

/**
 * App-local bounded cache for lazy commit diff metadata.
 *
 * Entries are revision-scoped, so data from one repository snapshot is never
 * reused after refresh. The cache stores promises to deduplicate concurrent
 * inspector/drill-down requests without hydrating the authoritative logical
 * graph dataset or retaining an unbounded history of inspected commits.
 */
export class GitCommitDiffCache {
  private readonly entries = new Map<string, Promise<GitCommitDiff>>();
  private readonly fileEntries = new Map<string, Promise<GitCommitFileDetail>>();
  private readonly maxEntries: number;
  private readonly maxFileEntries: number;

  constructor(
    private readonly repositoryService: RepositoryService,
    options: GitCommitDiffCacheOptions = {},
  ) {
    const requested = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(requested) || requested < 1) {
      throw new Error("GitCommitDiffCache maxEntries must be a positive integer.");
    }
    const requestedFileEntries = options.maxFileEntries ?? DEFAULT_MAX_FILE_ENTRIES;
    if (!Number.isInteger(requestedFileEntries) || requestedFileEntries < 1) {
      throw new Error("GitCommitDiffCache maxFileEntries must be a positive integer.");
    }
    this.maxEntries = requested;
    this.maxFileEntries = requestedFileEntries;
  }

  get(session: RepositorySession, oid: string): Promise<GitCommitDiff> {
    const key = cacheKey(session, oid);
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }

    const pending = this.repositoryService.getCommitDiff(session, oid);
    this.entries.set(key, pending);
    this.evictLeastRecentlyUsed();
    void pending.catch(() => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
    });
    return pending;
  }

  getFileDetail(
    session: RepositorySession,
    oid: string,
    path: string,
  ): Promise<GitCommitFileDetail> {
    const key = fileCacheKey(session, oid, path);
    const existing = this.fileEntries.get(key);
    if (existing) {
      this.fileEntries.delete(key);
      this.fileEntries.set(key, existing);
      return existing;
    }

    const pending = this.repositoryService.getCommitFileDetail(session, oid, path);
    this.fileEntries.set(key, pending);
    this.evictFileLeastRecentlyUsed();
    void pending.catch(() => {
      if (this.fileEntries.get(key) === pending) this.fileEntries.delete(key);
    });
    return pending;
  }

  clear(): void {
    this.entries.clear();
    this.fileEntries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  get fileDetailSize(): number {
    return this.fileEntries.size;
  }

  private evictLeastRecentlyUsed(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }

  private evictFileLeastRecentlyUsed(): void {
    while (this.fileEntries.size > this.maxFileEntries) {
      const oldestKey = this.fileEntries.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.fileEntries.delete(oldestKey);
    }
  }
}
