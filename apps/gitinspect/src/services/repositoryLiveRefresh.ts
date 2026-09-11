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
  private readonly inFlightPreviousRevisions = new Set<string>();
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

    // While a refresh is in flight the native watcher may still observe the
    // request revision until the authority publishes the refresh result, or it
    // may observe the returned revision after publication. Defer provenance
    // validation until the refresh resolves so either boundary revision can
    // justify one bounded follow-up. Arbitrary stale/future revisions must not
    // bypass the guard.
    if (this.refreshing) {
      this.inFlightPreviousRevisions.add(change.previousRevision);
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
    this.inFlightPreviousRevisions.clear();
  }

  private pump(): void {
    if (!this.active || this.refreshing || !this.followUpRequested) return;
    this.followUpRequested = false;
    this.refreshing = true;
    this.inFlightPreviousRevisions.clear();
    const requestSession = this.refreshSession;

    void this.runRefresh(requestSession);
  }

  private async runRefresh(requestSession: RepositorySession): Promise<void> {
    let refreshed: RepositorySession;
    try {
      refreshed = await this.service.refreshRepository(requestSession);
    } catch (error: unknown) {
      if (!this.active) {
        this.finishRefresh(false);
        return;
      }
      const followUpRequested = this.inFlightPreviousRevisions.has(
        requestSession.snapshot.revision,
      );
      this.finishRefresh(followUpRequested);
      this.callbacks.onError(error);
      if (this.active && this.followUpRequested) this.pump();
      return;
    }

    if (!this.active) {
      this.finishRefresh(false);
      return;
    }
    if (refreshed.key !== requestSession.key) {
      this.finishRefresh(false);
      this.callbacks.onError(
        new Error(`Repository refresh identity mismatch: ${refreshed.key} != ${requestSession.key}`),
      );
      return;
    }

    const requestRevision = requestSession.snapshot.revision;
    const refreshedRevision = refreshed.snapshot.revision;
    const changed = refreshedRevision !== requestRevision;
    const followUpRequested =
      this.inFlightPreviousRevisions.has(requestRevision) ||
      this.inFlightPreviousRevisions.has(refreshedRevision);
    if (changed) this.refreshSession = refreshed;
    this.finishRefresh(followUpRequested);

    if (changed) this.callbacks.onRefreshed(refreshed);
    if (this.active && this.followUpRequested) this.pump();
  }

  private finishRefresh(followUpRequested: boolean): void {
    this.inFlightPreviousRevisions.clear();
    this.refreshing = false;
    this.followUpRequested = this.active && followUpRequested;
  }
}
