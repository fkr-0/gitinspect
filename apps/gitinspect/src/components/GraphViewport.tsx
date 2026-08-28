import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  CameraController,
  InteractionManager,
  LabelSystem,
  PickRegistry,
  type CameraMode,
  type CameraState,
  type ElementId,
  type GraphDataset,
  type GraphNodeRecord,
  type LabelDescriptor,
  type ModifierState,
  type MouseMode,
  type PickReference,
  type SelectionGranularity,
  type SelectionState,
  type SemanticPickRecord,
  type SemanticRenderIdentity,
  type Vec3,
} from "@gitinspect/graph-elements";

import {
  changedFilePathForGitSelection,
  createGitVisualMapper,
  gitVisualMapper,
} from "../domain/gitVisualMapper";
import { gitEdgeRoutes } from "../domain/gitLayout";
import { buildGitTopologyContext, type GitTopologyContext } from "../domain/gitTopology";
import { gitEdgeStyleRegistry } from "../domain/gitVisualTheme";
import { GitWorldScaleSearchAdapter } from "../scale";
import { createSearchHighlightMapper, type GitSearchFilters } from "../search";
import type { ViewportTopologyFitRequest } from "./ViewportCameraBridge";
import {
  contextualGitCameraBounds,
  gitCameraBoundsForPositions,
  gitTopologyVisibilityRange,
  isInheritedCinematicCamera,
} from "./gitCameraFit";
import type { ViewportProjectionPoint } from "./ViewportProjectionBridge";

interface GraphViewportProps {
  readonly dataset: GraphDataset | undefined;
  readonly selectedElementId: string | undefined;
  readonly search: string;
  readonly filters?: GitSearchFilters;
  readonly cameraMode?: CameraMode;
  readonly pointerMode?: MouseMode;
  readonly cameraState?: CameraState;
  readonly onCameraStateChange?: (camera: CameraState) => void;
  readonly onSearchResultsChange?: (results: ViewportSearchResults) => void;
  readonly onSelect: (elementId: string, selection: SelectionState) => void;
  readonly onContextRequest?: (elementId: string, selection: SelectionState) => void;
}

export interface ViewportSearchResults {
  readonly query: string;
  readonly filterKey: string;
  readonly elementIds: readonly ElementId[];
  /** Bounded ordered preview for App/sidebar consumption; the adapter keeps the complete filter set. */
  readonly filterPreviewElementIds?: readonly ElementId[];
  readonly filterMatchCount?: number;
}

const INITIAL_CAMERA_STATE: CameraState = {
  mode: "attached",
  position: [10, 6, 16],
  target: [0, 0, 0],
  zoom: 1,
};
const MAX_VIEWPORT_LABELS = 48;
const MAX_REPORTED_FILTER_PREVIEW_IDS = 200;
const DEFAULT_LOD_SAMPLE_DISTANCE = 8;
const LazyGraphScene = lazy(() =>
  import("./GraphScene").then((module) => ({ default: module.GraphScene })),
);
const EMPTY_DRILL_TARGETS = new Map<string, { readonly drillTargetId: string }>();
const EMPTY_IDS = new Set<ElementId>();
const EMPTY_SEARCH_RESULT_IDS: readonly ElementId[] = Object.freeze([]);
const KEYBOARD_SELECTION_REFERENCE: PickReference = {
  objectId: "viewport-keyboard-selection",
};
const GIT_NODE_GRANULARITIES: readonly SelectionGranularity[] = [
  "sub-element",
  "node",
  "edge-group",
  "chain",
  "cluster",
];
const GIT_EDGE_GRANULARITIES: readonly SelectionGranularity[] = [
  "sub-element",
  "edge-group",
  "chain",
  "cluster",
];

function normalizedFilterTerms(values: readonly string[] | undefined): readonly string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

