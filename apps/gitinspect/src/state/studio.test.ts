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
    expect(ready.selectedElementId).toBe(dataset.nodes[0]?.id);

    const navigated = studioReducer(
      studioReducer(
        studioReducer(ready, { type: "cameraModeChanged", mode: "free-flight" }),
        { type: "pointerModeChanged", mode: "camera" },
      ),
      { type: "searchChanged", search: "layout" },
    );

    expect(navigated.cameraMode).toBe("free-flight");
    expect(navigated.pointerMode).toBe("camera");
    expect(navigated.search).toBe("layout");
  });

  it("keeps destructive transaction execution out of state", () => {
    const open = studioReducer(initialStudioState, {
      type: "transactionTrayToggled",
    });

    expect(open.transactionTrayOpen).toBe(true);
    expect(Object.keys(open)).not.toContain("operations");
    expect(Object.keys(open)).not.toContain("confirmToken");
  });
});
