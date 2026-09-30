import type { GitCommitDiff, GitCommitFileDetail, GitPluginReport } from "@gitinspect/contracts";

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
import { verifyRepositoryRevision } from "./repositoryRevision";

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

    async openRepository(path: string): Promise<RepositorySession> {
      const session = decodeCompactRepositorySession(
        await tauri.core.invoke<CompactRepositorySession>("open_repository_compact", { path }),
      );
      await verifyRepositoryRevision(session.snapshot);
      return session;
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
        const refreshed = applyCompactRepositoryAppendDelta(session, result.delta);
        await verifyRepositoryRevision(refreshed.snapshot);
        return refreshed;
      }
      const refreshed = decodeCompactRepositorySession(result.session);
      if (refreshed.key !== session.key) {
        throw new Error(
          `Native full refresh repository identity mismatch: ${refreshed.key} != ${session.key}`,
        );
      }
      if (
        refreshed.snapshot.repositoryPath !== session.snapshot.repositoryPath ||
        refreshed.snapshot.gitDir !== session.snapshot.gitDir
      ) {
        throw new Error("Native full refresh changed the repository path identity");
      }
      if (refreshed.snapshot.revision === session.snapshot.revision) {
        throw new Error("Native full refresh must advance the repository revision");
      }
      await verifyRepositoryRevision(refreshed.snapshot);
      return refreshed;
    },

    getCommitDiff(session: RepositorySession, oid: string): Promise<GitCommitDiff> {
      return tauri.core.invoke<GitCommitDiff>("get_commit_diff", {
        repositoryId: session.key,
        oid,
        options: null,
      });
    },

    runPlugins(session: RepositorySession): Promise<GitPluginReport> {
      return tauri.core.invoke<GitPluginReport>("run_repository_plugins", {
        repositoryId: session.key,
        expectedRevision: session.snapshot.revision,
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

      let listenerStopped = false;
      let nativeStopped = false;
      let stopInFlight: Promise<void> | undefined;
      return async () => {
        if (!listenerStopped) {
          listenerStopped = true;
          unlisten();
        }
        if (nativeStopped) return;
        if (!stopInFlight) {
          stopInFlight = tauri.core
            .invoke<void>("stop_repository_watch", {
              watchId: watch.watchId,
            })
            .then(() => {
              nativeStopped = true;
            })
            .finally(() => {
              stopInFlight = undefined;
            });
        }
        await stopInFlight;
      };
    },
  });
}