export function viewportSearchFilterKey(filters: GitSearchFilters | undefined): string {
  if (!filters) return "";
  const objectKinds = normalizedFilterTerms(filters.objectKinds);
  const authors = normalizedFilterTerms(filters.authors);
  const refs = normalizedFilterTerms(filters.refs);
  const changedPaths = normalizedFilterTerms(filters.changedPaths);
  const signatureStates = [...new Set(filters.signatureStates ?? [])].sort();
  const fromMs = filters.dateRange?.fromMs;
  const toMs = filters.dateRange?.toMs;
  const active =
    objectKinds.length > 0 ||
    authors.length > 0 ||
    refs.length > 0 ||
    changedPaths.length > 0 ||
    signatureStates.length > 0 ||
    fromMs !== undefined ||
    toMs !== undefined ||
    filters.merge !== undefined;
  if (!active) return "";
  return JSON.stringify({
    objectKinds,
    authors,
    refs,
    changedPaths,
    signatureStates,
    ...(fromMs === undefined ? {} : { fromMs }),
    ...(toMs === undefined ? {} : { toMs }),
    ...(filters.merge === undefined ? {} : { merge: filters.merge }),
  });
}

const VIEWPORT_LABEL_FLIP_X_PERCENT = 82;

export function viewportLabelSide(projectedXPercent: number): "left" | "right" {
  return projectedXPercent >= VIEWPORT_LABEL_FLIP_X_PERCENT ? "left" : "right";
}

export function viewportSearchResults(
  query: string,
  results: readonly { readonly id: ElementId }[] | undefined,
  filters?: GitSearchFilters,
  filterIds?: ReadonlySet<ElementId>,
): ViewportSearchResults {
  const filterKey = viewportSearchFilterKey(filters);
  return Object.freeze({
    query,
    filterKey,
    elementIds:
      results === undefined
        ? EMPTY_SEARCH_RESULT_IDS
        : Object.freeze(results.map((result) => result.id)),
    ...(filterKey.length > 0 && filterIds !== undefined
      ? {
          filterPreviewElementIds: Object.freeze(
            [...filterIds].slice(0, MAX_REPORTED_FILTER_PREVIEW_IDS),
          ),
          filterMatchCount: filterIds.size,
        }
      : {}),
  });
}

function sameViewportSearchResults(
  left: ViewportSearchResults,
  right: ViewportSearchResults,
): boolean {
  return (
    left.query === right.query &&
    left.filterKey === right.filterKey &&
    left.elementIds.length === right.elementIds.length &&
    left.elementIds.every((elementId, index) => elementId === right.elementIds[index]) &&
    left.filterMatchCount === right.filterMatchCount &&
    (left.filterPreviewElementIds?.length ?? 0) === (right.filterPreviewElementIds?.length ?? 0) &&
    (left.filterPreviewElementIds ?? EMPTY_SEARCH_RESULT_IDS).every(
      (elementId, index) => elementId === right.filterPreviewElementIds?.[index],
    )
  );
}

export function resolveViewportSelection(
  elementId: string,
  aggregateDrillTargets: ReadonlyMap<string, { readonly drillTargetId: string }>,
): string {
  return aggregateDrillTargets.get(elementId)?.drillTargetId ?? elementId;
}

export function viewportPickRecord(
  identity: SemanticRenderIdentity,
  aggregateDrillTargets: ReadonlyMap<string, { readonly drillTargetId: string }>,
  dataset?: GraphDataset,
): SemanticPickRecord {
  const elementId = resolveViewportSelection(identity.ownerId, aggregateDrillTargets);
  const edge = dataset?.edges.some((candidate) => candidate.id === elementId) === true;
  return {
    elementId,
    interactionKey: identity.interactionKey ?? identity.elementId,
    semanticKind: edge ? "edge" : "node",
    availableGranularities: edge ? GIT_EDGE_GRANULARITIES : GIT_NODE_GRANULARITIES,
  };
}

export function viewportRelatedSelectionIds(
  dataset: GraphDataset,
  record: SemanticPickRecord,
  granularity: SelectionGranularity,
): readonly ElementId[] {
  const selection: SelectionState = {
    elementId: record.elementId,
    granularity,
    relatedIds: [],
    ...(record.interactionKey === undefined ? {} : { interactionKey: record.interactionKey }),
  };
  return gitVisualMapper.relatedSelectionIds?.(selection, dataset) ?? [record.elementId];
}

export function syncViewportInteractionSelection(
  picks: PickRegistry,
  interactions: InteractionManager,
  elementId: ElementId | undefined,
): void {
  picks.unregister(KEYBOARD_SELECTION_REFERENCE);
  if (elementId === undefined) {
    interactions.clearSelection();
    return;
  }
  picks.register(KEYBOARD_SELECTION_REFERENCE, {
    elementId,
    interactionKey: `viewport-selection:${elementId}`,
    availableGranularities: ["node"],
  });
  interactions.click(KEYBOARD_SELECTION_REFERENCE, { shift: true });
}

