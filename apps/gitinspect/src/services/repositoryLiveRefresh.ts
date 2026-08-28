import type { RepositoryChange, RepositoryService, RepositorySession } from "./repository";

export interface RepositoryLiveRefreshCallbacks {
  readonly onRefreshed: (session: RepositorySession) => void;
  readonly onError: (error: unknown) => void;
}

/**
 * Serializes watcher-triggered refreshes without becoming a second repository
 * state authority.
 *
 * The coordinator retains only the latest session returned by the existing
 * RepositoryService refresh boundary so a watcher event that lands while one
 * refresh is in flight can trigger one bounded follow-up refresh from the new
 * authoritative revision. Multiple in-flight events collapse into that single
 * follow-up. The React studio remains the owner of user-visible repository
 * state through onRefreshed.
 */
export class RepositoryLiveRefreshCoordinator {
  private active = true;
  private refreshing = false;
  private followUpRequested = false;
  private refreshSession: RepositorySession;

  constructor(
    private readonly service: Pick<RepositoryService, "refreshRepository">,
    session: RepositorySession,
    private readonly callbacks: RepositoryLiveRefreshCallbacks,
  ) {
    this.refreshSession = session;
  }

  request(change: RepositoryChange): boolean {
    if (!this.active || change.repositoryId !== this.refreshSession.key) return false;

    // While a refresh is in flight the native authority may already have moved
    // to the result revision, so the event's previousRevision can legitimately
    // be either the request revision or the just-refreshed revision. Retain one
    // follow-up instead of rejecting it against a transient local revision.
    if (this.refreshing) {
      this.followUpRequested = true;
      return true;
    }

    if (change.previousRevision !== this.refreshSession.snapshot.revision) return false;
    this.followUpRequested = true;
    this.pump();
    return true;
  }

  dispose(): void {
    this.active = false;
    this.followUpRequested = false;
  }

  private pump(): void {
    if (!this.active || this.refreshing || !this.followUpRequested) return;
    this.followUpRequested = false;
    this.refreshing = true;
    const requestSession = this.refreshSession;

    void this.service
      .refreshRepository(requestSession)
      .then((refreshed) => {
        if (!this.active || refreshed.key !== requestSession.key) return;
        if (refreshed.snapshot.revision === requestSession.snapshot.revision) return;
        this.refreshSession = refreshed;
        this.callbacks.onRefreshed(refreshed);
      })
      .catch((error: unknown) => {
        if (this.active) this.callbacks.onError(error);
      })
      .finally(() => {
        this.refreshing = false;
        if (this.active && this.followUpRequested) this.pump();
      });
  }
}
