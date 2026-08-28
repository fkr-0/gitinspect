import type { GitCommitDiff, GitCommitFileDetail } from "@gitinspect/contracts";
import {
  type CameraState,
  type ChildWorldResolver,
  type GraphDataset,
  type GraphNodeRecord,
  type SelectionState,
  type WorldNavigationFrame,
  type WorldNavigationSnapshot,
  WorldNavigationStack,
} from "@gitinspect/graph-elements";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  GraphViewport,
  type ViewportSearchResults,
  viewportSearchFilterKey,
} from "./components/GraphViewport";
import { changedFilePathForGitSelection } from "./domain/gitVisualMapper";
import { repositorySnapshotToGraphDataset } from "./domain/graphAdapter";
import { GitCommitDrilldownResolver } from "./drilldown/gitCommitDrilldown";
import { GitCommitDiffCache } from "./inspection/gitCommitDiffCache";
import type { GitSearchFilters, GitSignatureState } from "./search";
import {
  createDemoRepositoryService,
  type RepositoryService,
  type RepositorySession,
} from "./services/repository";
import { RepositoryLiveRefreshCoordinator } from "./services/repositoryLiveRefresh";
import {
  type ChildNavigationUrlParse,
  type ChildNavigationUrlState,
  childNavigationFromHref,
  childNavigationHistoryDepth,
  childNavigationHistoryState,
  hrefWithChildNavigation,
  hrefWithSelection,
  selectionFromHref,
} from "./state/selectionUrl";
import { initialStudioState, studioReducer } from "./state/studio";
import { GitMutationPreviewTray } from "./transactions/GitMutationPreviewTray";

interface AppProps {
  readonly repositoryService?: RepositoryService;
  readonly autoOpenDemo?: boolean;
}

interface PendingChildNavigationRestore {
  readonly rootSelectionId: string | undefined;
  readonly parsed: ChildNavigationUrlParse;
}

export function viewportInteractionSelectionForDataset(
  selection: SelectionState | undefined,
  dataset: GraphDataset | undefined,
) {
  if (!selection?.elementId || !dataset) return undefined;
  const node = dataset.nodes.find((candidate) => candidate.id === selection.elementId);
  const edge = dataset.edges.find((candidate) => candidate.id === selection.elementId);
  if (!node && !edge) return undefined;
  return {
    selection,
    node,
    edge,
    changedFilePath: changedFilePathForGitSelection(selection, dataset),
  };
}

type CommitDiffState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly oid: string }
  | { readonly status: "ready"; readonly oid: string; readonly diff: GitCommitDiff }
  | { readonly status: "error"; readonly oid: string; readonly message: string };

type FileDetailState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly oid: string; readonly path: string }
  | {
      readonly status: "ready";
      readonly oid: string;
      readonly path: string;
      readonly detail: GitCommitFileDetail;
    }
  | {
      readonly status: "error";
      readonly oid: string;
      readonly path: string;
      readonly message: string;
    };

function repositoryWorldFrame(
  session: RepositorySession,
  dataset: GraphDataset,
  camera?: CameraState,
): WorldNavigationFrame {
  return {
    datasetIdentity: `${session.key}:${session.snapshot.revision}:repository`,
    dataset,
    mapperKey: "git-repository-v1",
    layoutKey: "git-repository-lod-v1",
    camera: camera ?? {
      mode: "attached",
      position: [10, 6, 16],
      target: [0, 0, 0],
      zoom: 1,
    },
  };
}

export function logicalSelectionFromViewport(
  elementId: string,
  navigationDepth: number,
): string | undefined {
  return navigationDepth === 0 ? elementId : undefined;
}

export function navigationLocalSelectionFromViewport(
  elementId: string,
  navigationDepth: number,
): string | undefined {
  return navigationDepth > 0 ? elementId : undefined;
}

export function inspectionNodeForNavigation(
  rootSelection: GraphNodeRecord | undefined,
  activeDataset: GraphDataset | undefined,
  navigationDepth: number,
  navigationElementId: string | undefined,
): GraphNodeRecord | undefined {
  if (navigationDepth === 0) return rootSelection;
  if (!activeDataset || navigationElementId === undefined) return undefined;
  return activeDataset.nodes.find((node) => node.id === navigationElementId);
}