export function viewportContextShortcut(event: {
  readonly key: string;
  readonly code: string;
  readonly shiftKey: boolean;
}): "context-menu" | undefined {
  if (event.key === "ContextMenu" || event.code === "ContextMenu") return "context-menu";
  if (event.shiftKey && (event.key === "F10" || event.code === "F10")) return "context-menu";
  return undefined;
}

export type ViewportTraversalCommand = "previous" | "next" | "first" | "last";

export function viewportTraversalCommand(key: string): ViewportTraversalCommand | undefined {
  if (key === "ArrowLeft" || key === "ArrowUp") return "previous";
  if (key === "ArrowRight" || key === "ArrowDown") return "next";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  return undefined;
}

export function viewportTraversalTarget(
  elementIds: readonly ElementId[],
  currentElementId: ElementId,
  command: ViewportTraversalCommand,
): ElementId | undefined {
  if (elementIds.length === 0) return undefined;
  if (command === "first") return elementIds[0];
  if (command === "last") return elementIds[elementIds.length - 1];
  const currentIndex = elementIds.indexOf(currentElementId);
  if (currentIndex < 0) return elementIds[0];
  const delta = command === "next" ? 1 : -1;
  return elementIds[(currentIndex + delta + elementIds.length) % elementIds.length];
}

function lodCameraProjectionSampleChanged(
  previous: Vec3,
  next: Vec3,
  minimumDistance = DEFAULT_LOD_SAMPLE_DISTANCE,
): boolean {
  if (minimumDistance <= 0) {
    return previous[0] !== next[0] || previous[1] !== next[1] || previous[2] !== next[2];
  }
  return (
    Math.hypot(next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]) >=
    minimumDistance
  );
}

export function planViewportLabels(
  labelSystem: LabelSystem,
  nodes: readonly GraphNodeRecord[],
  nodePositions: ReadonlyMap<ElementId, Vec3>,
  cameraPosition: Vec3,
  selectedElementId: ElementId | undefined,
  hoveredElementId: ElementId | undefined,
  searchHitIds: ReadonlySet<ElementId> = EMPTY_IDS,
  topology?: GitTopologyContext,
): ReadonlySet<ElementId> {
  const descriptors: LabelDescriptor[] = nodes.flatMap((node) => {
    const position = nodePositions.get(node.id);
    if (!position) return [];
    return [
      {
        id: `viewport-label:${node.id}`,
        text: node.label ?? node.id,
        position,
        importance: Math.max(
          searchHitIds.has(node.id) ? 1_100 : 0,
          topology?.labelPriorityById.get(node.id) ?? 0,
          Math.min(50, Math.max(1, node.weight ?? 1)),
        ),
        elementId: node.id,
        collisionGroup: node.group ?? node.kind,
      },
    ];
  });
  const plan = labelSystem.evaluate(descriptors, {
    cameraPosition,
    lod: 0,
    ...(selectedElementId ? { selectedIds: new Set([selectedElementId]) } : {}),
    ...(hoveredElementId ? { hoveredIds: new Set([hoveredElementId]) } : {}),
    maxVisible: MAX_VIEWPORT_LABELS,
  });
  return new Set(
    plan.visible.flatMap((entry) =>
      entry.descriptor.elementId ? [entry.descriptor.elementId] : [],
    ),
  );
}

function editableEventTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function GraphViewport({
  dataset,
  selectedElementId,
  search,
  filters,
  cameraMode = "attached",
  pointerMode = "cursor",
  cameraState = INITIAL_CAMERA_STATE,
  onCameraStateChange,
  onSearchResultsChange,
  onSelect,
  onContextRequest,
}: GraphViewportProps) {
  const semanticInteractionEnabled = pointerMode === "cursor";
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filterKey = viewportSearchFilterKey(filters);
  const effectiveFilters = filterKey.length === 0 ? undefined : filters;
  const scaleSearchRef = useRef<GitWorldScaleSearchAdapter | undefined>(undefined);
  scaleSearchRef.current ??= new GitWorldScaleSearchAdapter();
  const pickRegistryRef = useRef<PickRegistry | undefined>(undefined);
  pickRegistryRef.current ??= new PickRegistry();
  const interactionDatasetRef = useRef<GraphDataset | undefined>(dataset);
  interactionDatasetRef.current = dataset;
  const interactionManagerRef = useRef<InteractionManager | undefined>(undefined);
  interactionManagerRef.current ??= new InteractionManager(pickRegistryRef.current, {
    resolveRelatedIds: (record, granularity) => {
      const currentDataset = interactionDatasetRef.current;
      return currentDataset
        ? viewportRelatedSelectionIds(currentDataset, record, granularity)
        : [record.elementId];
    },
  });
  const labelSystemRef = useRef<LabelSystem | undefined>(undefined);
  labelSystemRef.current ??= new LabelSystem({ maxVisible: MAX_VIEWPORT_LABELS });
  const cameraControllerRef = useRef<CameraController | undefined>(undefined);
  cameraControllerRef.current ??= new CameraController(cameraState);
  const overlayButtonRefsRef = useRef(new Map<ElementId, HTMLButtonElement>());
  const pendingKeyboardFocusIdRef = useRef<ElementId | undefined>(undefined);
  const [hoveredElementId, setHoveredElementId] = useState<ElementId | undefined>();
  const [tooltipRecord, setTooltipRecord] = useState<SemanticPickRecord | undefined>();
  const [projectedLabelPoints, setProjectedLabelPoints] = useState<
    ReadonlyMap<ElementId, ViewportProjectionPoint>
  >(new Map());
  const lodCameraPositionRef = useRef<Vec3>(cameraState.position);
  const [lodCameraPosition, setLodCameraPosition] = useState<Vec3>(cameraState.position);
  const topologyContext = useMemo(
    () => (dataset ? buildGitTopologyContext(dataset, selectedElementId) : undefined),
    [dataset, selectedElementId],
  );
  useEffect(() => {
    const position: Vec3 = [...cameraState.position];
    lodCameraPositionRef.current = position;
    setLodCameraPosition(position);
  }, [cameraState]);
  const model = useMemo(() => {
    if (!dataset) return undefined;
    const scaleSearch = scaleSearchRef.current;
    if (!scaleSearch) return undefined;
    return scaleSearch.project({
      dataset,
      camera: { position: lodCameraPosition },
      ...(normalizedSearch
        ? { search: { text: normalizedSearch, mode: "substring" as const, limit: 200 } }
        : {}),
      ...(effectiveFilters ? { filters: effectiveFilters } : {}),
      ...(selectedElementId ? { selectedIds: new Set([selectedElementId]) } : {}),
      ...(hoveredElementId ? { hoveredIds: new Set([hoveredElementId]) } : {}),
    });
  }, [
    dataset,
    effectiveFilters,
    hoveredElementId,
    lodCameraPosition,
    normalizedSearch,
    selectedElementId,
  ]);
  const reportedSearchResults = viewportSearchResults(
    normalizedSearch,
    model?.search?.results,
    effectiveFilters,
    model?.filter?.ids,
  );
  const lastReportedSearchResultsRef = useRef<ViewportSearchResults>(
    viewportSearchResults("", undefined),
  );
  useEffect(() => {
    if (!onSearchResultsChange) return;
    if (sameViewportSearchResults(lastReportedSearchResultsRef.current, reportedSearchResults))
      return;
    lastReportedSearchResultsRef.current = reportedSearchResults;
    onSearchResultsChange(reportedSearchResults);
  }, [onSearchResultsChange, reportedSearchResults]);
  const renderDataset = model?.scale.renderDataset;
  const aggregateDrillTargets = model?.scale.aggregateDrillTargets ?? EMPTY_DRILL_TARGETS;
  useEffect(() => {
    const picks = pickRegistryRef.current;
    const interactions = interactionManagerRef.current;
    picks?.clear();
    interactions?.clearSelection();
    interactions?.clearHover();
  }, []);
  useEffect(() => {
    const interactions = interactionManagerRef.current;
    if (!interactions) return;
    return interactions.subscribe((event) => {
      if (event.type === "hover-change") {
        setHoveredElementId(event.hover?.record.elementId);
        setTooltipRecord(undefined);
      } else if (event.type === "tooltip-request") {
        setTooltipRecord(event.hover.record);
      } else if (event.type === "context-request") {
        const elementId = event.selection.elementId;
        if (elementId !== undefined) onContextRequest?.(elementId, event.selection);
      } else if (event.type === "shortcut" && event.shortcut === "context-menu") {
        const elementId = event.selection?.elementId;
        if (elementId !== undefined && event.selection) {
          onContextRequest?.(elementId, event.selection);
        }
      }
    });
  }, [onContextRequest]);
  useEffect(() => {
    const picks = pickRegistryRef.current;
    const interactions = interactionManagerRef.current;
    if (!picks || !interactions) return;
    const exists =
      selectedElementId === undefined
        ? false
        : dataset?.nodes.some((node) => node.id === selectedElementId) === true;
    syncViewportInteractionSelection(picks, interactions, exists ? selectedElementId : undefined);
  }, [dataset, selectedElementId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (editableEventTarget(event.target)) return;
      const shortcut = viewportContextShortcut(event);
      if (shortcut === undefined || selectedElementId === undefined) return;
      const interactions = interactionManagerRef.current;
      if (!interactions?.getSelection()) return;
      event.preventDefault();
      interactions.keyboardShortcut(shortcut, {
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedElementId]);
  useEffect(() => {
    if (!semanticInteractionEnabled) interactionManagerRef.current?.clearHover();
  }, [semanticInteractionEnabled]);
  useEffect(() => () => interactionManagerRef.current?.dispose(), []);

  const registerSemanticIdentity = useCallback(
    (reference: PickReference, identity: SemanticRenderIdentity) => {
      const picks = pickRegistryRef.current;
      if (!picks) return false;
      picks.unregister(reference);
      picks.register(reference, viewportPickRecord(identity, aggregateDrillTargets, dataset));
      return true;
    },
    [aggregateDrillTargets, dataset],
  );

  const selectSemanticIdentity = useCallback(
    (reference: PickReference, identity: SemanticRenderIdentity, modifiers: ModifierState = {}) => {
      if (!semanticInteractionEnabled) return;
      const interactions = interactionManagerRef.current;
      if (!interactions || !registerSemanticIdentity(reference, identity)) return;
      const selection = interactions.click(reference, modifiers);
      if (selection?.elementId !== undefined) onSelect(selection.elementId, selection);
    },
    [onSelect, registerSemanticIdentity, semanticInteractionEnabled],
  );

  const requestContextForSemanticIdentity = useCallback(
    (reference: PickReference, identity: SemanticRenderIdentity, modifiers: ModifierState = {}) => {
      if (!semanticInteractionEnabled) return;
      const interactions = interactionManagerRef.current;
      if (!interactions || !registerSemanticIdentity(reference, identity)) return;
      interactions.click(reference, modifiers);
      interactions.requestContext(reference, modifiers);
    },
    [registerSemanticIdentity, semanticInteractionEnabled],
  );

  const hoverSemanticIdentity = useCallback(
    (reference: PickReference, identity: SemanticRenderIdentity) => {
      if (!semanticInteractionEnabled) return;
      const interactions = interactionManagerRef.current;
      if (!interactions || !registerSemanticIdentity(reference, identity)) return;
      interactions.hover(reference);
    },
    [registerSemanticIdentity, semanticInteractionEnabled],
  );

  const clearSemanticHover = useCallback(() => {
    interactionManagerRef.current?.clearHover();
  }, []);

  const handleCameraStateChange = useCallback(
    (next: CameraState) => {
      onCameraStateChange?.(next);
      if (!lodCameraProjectionSampleChanged(lodCameraPositionRef.current, next.position)) return;
      const position: Vec3 = [...next.position];
      lodCameraPositionRef.current = position;
      setLodCameraPosition(position);
    },
    [onCameraStateChange],
  );

  const nodePositions = useMemo(() => {
    if (!model) return undefined;
    return new Map(Object.entries(model.scale.nodePositions));
  }, [model]);
  const topologyFit = useMemo<ViewportTopologyFitRequest | undefined>(() => {
    if (
      !dataset ||
      !model ||
      !nodePositions ||
      cameraMode !== "attached" ||
      !dataset.nodes.some((node) => node.kind === "commit") ||
      !dataset.edges.some((edge) => edge.kind === "history" || edge.kind === "merge-parent")
    ) {
      return undefined;
    }
    const selectionChanged =
      selectedElementId !== undefined && cameraState.attachedNodeId !== selectedElementId;
    if (!isInheritedCinematicCamera(cameraState) && !selectionChanged) return undefined;
    const overview = model.scale.layoutBounds;
    const focus =
      selectedElementId && topologyContext
        ? gitCameraBoundsForPositions(nodePositions, topologyContext.focusNodeIds)
        : undefined;
    const bounds = focus ? contextualGitCameraBounds(overview, focus) : overview;
    return Object.freeze({
      key: `${dataset.revision}:${selectedElementId ?? "overview"}`,
      bounds,
      ...(selectedElementId !== undefined && nodePositions.has(selectedElementId)
        ? { targetElementId: selectedElementId }
        : {}),
    });
  }, [
    cameraMode,
    cameraState,
    dataset,
    model,
    nodePositions,
    selectedElementId,
    topologyContext,
  ]);
  const visibilityRange = useMemo(
    () =>
      model
        ? gitTopologyVisibilityRange(model.scale.layoutBounds)
        : { far: 500, fogNear: 22, fogFar: 80 },
    [model],
  );
  const visibleLabelIds = useMemo(
    () =>
      renderDataset && nodePositions && labelSystemRef.current
        ? planViewportLabels(
            labelSystemRef.current,
            renderDataset.nodes,
            nodePositions,
            lodCameraPosition,
            selectedElementId,
            hoveredElementId,
            model?.highlights.hitIds ?? EMPTY_IDS,
            topologyContext,
          )
        : EMPTY_IDS,
    [
      hoveredElementId,
      lodCameraPosition,
      model,
      nodePositions,
      renderDataset,
      selectedElementId,
      topologyContext,
    ],
  );
  const projectedLabelIds = useMemo(
    () =>
      renderDataset
        ? renderDataset.nodes
            .filter((node) => visibleLabelIds.has(node.id))
            .slice(0, MAX_VIEWPORT_LABELS)
            .map((node) => node.id)
        : [],
    [renderDataset, visibleLabelIds],
  );
  const interactiveOverlayNodes = useMemo(
    () =>
      (renderDataset?.nodes ?? []).filter(
        (node) => visibleLabelIds.has(node.id) && projectedLabelPoints.get(node.id)?.visible === true,
      ),
    [projectedLabelPoints, renderDataset, visibleLabelIds],
  );
  const interactiveOverlayNodeIds = useMemo(
    () => interactiveOverlayNodes.map((node) => node.id),
    [interactiveOverlayNodes],
  );
  const rovingTabStopId = useMemo(() => {
    if (interactiveOverlayNodes.length === 0) return undefined;
    const selectedRenderNode = interactiveOverlayNodes.find(
      (node) => resolveViewportSelection(node.id, aggregateDrillTargets) === selectedElementId,
    );
    return selectedRenderNode?.id ?? interactiveOverlayNodes[0]?.id;
  }, [aggregateDrillTargets, interactiveOverlayNodes, selectedElementId]);
  useEffect(() => {
    const pendingFocusId = pendingKeyboardFocusIdRef.current;
    if (pendingFocusId === undefined) return;
    const exact = overlayButtonRefsRef.current.get(pendingFocusId);
    const aggregate = interactiveOverlayNodes.find(
      (node) => resolveViewportSelection(node.id, aggregateDrillTargets) === pendingFocusId,
    );
    const target = exact ?? (aggregate ? overlayButtonRefsRef.current.get(aggregate.id) : undefined);
    if (!target) return;
    pendingKeyboardFocusIdRef.current = undefined;
    target.focus();
  }, [aggregateDrillTargets, interactiveOverlayNodes]);
  const edgeRoutes = useMemo(
    () =>
      renderDataset && nodePositions ? gitEdgeRoutes(renderDataset, nodePositions) : new Map(),
    [nodePositions, renderDataset],
  );
  const topologyMapper = useMemo(
    () => createGitVisualMapper(undefined, topologyContext),
    [topologyContext],
  );
  const mapper = useMemo(
    () => (model ? createSearchHighlightMapper(topologyMapper, model.highlights) : topologyMapper),
    [model, topologyMapper],
  );
  const tooltipNode = dataset?.nodes.find((node) => node.id === tooltipRecord?.elementId);
  const tooltipEdge = dataset?.edges.find((edge) => edge.id === tooltipRecord?.elementId);
  const tooltipFilePath =
    dataset && tooltipRecord
      ? changedFilePathForGitSelection(
          {
            elementId: tooltipRecord.elementId,
            ...(tooltipRecord.interactionKey === undefined
              ? {}
              : { interactionKey: tooltipRecord.interactionKey }),
            granularity: "sub-element",
          },
          dataset,
        )
      : undefined;
  const selectedAccessibleNode = dataset?.nodes.find((node) => node.id === selectedElementId);
  const selectedAccessibleSummary = selectedAccessibleNode
    ? `Selected ${selectedAccessibleNode.label ?? selectedAccessibleNode.id}, ${selectedAccessibleNode.kind}.`
    : selectedElementId
      ? `Selected ${selectedElementId}.`
      : "No graph node selected.";
  const canRenderCanvas = typeof window !== "undefined";

  return (
    <section
      className="viewport"
      aria-label="3D graph viewport"
      aria-describedby="viewport-keyboard-instructions viewport-selection-status"
      data-testid="graph-viewport"
      data-camera-mode={cameraMode}
      data-pointer-mode={pointerMode}
    >
      <p id="viewport-keyboard-instructions" className="sr-only">
        Use arrow keys to move between visible graph nodes. Home and End jump to the first or last
        visible node. The Context Menu key or Shift plus F10 opens read-only context actions.
      </p>
      <p id="viewport-selection-status" className="sr-only" role="status" aria-live="polite">
        {selectedAccessibleSummary}
      </p>
      {renderDataset && nodePositions && canRenderCanvas && cameraControllerRef.current && (
        <Suspense
          fallback={
            <div className="viewport__scene-loading" role="status" aria-live="polite">
              Loading 3D graph…
            </div>
          }
        >
          <LazyGraphScene
            dataset={renderDataset}
            mapper={mapper}
            nodePositions={nodePositions}
            edgeRoutes={edgeRoutes}
            edgeStyleRegistry={gitEdgeStyleRegistry}
            controller={cameraControllerRef.current}
            cameraState={cameraState}
            cameraMode={cameraMode}
            pointerMode={pointerMode}
            selectedElementId={selectedElementId}
            projectedLabelIds={projectedLabelIds}
            visibilityRange={visibilityRange}
            {...(topologyFit === undefined ? {} : { topologyFit })}
            onCameraStateChange={handleCameraStateChange}
            onProjectionChange={setProjectedLabelPoints}
            {...(semanticInteractionEnabled
              ? {
                  nodeInteraction: {
                    onClick: (event) =>
                      selectSemanticIdentity(event.reference, event.identity, event.modifiers),
                    onContextMenu: (event) =>
                      requestContextForSemanticIdentity(
                        event.reference,
                        event.identity,
                        event.modifiers,
                      ),
                    onHoverChange: (event) => {
                      if (event) hoverSemanticIdentity(event.reference, event.identity);
                      else clearSemanticHover();
                    },
                  },
                  edgeInteraction: {
                    onClick: (event) =>
                      selectSemanticIdentity(event.reference, event.identity, event.modifiers),
                    onContextMenu: (event) =>
                      requestContextForSemanticIdentity(
                        event.reference,
                        event.identity,
                        event.modifiers,
                      ),
                    onHoverChange: (event) => {
                      if (event) hoverSemanticIdentity(event.reference, event.identity);
                      else clearSemanticHover();
                    },
                  },
                }
              : {})}
          />
        </Suspense>
      )}
      <div className="viewport__atmosphere" aria-hidden="true" />
      <div className="viewport__grid" aria-hidden="true" />

      <div className="viewport__legend">
        <span className="eyebrow">GraphWorld · Git Railfield</span>
        <strong>
          {model
            ? `${model.scale.stats.renderNodeCount} rendered / ${model.scale.stats.logicalNodeCount} logical elements`
            : "No world loaded"}
        </strong>
        <span>
          {model
            ? `${model.scale.renderDataset.edges.length} rendered relations · ${model.scale.stats.aggregateBucketCount} aggregates · ${dataset?.revision}`
            : "Open a repository to hydrate the scene"}
        </span>
      </div>

      {interactiveOverlayNodes.map((node) => {
        const projected = projectedLabelPoints.get(node.id);
        if (!projected) return null;
        const logicalElementId = resolveViewportSelection(node.id, aggregateDrillTargets);
        const selected = logicalElementId === selectedElementId;
        const hovered = logicalElementId === hoveredElementId;
        const matches =
          normalizedSearch.length === 0 || model?.highlights.hitIds.has(logicalElementId) === true;
        const style = {
          "--point-x": `${projected.x}%`,
          "--point-y": `${projected.y}%`,
          "--point-scale": "1",
        } as CSSProperties;

        return (
          <button
            key={node.id}
            ref={(element) => {
              if (element) overlayButtonRefsRef.current.set(node.id, element);
              else overlayButtonRefsRef.current.delete(node.id);
            }}
            type="button"
            className="viewport-node"
            tabIndex={node.id === rovingTabStopId ? 0 : -1}
            data-selected={selected || undefined}
            data-hovered={hovered || undefined}
            data-muted={!matches || undefined}
            data-label-side={viewportLabelSide(projected.x)}
            aria-disabled={!semanticInteractionEnabled || undefined}
            aria-pressed={selected}
            aria-label={`${node.label ?? node.id}, ${node.kind}${selected ? ", selected" : ""}`}
            style={style}
            onPointerEnter={() =>
              hoverSemanticIdentity(
                { objectId: `viewport-overlay:${node.id}` },
                { ownerId: node.id, elementId: node.id, interactionKey: node.id },
              )
            }
            onPointerLeave={clearSemanticHover}
            onKeyDown={(event) => {
              if (!semanticInteractionEnabled) return;
              if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
              const command = viewportTraversalCommand(event.key);
              if (!command) return;
              event.preventDefault();
              const targetId = viewportTraversalTarget(interactiveOverlayNodeIds, node.id, command);
              if (!targetId || targetId === node.id) return;
              const logicalTargetId = resolveViewportSelection(targetId, aggregateDrillTargets);
              pendingKeyboardFocusIdRef.current = logicalTargetId;
              overlayButtonRefsRef.current.get(targetId)?.focus();
              selectSemanticIdentity(
                { objectId: `viewport-keyboard:${targetId}` },
                { ownerId: targetId, elementId: targetId, interactionKey: targetId },
              );
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              requestContextForSemanticIdentity(
                { objectId: `viewport-overlay:${node.id}` },
                { ownerId: node.id, elementId: node.id, interactionKey: node.id },
                {
                  shift: event.shiftKey,
                  ctrl: event.ctrlKey,
                  meta: event.metaKey,
                  alt: event.altKey,
                },
              );
            }}
            onClick={(event) =>
              selectSemanticIdentity(
                { objectId: `viewport-overlay:${node.id}` },
                { ownerId: node.id, elementId: node.id, interactionKey: node.id },
                {
                  shift: event.shiftKey,
                  ctrl: event.ctrlKey,
                  meta: event.metaKey,
                  alt: event.altKey,
                },
              )
            }
            title={node.label ?? node.id}
          >
            <span className="viewport-node__label">{node.label ?? node.kind}</span>
          </button>
        );
      })}

      {semanticInteractionEnabled && tooltipRecord && (tooltipNode || tooltipEdge) && (
        <div className="viewport__tooltip" role="tooltip" data-testid="viewport-tooltip">
          <span>{tooltipFilePath ? "changed-file" : (tooltipNode?.kind ?? tooltipEdge?.kind)}</span>
          <strong>
            {tooltipFilePath ?? tooltipNode?.label ?? tooltipEdge?.kind ?? tooltipRecord.elementId}
          </strong>
          <code>{tooltipRecord.interactionKey ?? tooltipRecord.elementId}</code>
        </div>
      )}

      {!model && (
        <div className="viewport__empty">
          <span className="viewport__reticle" aria-hidden="true" />
          <strong>Repository space is ready</strong>
          <span>Open a repository to build its semantic Git world.</span>
        </div>
      )}

      <div className="viewport__boundary-note">
        Public GraphWorld · topology-derived Git Railfield · camera-projected labels
      </div>
    </section>
  );
}
