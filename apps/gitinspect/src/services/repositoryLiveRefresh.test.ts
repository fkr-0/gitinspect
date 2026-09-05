import { describe, expect, it, vi } from "vitest";

import { createDemoSnapshot, type RepositoryChange, type RepositorySession } from "./repository";
import { RepositoryLiveRefreshCoordinator } from "./repositoryLiveRefresh";

function session(revision: string): RepositorySession {
  return {
    key: "repository:1",
    snapshot: {
      ...createDemoSnapshot("/native/repo"),
      revision,
    },
  };
}

function change(previousRevision: string): RepositoryChange {
  return {
    repositoryId: "repository:1",
    previousRevision,
    reasons: ["refs"],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("RepositoryLiveRefreshCoordinator", () => {
  it("ignores stale idle events and refreshes only the current repository revision", async () => {
    const current = session("rev-1");
    const refreshed = session("rev-2");
    const refreshRepository = vi.fn(async () => refreshed);
    const onRefreshed = vi.fn();
    const onError = vi.fn();
    const coordinator = new RepositoryLiveRefreshCoordinator({ refreshRepository }, current, {
      onRefreshed,
      onError,
    });

    expect(coordinator.request(change("stale-revision"))).toBe(false);
    expect(refreshRepository).not.toHaveBeenCalled();
    expect(coordinator.request(change("rev-1"))).toBe(true);
    await flushPromises();

    expect(refreshRepository).toHaveBeenCalledTimes(1);
    expect(refreshRepository).toHaveBeenCalledWith(current);
    expect(onRefreshed).toHaveBeenCalledWith(refreshed);
    expect(onError).not.toHaveBeenCalled();
  });

  it("retains one follow-up refresh when watcher events arrive during an in-flight refresh", async () => {
    const firstSession = session("rev-1");
    const secondSession = session("rev-2");
    const thirdSession = session("rev-3");
    const first = deferred<RepositorySession>();
    const second = deferred<RepositorySession>();
    const refreshRepository = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onRefreshed = vi.fn();
    const coordinator = new RepositoryLiveRefreshCoordinator({ refreshRepository }, firstSession, {
      onRefreshed,
      onError: vi.fn(),
    });

    coordinator.request(change("rev-1"));
    expect(refreshRepository).toHaveBeenCalledTimes(1);

    // Both the old authority revision and a revision emitted after native refresh
    // completion are safe signals for one follow-up while the request is active.
    expect(coordinator.request(change("rev-1"))).toBe(true);
    expect(coordinator.request(change("rev-2"))).toBe(true);
    expect(refreshRepository).toHaveBeenCalledTimes(1);

    first.resolve(secondSession);
    await flushPromises();
    expect(refreshRepository).toHaveBeenCalledTimes(2);
    expect(refreshRepository).toHaveBeenNthCalledWith(2, secondSession);

    second.resolve(thirdSession);
    await flushPromises();
    expect(onRefreshed.mock.calls.map(([value]) => value.snapshot.revision)).toEqual([
      "rev-2",
      "rev-3",
    ]);
    expect(refreshRepository).toHaveBeenCalledTimes(2);
  });

  it("retries after an unchanged refresh when an in-flight event requested a follow-up", async () => {
    const current = session("rev-1");
    const changed = session("rev-2");
    const first = deferred<RepositorySession>();
    const second = deferred<RepositorySession>();
    const refreshRepository = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onRefreshed = vi.fn();
    const coordinator = new RepositoryLiveRefreshCoordinator({ refreshRepository }, current, {
      onRefreshed,
      onError: vi.fn(),
    });

    coordinator.request(change("rev-1"));
    coordinator.request(change("rev-1"));
    first.resolve(current);
    await flushPromises();

    expect(refreshRepository).toHaveBeenCalledTimes(2);
    expect(refreshRepository).toHaveBeenNthCalledWith(2, current);
    second.resolve(changed);
    await flushPromises();
    expect(onRefreshed).toHaveBeenCalledTimes(1);
    expect(onRefreshed).toHaveBeenCalledWith(changed);
  });

  it("does not let stale in-flight watcher metadata force a follow-up refresh", async () => {
    const current = session("rev-1");
    const refreshed = session("rev-2");
    const first = deferred<RepositorySession>();
    const refreshRepository = vi.fn(() => first.promise);
    const onRefreshed = vi.fn();
    const onError = vi.fn();
    const coordinator = new RepositoryLiveRefreshCoordinator({ refreshRepository }, current, {
      onRefreshed,
      onError,
    });

    coordinator.request(change("rev-1"));
    expect(coordinator.request(change("stale-revision"))).toBe(true);
    first.resolve(refreshed);
    await flushPromises();

    expect(refreshRepository).toHaveBeenCalledTimes(1);
    expect(onRefreshed).toHaveBeenCalledWith(refreshed);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a refresh that returns a different repository identity", async () => {
    const current = session("rev-1");
    const wrongRepository = {
      ...session("rev-2"),
      key: "repository:other",
    };
    const refreshRepository = vi.fn(async () => wrongRepository);
    const onRefreshed = vi.fn();
    const onError = vi.fn();
    const coordinator = new RepositoryLiveRefreshCoordinator({ refreshRepository }, current, {
      onRefreshed,
      onError,
    });

    coordinator.request(change("rev-1"));
    await flushPromises();

    expect(onRefreshed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/identity mismatch/i) }),
    );
  });

  it("does not lose a current-revision event raised while publishing a refresh", async () => {
    const firstSession = session("rev-1");
    const secondSession = session("rev-2");
    const thirdSession = session("rev-3");
    const second = deferred<RepositorySession>();
    const refreshRepository = vi
      .fn()
      .mockResolvedValueOnce(secondSession)
      .mockImplementationOnce(() => second.promise);
    let coordinator: RepositoryLiveRefreshCoordinator;
    const onRefreshed = vi.fn((refreshed: RepositorySession) => {
      if (refreshed.snapshot.revision === "rev-2") {
        expect(coordinator.request(change("rev-2"))).toBe(true);
      }
    });
    coordinator = new RepositoryLiveRefreshCoordinator({ refreshRepository }, firstSession, {
      onRefreshed,
      onError: vi.fn(),
    });

    coordinator.request(change("rev-1"));
    await flushPromises();
    expect(refreshRepository).toHaveBeenCalledTimes(2);
    expect(refreshRepository).toHaveBeenNthCalledWith(2, secondSession);

    second.resolve(thirdSession);
    await flushPromises();
    expect(onRefreshed.mock.calls.map(([value]) => value.snapshot.revision)).toEqual([
      "rev-2",
      "rev-3",
    ]);
  });

  it("does not publish or start a queued refresh after disposal", async () => {
    const current = session("rev-1");
    const refreshed = session("rev-2");
    const pending = deferred<RepositorySession>();
    const refreshRepository = vi.fn(() => pending.promise);
    const onRefreshed = vi.fn();
    const onError = vi.fn();
    const coordinator = new RepositoryLiveRefreshCoordinator({ refreshRepository }, current, {
      onRefreshed,
      onError,
    });

    coordinator.request(change("rev-1"));
    coordinator.request(change("rev-1"));
    coordinator.dispose();
    pending.resolve(refreshed);
    await flushPromises();

    expect(refreshRepository).toHaveBeenCalledTimes(1);
    expect(onRefreshed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
