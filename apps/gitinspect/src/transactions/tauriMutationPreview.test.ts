import { afterEach, describe, expect, it, vi } from "vitest";

import { createTauriMutationPreviewBridge } from "./tauriMutationPreview";

describe("Tauri mutation preview bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses only the narrow sandbox-ID preview commands", async () => {
    const invoke = vi.fn(async (_command: string, _args?: Readonly<Record<string, unknown>>) => ({
      sandboxId: "sandbox-1-1",
      baseRevision: "r1",
    }));
    vi.stubGlobal("window", {
      __TAURI__: { core: { invoke } },
    });
    const bridge = createTauriMutationPreviewBridge();
    expect(bridge).toBeDefined();
    await bridge?.createSandbox("repository:1", "r1");
    await bridge?.preview("sandbox-1-1", "tx", [{ kind: "branch-delete", name: "topic" }]);
    await bridge?.confirm("sandbox-1-1", "tx", "preview:token");
    await bridge?.cancelSandbox("sandbox-1-1");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "create_mutation_sandbox",
      "preview_mutation_transaction",
      "confirm_mutation_preview",
      "cancel_mutation_sandbox",
    ]);
    expect(invoke.mock.calls.some(([command]) => String(command).includes("apply"))).toBe(false);
  });
});
