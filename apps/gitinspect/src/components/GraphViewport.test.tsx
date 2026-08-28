import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InteractionManager,
  LabelSystem,
  PickRegistry,
  type GraphDataset,
  type GraphNodeRecord,
  type Vec3,
} from "@gitinspect/graph-elements";

import { buildGitTopologyContext } from "../domain/gitTopology";
import { createSyntheticGitHistory } from "../scale/synthetic";

import {
  GraphViewport,
  planViewportLabels,
  resolveViewportSelection,
  syncViewportInteractionSelection,
  viewportContextShortcut,
  viewportLabelSide,
  viewportPickRecord,
  viewportRelatedSelectionIds,
  viewportSearchFilterKey,
  viewportSearchResults,
  viewportTraversalCommand,
  viewportTraversalTarget,
} from "./GraphViewport";

const dataset: GraphDataset = {
  revision: "rev-scale-ui",
  nodes: [
    { id: "commit:a", kind: "commit", label: "alpha", properties: { oid: "a" } },
    { id: "commit:b", kind: "commit", label: "beta", properties: { oid: "b" } },
    {
      id: "ref:refs/heads/main",
      kind: "local-branch",
      label: "main",
      properties: { name: "refs/heads/main", targetOid: "a" },
    },
  ],
  edges: [
    {
      id: "history:a:b",
      source: "commit:a",
      target: "commit:b",
      kind: "history",
      directed: true,
      properties: { parentIndex: 0, firstParent: true },
    },
    {
      id: "ref-target:main",
      source: "ref:refs/heads/main",
      target: "commit:a",
      kind: "ref-target",
      directed: true,
      properties: {},
    },
  ],
};