export function changedFilePathForInspection(
  node: GraphNodeRecord | undefined,
  navigationDepth: number,
): string | undefined {
  if (navigationDepth === 0 || !node) return undefined;
  const fileDetailKind =
    node.kind.startsWith("changed-file-") ||
    node.kind === "file-detail-core" ||
    node.kind === "diff-hunk" ||
    node.kind === "file-blob-context";
  if (!fileDetailKind) return undefined;
  const path = node.properties.path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

export function selectedPatchHunkIndexForInspection(
  node: GraphNodeRecord | undefined,
  navigationDepth: number,
): number | undefined {
  if (navigationDepth < 2 || node?.kind !== "diff-hunk") return undefined;
  const index = node.properties.hunkIndex;
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

export function visibleLogicalNodesForSearch(
  dataset: GraphDataset | undefined,
  search: string,
  filters: GitSearchFilters | undefined,
  indexedResults: ViewportSearchResults,
  limit = 48,
): readonly GraphNodeRecord[] {
  if (!dataset || limit <= 0) return [];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filterKey = viewportSearchFilterKey(filters);
  if (normalizedSearch.length === 0 && filterKey.length === 0) return dataset.nodes.slice(0, limit);
  if (indexedResults.query !== normalizedSearch || indexedResults.filterKey !== filterKey)
    return [];
  const resultIds =
    normalizedSearch.length > 0
      ? indexedResults.elementIds
      : (indexedResults.filterPreviewElementIds ?? []);

  const nodesById = new Map(dataset.nodes.map((node) => [node.id, node]));
  const visible: GraphNodeRecord[] = [];
  const seen = new Set<string>();
  for (const elementId of resultIds) {
    if (visible.length >= limit || seen.has(elementId)) continue;
    seen.add(elementId);
    const node = nodesById.get(elementId);
    if (node) visible.push(node);
  }
  return visible;
}

type TextSearchFilterKey = "objectKinds" | "authors" | "refs" | "changedPaths";

export function searchFilterText(filters: GitSearchFilters, key: TextSearchFilterKey): string {
  return filters[key]?.[0] ?? "";
}

export function withSearchFilterText(
  filters: GitSearchFilters,
  key: TextSearchFilterKey,
  value: string,
): GitSearchFilters {
  const activeValue = value.trim().length > 0 ? ([value] as const) : undefined;
  switch (key) {
    case "objectKinds": {
      const { objectKinds: _removed, ...rest } = filters;
      return activeValue ? { ...rest, objectKinds: activeValue } : rest;
    }
    case "authors": {
      const { authors: _removed, ...rest } = filters;
      return activeValue ? { ...rest, authors: activeValue } : rest;
    }
    case "refs": {
      const { refs: _removed, ...rest } = filters;
      return activeValue ? { ...rest, refs: activeValue } : rest;
    }
    case "changedPaths": {
      const { changedPaths: _removed, ...rest } = filters;
      return activeValue ? { ...rest, changedPaths: activeValue } : rest;
    }
  }
}

export function withSignatureSearchFilter(
  filters: GitSearchFilters,
  signature: GitSignatureState | "",
): GitSearchFilters {
  const { signatureStates: _removed, ...rest } = filters;
  return signature ? { ...rest, signatureStates: [signature] } : rest;
}

export function withMergeSearchFilter(
  filters: GitSearchFilters,
  merge: "" | "merge" | "non-merge",
): GitSearchFilters {
  const { merge: _removed, ...rest } = filters;
  if (merge === "merge") return { ...rest, merge: true };
  if (merge === "non-merge") return { ...rest, merge: false };
  return rest;
}

function parseUtcDateBoundary(value: string, endOfDay: boolean): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return timestamp;
}

export function dateSearchFilterValue(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function withDateSearchFilter(
  filters: GitSearchFilters,
  boundary: "fromMs" | "toMs",
  value: string,
): GitSearchFilters {
  const parsed = parseUtcDateBoundary(value, boundary === "toMs");
  const fromMs = boundary === "fromMs" ? parsed : filters.dateRange?.fromMs;
  const toMs = boundary === "toMs" ? parsed : filters.dateRange?.toMs;
  const { dateRange: _removed, ...rest } = filters;
  if (fromMs === undefined && toMs === undefined) return rest;
  return {
    ...rest,
    dateRange: {
      ...(fromMs === undefined ? {} : { fromMs }),
      ...(toMs === undefined ? {} : { toMs }),
    },
  };
}

export function activeGitSearchFilterCount(filters: GitSearchFilters): number {
  const hasTerms = (values: readonly string[] | undefined) =>
    (values ?? []).some((value) => value.trim().length > 0);
  return (
    Number(hasTerms(filters.objectKinds)) +
    Number(hasTerms(filters.authors)) +
    Number(filters.dateRange?.fromMs !== undefined || filters.dateRange?.toMs !== undefined) +
    Number(hasTerms(filters.refs)) +
    Number((filters.signatureStates?.length ?? 0) > 0) +
    Number(hasTerms(filters.changedPaths)) +
    Number(filters.merge !== undefined)
  );
}

export function rewindNavigationToRoot(
  stack: WorldNavigationStack | undefined,
): WorldNavigationSnapshot | undefined {
  if (!stack) return undefined;
  let changed = false;
  while (stack.back()) changed = true;
  return changed ? stack.snapshot() : undefined;
}

export function persistCurrentNavigationCamera(
  stack: WorldNavigationStack | undefined,
  camera: CameraState | undefined,
  selectionId?: string,
): WorldNavigationSnapshot | undefined {
  if (!stack || !camera) return undefined;
  stack.replace({
    ...stack.current,
    ...(selectionId === undefined ? {} : { selectionId }),
    camera,
  });
  return stack.snapshot();
}

function rootCameraForRepositoryRefresh(
  stack: WorldNavigationStack | undefined,
  repositoryKey: string,
  liveCamera: CameraState | undefined,
): CameraState | undefined {
  if (!stack) return undefined;
  const snapshot = stack.snapshot();
  const root = snapshot.history[0] ?? snapshot.current;
  if (!root.datasetIdentity.startsWith(`${repositoryKey}:`)) return undefined;
  return snapshot.history.length === 0 ? (liveCamera ?? root.camera) : root.camera;
}

function frameHasNode(frame: WorldNavigationFrame, elementId: string | undefined): boolean {
  return elementId !== undefined && frame.dataset.nodes.some((node) => node.id === elementId);
}

function restoreResolvedFrameState(
  stack: WorldNavigationStack,
  previous: WorldNavigationFrame,
): string | undefined {
  const resolved = stack.current;
  const preferredSelectionId = previous.selectionId ?? previous.camera.attachedNodeId;
  const selectionStillExists = frameHasNode(resolved, preferredSelectionId);
  const previousAttachedNodeId = previous.camera.attachedNodeId;
  const attachedNodeId = frameHasNode(resolved, previousAttachedNodeId)
    ? previousAttachedNodeId
    : frameHasNode(resolved, resolved.camera.attachedNodeId)
      ? resolved.camera.attachedNodeId
      : undefined;
  stack.replace({
    ...resolved,
    ...(selectionStillExists && preferredSelectionId !== undefined
      ? { selectionId: preferredSelectionId }
      : {}),
    camera: {
      mode: previous.camera.mode,
      position: [...previous.camera.position],
      target: [...previous.camera.target],
      ...(attachedNodeId === undefined ? {} : { attachedNodeId }),
      zoom: previous.camera.zoom,
    },
  });
  return preferredSelectionId !== undefined && !selectionStillExists
    ? preferredSelectionId
    : undefined;
}

export async function reconcileNavigationAfterRepositoryRefresh(
  previous: WorldNavigationSnapshot | undefined,
  nextRoot: WorldNavigationFrame,
  resolver: ChildWorldResolver,
  rootSelectionId: string | undefined,
): Promise<{
  readonly stack: WorldNavigationStack;
  readonly snapshot: WorldNavigationSnapshot;
  readonly navigationElementId: string | undefined;
  readonly message: string | undefined;
}> {
  const stack = new WorldNavigationStack(nextRoot, resolver);
  const rootSnapshot = () => stack.snapshot();
  if (!previous || previous.history.length === 0) {
    return {
      stack,
      snapshot: rootSnapshot(),
      navigationElementId: undefined,
      message: undefined,
    };
  }

  const previousRoot = previous.history[0];
  const previousRootSelectionId = previousRoot?.selectionId;
  const targetId = previousRootSelectionId ?? rootSelectionId;
  if (targetId === undefined || rootSelectionId !== targetId || !frameHasNode(nextRoot, targetId)) {
    return {
      stack,
      snapshot: rootSnapshot(),
      navigationElementId: undefined,
      message:
        targetId === undefined
          ? "Derived navigation was reset because its repository selection is unavailable after repository refresh."
          : `Navigation target ${targetId} is no longer present after repository refresh.`,
    };
  }

  if (!(await stack.enter(targetId))) {
    return {
      stack,
      snapshot: rootSnapshot(),
      navigationElementId: undefined,
      message: `Navigation target ${targetId} could not be re-resolved after repository refresh.`,
    };
  }

  const previousCommitFrame =
    previous.history.length === 1 ? previous.current : previous.history[1];
  if (!previousCommitFrame) {
    return {
      stack,
      snapshot: stack.snapshot(),
      navigationElementId: stack.current.selectionId,
      message: "Commit navigation history could not be restored after repository refresh.",
    };
  }
  const missingCommitSelection = restoreResolvedFrameState(stack, previousCommitFrame);
  if (missingCommitSelection !== undefined) {
    return {
      stack,
      snapshot: stack.snapshot(),
      navigationElementId: stack.current.selectionId,
      message: `Navigation-local selection ${missingCommitSelection} is no longer present after repository refresh.`,
    };
  }
  if (previous.history.length === 1) {
    return {
      stack,
      snapshot: stack.snapshot(),
      navigationElementId: stack.current.selectionId,
      message: undefined,
    };
  }

  const fileTargetId = previousCommitFrame.selectionId;
  if (!frameHasNode(stack.current, fileTargetId)) {
    return {
      stack,
      snapshot: stack.snapshot(),
      navigationElementId: stack.current.selectionId,
      message:
        fileTargetId === undefined
          ? "Changed-file navigation target is unavailable after repository refresh."
          : `Changed-file navigation target ${fileTargetId} is no longer present after repository refresh.`,
    };
  }
  if (!(await stack.enter(fileTargetId as string))) {
    return {
      stack,
      snapshot: stack.snapshot(),
      navigationElementId: stack.current.selectionId,
      message: `Changed-file navigation target ${fileTargetId} could not be re-resolved after repository refresh.`,
    };
  }

  const missingFileSelection = restoreResolvedFrameState(stack, previous.current);
  return {
    stack,
    snapshot: stack.snapshot(),
    navigationElementId: stack.current.selectionId,
    message:
      missingFileSelection === undefined
        ? undefined
        : `Navigation-local selection ${missingFileSelection} is no longer present after repository refresh.`,
  };
}

export function childNavigationUrlStateForNavigation(
  navigation: WorldNavigationSnapshot | undefined,
  navigationElementId: string | undefined,
): ChildNavigationUrlState | undefined {
  const depth = navigation?.history.length ?? 0;
  if (!navigation || depth === 0 || depth > 2) return undefined;
  const preferredSelectionId = navigationElementId ?? navigation.current.selectionId;
  const localSelectionId = frameHasNode(navigation.current, preferredSelectionId)
    ? preferredSelectionId
    : undefined;
  if (depth === 1) {
    return {
      depth: 1,
      ...(localSelectionId === undefined ? {} : { localSelectionId }),
    };
  }

  const fileElementId = navigation.history[1]?.selectionId;
  if (fileElementId === undefined) return undefined;
  return {
    depth: 2,
    fileElementId,
    ...(localSelectionId === undefined ? {} : { localSelectionId }),
  };
}

export function hrefForNavigationSnapshot(
  href: string,
  rootSelectionId: string | undefined,
  navigation: WorldNavigationSnapshot | undefined,
  navigationElementId: string | undefined,
): string {
  return hrefWithChildNavigation(
    hrefWithSelection(href, rootSelectionId),
    childNavigationUrlStateForNavigation(navigation, navigationElementId),
  );
}

export function shouldUseChildBrowserHistoryBack(
  historyState: unknown,
  navigationDepth: number,
): boolean {
  return navigationDepth > 0 && childNavigationHistoryDepth(historyState) === navigationDepth;
}

function failClosedUrlNavigation(
  stack: WorldNavigationStack,
  message: string,
): {
  readonly snapshot: WorldNavigationSnapshot;
  readonly navigationElementId: undefined;
  readonly message: string;
} {
  rewindNavigationToRoot(stack);
  return {
    snapshot: stack.snapshot(),
    navigationElementId: undefined,
    message,
  };
}

export async function restoreNavigationFromUrlState(
  stack: WorldNavigationStack,
  request: ChildNavigationUrlState,
  rootSelectionId: string | undefined,
): Promise<{
  readonly snapshot: WorldNavigationSnapshot;
  readonly navigationElementId: string | undefined;
  readonly message: string | undefined;
}> {
  rewindNavigationToRoot(stack);
  if (rootSelectionId === undefined) {
    return failClosedUrlNavigation(
      stack,
      "Child-navigation URL requires an explicit repository selection.",
    );
  }
  const rootTarget = stack.current.dataset.nodes.find((node) => node.id === rootSelectionId);
  if (rootTarget?.kind !== "commit") {
    return failClosedUrlNavigation(
      stack,
      `Child-navigation URL root ${rootSelectionId} is not a commit in the current repository.`,
    );
  }
  stack.replace({ ...stack.current, selectionId: rootSelectionId });
  if (!(await stack.enter(rootSelectionId))) {
    return failClosedUrlNavigation(
      stack,
      `Child-navigation URL commit ${rootSelectionId} could not be resolved.`,
    );
  }

  if (request.depth === 2) {
    const fileTarget = stack.current.dataset.nodes.find(
      (node) => node.id === request.fileElementId,
    );
    if (!fileTarget?.kind.startsWith("changed-file-")) {
      return failClosedUrlNavigation(
        stack,
        `Child-navigation URL file target ${request.fileElementId} is not present in the resolved commit.`,
      );
    }
    stack.replace({ ...stack.current, selectionId: request.fileElementId });
    if (!(await stack.enter(request.fileElementId))) {
      return failClosedUrlNavigation(
        stack,
        `Child-navigation URL file target ${request.fileElementId} could not be resolved.`,
      );
    }
  }

  const preferredSelectionId = request.localSelectionId ?? stack.current.selectionId;
  if (preferredSelectionId === undefined || !frameHasNode(stack.current, preferredSelectionId)) {
    return failClosedUrlNavigation(
      stack,
      `Child-navigation URL local selection ${preferredSelectionId ?? "(missing)"} is not present in the resolved child world.`,
    );
  }
  stack.replace({ ...stack.current, selectionId: preferredSelectionId });
  return {
    snapshot: stack.snapshot(),
    navigationElementId: preferredSelectionId,
    message: undefined,
  };
}

function shortLabel(node: GraphNodeRecord): string {
  if (node.kind === "commit") {
    const oid = node.properties.oid;
    return typeof oid === "string" ? oid.slice(0, 9) : node.id.slice(0, 9);
  }
  return node.label ?? node.id;
}

function formatProperty(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined) return "—";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

export function App({ repositoryService, autoOpenDemo = true }: AppProps) {
  const fallbackService = useMemo(() => createDemoRepositoryService(), []);
  const service = repositoryService ?? fallbackService;
  const [state, dispatch] = useReducer(studioReducer, initialStudioState);
  const [commitDiffState, setCommitDiffState] = useState<CommitDiffState>({ status: "idle" });
  const [fileDetailState, setFileDetailState] = useState<FileDetailState>({ status: "idle" });
  const [indexedSearchResults, setIndexedSearchResults] = useState<ViewportSearchResults>({
    query: "",
    filterKey: "",
    elementIds: [],
  });
  const activeSearchFilterCount = activeGitSearchFilterCount(state.searchFilters);
  const sessionRef = useRef<RepositorySession | undefined>(state.session);
  sessionRef.current = state.session;
  const repositorySessionKey = state.session?.key;
  const selectedElementIdRef = useRef<string | undefined>(state.selectedElementId);
  selectedElementIdRef.current = state.selectedElementId;
  const commitDiffCache = useMemo(() => new GitCommitDiffCache(service), [service]);
  const drilldownResolver = useMemo(
    () =>
      new GitCommitDrilldownResolver(
        service,
        () => {
          const session = sessionRef.current;
          if (!session) throw new Error("Repository session is unavailable for commit drill-down.");
          return session;
        },
        commitDiffCache,
      ),
    [commitDiffCache, service],
  );
  const navigationRef = useRef<WorldNavigationStack | undefined>(undefined);
  const viewportCameraRef = useRef<CameraState | undefined>(undefined);
  const [navigation, setNavigation] = useState<WorldNavigationSnapshot | undefined>();
  const [navigationElementId, setNavigationElementId] = useState<string | undefined>();
  const navigationElementIdRef = useRef<string | undefined>(navigationElementId);
  navigationElementIdRef.current = navigationElementId;
  const pendingChildNavigationRef = useRef<PendingChildNavigationRestore | undefined>(undefined);
  const [urlRestoreGeneration, setUrlRestoreGeneration] = useState(0);
  const [navigationError, setNavigationError] = useState<string | undefined>();
  const [contextElementId, setContextElementId] = useState<string | undefined>();
  const [viewportSelection, setViewportSelection] = useState<SelectionState | undefined>();
  const [mutationDraftCount, setMutationDraftCount] = useState(0);
  const captureViewportCamera = useCallback((camera: CameraState) => {
    viewportCameraRef.current = camera;
  }, []);
  const captureIndexedSearchResults = useCallback((results: ViewportSearchResults) => {
    setIndexedSearchResults((current) => {
      const unchanged =
        current.query === results.query &&
        current.filterKey === results.filterKey &&
        current.elementIds.length === results.elementIds.length &&
        current.elementIds.every((elementId, index) => elementId === results.elementIds[index]) &&
        current.filterMatchCount === results.filterMatchCount &&
        (current.filterPreviewElementIds?.length ?? 0) ===
          (results.filterPreviewElementIds?.length ?? 0) &&
        (current.filterPreviewElementIds ?? []).every(
          (elementId, index) => elementId === results.filterPreviewElementIds?.[index],
        );
      return unchanged ? current : results;
    });
  }, []);

  const returnToRepositoryWorld = useCallback(() => {
    const rewound = rewindNavigationToRoot(navigationRef.current);
    if (rewound) {
      viewportCameraRef.current = rewound.current.camera;
      setNavigation(rewound);
    }
    setNavigationElementId(undefined);
    setNavigationError(undefined);
  }, []);

  const pushChildNavigationHistoryEntry = useCallback(
    (snapshot: WorldNavigationSnapshot, localSelectionId: string | undefined) => {
      if (typeof window === "undefined") return;
      const childState = childNavigationUrlStateForNavigation(snapshot, localSelectionId);
      if (!childState) return;
      const nextHref = hrefForNavigationSnapshot(
        window.location.href,
        state.selectedElementId,
        snapshot,
        localSelectionId,
      );
      if (nextHref !== window.location.href) {
        window.history.pushState(childNavigationHistoryState(childState.depth), "", nextHref);
      }
    },
    [state.selectedElementId],
  );

  const selectLogicalElement = useCallback(
    (elementId: string | undefined) => {
      pendingChildNavigationRef.current = undefined;
      setContextElementId(undefined);
      setViewportSelection(undefined);
      returnToRepositoryWorld();
      if (typeof window !== "undefined") {
        const selectedHref = hrefWithSelection(window.location.href, elementId);
        const nextHref = hrefWithChildNavigation(selectedHref, undefined);
        if (nextHref !== window.location.href) {
          window.history.pushState(null, "", nextHref);
        }
      }
      dispatch({
        type: "elementSelected",
        ...(elementId === undefined ? {} : { elementId }),
      });
    },
    [returnToRepositoryWorld],
  );

  const openRepository = useCallback(
    async (path: string) => {
      dispatch({ type: "repositoryLoading", path });
      try {
        const session = await service.openRepository(path);
        const dataset = repositorySnapshotToGraphDataset(session.snapshot);
        const preferredSelectionId =
          typeof window === "undefined" ? undefined : selectionFromHref(window.location.href);
        const childNavigation =
          typeof window === "undefined" ? undefined : childNavigationFromHref(window.location.href);
        if (childNavigation && childNavigation.status !== "none") {
          pendingChildNavigationRef.current = {
            rootSelectionId: preferredSelectionId,
            parsed: childNavigation,
          };
          setUrlRestoreGeneration((generation) => generation + 1);
        }
        dispatch({
          type: "repositoryLoaded",
          session,
          dataset,
          ...(preferredSelectionId === undefined ? {} : { preferredSelectionId }),
        });
        if (
          childNavigation !== undefined &&
          childNavigation.status !== "none" &&
          preferredSelectionId === undefined
        ) {
          dispatch({
            type: "selectionRejected",
            elementId: "child-navigation",
            message: "Child-navigation URL requires an explicit repository selection",
          });
        }
      } catch (error) {
        dispatch({
          type: "repositoryFailed",
          message: error instanceof Error ? error.message : "Repository open failed.",
        });
      }
    },
    [service],
  );

  useEffect(() => {
    if (autoOpenDemo && service.mode === "demo") {
      void openRepository(initialStudioState.repositoryPath);
    }
  }, [autoOpenDemo, openRepository, service.mode]);

  useEffect(() => {
    const session = state.session;
    const dataset = state.dataset;
    if (!session || !dataset) {
      drilldownResolver.clear();
      navigationRef.current = undefined;
      viewportCameraRef.current = undefined;
      setNavigation(undefined);
      setNavigationElementId(undefined);
      setNavigationError(undefined);
      setViewportSelection(undefined);
      return;
    }

    const previousStack = navigationRef.current;
    if (previousStack && previousStack.depth > 0) {
      persistCurrentNavigationCamera(
        previousStack,
        viewportCameraRef.current ?? previousStack.current.camera,
        navigationElementIdRef.current ?? previousStack.current.selectionId,
      );
    }
    const previous = previousStack?.snapshot();
    const previousRoot = previous?.history[0] ?? previous?.current;
    const sameRepository = previousRoot?.datasetIdentity.startsWith(`${session.key}:`) === true;
    const preservedRootCamera = rootCameraForRepositoryRefresh(
      previousStack,
      session.key,
      viewportCameraRef.current,
    );
    const rootFrame = repositoryWorldFrame(session, dataset, preservedRootCamera);
    drilldownResolver.clear();

    if (!sameRepository || !previous || previous.history.length === 0) {
      const stack = new WorldNavigationStack(rootFrame, drilldownResolver.resolve);
      navigationRef.current = stack;
      const snapshot = stack.snapshot();
      viewportCameraRef.current = snapshot.current.camera;
      setNavigation(snapshot);
      setNavigationElementId(undefined);
      setNavigationError(undefined);
      setViewportSelection(undefined);
      return;
    }

    let active = true;
    void reconcileNavigationAfterRepositoryRefresh(
      previous,
      rootFrame,
      drilldownResolver.resolve,
      selectedElementIdRef.current,
    )
      .then((restored) => {
        if (!active) return;
        navigationRef.current = restored.stack;
        viewportCameraRef.current = restored.snapshot.current.camera;
        setNavigation(restored.snapshot);
        setNavigationElementId(restored.navigationElementId);
        setNavigationError(restored.message);
        setViewportSelection(undefined);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const stack = new WorldNavigationStack(rootFrame, drilldownResolver.resolve);
        const snapshot = stack.snapshot();
        navigationRef.current = stack;
        viewportCameraRef.current = snapshot.current.camera;
        setNavigation(snapshot);
        setNavigationElementId(undefined);
        setNavigationError(
          `Navigation refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        setViewportSelection(undefined);
      });
    return () => {
      active = false;
    };
  }, [drilldownResolver, state.dataset, state.session]);

  useEffect(() => {
    if (typeof window === "undefined" || pendingChildNavigationRef.current) return;
    const nextHref = hrefForNavigationSnapshot(
      window.location.href,
      state.selectedElementId,
      navigation,
      navigationElementId,
    );
    if (nextHref !== window.location.href) {
      window.history.replaceState(window.history.state, "", nextHref);
    }
  }, [navigation, navigationElementId, state.selectedElementId]);

  useEffect(() => {
    if (typeof window === "undefined" || !state.dataset) return;
    const dataset = state.dataset;
    const handlePopState = () => {
      setViewportSelection(undefined);
      const requested = selectionFromHref(window.location.href);
      const parsedChildNavigation = childNavigationFromHref(window.location.href);
      pendingChildNavigationRef.current =
        parsedChildNavigation.status === "none"
          ? undefined
          : { rootSelectionId: requested, parsed: parsedChildNavigation };
      if (parsedChildNavigation.status !== "none") {
        setUrlRestoreGeneration((generation) => generation + 1);
      }
      if (requested === undefined) {
        returnToRepositoryWorld();
        dispatch({ type: "elementSelected" });
        return;
      }
      if (dataset.nodes.some((node) => node.id === requested)) {
        returnToRepositoryWorld();
        dispatch({ type: "elementSelected", elementId: requested });
        return;
      }
      returnToRepositoryWorld();
      dispatch({
        type: "selectionRejected",
        elementId: requested,
        message: "URL selection is not present in the current repository",
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [returnToRepositoryWorld, state.dataset]);

  useEffect(() => {
    const pending = pendingChildNavigationRef.current;
    const stack = navigationRef.current;
    if (
      urlRestoreGeneration === 0 ||
      !pending ||
      !stack ||
      !state.dataset ||
      !state.session ||
      stack.depth !== 0
    )
      return;

    if (pending.parsed.status === "none") {
      pendingChildNavigationRef.current = undefined;
      setNavigationError(undefined);
      return;
    }
    if (pending.parsed.status === "invalid") {
      pendingChildNavigationRef.current = undefined;
      setNavigationError(`Invalid child-navigation URL: ${pending.parsed.message}`);
      return;
    }
    if (
      pending.rootSelectionId === undefined ||
      pending.rootSelectionId !== state.selectedElementId
    ) {
      pendingChildNavigationRef.current = undefined;
      setNavigationError(
        "Invalid child-navigation URL: deep navigation requires the URL root selection to resolve exactly.",
      );
      return;
    }

    let active = true;
    const restoreStack = new WorldNavigationStack(stack.current, drilldownResolver.resolve);
    setNavigationError(undefined);
    void restoreNavigationFromUrlState(restoreStack, pending.parsed.state, pending.rootSelectionId)
      .then((restored) => {
        if (!active || navigationRef.current !== stack) return;
        if (pendingChildNavigationRef.current === pending) {
          pendingChildNavigationRef.current = undefined;
        }
        navigationRef.current = restoreStack;
        viewportCameraRef.current = restored.snapshot.current.camera;
        setNavigation(restored.snapshot);
        setNavigationElementId(restored.navigationElementId);
        setNavigationError(restored.message);
        setViewportSelection(undefined);
      })
      .catch((error: unknown) => {
        if (!active || navigationRef.current !== stack) return;
        if (pendingChildNavigationRef.current === pending) {
          pendingChildNavigationRef.current = undefined;
        }
        const snapshot = stack.snapshot();
        viewportCameraRef.current = snapshot.current.camera;
        setNavigation(snapshot);
        setNavigationElementId(undefined);
        setNavigationError(
          `Child-navigation URL resolution failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        setViewportSelection(undefined);
      });
    return () => {
      active = false;
    };
  }, [
    drilldownResolver.resolve,
    state.dataset,
    state.selectedElementId,
    state.session,
    urlRestoreGeneration,
  ]);

  const selectedNode = state.dataset?.nodes.find((node) => node.id === state.selectedElementId);
  const selectedCommitOid =
    selectedNode?.kind === "commit" && typeof selectedNode.properties.oid === "string"
      ? selectedNode.properties.oid
      : undefined;
  const navigationDepth = navigation?.history.length ?? 0;
  const activeDataset = navigation?.current.dataset ?? state.dataset;
  const defaultChildSelectionId =
    navigationDepth > 0
      ? (navigation?.current.selectionId ??
        (navigationDepth === 1 && selectedCommitOid
          ? `commit-core:${selectedCommitOid}`
          : undefined))
      : undefined;
  const viewportSelectedElementId =
    navigationDepth > 0
      ? (navigationElementId ?? defaultChildSelectionId)
      : state.selectedElementId;
  const activeInspectionNode = inspectionNodeForNavigation(
    selectedNode,
    activeDataset,
    navigationDepth,
    viewportSelectedElementId,
  );
  const interactionInspection = viewportInteractionSelectionForDataset(
    viewportSelection,
    activeDataset,
  );
  const interactionHeading =
    interactionInspection?.changedFilePath ??
    (interactionInspection?.edge
      ? `${interactionInspection.edge.source} → ${interactionInspection.edge.target}`
      : undefined);
  const interactionKind = interactionInspection?.changedFilePath
    ? "changed-file"
    : interactionInspection?.edge?.kind;
  const selectedChangedFilePath = changedFilePathForInspection(
    activeInspectionNode,
    navigationDepth,
  );
  const selectedPatchHunkIndex = selectedPatchHunkIndexForInspection(
    activeInspectionNode,
    navigationDepth,
  );
  const selectedPatchHunk =
    fileDetailState.status === "ready" &&
    fileDetailState.oid === selectedCommitOid &&
    fileDetailState.path === selectedChangedFilePath &&
    selectedPatchHunkIndex !== undefined
      ? fileDetailState.detail.hunks[selectedPatchHunkIndex]
      : undefined;
  const contextNode =
    contextElementId === undefined
      ? undefined
      : state.dataset?.nodes.find((node) => node.id === contextElementId);

  const openLogicalContext = useCallback(
    (elementId: string, selection: SelectionState) => {
      const logicalElementId = logicalSelectionFromViewport(elementId, navigationDepth);
      if (logicalElementId === undefined) return;
      if (!state.dataset?.nodes.some((node) => node.id === logicalElementId)) {
        setContextElementId(undefined);
        setViewportSelection(selection);
        return;
      }
      selectLogicalElement(logicalElementId);
      setViewportSelection(selection);
      setContextElementId(logicalElementId);
    },
    [navigationDepth, selectLogicalElement, state.dataset],
  );

  useEffect(() => {
    if (contextElementId === undefined) return;
    if (
      navigationDepth > 0 ||
      contextElementId !== state.selectedElementId ||
      !state.dataset?.nodes.some((node) => node.id === contextElementId)
    ) {
      setContextElementId(undefined);
    }
  }, [contextElementId, navigationDepth, state.dataset, state.selectedElementId]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || session.key !== repositorySessionKey) return;
    let active = true;
    let stopWatch: (() => Promise<void>) | undefined;
    const refreshCoordinator = new RepositoryLiveRefreshCoordinator(service, session, {
      onRefreshed: (refreshed) => {
        dispatch({
          type: "repositoryLoaded",
          session: refreshed,
          dataset: repositorySnapshotToGraphDataset(refreshed.snapshot),
        });
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!/stale repository (?:revision|refresh)/i.test(message)) {
          dispatch({ type: "repositoryFailed", message });
        }
      },
    });

    void service
      .watchRepository(session, (change) => {
        if (active) refreshCoordinator.request(change);
      })
      .then((stop) => {
        if (active) stopWatch = stop;
        else void stop();
      })
      .catch((error: unknown) => {
        if (active) console.warn("Repository live refresh is unavailable", error);
      });

    return () => {
      active = false;
      refreshCoordinator.dispose();
      if (stopWatch) void stopWatch();
    };
  }, [repositorySessionKey, service]);

  useEffect(() => {
    const session = state.session;
    if (!session || !selectedCommitOid) {
      setCommitDiffState({ status: "idle" });
      return;
    }
    let active = true;
    setCommitDiffState({ status: "loading", oid: selectedCommitOid });
    void commitDiffCache
      .get(session, selectedCommitOid)
      .then((diff) => {
        if (active) setCommitDiffState({ status: "ready", oid: selectedCommitOid, diff });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCommitDiffState({
          status: "error",
          oid: selectedCommitOid,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      active = false;
    };
  }, [commitDiffCache, selectedCommitOid, state.session]);

  useEffect(() => {
    const session = state.session;
    if (!session || !selectedCommitOid || !selectedChangedFilePath) {
      setFileDetailState({ status: "idle" });
      return;
    }
    let active = true;
    setFileDetailState({
      status: "loading",
      oid: selectedCommitOid,
      path: selectedChangedFilePath,
    });
    void commitDiffCache
      .getFileDetail(session, selectedCommitOid, selectedChangedFilePath)
      .then((detail) => {
        if (active) {
          setFileDetailState({
            status: "ready",
            oid: selectedCommitOid,
            path: selectedChangedFilePath,
            detail,
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFileDetailState({
          status: "error",
          oid: selectedCommitOid,
          path: selectedChangedFilePath,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      active = false;
    };
  }, [commitDiffCache, selectedChangedFilePath, selectedCommitOid, state.session]);

  const enterSelectedCommit = useCallback(async () => {
    const stack = navigationRef.current;
    const elementId = state.selectedElementId;
    if (!stack || !elementId || !selectedCommitOid || navigationDepth > 0) return;
    setContextElementId(undefined);
    persistCurrentNavigationCamera(
      stack,
      viewportCameraRef.current ?? stack.current.camera,
      elementId,
    );
    setNavigationError(undefined);
    try {
      const entered = await stack.enter(elementId);
      if (!entered) {
        if (navigationRef.current === stack) {
          setNavigationError(
            "Commit world was not opened because the repository revision or navigation target changed.",
          );
        }
        return;
      }
      if (navigationRef.current !== stack) return;
      const snapshot = stack.snapshot();
      viewportCameraRef.current = snapshot.current.camera;
      setNavigation(snapshot);
      const preferredSelectionId =
        snapshot.current.selectionId ?? snapshot.current.camera.attachedNodeId;
      const nextNavigationElementId =
        preferredSelectionId &&
        snapshot.current.dataset.nodes.some((node) => node.id === preferredSelectionId)
          ? preferredSelectionId
          : `commit-core:${selectedCommitOid}`;
      setNavigationElementId(nextNavigationElementId);
      pushChildNavigationHistoryEntry(snapshot, nextNavigationElementId);
    } catch (error) {
      if (navigationRef.current === stack) {
        setNavigationError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [
    navigationDepth,
    pushChildNavigationHistoryEntry,
    selectedCommitOid,
    state.selectedElementId,
  ]);

  const enterSelectedChangedFile = useCallback(async () => {
    const stack = navigationRef.current;
    const elementId = viewportSelectedElementId;
    if (
      !stack ||
      navigationDepth !== 1 ||
      !elementId ||
      !selectedChangedFilePath ||
      !activeInspectionNode?.kind.startsWith("changed-file-")
    )
      return;
    persistCurrentNavigationCamera(
      stack,
      viewportCameraRef.current ?? stack.current.camera,
      elementId,
    );
    setNavigationError(undefined);
    try {
      const entered = await stack.enter(elementId);
      if (!entered) {
        if (navigationRef.current === stack) {
          setNavigationError(
            "Bounded file world was not opened because the repository revision or file target changed.",
          );
        }
        return;
      }
      if (navigationRef.current !== stack) return;
      const snapshot = stack.snapshot();
      viewportCameraRef.current = snapshot.current.camera;
      setNavigation(snapshot);
      const preferredSelectionId =
        snapshot.current.selectionId ?? snapshot.current.camera.attachedNodeId;
      const nextNavigationElementId =
        preferredSelectionId &&
        snapshot.current.dataset.nodes.some((node) => node.id === preferredSelectionId)
          ? preferredSelectionId
          : undefined;
      setNavigationElementId(nextNavigationElementId);
      pushChildNavigationHistoryEntry(snapshot, nextNavigationElementId);
    } catch (error) {
      if (navigationRef.current === stack) {
        setNavigationError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [
    activeInspectionNode,
    navigationDepth,
    pushChildNavigationHistoryEntry,
    selectedChangedFilePath,
    viewportSelectedElementId,
  ]);

  const leaveCurrentWorld = useCallback(() => {
    const stack = navigationRef.current;
    if (
      stack &&
      typeof window !== "undefined" &&
      shouldUseChildBrowserHistoryBack(window.history.state, stack.depth)
    ) {
      window.history.back();
      return;
    }
    if (!stack?.back()) return;
    const snapshot = stack.snapshot();
    viewportCameraRef.current = snapshot.current.camera;
    setNavigation(snapshot);
    const restoredSelectionId =
      snapshot.current.selectionId ?? snapshot.current.camera.attachedNodeId;
    setNavigationElementId(
      snapshot.history.length > 0 &&
        restoredSelectionId &&
        snapshot.current.dataset.nodes.some((node) => node.id === restoredSelectionId)
        ? restoredSelectionId
        : undefined,
    );
    setNavigationError(undefined);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || (navigationDepth === 0 && contextElementId === undefined))
      return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (navigationDepth > 0) leaveCurrentWorld();
      else setContextElementId(undefined);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextElementId, leaveCurrentWorld, navigationDepth]);

  const visibleNodes = useMemo(
    () =>
      visibleLogicalNodesForSearch(
        state.dataset,
        state.search,
        activeSearchFilterCount > 0 ? state.searchFilters : undefined,
        indexedSearchResults,
      ),
    [
      activeSearchFilterCount,
      indexedSearchResults,
      state.dataset,
      state.search,
      state.searchFilters,
    ],
  );

  const chooseRepository = async (mode: "folder" | "file") => {
    const path = await service.chooseRepositoryPath({
      mode,
      expectedKind: mode === "folder" ? "worktree" : "git-dir",
    });
    if (path) {
      dispatch({ type: "pathChanged", path });
      await openRepository(path);
    }
  };

  return (
    <main className="studio-shell" data-testid="studio-shell">
      <header className="topbar">
        {/* biome-ignore lint/a11y/useSemanticElements: styled layout div, semantic element would break layout */}
        <div className="brand" role="banner" aria-label="gitinspect">
          <span className="brand__mark">gi</span>
          <div>
            <strong>gitinspect</strong>
            <span>repository spatial studio</span>
          </div>
        </div>

        <form
          className="repository-open"
          onSubmit={(event) => {
            event.preventDefault();
            void openRepository(state.repositoryPath);
          }}
        >
          <label className="sr-only" htmlFor="repository-path">
            Repository path
          </label>
          <span className="repository-open__prefix">repo</span>
          <input
            id="repository-path"
            value={state.repositoryPath}
            onChange={(event) => dispatch({ type: "pathChanged", path: event.currentTarget.value })}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void chooseRepository("folder")}
          >
            Folder…
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void chooseRepository("file")}
          >
            File…
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={state.status === "loading"}
          >
            {state.status === "loading" ? "Opening…" : "Open"}
          </button>
        </form>

        <div className="runtime-badge" data-mode={service.mode}>
          <span className="runtime-badge__dot" />
          {service.mode === "demo" ? "synthetic adapter" : "native adapter"}
        </div>
      </header>

      <div className="modebar">
        {/* biome-ignore lint/a11y/useSemanticElements: styled layout div, fieldset would break styling */}
        <div className="segmented" role="group" aria-label="Pointer mode">
          {(["camera", "cursor"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.pointerMode === mode}
              onClick={() => dispatch({ type: "pointerModeChanged", mode })}
            >
              {mode === "camera" ? "Camera" : "Cursor"}
            </button>
          ))}
        </div>
        <div className="modebar__divider" />
        {/* biome-ignore lint/a11y/useSemanticElements: styled layout div, fieldset would break styling */}
        <div className="segmented" role="group" aria-label="Camera controller mode">
          {(["attached", "free-flight"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.cameraMode === mode}
              onClick={() => dispatch({ type: "cameraModeChanged", mode })}
            >
              {mode === "attached" ? "Attached" : "Free flight"}
            </button>
          ))}
        </div>
        <span className="modebar__hint">
          {state.pointerMode === "cursor"
            ? "semantic picking active"
            : "viewport navigation active"}
        </span>
        <button
          type="button"
          className="tray-toggle"
          aria-expanded={state.transactionTrayOpen}
          onClick={() => dispatch({ type: "transactionTrayToggled" })}
        >
          Transaction tray <span>{mutationDraftCount}</span>
        </button>
      </div>

      <div className="workspace">
        <aside className="sidebar sidebar--left">
          <div className="panel-heading">
            <span className="eyebrow">Repository</span>
            <strong>
              {state.session
                ? state.session.snapshot.repositoryPath.split("/").filter(Boolean).at(-1)
                : "not loaded"}
            </strong>
            <span className="panel-heading__meta">
              {state.session ? state.session.snapshot.revision : "no revision"}
            </span>
          </div>

          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={state.search}
              onChange={(event) =>
                dispatch({ type: "searchChanged", search: event.currentTarget.value })
              }
              placeholder="Search graph…"
            />
            {state.search && (
              <button
                type="button"
                onClick={() => dispatch({ type: "searchChanged", search: "" })}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </label>

          <details
            className="search-filters"
            data-active={activeSearchFilterCount > 0 || undefined}
          >
            <summary>
              <span>Filters</span>
              <span>
                {activeSearchFilterCount > 0 ? `${activeSearchFilterCount} active` : "optional"}
              </span>
            </summary>
            <div className="search-filters__grid">
              <label>
                <span>Kind</span>
                <input
                  value={searchFilterText(state.searchFilters, "objectKinds")}
                  onChange={(event) =>
                    dispatch({
                      type: "searchFiltersChanged",
                      filters: withSearchFilterText(
                        state.searchFilters,
                        "objectKinds",
                        event.currentTarget.value,
                      ),
                    })
                  }
                  placeholder="commit"
                />
              </label>
              <label>
                <span>Author</span>
                <input
                  value={searchFilterText(state.searchFilters, "authors")}
                  onChange={(event) =>
                    dispatch({
                      type: "searchFiltersChanged",
                      filters: withSearchFilterText(
                        state.searchFilters,
                        "authors",
                        event.currentTarget.value,
                      ),
                    })
                  }
                  placeholder="name / email"
                />
              </label>
              <label>
                <span>Ref</span>
                <input
                  value={searchFilterText(state.searchFilters, "refs")}
                  onChange={(event) =>
                    dispatch({
                      type: "searchFiltersChanged",
                      filters: withSearchFilterText(
                        state.searchFilters,
                        "refs",
                        event.currentTarget.value,
                      ),
                    })
                  }
                  placeholder="main"
                />
              </label>
              <label>
                <span>Path</span>
                <input
                  value={searchFilterText(state.searchFilters, "changedPaths")}
                  onChange={(event) =>
                    dispatch({
                      type: "searchFiltersChanged",
                      filters: withSearchFilterText(
                        state.searchFilters,
                        "changedPaths",
                        event.currentTarget.value,
                      ),
                    })
                  }
                  placeholder="src/"
                />
              </label>
              <label>
                <span>Signature</span>
                <select
                  value={state.searchFilters.signatureStates?.[0] ?? ""}
                  onChange={(event) =>
                    dispatch({
                      type: "searchFiltersChanged",
                      filters: withSignatureSearchFilter(
                        state.searchFilters,
                        event.currentTarget.value as GitSignatureState | "",
                      ),
                    })
                  }
                >
                  <option value="">any</option>
                  <option value="valid">valid</option>
                  <option value="invalid">invalid</option>
                  <option value="unknown">unknown</option>
                  <option value="unsigned">unsigned</option>
                </select>
              </label>
              <label>
                <span>Merge</span>
                <select
                  value={
                    state.searchFilters.merge === undefined
                      ? ""
                      : state.searchFilters.merge
                        ? "merge"
                        : "non-merge"
                  }
                  onChange={(event) =>
                    dispatch({
                      type: "searchFiltersChanged",
                      filters: withMergeSearchFilter(
                        state.searchFilters,
                        event.currentTarget.value as "" | "merge" | "non-merge",
                      ),
                    })
                  }
                >
                  <option value="">any</option>
                  <option value="merge">merge only</option>
                  <option value="non-merge">non-merge</option>
                </select>
              </label>
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={dateSearchFilterValue(state.searchFilters.dateRange?.fromMs)}
                  onChange={(event) =>
                    dispatch({
                      type: "searchFiltersChanged",
                      filters: withDateSearchFilter(
                        state.searchFilters,
                        "fromMs",
                        event.currentTarget.value,
                      ),
                    })
                  }
                />
              </label>
              <label>
                <span>Through</span>
                <input
                  type="date"
                  value={dateSearchFilterValue(state.searchFilters.dateRange?.toMs)}
                  onChange={(event) =>
                    dispatch({
                      type: "searchFiltersChanged",
                      filters: withDateSearchFilter(
                        state.searchFilters,
                        "toMs",
                        event.currentTarget.value,
                      ),
                    })
                  }
                />
              </label>
            </div>
            {activeSearchFilterCount > 0 && (
              <button
                type="button"
                className="search-filters__clear"
                onClick={() => dispatch({ type: "searchFiltersChanged", filters: {} })}
              >
                Clear filters
              </button>
            )}
          </details>

          {/* biome-ignore lint/a11y/useSemanticElements: styled layout div, list element would break styling */}
          <div className="object-list" role="list" aria-label="Repository elements">
            {visibleNodes.map((node) => (
              <button
                type="button"
                key={node.id}
                className="object-list__row"
                aria-pressed={node.id === state.selectedElementId}
                onClick={() => selectLogicalElement(node.id)}
              >
                <span className="object-list__glyph">{node.kind.slice(0, 1).toUpperCase()}</span>
                <span className="object-list__copy">
                  <strong>{node.label ?? node.kind}</strong>
                  <small>{shortLabel(node)}</small>
                </span>
              </button>
            ))}
            {state.dataset && visibleNodes.length === 0 && (
              <p className="empty-copy">No graph elements match the active search or filters.</p>
            )}
          </div>

          <div className="sidebar__stats">
            <span>
              <strong>{state.session?.snapshot.commits.length ?? 0}</strong> commits
            </span>
            <span>
              <strong>{state.session?.snapshot.refs.length ?? 0}</strong> refs
            </span>
            <span>
              <strong>{state.session?.snapshot.remotes.length ?? 0}</strong> remotes
            </span>
          </div>
        </aside>

        <GraphViewport
          dataset={activeDataset}
          selectedElementId={viewportSelectedElementId}
          search={state.search}
          {...(navigationDepth === 0 && activeSearchFilterCount > 0
            ? { filters: state.searchFilters }
            : {})}
          cameraMode={state.cameraMode}
          pointerMode={state.pointerMode}
          {...(navigation === undefined ? {} : { cameraState: navigation.current.camera })}
          onCameraStateChange={captureViewportCamera}
          {...(navigationDepth === 0 ? { onSearchResultsChange: captureIndexedSearchResults } : {})}
          onSelect={(elementId, selection) => {
            const logicalElementId = logicalSelectionFromViewport(elementId, navigationDepth);
            if (logicalElementId !== undefined) {
              if (state.dataset?.nodes.some((node) => node.id === logicalElementId)) {
                selectLogicalElement(logicalElementId);
                setViewportSelection(selection);
              } else if (state.dataset?.edges.some((edge) => edge.id === logicalElementId)) {
                setContextElementId(undefined);
                setViewportSelection(selection);
              }
              return;
            }
            const localElementId = navigationLocalSelectionFromViewport(elementId, navigationDepth);
            if (
              localElementId !== undefined &&
              activeDataset?.nodes.some((node) => node.id === localElementId)
            ) {
              setNavigationElementId(localElementId);
              setViewportSelection(selection);
            } else if (
              localElementId !== undefined &&
              activeDataset?.edges.some((edge) => edge.id === localElementId)
            ) {
              setViewportSelection(selection);
            }
          }}
          onContextRequest={openLogicalContext}
        />

        <aside className="sidebar sidebar--right">
          <div className="panel-heading panel-heading--inspection">
            <span className="eyebrow">Inspector</span>
            <strong>
              {interactionHeading ?? activeInspectionNode?.label ?? "Select an element"}
            </strong>
            <span className="kind-chip">
              {interactionKind ?? activeInspectionNode?.kind ?? "—"}
            </span>
          </div>

          {state.selectionNotice && (
            <p className="empty-copy" role="alert" data-testid="selection-notice">
              {state.selectionNotice}
            </p>
          )}
          {navigationError && (
            <p className="empty-copy" role="alert" data-testid="navigation-error">
              {navigationError}
            </p>
          )}

          {activeInspectionNode ? (
            <div className="inspection">
              {interactionInspection && (
                <section data-testid="viewport-interaction-selection">
                  <h2>Interaction selection</h2>
                  <dl>
                    <div>
                      <dt>Scope</dt>
                      <dd>{interactionInspection.selection.granularity}</dd>
                    </div>
                    <div>
                      <dt>Semantic owner</dt>
                      <dd>{interactionInspection.selection.elementId}</dd>
                    </div>
                    <div>
                      <dt>Render identity</dt>
                      <dd>{interactionInspection.selection.interactionKey ?? "—"}</dd>
                    </div>
                    {interactionInspection.changedFilePath && (
                      <div>
                        <dt>Changed file</dt>
                        <dd>{interactionInspection.changedFilePath}</dd>
                      </div>
                    )}
                    {interactionInspection.edge && (
                      <div>
                        <dt>Relation</dt>
                        <dd>
                          {interactionInspection.edge.source} → {interactionInspection.edge.target}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Related semantics</dt>
                      <dd>
                        {interactionInspection.selection.relatedIds.length > 0
                          ? interactionInspection.selection.relatedIds.join(", ")
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </section>
              )}
              {contextNode && navigationDepth === 0 && (
                <div
                  role="menu"
                  aria-label="Selection context actions"
                  data-testid="selection-context-menu"
                >
                  <h2>Context actions</h2>
                  <p>
                    Read-only actions for {contextNode.label ?? contextNode.id}. Open with
                    right-click, Menu, or Shift+F10.
                  </p>
                  {contextNode.kind === "commit" && selectedCommitOid && (
                    <button
                      type="button"
                      role="menuitem"
                      className="button button--ghost"
                      onClick={() => void enterSelectedCommit()}
                    >
                      Enter commit world
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="button button--ghost"
                    onClick={() => setContextElementId(undefined)}
                  >
                    Close context (Esc)
                  </button>
                  <p>
                    Mutation/apply actions are intentionally unavailable from this context surface.
                  </p>
                </div>
              )}
              {navigationDepth > 0 && (
                <section data-testid="drilldown-navigation">
                  <h2>World navigation</h2>
                  <p>
                    Repository / {selectedCommitOid?.slice(0, 10) ?? "commit"}
                    {navigationDepth > 1 && selectedChangedFilePath
                      ? ` / ${selectedChangedFilePath}`
                      : ""}
                    {` · depth ${navigationDepth}`}
                  </p>
                  <p data-testid="drilldown-local-selection">
                    Local selection: {activeInspectionNode.label ?? activeInspectionNode.id}.
                    Repository selection remains {state.selectedElementId}.
                  </p>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={leaveCurrentWorld}
                  >
                    {navigationDepth > 1
                      ? "Back to commit world (Esc)"
                      : "Back to repository (Esc)"}
                  </button>
                </section>
              )}
              <section>
                <h2>Identity</h2>
                <dl>
                  <div>
                    <dt>Element</dt>
                    <dd>{activeInspectionNode.id}</dd>
                  </div>
                  <div>
                    <dt>Group</dt>
                    <dd>{activeInspectionNode.group ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Weight</dt>
                    <dd>{activeInspectionNode.weight ?? "—"}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h2>Properties</h2>
                <dl>
                  {Object.entries(activeInspectionNode.properties).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{formatProperty(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              {selectedCommitOid && selectedChangedFilePath && (
                <section data-testid="commit-file-detail-inspection">
                  <h2>Bounded file patch</h2>
                  {navigationDepth === 1 &&
                    activeInspectionNode.kind.startsWith("changed-file-") && (
                      <button
                        type="button"
                        className="button button--ghost"
                        data-testid="file-drilldown-enter"
                        onClick={() => void enterSelectedChangedFile()}
                      >
                        Enter bounded file world
                      </button>
                    )}
                  {fileDetailState.status === "loading" &&
                    fileDetailState.oid === selectedCommitOid &&
                    fileDetailState.path === selectedChangedFilePath && (
                      <p>Loading bounded patch content…</p>
                    )}
                  {fileDetailState.status === "error" &&
                    fileDetailState.oid === selectedCommitOid &&
                    fileDetailState.path === selectedChangedFilePath && (
                      <p role="alert">{fileDetailState.message}</p>
                    )}
                  {fileDetailState.status === "ready" &&
                    fileDetailState.oid === selectedCommitOid &&
                    fileDetailState.path === selectedChangedFilePath && (
                      <>
                        <dl>
                          <div>
                            <dt>Content</dt>
                            <dd>{fileDetailState.detail.contentStatus}</dd>
                          </div>
                          <div>
                            <dt>Old blob</dt>
                            <dd>{fileDetailState.detail.oldOid?.slice(0, 12) ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>New blob</dt>
                            <dd>{fileDetailState.detail.newOid?.slice(0, 12) ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>Old bytes</dt>
                            <dd>{fileDetailState.detail.oldBytes ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>New bytes</dt>
                            <dd>{fileDetailState.detail.newBytes ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>Truncated</dt>
                            <dd>{fileDetailState.detail.truncated ? "yes" : "no"}</dd>
                          </div>
                        </dl>
                        {fileDetailState.detail.contentStatus === "text" &&
                          navigationDepth === 1 && (
                            <pre data-testid="bounded-file-patch">
                              <code>
                                {fileDetailState.detail.hunks.flatMap((hunk) => [
                                  `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`,
                                  ...hunk.lines.map((line) => {
                                    const prefix =
                                      line.kind === "addition"
                                        ? "+"
                                        : line.kind === "deletion"
                                          ? "-"
                                          : " ";
                                    return `${prefix}${line.content}${line.content.endsWith("\n") ? "" : "\n"}`;
                                  }),
                                ])}
                              </code>
                            </pre>
                          )}
                        {fileDetailState.detail.contentStatus === "text" &&
                          navigationDepth > 1 &&
                          selectedPatchHunk && (
                            <pre data-testid="bounded-selected-hunk">
                              <code>
                                {[
                                  `@@ -${selectedPatchHunk.oldStart},${selectedPatchHunk.oldLines} +${selectedPatchHunk.newStart},${selectedPatchHunk.newLines} @@\n`,
                                  ...selectedPatchHunk.lines.map((line) => {
                                    const prefix =
                                      line.kind === "addition"
                                        ? "+"
                                        : line.kind === "deletion"
                                          ? "-"
                                          : " ";
                                    return `${prefix}${line.content}${line.content.endsWith("\n") ? "" : "\n"}`;
                                  }),
                                ]}
                              </code>
                            </pre>
                          )}
                        {fileDetailState.detail.contentStatus === "text" &&
                          navigationDepth > 1 &&
                          !selectedPatchHunk &&
                          activeInspectionNode.kind === "file-detail-core" && (
                            <p>
                              Select a hunk node to inspect its bounded patch lines; blob nodes
                              remain metadata-only.
                            </p>
                          )}
                        {fileDetailState.detail.contentStatus !== "text" && (
                          <p>
                            Patch text is not materialized for{" "}
                            {fileDetailState.detail.contentStatus} content.
                          </p>
                        )}
                      </>
                    )}
                </section>
              )}
              {selectedCommitOid && (
                <section data-testid="commit-diff-inspection">
                  <h2>Lazy commit diff</h2>
                  {navigationDepth === 0 && (
                    <button
                      type="button"
                      className="button button--ghost"
                      data-testid="commit-drilldown-enter"
                      onClick={() => void enterSelectedCommit()}
                    >
                      Enter commit world
                    </button>
                  )}
                  {navigationDepth > 0 && (
                    <p>
                      This bounded child world is derived from the selected commit; the logical
                      repository selection remains {state.selectedElementId}.
                    </p>
                  )}
                  {commitDiffState.status === "loading" &&
                    commitDiffState.oid === selectedCommitOid && (
                      <p>Loading bounded file diff metadata…</p>
                    )}
                  {commitDiffState.status === "error" &&
                    commitDiffState.oid === selectedCommitOid && (
                      <p role="alert">{commitDiffState.message}</p>
                    )}
                  {commitDiffState.status === "ready" &&
                    commitDiffState.oid === selectedCommitOid && (
                      <>
                        <dl>
                          <div>
                            <dt>Parent</dt>
                            <dd>{commitDiffState.diff.parentOid ?? "root commit"}</dd>
                          </div>
                          <div>
                            <dt>Files</dt>
                            <dd>{commitDiffState.diff.files.length}</dd>
                          </div>
                          <div>
                            <dt>Truncated</dt>
                            <dd>{commitDiffState.diff.truncated ? "yes" : "no"}</dd>
                          </div>
                        </dl>
                        <div className="diff-file-list">
                          {commitDiffState.diff.files.map((file) => (
                            <div key={`${file.path}:${file.status}`}>
                              <strong>{file.path}</strong>
                              <span>
                                {file.status} · +{file.additions} / -{file.deletions} · {file.kind}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                </section>
              )}
              <section className="inspection__future">
                <span className="eyebrow">Phase 4 read-only boundary</span>
                <p>
                  Repository metadata, bounded diffs, and live refresh are wired. Destructive
                  mutation apply remains deliberately unavailable.
                </p>
              </section>
            </div>
          ) : (
            <div className="inspector-empty">
              <span>＋</span>
              <strong>Nothing inspected</strong>
              <p>Use cursor mode to select a semantic element in the world.</p>
            </div>
          )}
        </aside>
      </div>

      {state.error && (
        <div className="error-banner" role="alert">
          <strong>Repository open failed</strong>
          <span>{state.error}</span>
        </div>
      )}

      <GitMutationPreviewTray
        open={state.transactionTrayOpen}
        session={state.session}
        {...(selectedCommitOid === undefined ? {} : { selectedCommitOid })}
        onDraftCountChange={setMutationDraftCount}
      />

      <footer className="statusbar">
        <span>
          <i data-state={state.status} /> {state.status}
        </span>
        <span>
          {state.session?.snapshot.headRef ??
            (state.session?.snapshot.head
              ? `detached@${state.session.snapshot.head.slice(0, 10)}`
              : "HEAD unavailable")}
        </span>
        <span className="statusbar__spacer" />
        <span>{state.cameraMode}</span>
        <span>{state.pointerMode}</span>
        <span>world depth {navigationDepth}</span>
        <span>schema v{state.session?.snapshot.schemaVersion ?? 1}</span>
      </footer>
    </main>
  );
}
