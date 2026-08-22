import { afterEach, describe, expect, it, vi } from "vitest";

import { InteractionManager, granularityFromModifiers } from "./InteractionManager";
import { PickRegistry } from "./PickRegistry";

describe("modifier policy", () => {
  it("uses the required precedence", () => {
    expect(granularityFromModifiers({})).toBe("sub-element");
    expect(granularityFromModifiers({ shift: true })).toBe("node");
    expect(granularityFromModifiers({ ctrl: true, shift: true })).toBe("edge-group");
    expect(granularityFromModifiers({ meta: true })).toBe("edge-group");
    expect(granularityFromModifiers({ alt: true, ctrl: true })).toBe("chain");
    expect(granularityFromModifiers({ shift: true, alt: true, ctrl: true })).toBe("cluster");
  });
});

describe("PickRegistry", () => {
  it("resolves instance picks semantically and falls back to an object record", () => {
    const registry = new PickRegistry();
    registry.register(
      { objectId: "mesh" },
      { elementId: "node-a", interactionKey: "plate", availableGranularities: ["node"] },
    );
    registry.register(
      { objectId: "mesh", instanceId: 7 },
      {
        elementId: "file-7",
        interactionKey: "file:7",
        semanticKind: "file",
        availableGranularities: ["sub-element", "node"],
      },
    );

    expect(registry.resolve({ objectId: "mesh", instanceId: 7 })).toMatchObject({ elementId: "file-7" });
    expect(registry.resolve({ objectId: "mesh", instanceId: 8 })).toMatchObject({ elementId: "node-a" });
  });
});

describe("InteractionManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays tooltips, cancels stale hover timers, and keeps selection independent", () => {
    vi.useFakeTimers();
    const registry = new PickRegistry();
    registry.register(
      { objectId: 1 },
      { elementId: "a", interactionKey: "a", availableGranularities: ["sub-element", "node"] },
    );
    registry.register(
      { objectId: 2 },
      { elementId: "b", interactionKey: "b", availableGranularities: ["sub-element", "node"] },
    );
    const manager = new InteractionManager(registry, { tooltipDelayMs: 250 });
    const events: string[] = [];
    manager.subscribe((event) => events.push(event.type));

    manager.click({ objectId: 1 }, { shift: true });
    manager.hover({ objectId: 1 });
    vi.advanceTimersByTime(200);
    manager.hover({ objectId: 2 });
    vi.advanceTimersByTime(249);
    expect(events.filter((event) => event === "tooltip-request")).toHaveLength(0);
    vi.advanceTimersByTime(1);

    expect(events.filter((event) => event === "tooltip-request")).toHaveLength(1);
    expect(manager.getHover()).toMatchObject({ record: { elementId: "b" }, tooltipVisible: true });
    expect(manager.getSelection()).toMatchObject({ elementId: "a", granularity: "node" });
  });

  it("does not restart the tooltip delay while remaining over the same pick", () => {
    vi.useFakeTimers();
    const registry = new PickRegistry();
    registry.register(
      { objectId: 1 },
      { elementId: "a", interactionKey: "a", availableGranularities: ["sub-element"] },
    );
    const manager = new InteractionManager(registry, { tooltipDelayMs: 250 });

    manager.hover({ objectId: 1 });
    vi.advanceTimersByTime(100);
    manager.hover({ objectId: 1 });
    vi.advanceTimersByTime(150);

    expect(manager.getHover()).toMatchObject({ tooltipVisible: true });
  });

  it("falls back to an available granularity and resolves related semantic ids", () => {
    const registry = new PickRegistry();
    registry.register(
      { objectId: "edge" },
      { elementId: "e1", interactionKey: "edge", availableGranularities: ["edge-group"] },
    );
    const manager = new InteractionManager(registry, {
      resolveRelatedIds: (_record, granularity) => (granularity === "edge-group" ? ["e1", "e2"] : []),
    });

    expect(manager.click({ objectId: "edge" })).toEqual({
      elementId: "e1",
      interactionKey: "edge",
      granularity: "edge-group",
      relatedIds: ["e1", "e2"],
    });
  });
});
