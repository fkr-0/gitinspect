import { describe, expect, it, vi } from "vitest";
import {
  StaleTransactionError,
  TransactionManager,
  TransactionStateError,
  type TransactionDomainAdapter,
} from "./index.js";

interface Operation {
  readonly id: string;
}

interface Preview {
  readonly summary: string;
}

function adapter(overrides: Partial<TransactionDomainAdapter<Operation, Preview, string>> = {}) {
  return {
    validate: vi.fn(() => undefined),
    preview: vi.fn(async () => ({ preview: { summary: "safe" }, previewRevision: "r1" })),
    confirm: vi.fn(async () => ({ token: "domain-issued-token" })),
    apply: vi.fn(async ({ confirmationToken }) => `applied:${confirmationToken}`),
    cancel: vi.fn(async () => undefined),
    ...overrides,
  } satisfies TransactionDomainAdapter<Operation, Preview, string>;
}

describe("TransactionManager", () => {
  it("defaults to copy target and keeps draft operations inert until adapter preview", async () => {
    const domain = adapter();
    const manager = new TransactionManager("r1", domain, { id: "tx" });
    manager.addOperation({ id: "one" });
    expect(manager.targetMode).toBe("copy");
    expect(domain.validate).not.toHaveBeenCalled();
    expect(domain.apply).not.toHaveBeenCalled();
    await manager.preview("r1");
    expect(manager.state).toBe("previewed");
    const token = await manager.confirm("r1");
    expect(token).toBe("domain-issued-token");
    expect(manager.state).toBe("confirmed");
    await expect(manager.apply("r1")).resolves.toBe("applied:domain-issued-token");
    expect(manager.state).toBe("applied");
  });

  it("requires original target mode to be explicit", () => {
    const manager = new TransactionManager("r1", adapter(), { targetMode: "original" });
    expect(manager.targetMode).toBe("original");
  });

  it("invalidates stale previews and fails closed before confirmation", async () => {
    const domain = adapter();
    const manager = new TransactionManager("r1", domain);
    await manager.preview("r1");
    await expect(manager.confirm("r2")).rejects.toBeInstanceOf(StaleTransactionError);
    expect(manager.state).toBe("failed");
    expect(manager.snapshot().preview).toBeUndefined();
    expect(domain.confirm).not.toHaveBeenCalled();
  });

  it("uses the adapter token without treating the renderer as a security authority", async () => {
    const domain = adapter({ confirm: vi.fn(async () => ({ token: "opaque-adapter-proof" })) });
    const manager = new TransactionManager("r1", domain);
    await manager.preview("r1");
    await manager.confirm("r1");
    await manager.apply("r1");
    expect(domain.apply).toHaveBeenCalledWith(
      expect.objectContaining({ confirmationToken: "opaque-adapter-proof" }),
    );
  });

  it("supports cancellation and records adapter failures as terminal", async () => {
    const cancellable = new TransactionManager("r1", adapter());
    await cancellable.cancel();
    expect(cancellable.state).toBe("cancelled");
    await expect(cancellable.cancel()).rejects.toBeInstanceOf(TransactionStateError);

    const broken = new TransactionManager(
      "r1",
      adapter({ preview: vi.fn(async () => Promise.reject(new Error("preview exploded"))) }),
    );
    await expect(broken.preview("r1")).rejects.toThrow("preview exploded");
    expect(broken.state).toBe("failed");
    expect(broken.snapshot().failureReason).toBe("preview exploded");
  });
});
