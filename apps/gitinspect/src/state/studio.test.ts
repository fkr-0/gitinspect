import { describe, expect, it } from "vitest";

import { repositorySnapshotToGraphDataset } from "../domain/graphAdapter";
import { createDemoRepositoryService } from "../services/repository";
import { initialStudioState, studioReducer } from "./studio";

describe("studio state", () => {
  it("tracks loading, loaded selection, camera, cursor, and search state", async () => {
    const service = createDemoRepositoryService();
    const session = await service.openRepository("/repo/demo");
    const dataset = repositorySnapshotToGraphDataset(session.snapshot);

    const loading = studioReducer(initialStudioState, {
      type: "repositoryLoading",
      path: "/repo/demo",
    });
    expect(loading.status).toBe("loading");

    const ready = studioReducer(loading, {
      type: "repositoryLoaded",
      session,
      dataset,
    });
    expect(ready.status).toBe("ready");
    expect(ready.selectedElementId).toBeUndefined();

    const navigated = studioReducer(
      studioReducer(
        studioReducer(studioReducer(ready, { type: "cameraModeChanged", mode: "free-flight" }), {
          type: "pointerModeChanged",
          mode: "camera",
        }),
        { type: "searchChanged", search: "layout" },
      ),
      { type: "searchFiltersChanged", filters: { authors: ["Ada"], merge: false } },
    );

    expect(navigated.cameraMode).toBe("free-flight");
    expect(navigated.pointerMode).toBe("camera");
    expect(navigated.search).toBe("layout");
    expect(navigated.searchFilters).toEqual({ authors: ["Ada"], merge: false });
  });

  it("keeps destructive transaction execution out of state", () => {
    const open = studioReducer(initialStudioState, {
      type: "transactionTrayToggled",
    });

    expect(open.transactionTrayOpen).toBe(true);
    expect(Object.keys(open)).not.toContain("operations");
    expect(Object.keys(open)).not.toContain("confirmToken");
  });

  it("preserves logical selection across refresh and clears it explicitly when the object disappears", async () => {
    const service = createDemoRepositoryService();
    const session = await service.openRepository("/repo/demo");
    const dataset = repositorySnapshotToGraphDataset(session.snapshot);
    const selected = dataset.nodes[1]?.id;
    if (!selected) throw new Error("fixture missing second logical node");

    const ready = studioReducer(initialStudioState, {
      type: "repositoryLoaded",
      session,
      dataset,
    });
    const selectedState = studioReducer(ready, { type: "elementSelected", elementId: selected });
    const refreshed = studioReducer(selectedState, {
      type: "repositoryLoaded",
      session: { ...session, snapshot: { ...session.snapshot, revision: "rev-2" } },
      dataset: { ...dataset, revision: "rev-2" },
    });

    expect(refreshed.selectedElementId).toBe(selected);
    expect(refreshed.selectionNotice).toBeUndefined();

    const withoutSelected = {
      ...dataset,
      revision: "rev-3",
      nodes: dataset.nodes.filter((node) => node.id !== selected),
      edges: dataset.edges.filter((edge) => edge.source !== selected && edge.target !== selected),
    };
    const disappeared = studioReducer(refreshed, {
      type: "repositoryLoaded",
      session: { ...session, snapshot: { ...session.snapshot, revision: "rev-3" } },
      dataset: withoutSelected,
    });

    expect(disappeared.selectedElementId).toBeUndefined();
    expect(disappeared.selectionNotice).toContain(selected);
    expect(disappeared.selectionNotice).toContain("no longer present after repository refresh");
  });

  it("rejects stale external selection requests without selecting a fallback object", () => {
    const rejected = studioReducer(initialStudioState, {
      type: "selectionRejected",
      elementId: "commit:missing",
      message: "URL selection is not present in the current repository",
    });

    expect(rejected.selectedElementId).toBeUndefined();
    expect(rejected.selectionNotice).toContain("commit:missing");
  });

  it("uses a valid URL-preferred selection on initial repository load and rejects a stale one", async () => {
    const service = createDemoRepositoryService();
    const session = await service.openRepository("/repo/demo");
    const dataset = repositorySnapshotToGraphDataset(session.snapshot);
    const preferred = dataset.nodes.at(-1)?.id;
    if (!preferred) throw new Error("fixture missing logical node");

    const selected = studioReducer(initialStudioState, {
      type: "repositoryLoaded",
      session,
      dataset,
      preferredSelectionId: preferred,
    });
    expect(selected.selectedElementId).toBe(preferred);

    const rejected = studioReducer(initialStudioState, {
      type: "repositoryLoaded",
      session,
      dataset,
      preferredSelectionId: "commit:not-present",
    });
    expect(rejected.selectedElementId).toBeUndefined();
    expect(rejected.selectionNotice).toContain("commit:not-present");
  });
});