describe("GraphViewport Phase-5 projection wiring", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the full Git modifier grammar from semantic node/sub-element picks", () => {
    const reference = { objectId: "commit-batch", instanceId: 1 } as const;
    const picks = new PickRegistry();
    picks.register(
      reference,
      viewportPickRecord(
        {
          ownerId: "commit:a",
          elementId: "commit:a:file:src/main.ts",
          interactionKey: "file:a:src/main.ts",
        },
        new Map(),
        dataset,
      ),
    );
    const interactions = new InteractionManager(picks, {
      resolveRelatedIds: (record, granularity) =>
        viewportRelatedSelectionIds(dataset, record, granularity),
    });

    expect(interactions.click(reference)).toEqual({
      elementId: "commit:a",
      interactionKey: "file:a:src/main.ts",
      granularity: "sub-element",
      relatedIds: ["file:a:src/main.ts"],
    });
    expect(interactions.click(reference, { shift: true })).toEqual({
      elementId: "commit:a",
      interactionKey: "file:a:src/main.ts",
      granularity: "node",
      relatedIds: ["commit:a"],
    });
    expect(interactions.click(reference, { ctrl: true })).toEqual({
      elementId: "commit:a",
      interactionKey: "file:a:src/main.ts",
      granularity: "edge-group",
      relatedIds: ["history:a:b", "ref-target:main"],
    });
    expect(interactions.click(reference, { shift: true, alt: true })).toEqual({
      elementId: "commit:a",
      interactionKey: "file:a:src/main.ts",
      granularity: "cluster",
      relatedIds: ["commit:a", "ref-target:main", "ref:refs/heads/main"],
    });
  });

  it("resolves Alt traversal as a deterministic first-parent chain", () => {
    const reference = { objectId: "commit-batch", instanceId: 2 } as const;
    const picks = new PickRegistry();
    picks.register(
      reference,
      viewportPickRecord(
        { ownerId: "commit:b", elementId: "commit:b", interactionKey: "commit:b" },
        new Map(),
        dataset,
      ),
    );
    const interactions = new InteractionManager(picks, {
      resolveRelatedIds: (record, granularity) =>
        viewportRelatedSelectionIds(dataset, record, granularity),
    });

    expect(interactions.click(reference, { alt: true })).toEqual({
      elementId: "commit:b",
      interactionKey: "commit:b",
      granularity: "chain",
      relatedIds: ["commit:b", "history:a:b", "commit:a"],
    });
  });

  it("makes edge render identities directly pickable without pretending they are nodes", () => {
    const record = viewportPickRecord(
      {
        ownerId: "history:a:b",
        elementId: "history:a:b",
        interactionKey: "history:a:b",
      },
      new Map(),
      dataset,
    );
    expect(record.semanticKind).toBe("edge");
    expect(record.availableGranularities).toEqual([
      "sub-element",
      "edge-group",
      "chain",
      "cluster",
    ]);
    expect(viewportRelatedSelectionIds(dataset, record, "edge-group")).toEqual([
      "history:a:b",
      "ref-target:main",
    ]);
  });
  it("renders projection statistics without fabricating a second SSR node layout", () => {
    const html = renderToStaticMarkup(
      <GraphViewport
        dataset={dataset}
        selectedElementId="commit:a"
        search="alpha"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("rendered / 3 logical elements");
    expect(html).toContain("topology-derived Git Railfield · camera-projected labels");
    expect(html).toContain(
      'aria-describedby="viewport-keyboard-instructions viewport-selection-status viewport-mutation-status"',
    );
    expect(html).toContain("No mutation preview active.");
    expect(html).toContain("Use arrow keys to move between visible graph nodes.");
    expect(html).toContain("Selected alpha, commit.");
    expect(html).not.toContain("viewport-node__core");
    expect(html).not.toContain('title="alpha"');
  });

  it("maps roving keyboard traversal deterministically and wraps visible node order", () => {
    const ids = ["commit:a", "commit:b", "ref:refs/heads/main"] as const;

    expect(viewportTraversalCommand("ArrowRight")).toBe("next");
    expect(viewportTraversalCommand("ArrowDown")).toBe("next");
    expect(viewportTraversalCommand("ArrowLeft")).toBe("previous");
    expect(viewportTraversalCommand("ArrowUp")).toBe("previous");
    expect(viewportTraversalCommand("Home")).toBe("first");
    expect(viewportTraversalCommand("End")).toBe("last");
    expect(viewportTraversalCommand("Enter")).toBeUndefined();

    expect(viewportTraversalTarget(ids, "commit:a", "next")).toBe("commit:b");
    expect(viewportTraversalTarget(ids, "commit:a", "previous")).toBe("ref:refs/heads/main");
    expect(viewportTraversalTarget(ids, "ref:refs/heads/main", "next")).toBe("commit:a");
    expect(viewportTraversalTarget(ids, "commit:b", "first")).toBe("commit:a");
    expect(viewportTraversalTarget(ids, "commit:b", "last")).toBe("ref:refs/heads/main");
    expect(viewportTraversalTarget(ids, "commit:missing", "next")).toBe("commit:a");
    expect(viewportTraversalTarget([], "commit:a", "next")).toBeUndefined();
  });

  it("flips projected labels inward before a maximum-width label can clip the right edge", () => {
    expect(viewportLabelSide(81.99)).toBe("right");
    expect(viewportLabelSide(82)).toBe("left");
    expect(viewportLabelSide(100)).toBe("left");
  });

  it("reports bounded indexed search identities in adapter result order", () => {
    expect(viewportSearchResults("parser", [{ id: "commit:b" }, { id: "commit:a" }])).toEqual({
      query: "parser",
      filterKey: "",
      elementIds: ["commit:b", "commit:a"],
    });
    expect(viewportSearchResults("", undefined)).toEqual({
      query: "",
      filterKey: "",
      elementIds: [],
    });
  });

  it("keeps complete adapter filtering separate from bounded App/sidebar filter previews", () => {
    const filters = { authors: [" ADA ", "ada"], merge: false } as const;
    const filterIds = new Set(
      Array.from({ length: 240 }, (_, index) => `commit:${String(index).padStart(3, "0")}`),
    );

    expect(viewportSearchFilterKey(filters)).toBe(
      viewportSearchFilterKey({
        merge: false,
        authors: ["ada"],
      }),
    );
    expect(viewportSearchResults("alpha", [{ id: "commit:a" }], filters, filterIds)).toEqual({
      query: "alpha",
      filterKey: viewportSearchFilterKey(filters),
      elementIds: ["commit:a"],
      filterPreviewElementIds: Array.from(
        { length: 200 },
        (_, index) => `commit:${String(index).padStart(3, "0")}`,
      ),
      filterMatchCount: 240,
    });
    expect(viewportSearchFilterKey({ authors: ["   "] })).toBe("");
  });

  it("projects active Git filters through the same long-lived world-scale adapter", () => {
    const html = renderToStaticMarkup(
      <GraphViewport
        dataset={dataset}
        selectedElementId="commit:a"
        search=""
        filters={{ objectKinds: ["local-branch"] }}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("1 rendered / 3 logical elements");
    // In static rendering there is no Three camera, so labels intentionally have no
    // independent rank/hash fallback. The filtered render count remains authoritative.
    expect(html).not.toContain('title="main"');
    expect(html).not.toContain('title="alpha"');
  });

  it("resolves synthetic aggregate clicks to the deterministic logical drill target", () => {
    const targets = new Map([["lod-aggregate:history", { drillTargetId: "commit:a" }]]);

    expect(resolveViewportSelection("lod-aggregate:history", targets)).toBe("commit:a");
    expect(resolveViewportSelection("commit:b", targets)).toBe("commit:b");
  });

  it("resolves aggregate render identity before the generic interaction manager selects it", () => {
    const targets = new Map([["lod-aggregate:history", { drillTargetId: "commit:a" }]]);
    const reference = { objectId: "commit-batch", instanceId: 3 } as const;
    const picks = new PickRegistry();
    picks.register(
      reference,
      viewportPickRecord(
        {
          ownerId: "lod-aggregate:history",
          elementId: "body",
          interactionKey: "aggregate-body",
        },
        targets,
      ),
    );
    const interactions = new InteractionManager(picks);

    expect(interactions.click(reference, { shift: true })).toEqual({
      elementId: "commit:a",
      interactionKey: "aggregate-body",
      granularity: "node",
      relatedIds: ["commit:a"],
    });
  });

  it("resolves aggregate hover before delayed tooltip consumers observe identity", () => {
    vi.useFakeTimers();
    const targets = new Map([["lod-aggregate:history", { drillTargetId: "commit:a" }]]);
    const reference = { objectId: "aggregate-batch", instanceId: 2 } as const;
    const picks = new PickRegistry();
    picks.register(
      reference,
      viewportPickRecord(
        {
          ownerId: "lod-aggregate:history",
          elementId: "aggregate-body",
          interactionKey: "aggregate-hover",
        },
        targets,
      ),
    );
    const interactions = new InteractionManager(picks, { tooltipDelayMs: 25 });
    const tooltipIds: string[] = [];
    interactions.subscribe((event) => {
      if (event.type === "tooltip-request") tooltipIds.push(event.hover.record.elementId);
    });

    interactions.hover(reference);
    vi.advanceTimersByTime(24);
    expect(tooltipIds).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(interactions.getHover()).toMatchObject({
      record: { elementId: "commit:a", interactionKey: "aggregate-hover" },
      tooltipVisible: true,
    });
    expect(tooltipIds).toEqual(["commit:a"]);
  });

  it("resolves aggregate context requests to a logical Git element before consumers observe them", () => {
    const targets = new Map([["lod-aggregate:history", { drillTargetId: "commit:a" }]]);
    const reference = { objectId: "aggregate-context", instanceId: 4 } as const;
    const picks = new PickRegistry();
    picks.register(
      reference,
      viewportPickRecord(
        {
          ownerId: "lod-aggregate:history",
          elementId: "aggregate-body",
          interactionKey: "aggregate-context",
        },
        targets,
      ),
    );
    const interactions = new InteractionManager(picks);
    const contextIds: string[] = [];
    interactions.subscribe((event) => {
      if (event.type === "context-request" && event.selection.elementId !== undefined) {
        contextIds.push(event.selection.elementId);
      }
    });

    expect(interactions.requestContext(reference, { shift: true })).toMatchObject({
      elementId: "commit:a",
      granularity: "node",
    });
    expect(contextIds).toEqual(["commit:a"]);
  });

  it("routes standard keyboard context shortcuts through the authoritative selected identity mirror", () => {
    const picks = new PickRegistry();
    const interactions = new InteractionManager(picks);
    const shortcuts: Array<{ shortcut: string; elementId: string | undefined }> = [];
    interactions.subscribe((event) => {
      if (event.type === "shortcut") {
        shortcuts.push({ shortcut: event.shortcut, elementId: event.selection?.elementId });
      }
    });

    syncViewportInteractionSelection(picks, interactions, "commit:b");
    const menuShortcut = viewportContextShortcut({
      key: "ContextMenu",
      code: "ContextMenu",
      shiftKey: false,
    });
    expect(menuShortcut).toBe("context-menu");
    interactions.keyboardShortcut(menuShortcut!, {});

    const shiftF10 = viewportContextShortcut({ key: "F10", code: "F10", shiftKey: true });
    expect(shiftF10).toBe("context-menu");
    expect(viewportContextShortcut({ key: "F10", code: "F10", shiftKey: false })).toBeUndefined();
    interactions.keyboardShortcut(shiftF10!, { shift: true });

    expect(shortcuts).toEqual([
      { shortcut: "context-menu", elementId: "commit:b" },
      { shortcut: "context-menu", elementId: "commit:b" },
    ]);

    syncViewportInteractionSelection(picks, interactions, undefined);
    expect(interactions.getSelection()).toBeUndefined();
  });

  it("bounds viewport labels while promoting selected, hovered, and search identities", () => {
    const nodes: GraphNodeRecord[] = Array.from({ length: 64 }, (_, index) => ({
      id: `commit:${String(index).padStart(2, "0")}`,
      kind: "commit",
      label: `commit ${index}`,
      weight: 1,
      properties: {},
    }));
    const positions = new Map<string, Vec3>(
      nodes.map((node, index) => [node.id, [index, 0, 0] as Vec3]),
    );
    const selected = nodes[63]!.id;
    const hovered = nodes[62]!.id;
    const searchHit = nodes[61]!.id;
    const visible = planViewportLabels(
      new LabelSystem({ maxVisible: 48 }),
      nodes,
      positions,
      [0, 0, 0],
      selected,
      hovered,
      new Set([searchHit]),
    );

    expect(visible.size).toBeLessThanOrEqual(48);
    expect(visible.has(selected)).toBe(true);
    expect(visible.has(hovered)).toBe(true);
    expect(visible.has(searchHit)).toBe(true);
  });

  it("keeps local topology labels ahead of distant linear-history clutter", () => {
    const history = createSyntheticGitHistory(64);
    const selected = `commit:${(31).toString(16).padStart(12, "0")}`;
    const topology = buildGitTopologyContext(history, selected);
    const positions = new Map<string, Vec3>(
      history.nodes.map((node, index) => [node.id, [index, 0, 0] as Vec3]),
    );
    const visible = planViewportLabels(
      new LabelSystem({ maxVisible: 48 }),
      history.nodes,
      positions,
      [0, 0, 100],
      selected,
      undefined,
      new Set(),
      topology,
    );

    expect(visible.size).toBeLessThanOrEqual(48);
    expect(visible.has(selected)).toBe(true);
    for (const id of topology.immediateParentIds) expect(visible.has(id), `parent ${id}`).toBe(true);
    for (const id of topology.immediateChildIds) expect(visible.has(id), `child ${id}`).toBe(true);
    expect(visible.has("head:HEAD")).toBe(true);
    expect(visible.has("ref:refs/heads/main")).toBe(true);
  });

  it("preserves camera/pointer ownership without creating non-canonical SSR overlay picks", () => {
    const html = renderToStaticMarkup(
      <GraphViewport
        dataset={dataset}
        selectedElementId="commit:a"
        search=""
        cameraMode="free-flight"
        pointerMode="camera"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('data-camera-mode="free-flight"');
    expect(html).toContain('data-pointer-mode="camera"');
    expect(html).not.toContain("viewport-node");
  });
});
