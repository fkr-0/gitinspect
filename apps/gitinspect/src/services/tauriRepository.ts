import type { GitCommitDiff, GitCommitFileDetail } from "@gitinspect/contracts";

import {
  applyCompactRepositoryAppendDelta,
  decodeCompactRepositorySession,
  type CompactRepositoryDeltaRefreshResult,
  type CompactRepositorySession,
} from "./compactRepository";
import {
  NativeRepositoryService,
  type RepositoryChange,
  type RepositoryPathSelection,
  type RepositoryService,
  type RepositorySession,
  type RepositoryWatchStop,
} from "./repository";

interface TauriEvent<T> {
  readonly event: string;
  readonly id: number;
  readonly payload: T;
}

interface TauriGlobal {
  readonly core: {
    invoke<T>(command: string, args?: Readonly<Record<string, unknown>>): Promise<T>;
  };
  readonly event: {
    listen<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<() => void>;
  };
}

declare global {
  interface Window {
    readonly __TAURI__?: TauriGlobal;
  }
}

interface WatchSession {
  readonly watchId: string;
}

function tauriGlobal(): TauriGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  const candidate = window.__TAURI__;
  if (!candidate?.core?.invoke || !candidate.event?.listen) return undefined;
  return candidate;
}

export function createTauriRepositoryService(): RepositoryService | undefined {
  const tauri = tauriGlobal();
  if (!tauri) return undefined;

  return new NativeRepositoryService({
    chooseRepositoryPath(selection: RepositoryPathSelection): Promise<string | undefined> {
      return tauri.core.invoke<string | undefined>("choose_repository_path", { selection });
    },

    openRepository(path: string): Promise<RepositorySession> {
      return tauri.core
        .invoke<CompactRepositorySession>("open_repository_compact", { path })
        .then(decodeCompactRepositorySession);
    },

    async refreshRepository(session: RepositorySession): Promise<RepositorySession> {
      const result = await tauri.core.invoke<CompactRepositoryDeltaRefreshResult>(
        "refresh_repository_compact_delta",
        {
          repositoryId: session.key,
          expectedRevision: session.snapshot.revision,
        },
      );
      if (result.status === "unchanged") {
        if (result.revision !== session.snapshot.revision) {
          throw new Error(
            `Native unchanged refresh revision mismatch: ${result.revision} != ${session.snapshot.revision}`,
          );
        }
        return session;
      }
      if (result.status === "delta") {
        return applyCompactRepositoryAppendDelta(session, result.delta);
      }
      return decodeCompactRepositorySession(result.session);
    },

    getCommitDiff(session: RepositorySession, oid: string): Promise<GitCommitDiff> {
      return tauri.core.invoke<GitCommitDiff>("get_commit_diff", {
        repositoryId: session.key,
        oid,
        options: null,
      });
    },

    getCommitFileDetail(
      session: RepositorySession,
      oid: string,
      path: string,
    ): Promise<GitCommitFileDetail> {
      return tauri.core.invoke<GitCommitFileDetail>("get_commit_file_detail", {
        repositoryId: session.key,
        oid,
        path,
        options: null,
      });
    },

    async watchRepository(
      session: RepositorySession,
      onChange: (change: RepositoryChange) => void,
    ): Promise<RepositoryWatchStop> {
      const unlisten = await tauri.event.listen<RepositoryChange>(
        "repository://changed",
        (event) => {
          if (event.payload.repositoryId === session.key) onChange(event.payload);
        },
      );

      let watch: WatchSession;
      try {
        watch = await tauri.core.invoke<WatchSession>("start_repository_watch", {
          repositoryId: session.key,
        });
      } catch (error) {
        unlisten();
        throw error;
      }

      let stopped = false;
      return async () => {
        if (stopped) return;
        stopped = true;
        unlisten();
        await tauri.core.invoke<void>("stop_repository_watch", {
          watchId: watch.watchId,
        });
      };
    },
  });
}
