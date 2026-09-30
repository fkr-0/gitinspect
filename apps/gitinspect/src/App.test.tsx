import {
  type ChildWorldResolver,
  type WorldNavigationFrame,
  WorldNavigationStack,
} from "@gitinspect/graph-elements";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  App,
  activeGitSearchFilterCount,
  changedFilePathForInspection,
  childNavigationUrlStateForNavigation,
  dateSearchFilterValue,
  hrefForNavigationSnapshot,
  inspectionNodeForNavigation,
  logicalSelectionFromViewport,
  navigationLocalSelectionFromViewport,
  persistCurrentNavigationCamera,
  reconcileNavigationAfterRepositoryRefresh,
  restoreNavigationFromUrlState,
  rewindNavigationToRoot,
  searchFilterText,
  searchInputKeyboardAction,
  selectedPatchHunkIndexForInspection,
  shouldUseChildBrowserHistoryBack,
  viewportInteractionSelectionForDataset,
  visibleLogicalNodesForSearch,
  withDateSearchFilter,
  withMergeSearchFilter,
  withSearchFilterText,
  withSignatureSearchFilter,
} from "./App";
import { viewportSearchFilterKey } from "./components/GraphViewport";
import { childNavigationHistoryState } from "./state/selectionUrl";

describe("gitinspect application shell", () => {
  it("renders the studio chrome without a browser or native Tauri runtime", () => {
    const html = renderToStaticMarkup(<App autoOpenDemo={false} />);

    expect(html).toContain("gitinspect");
    expect(html).toContain("3D graph viewport");
    expect(html).toContain("Repository path");
    expect(html).toContain("Transaction tray");
    expect(html).toContain("Disposable-copy preview");
    expect(html).toContain("No original-repository apply command is exposed here");
    expect(html).toContain("Filters");
    expect(html).toContain("Signature");
    expect(html).toContain('aria-keyshortcuts="/"');
    expect(html).toContain("Apply to repository");
    expect(html).toContain("disabled");
  });

  it("keeps file and edge interaction detail inspectable without changing logical node identity", () => {
    const dataset = {
      revision: "rev-interaction",
      nodes: [
        {
          id: "commit:abc",
          kind: "commit",
          properties: {
            oid: "abc",
            files: [
              {
                path: "src/main.ts",
                kind: "text",
                status: "modified",
                additions: 2,
                deletions: 1,
              },
            ],
          },
        },
        { id: "commit:def", kind: "commit", properties: { oid: "def" } },
      ],
      edges: [
        {
          id: "history:abc:def",
          source: "commit:abc",
          target: "commit:def",
          kind: "history",
          directed: true,
          properties: { firstParent: true },
        },
      ],
    };

    const fileInspection = viewportInteractionSelectionForDataset(
      {
        elementId: "commit:abc",
        interactionKey: "file:abc:src/main.ts",
        granularity: "sub-element",
        relatedIds: ["file:abc:src/main.ts"],
      },
      dataset,
    );
    expect(fileInspection?.node?.id).toBe("commit:abc");
    expect(fileInspection?.changedFilePath).toBe("src/main.ts");

    const edgeInspection = viewportInteractionSelectionForDataset(
      {
        elementId: "history:abc:def",
        interactionKey: "history:abc:def",
        granularity: "edge-group",
        relatedIds: ["history:abc:def"],
      },
      dataset,
    );
    expect(edgeInspection?.node).toBeUndefined();
    expect(edgeInspection?.edge?.source).toBe("commit:abc");
    expect(edgeInspection?.edge?.target).toBe("commit:def");
  });

  it("accepts viewport identities only in the authoritative repository world", () => {
    expect(logicalSelectionFromViewport("commit:abc", 0)).toBe("commit:abc");
    expect(logicalSelectionFromViewport("commit-file:abc:src%2Fmain.ts", 1)).toBeUndefined();
    expect(navigationLocalSelectionFromViewport("commit:abc", 0)).toBeUndefined();
    expect(navigationLocalSelectionFromViewport("commit-file:abc:src%2Fmain.ts", 1)).toBe(
      "commit-file:abc:src%2Fmain.ts",
    );
  });

  it("inspects child-world identities locally without replacing repository selection", () => {
    const rootNode = { id: "commit:abc", kind: "commit", properties: { oid: "abc" } };
    const childFile = {
      id: "commit-file:abc:src%2Fmain.ts",
      kind: "changed-file-text",
      label: "src/main.ts",
      properties: { path: "src/main.ts", boundedSummaryOnly: true },
    };
    const childDataset = {
      revision: "rev-1:commit:abc",
      nodes: [
        { id: "commit-core:abc", kind: "commit-core", properties: { oid: "abc" } },
        childFile,
      ],
      edges: [],
    };

    expect(inspectionNodeForNavigation(rootNode, childDataset, 0, childFile.id)).toBe(rootNode);
    expect(inspectionNodeForNavigation(rootNode, childDataset, 1, childFile.id)).toEqual(childFile);
    expect(inspectionNodeForNavigation(rootNode, childDataset, 1, "missing")).toBeUndefined();
    expect(changedFilePathForInspection(rootNode, 0)).toBeUndefined();
    expect(changedFilePathForInspection(childFile, 1)).toBe("src/main.ts");
    expect(
      changedFilePathForInspection(
        { id: "commit-core:abc", kind: "commit-core", properties: { path: "should-not-load" } },
        1,
      ),
    ).toBeUndefined();
    const hunkNode = {
      id: "file-hunk:abc:src%2Fmain.ts:2",
      kind: "diff-hunk",
      properties: { path: "src/main.ts", hunkIndex: 2 },
    };
    expect(changedFilePathForInspection(hunkNode, 2)).toBe("src/main.ts");
    expect(selectedPatchHunkIndexForInspection(hunkNode, 2)).toBe(2);
    expect(selectedPatchHunkIndexForInspection(hunkNode, 1)).toBeUndefined();
  });

  it("maps keyboard-first search commands without hijacking empty search", () => {
    expect(searchInputKeyboardAction("/", "", 0, "commit:a")).toBeUndefined();
    expect(searchInputKeyboardAction("Escape", "parser", 0, "commit:a")).toEqual({ type: "clear" });
    expect(searchInputKeyboardAction("Enter", "parser", 0, "commit:a")).toEqual({
      type: "select",
      elementId: "commit:a",
    });
    expect(searchInputKeyboardAction("Enter", "", 1, "ref:main")).toEqual({
      type: "select",
      elementId: "ref:main",
    });
    expect(searchInputKeyboardAction("Enter", "", 0, "commit:a")).toBeUndefined();
    expect(searchInputKeyboardAction("Enter", "parser", 0, undefined)).toBeUndefined();
  });

  it("uses ordered indexed search hits instead of a second ad-hoc substring filter", () => {
    const dataset = {
      revision: "rev-search",
      nodes: [
        {
          id: "commit:message-match",
          kind: "commit",
          label: "unrelated label",
          properties: { message: "Fix parser race" },
        },
        {
          id: "commit:label-match",
          kind: "commit",
          label: "parser cleanup",
          properties: {},
        },
        {
          id: "ref:main",
          kind: "local-branch",
          label: "main",
          properties: {},
        },
      ],
      edges: [],
    };

    expect(
      visibleLogicalNodesForSearch(dataset, " PARSER ", undefined, {
        query: "parser",
        filterKey: "",
        elementIds: ["commit:message-match", "commit:label-match"],
      }).map((node) => node.id),
    ).toEqual(["commit:message-match", "commit:label-match"]);
    expect(
      visibleLogicalNodesForSearch(dataset, "new query", undefined, {
        query: "parser",
        filterKey: "",
        elementIds: ["commit:message-match"],
      }),
    ).toEqual([]);
    expect(
      visibleLogicalNodesForSearch(
        dataset,
        "",
        undefined,
        {
          query: "parser",
          filterKey: "",
          elementIds: ["commit:message-match"],
        },
        2,
      ).map((node) => node.id),
    ).toEqual(["commit:message-match", "commit:label-match"]);
  });

  it("uses adapter-provided filter identities without constructing a second app-side filter", () => {
    const dataset = {
      revision: "rev-filter",
      nodes: [
        { id: "commit:a", kind: "commit", label: "alpha", properties: {} },
        { id: "commit:b", kind: "commit", label: "beta", properties: {} },
        { id: "ref:main", kind: "local-branch", label: "main", properties: {} },
      ],
      edges: [],
    };
    const filters = { objectKinds: ["commit"] } as const;
    const filterKey = viewportSearchFilterKey(filters);

    expect(
      visibleLogicalNodesForSearch(dataset, "", filters, {
        query: "",
        filterKey,
        elementIds: [],
        filterPreviewElementIds: ["commit:b", "commit:a"],
        filterMatchCount: 2,
      }).map((node) => node.id),
    ).toEqual(["commit:b", "commit:a"]);
    expect(
      visibleLogicalNodesForSearch(dataset, "", filters, {
        query: "",
        filterKey: viewportSearchFilterKey({ authors: ["Ada"] }),
        elementIds: [],
        filterPreviewElementIds: ["commit:a"],
        filterMatchCount: 1,
      }),
    ).toEqual([]);
  });

  it("builds every Git filter dimension as Studio interaction state", () => {
    let filters = withSearchFilterText({}, "objectKinds", "commit");
    filters = withSearchFilterText(filters, "authors", "Ada");
    filters = withSearchFilterText(filters, "refs", "main");
    filters = withSearchFilterText(filters, "changedPaths", "src/");
    filters = withSignatureSearchFilter(filters, "valid");
    filters = withMergeSearchFilter(filters, "non-merge");
    filters = withDateSearchFilter(filters, "fromMs", "2026-08-01");
    filters = withDateSearchFilter(filters, "toMs", "2026-08-23");

    expect(searchFilterText(filters, "authors")).toBe("Ada");
    expect(filters.signatureStates).toEqual(["valid"]);
    expect(filters.merge).toBe(false);
    expect(dateSearchFilterValue(filters.dateRange?.fromMs)).toBe("2026-08-01");
    expect(dateSearchFilterValue(filters.dateRange?.toMs)).toBe("2026-08-23");
    expect(filters.dateRange?.toMs).toBe(Date.UTC(2026, 7, 23, 23, 59, 59, 999));
    expect(activeGitSearchFilterCount(filters)).toBe(7);
    expect(withSearchFilterText(filters, "authors", "").authors).toBeUndefined();
  });

  it("rewinds derived child worlds before another logical repository selection takes authority", async () => {
    const frame = (datasetIdentity: string): WorldNavigationFrame => ({
      datasetIdentity,
      dataset: {
        revision: datasetIdentity,
        nodes: [{ id: datasetIdentity, kind: "commit", properties: {} }],
        edges: [],
      },
      mapperKey: datasetIdentity,
      layoutKey: datasetIdentity,
      camera: {
        mode: "attached",
        position: [0, 0, 1],
        target: [0, 0, 0],
        zoom: 1,
      },
    });
    const root = frame("root");
    const stack = new WorldNavigationStack(root, async () => frame("child"));

    await expect(stack.enter("commit:abc")).resolves.toBe(true);
    expect(stack.depth).toBe(1);
    expect(rewindNavigationToRoot(stack)?.current.datasetIdentity).toBe("root");
    expect(stack.depth).toBe(0);
  });

  it("re-resolves surviving commit and file worlds across repository refresh without losing local identity", async () => {
    const commitId = "commit:abc";
    const fileId = "commit-file:abc:src%2Fmain.ts";
    const hunkId = "file-hunk:abc:src%2Fmain.ts:0";
    const frame = (
      datasetIdentity: string,
      revision: string,
      nodes: WorldNavigationFrame["dataset"]["nodes"],
      selectionId: string,
      position: readonly [number, number, number],
    ): WorldNavigationFrame => ({
      datasetIdentity,
      dataset: { revision, nodes, edges: [] },
      mapperKey: "git-test",
      layoutKey: "git-test",
      selectionId,
      camera: {
        mode: "attached",
        position,
        target: [0, 0, 0],
        attachedNodeId: selectionId,
        zoom: 1,
      },
    });
    const oldRoot = frame(
      "repository:1:rev-1:repository",
      "rev-1",
      [{ id: commitId, kind: "commit", properties: { oid: "abc" } }],
      commitId,
      [11, 6, 16],
    );
    const oldCommit = frame(
      "repository:1:rev-1:commit:abc",
      "rev-1:commit:abc",
      [
        { id: "commit-core:abc", kind: "commit-core", properties: { oid: "abc" } },
        {
          id: fileId,
          kind: "changed-file-text",
          properties: { path: "src/main.ts" },
        },
      ],
      fileId,
      [3, 4, 17],
    );
    const oldFile = frame(
      "repository:1:rev-1:commit:abc:file:src%2Fmain.ts",
      "rev-1:commit:abc:file:src%2Fmain.ts",
      [
        {
          id: "file-core:abc:src%2Fmain.ts",
          kind: "file-detail-core",
          properties: { path: "src/main.ts" },
        },
        {
          id: hunkId,
          kind: "diff-hunk",
          properties: { path: "src/main.ts", hunkIndex: 0 },
        },
      ],
      hunkId,
      [1, 3, 14],
    );
    const oldResolver: ChildWorldResolver = async ({ elementId }) =>
      elementId === commitId ? oldCommit : elementId === fileId ? oldFile : undefined;
    const oldStack = new WorldNavigationStack(oldRoot, oldResolver);
    await expect(oldStack.enter(commitId)).resolves.toBe(true);
    await expect(oldStack.enter(fileId)).resolves.toBe(true);

    const newRoot = frame(
      "repository:1:rev-2:repository",
      "rev-2",
      [{ id: commitId, kind: "commit", properties: { oid: "abc" } }],
      commitId,
      [10, 6, 16],
    );
    const newCommit = frame(
      "repository:1:rev-2:commit:abc",
      "rev-2:commit:abc",
      [
        { id: "commit-core:abc", kind: "commit-core", properties: { oid: "abc" } },
        {
          id: fileId,
          kind: "changed-file-text",
          properties: { path: "src/main.ts" },
        },
      ],
      "commit-core:abc",
      [0, 4, 18],
    );
    const newFile = frame(
      "repository:1:rev-2:commit:abc:file:src%2Fmain.ts",
      "rev-2:commit:abc:file:src%2Fmain.ts",
      [
        {
          id: "file-core:abc:src%2Fmain.ts",
          kind: "file-detail-core",
          properties: { path: "src/main.ts" },
        },
        {
          id: hunkId,
          kind: "diff-hunk",
          properties: { path: "src/main.ts", hunkIndex: 0 },
        },
      ],
      "file-core:abc:src%2Fmain.ts",
      [0, 3, 15],
    );
    const refreshedResolver: ChildWorldResolver = async ({ elementId }) =>
      elementId === commitId ? newCommit : elementId === fileId ? newFile : undefined;

    const restored = await reconcileNavigationAfterRepositoryRefresh(
      oldStack.snapshot(),
      newRoot,
      refreshedResolver,
      commitId,
    );

    expect(restored.message).toBeUndefined();
    expect(restored.stack.depth).toBe(2);
    expect(restored.snapshot.current.dataset.revision).toBe("rev-2:commit:abc:file:src%2Fmain.ts");
    expect(restored.snapshot.history[0]?.selectionId).toBe(commitId);
    expect(restored.snapshot.history[1]?.selectionId).toBe(fileId);
    expect(restored.snapshot.history[1]?.camera.position).toEqual([3, 4, 17]);
    expect(restored.snapshot.current.selectionId).toBe(hunkId);
    expect(restored.snapshot.current.camera.position).toEqual([1, 3, 14]);
    expect(restored.navigationElementId).toBe(hunkId);
  });

  it("rewinds to the surviving commit world with an explicit notice when a refreshed file target disappears", async () => {
    const commitId = "commit:abc";
    const fileId = "commit-file:abc:src%2Fgone.ts";
    const root = (revision: string): WorldNavigationFrame => ({
      datasetIdentity: `repository:1:${revision}:repository`,
      dataset: {
        revision,
        nodes: [{ id: commitId, kind: "commit", properties: { oid: "abc" } }],
        edges: [],
      },
      mapperKey: "git-test",
      layoutKey: "git-test",
      selectionId: commitId,
      camera: { mode: "attached", position: [10, 6, 16], target: [0, 0, 0], zoom: 1 },
    });
    const oldCommit: WorldNavigationFrame = {
      ...root("rev-1"),
      datasetIdentity: "repository:1:rev-1:commit:abc",
      dataset: {
        revision: "rev-1:commit:abc",
        nodes: [
          { id: "commit-core:abc", kind: "commit-core", properties: { oid: "abc" } },
          { id: fileId, kind: "changed-file-text", properties: { path: "src/gone.ts" } },
        ],
        edges: [],
      },
      selectionId: fileId,
    };
    const oldFile: WorldNavigationFrame = {
      ...oldCommit,
      datasetIdentity: "repository:1:rev-1:commit:abc:file:src%2Fgone.ts",
      dataset: {
        revision: "rev-1:commit:abc:file:src%2Fgone.ts",
        nodes: [
          {
            id: "file-core:abc:src%2Fgone.ts",
            kind: "file-detail-core",
            properties: { path: "src/gone.ts" },
          },
        ],
        edges: [],
      },
      selectionId: "file-core:abc:src%2Fgone.ts",
    };
    const oldResolver: ChildWorldResolver = async ({ elementId }) =>
      elementId === commitId ? oldCommit : elementId === fileId ? oldFile : undefined;
    const oldStack = new WorldNavigationStack(root("rev-1"), oldResolver);
    await oldStack.enter(commitId);
    await oldStack.enter(fileId);

    const refreshedCommit: WorldNavigationFrame = {
      ...oldCommit,
      datasetIdentity: "repository:1:rev-2:commit:abc",
      dataset: {
        revision: "rev-2:commit:abc",
        nodes: [{ id: "commit-core:abc", kind: "commit-core", properties: { oid: "abc" } }],
        edges: [],
      },
      selectionId: "commit-core:abc",
      camera: {
        mode: "attached",
        position: [0, 4, 18],
        target: [0, 0, 0],
        attachedNodeId: "commit-core:abc",
        zoom: 1,
      },
    };
    const refreshedResolver: ChildWorldResolver = async ({ elementId }) =>
      elementId === commitId ? refreshedCommit : undefined;

    const restored = await reconcileNavigationAfterRepositoryRefresh(
      oldStack.snapshot(),
      root("rev-2"),
      refreshedResolver,
      commitId,
    );

    expect(restored.stack.depth).toBe(1);
    expect(restored.snapshot.current.dataset.revision).toBe("rev-2:commit:abc");
    expect(restored.snapshot.current.selectionId).toBe("commit-core:abc");
    expect(restored.navigationElementId).toBe("commit-core:abc");
    expect(restored.message).toContain(fileId);
    expect(restored.message).toContain("no longer present after repository refresh");
  });

  it("restores a bounded file/hunk deep link through the existing lazy navigation resolver", async () => {
    const commitId = "commit:abc";
    const fileId = "commit-file:abc:src%2Fmain.ts";
    const hunkId = "file-hunk:abc:src%2Fmain.ts:0";
    const root: WorldNavigationFrame = {
      datasetIdentity: "repository:1:rev-1:repository",
      dataset: {
        revision: "rev-1",
        nodes: [{ id: commitId, kind: "commit", properties: { oid: "abc" } }],
        edges: [],
      },
      mapperKey: "git-test",
      layoutKey: "git-test",
      camera: { mode: "attached", position: [10, 6, 16], target: [0, 0, 0], zoom: 1 },
    };
    const commit: WorldNavigationFrame = {
      ...root,
      datasetIdentity: "repository:1:rev-1:commit:abc",
      dataset: {
        revision: "rev-1:commit:abc",
        nodes: [
          { id: "commit-core:abc", kind: "commit-core", properties: { oid: "abc" } },
          { id: fileId, kind: "changed-file-text", properties: { path: "src/main.ts" } },
        ],
        edges: [],
      },
      selectionId: "commit-core:abc",
    };
    const file: WorldNavigationFrame = {
      ...commit,
      datasetIdentity: "repository:1:rev-1:commit:abc:file:src%2Fmain.ts",
      dataset: {
        revision: "rev-1:commit:abc:file:src%2Fmain.ts",
        nodes: [
          {
            id: "file-core:abc:src%2Fmain.ts",
            kind: "file-detail-core",
            properties: { path: "src/main.ts" },
          },
          {
            id: hunkId,
            kind: "diff-hunk",
            properties: { path: "src/main.ts", hunkIndex: 0 },
          },
        ],
        edges: [],
      },
      selectionId: "file-core:abc:src%2Fmain.ts",
    };
    const resolver: ChildWorldResolver = async ({ elementId }) =>
      elementId === commitId ? commit : elementId === fileId ? file : undefined;
    const stack = new WorldNavigationStack(root, resolver);
    const request = {
      depth: 2 as const,
      fileElementId: fileId,
      localSelectionId: hunkId,
    };

    const restored = await restoreNavigationFromUrlState(stack, request, commitId);

    expect(restored.message).toBeUndefined();
    expect(stack.depth).toBe(2);
    expect(restored.snapshot.history[0]?.selectionId).toBe(commitId);
    expect(restored.snapshot.history[1]?.selectionId).toBe(fileId);
    expect(restored.navigationElementId).toBe(hunkId);
    expect(
      childNavigationUrlStateForNavigation(restored.snapshot, restored.navigationElementId),
    ).toEqual(request);
    const href = hrefForNavigationSnapshot(
      "https://gitinspect.local/studio?mode=cursor#world",
      commitId,
      restored.snapshot,
      restored.navigationElementId,
    );
    expect(new URL(href).searchParams.get("selection")).toBe(commitId);
    expect(new URL(href).searchParams.get("world")).toBe("file");
    expect(new URL(href).searchParams.get("worldTarget")).toBe(fileId);
    expect(new URL(href).searchParams.get("worldSelection")).toBe(hunkId);
    expect(new URL(href).searchParams.get("mode")).toBe("cursor");
    expect(new URL(href).hash).toBe("#world");
  });

  it("uses browser back only for the matching gitinspect-owned child history depth", () => {
    expect(shouldUseChildBrowserHistoryBack(childNavigationHistoryState(1), 1)).toBe(true);
    expect(shouldUseChildBrowserHistoryBack(childNavigationHistoryState(2), 2)).toBe(true);
    expect(shouldUseChildBrowserHistoryBack(childNavigationHistoryState(1), 2)).toBe(false);
    expect(shouldUseChildBrowserHistoryBack(childNavigationHistoryState(2), 1)).toBe(false);
    expect(shouldUseChildBrowserHistoryBack(null, 1)).toBe(false);
    expect(shouldUseChildBrowserHistoryBack({ unrelated: true }, 2)).toBe(false);
    expect(shouldUseChildBrowserHistoryBack(childNavigationHistoryState(1), 0)).toBe(false);
  });

  it("fails a stale deep-link local identity closed at the repository root", async () => {
    const commitId = "commit:abc";
    const fileId = "commit-file:abc:src%2Fmain.ts";
    const root: WorldNavigationFrame = {
      datasetIdentity: "repository:1:rev-1:repository",
      dataset: {
        revision: "rev-1",
        nodes: [{ id: commitId, kind: "commit", properties: { oid: "abc" } }],
        edges: [],
      },
      mapperKey: "git-test",
      layoutKey: "git-test",
      camera: { mode: "attached", position: [10, 6, 16], target: [0, 0, 0], zoom: 1 },
    };
    const commit: WorldNavigationFrame = {
      ...root,
      datasetIdentity: "repository:1:rev-1:commit:abc",
      dataset: {
        revision: "rev-1:commit:abc",
        nodes: [{ id: fileId, kind: "changed-file-text", properties: { path: "src/main.ts" } }],
        edges: [],
      },
      selectionId: fileId,
    };
    const file: WorldNavigationFrame = {
      ...commit,
      datasetIdentity: "repository:1:rev-1:commit:abc:file:src%2Fmain.ts",
      dataset: {
        revision: "rev-1:commit:abc:file:src%2Fmain.ts",
        nodes: [
          {
            id: "file-core:abc:src%2Fmain.ts",
            kind: "file-detail-core",
            properties: { path: "src/main.ts" },
          },
        ],
        edges: [],
      },
      selectionId: "file-core:abc:src%2Fmain.ts",
    };
    const stack = new WorldNavigationStack(root, async ({ elementId }) =>
      elementId === commitId ? commit : elementId === fileId ? file : undefined,
    );

    const restored = await restoreNavigationFromUrlState(
      stack,
      { depth: 2, fileElementId: fileId, localSelectionId: "file-hunk:abc:src%2Fmain.ts:9" },
      commitId,
    );

    expect(stack.depth).toBe(0);
    expect(restored.snapshot.current.dataset.revision).toBe("rev-1");
    expect(restored.navigationElementId).toBeUndefined();
    expect(restored.message).toContain("not present in the resolved child world");
  });

  it("persists the live viewport camera in navigation history before commit drill-down", async () => {
    const root: WorldNavigationFrame = {
      datasetIdentity: "repository:1:rev-1:repository",
      dataset: {
        revision: "rev-1",
        nodes: [{ id: "commit:abc", kind: "commit", properties: {} }],
        edges: [],
      },
      mapperKey: "git-repository-v1",
      layoutKey: "git-repository-lod-v1",
      camera: {
        mode: "attached",
        position: [10, 6, 16],
        target: [0, 0, 0],
        zoom: 1,
      },
    };
    const child: WorldNavigationFrame = {
      ...root,
      datasetIdentity: "repository:1:rev-1:commit:abc",
      dataset: { ...root.dataset, revision: "rev-1:commit:abc" },
      camera: {
        mode: "attached",
        position: [0, 4, 18],
        target: [0, 0, 0],
        attachedNodeId: "commit-core:abc",
        zoom: 1,
      },
    };
    const stack = new WorldNavigationStack(root, async () => child);
    const liveRootCamera = {
      mode: "attached" as const,
      position: [24, 8, -7] as const,
      target: [5, 2, 1] as const,
      attachedNodeId: "commit:abc",
      zoom: 1.4,
    };

    persistCurrentNavigationCamera(stack, liveRootCamera, "commit:abc");
    await expect(stack.enter("commit:abc")).resolves.toBe(true);
    expect(stack.back()).toBe(true);
    expect(stack.current.camera).toEqual(liveRootCamera);
    expect(stack.current.selectionId).toBe("commit:abc");
  });
});
