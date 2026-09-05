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

interface PromiseCacheEntry<T> {
  readonly promise: Promise<T>;
  lastAccess: number;
}

class BoundedPromiseCache<T> {
  private readonly retained = new Map<string, PromiseCacheEntry<T>>();
  private readonly inFlight = new Map<string, PromiseCacheEntry<T>>();
  private accessSequence = 0;

  constructor(private readonly maxEntries: number) {}

  getOrCreate(key: string, load: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(key);
    if (pending) {
      pending.lastAccess = ++this.accessSequence;
      return pending.promise;
    }

    const retained = this.retained.get(key);
    if (retained) {
      retained.lastAccess = ++this.accessSequence;
      return retained.promise;
    }

    const entry: PromiseCacheEntry<T> = {
      promise: load(),
      lastAccess: ++this.accessSequence,
    };
    this.inFlight.set(key, entry);
    void entry.promise.then(
      () => {
        if (this.inFlight.get(key) !== entry) return;
        this.inFlight.delete(key);
        this.retained.set(key, entry);
        this.evictLeastRecentlyUsed();
      },
      () => {
        if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
      },
    );
    return entry.promise;
  }

  clear(): void {
    this.retained.clear();
    this.inFlight.clear();
    this.accessSequence = 0;
  }

  get size(): number {
    return this.retained.size;
  }

  private evictLeastRecentlyUsed(): void {
    while (this.retained.size > this.maxEntries) {
      let oldestKey: string | undefined;
      let oldestAccess = Infinity;
      for (const [key, entry] of this.retained) {
        if (entry.lastAccess < oldestAccess) {
          oldestKey = key;
          oldestAccess = entry.lastAccess;
        }
      }
      if (oldestKey === undefined) return;
      this.retained.delete(oldestKey);
    }
  }
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
  private readonly entries: BoundedPromiseCache<GitCommitDiff>;
  private readonly fileEntries: BoundedPromiseCache<GitCommitFileDetail>;

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
    this.entries = new BoundedPromiseCache(requested);
    this.fileEntries = new BoundedPromiseCache(requestedFileEntries);
  }

  get(session: RepositorySession, oid: string): Promise<GitCommitDiff> {
    const key = cacheKey(session, oid);
    return this.entries.getOrCreate(key, () => this.repositoryService.getCommitDiff(session, oid));
  }

  getFileDetail(
    session: RepositorySession,
    oid: string,
    path: string,
  ): Promise<GitCommitFileDetail> {
    const key = fileCacheKey(session, oid, path);
    return this.fileEntries.getOrCreate(key, () =>
      this.repositoryService.getCommitFileDetail(session, oid, path),
    );
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
}
