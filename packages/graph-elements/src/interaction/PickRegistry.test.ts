import { describe, expect, it } from "vitest";
import type { SelectionGranularity } from "@gitinspect/contracts";

import { PickRegistry } from "./PickRegistry";

describe("PickRegistry lifecycle", () => {
  it("rejects duplicate exact references while keeping numeric and string object ids distinct", () => {
    const registry = new PickRegistry();
    registry.register(
      { objectId: 1 },
      { elementId: "numeric", interactionKey: "numeric", availableGranularities: ["node"] },
    );
    registry.register(
      { objectId: "1" },
      { elementId: "string", interactionKey: "string", availableGranularities: ["node"] },
    );

    expect(() =>
      registry.register(
        { objectId: 1 },
        { elementId: "replacement", interactionKey: "replacement", availableGranularities: ["node"] },
      ),
    ).toThrow("Pick reference already registered: number:1");
    expect(registry.resolve({ objectId: 1 })?.elementId).toBe("numeric");
    expect(registry.resolve({ objectId: "1" })?.elementId).toBe("string");
    expect(registry.size).toBe(2);
  });

  it("does not let a stale registration disposer remove a newer record", () => {
    const registry = new PickRegistry();
    const disposeFirst = registry.register(
      { objectId: "mesh", instanceId: 4 },
      { elementId: "first", interactionKey: "first", availableGranularities: ["sub-element"] },
    );

    expect(registry.unregister({ objectId: "mesh", instanceId: 4 })).toBe(true);
    const disposeSecond = registry.register(
      { objectId: "mesh", instanceId: 4 },
      { elementId: "second", interactionKey: "second", availableGranularities: ["sub-element"] },
    );

    disposeFirst();
    expect(registry.resolve({ objectId: "mesh", instanceId: 4 })?.elementId).toBe("second");
    expect(registry.size).toBe(1);

    disposeSecond();
    expect(registry.resolve({ objectId: "mesh", instanceId: 4 })).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it("snapshots and freezes semantic records at registration time", () => {
    const registry = new PickRegistry();
    const granularities: SelectionGranularity[] = ["sub-element", "node"];
    registry.register(
      { objectId: "immutable" },
      {
        elementId: "commit:a",
        interactionKey: "commit:a",
        semanticKind: "commit",
        availableGranularities: granularities,
      },
    );

    granularities.push("cluster");
    const resolved = registry.resolve({ objectId: "immutable" });
    expect(resolved).toEqual({
      elementId: "commit:a",
      interactionKey: "commit:a",
      semanticKind: "commit",
      availableGranularities: ["sub-element", "node"],
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved?.availableGranularities)).toBe(true);
  });

  it("falls back to an object record after an exact instance record is removed and clear resets all picks", () => {
    const registry = new PickRegistry();
    registry.register(
      { objectId: "mesh" },
      { elementId: "object", interactionKey: "object", availableGranularities: ["node"] },
    );
    registry.register(
      { objectId: "mesh", instanceId: 8 },
      { elementId: "instance", interactionKey: "instance", availableGranularities: ["sub-element"] },
    );

    expect(registry.unregister({ objectId: "mesh", instanceId: 8 })).toBe(true);
    expect(registry.resolve({ objectId: "mesh", instanceId: 8 })?.elementId).toBe("object");
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.resolve({ objectId: "mesh" })).toBeUndefined();
  });
});
