import type {
  ElementId,
  GraphDataset,
  GraphDatasetView,
  GraphEdgeRecord,
} from "@gitinspect/graph-elements";

const HISTORY_KINDS = new Set(["history", "merge-parent"]);
const ATTACHMENT_KINDS = new Set(["ref-target", "tag-target", "stash-base", "head-resolved"]);
const SIGNAL_KINDS = new Set(["local-branch", "remote-branch", "tag", "stash", "head"]);

export type GitTopologyFocusLevel = "selected" | "neighbor" | "attachment" | "path" | "anchor";

export interface GitTopologyContext {
  readonly selectedElementId: ElementId | undefined;
  readonly selectedCommitId: ElementId | undefined;
  readonly immediateParentIds: ReadonlySet<ElementId>;
  readonly immediateChildIds: ReadonlySet<ElementId>;
  readonly attachmentIds: ReadonlySet<ElementId>;
  readonly pathContextIds: ReadonlySet<ElementId>;
  readonly mergeIngressEdgeIds: ReadonlySet<ElementId>;
  readonly focusNodeIds: ReadonlySet<ElementId>;
  readonly focusEdgeIds: ReadonlySet<ElementId>;
  readonly structuralAnchorIds: ReadonlySet<ElementId>;
  readonly labelPriorityById: ReadonlyMap<ElementId, number>;
}

function historyEdges(dataset: GraphDatasetView): readonly GraphEdgeRecord[] {
  return dataset.edges.filter((edge) => HISTORY_KINDS.has(edge.kind));
}

function firstParent(edge: GraphEdgeRecord): boolean {
  return edge.properties.firstParent === true || edge.properties.parentIndex === 0;
}

function resolveCommitForElement(
  dataset: GraphDatasetView,
  elementId: ElementId | undefined,
): ElementId | undefined {
  if (elementId === undefined) return undefined;
  const direct = dataset.nodes.find((node) => node.id === elementId);
  if (direct?.kind === "commit") return direct.id;
  if (direct?.kind === "head") {
    const directHead = dataset.edges.find(
      (edge) => edge.source === direct.id && edge.kind === "head-resolved",
    );
    if (
      directHead &&
      dataset.nodes.some((node) => node.id === directHead.target && node.kind === "commit")
    ) {
      return directHead.target;
    }
    const symbolic = dataset.edges.find(
      (edge) => edge.source === direct.id && edge.kind === "head-symbolic",
    );
    if (symbolic) return resolveCommitForElement(dataset, symbolic.target);
  }
  if (direct && SIGNAL_KINDS.has(direct.kind)) {
    const target = dataset.edges.find(
      (edge) => edge.source === direct.id && ATTACHMENT_KINDS.has(edge.kind),
    )?.target;
    if (target) return resolveCommitForElement(dataset, target);
  }
  const selectedEdge = dataset.edges.find((edge) => edge.id === elementId);
  if (selectedEdge) {
    const target = resolveCommitForElement(dataset, selectedEdge.target);
    return target ?? resolveCommitForElement(dataset, selectedEdge.source);
  }
  return undefined;
}

function structuralAnchors(dataset: GraphDatasetView): ReadonlySet<ElementId> {
  const anchors = new Set<ElementId>();
  const parentsByCommit = new Map<ElementId, ElementId[]>();
  const childrenByCommit = new Map<ElementId, ElementId[]>();
  for (const edge of historyEdges(dataset)) {
    const parents = parentsByCommit.get(edge.target) ?? [];
    parents.push(edge.source);
    parentsByCommit.set(edge.target, parents);
    const children = childrenByCommit.get(edge.source) ?? [];
    children.push(edge.target);
    childrenByCommit.set(edge.source, children);
  }

  for (const node of dataset.nodes) {
    if (
      SIGNAL_KINDS.has(node.kind) ||
      node.kind === "remote" ||
      node.kind === "commit-boundary" ||
      node.properties.truncatedBoundary === true
    ) {
      anchors.add(node.id);
    }
    if (node.kind !== "commit") continue;
    const parents = parentsByCommit.get(node.id)?.length ?? 0;
    const children = childrenByCommit.get(node.id)?.length ?? 0;
    if (
      node.properties.isHead === true ||
      node.properties.isMerge === true ||
      parents !== 1 ||
      children !== 1 ||
      (Array.isArray(node.properties.tags) && node.properties.tags.length > 0) ||
      (Array.isArray(node.properties.localBranches) && node.properties.localBranches.length > 0) ||
      (Array.isArray(node.properties.remoteBranches) && node.properties.remoteBranches.length > 0)
    ) {
      anchors.add(node.id);
    }
  }

  for (const edge of dataset.edges) {
    if (!ATTACHMENT_KINDS.has(edge.kind)) continue;
    anchors.add(edge.source);
    anchors.add(edge.target);
  }
  return anchors;
}

function addFirstParentPathContext(
  dataset: GraphDatasetView,
  start: ElementId,
  target: Set<ElementId>,
  edges: Set<ElementId>,
  depth = 2,
): void {
  let older: ElementId | undefined = start;
  for (let step = 0; step < depth && older; step += 1) {
    const edge = dataset.edges.find(
      (candidate) =>
        HISTORY_KINDS.has(candidate.kind) && candidate.target === older && firstParent(candidate),
    );
    if (!edge) break;
    target.add(edge.source);
    edges.add(edge.id);
    older = edge.source;
  }

  let frontier = [start];
  for (let step = 0; step < depth; step += 1) {
    const next: ElementId[] = [];
    for (const parent of frontier) {
      const children = dataset.edges
        .filter(
          (candidate) =>
            HISTORY_KINDS.has(candidate.kind) && candidate.source === parent && firstParent(candidate),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      for (const edge of children) {
        target.add(edge.target);
        edges.add(edge.id);
        next.push(edge.target);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
}

function attachedSignals(
  dataset: GraphDatasetView,
  commitId: ElementId,
): { readonly nodeIds: Set<ElementId>; readonly edgeIds: Set<ElementId> } {
  const nodeIds = new Set<ElementId>();
  const edgeIds = new Set<ElementId>();
  for (const edge of dataset.edges) {
    if (edge.target !== commitId || !ATTACHMENT_KINDS.has(edge.kind)) continue;
    nodeIds.add(edge.source);
    edgeIds.add(edge.id);
  }
  for (const signalId of [...nodeIds]) {
    for (const edge of dataset.edges) {
      if (
        edge.target !== signalId ||
        !["head-symbolic", "remote-membership"].includes(edge.kind)
      ) {
        continue;
      }
      nodeIds.add(edge.source);
      edgeIds.add(edge.id);
    }
  }
  return { nodeIds, edgeIds };
}

function topologyPriority(
  dataset: GraphDatasetView,
  context: Omit<GitTopologyContext, "labelPriorityById">,
): ReadonlyMap<ElementId, number> {
  const priorities = new Map<ElementId, number>();
  const setMax = (id: ElementId, value: number) =>
    priorities.set(id, Math.max(priorities.get(id) ?? 0, value));
  for (const id of context.structuralAnchorIds) setMax(id, 620);
  for (const id of context.pathContextIds) setMax(id, 760);
  for (const id of context.attachmentIds) setMax(id, 940);
  for (const id of context.immediateParentIds) setMax(id, 1_020);
  for (const id of context.immediateChildIds) setMax(id, 1_020);
  if (context.selectedCommitId) setMax(context.selectedCommitId, 1_180);
  if (context.selectedElementId) setMax(context.selectedElementId, 1_240);

  for (const node of dataset.nodes) {
    if (node.kind === "head" || node.properties.isHead === true) setMax(node.id, 900);
    if (node.kind === "local-branch" || node.kind === "remote-branch") setMax(node.id, 820);
    if (node.kind === "tag") setMax(node.id, 800);
    if (node.kind === "commit-boundary" || node.properties.truncatedBoundary === true)
      setMax(node.id, 700);
    if (node.kind === "commit" && node.properties.isMerge === true) setMax(node.id, 740);
  }
  return priorities;
}

export function buildGitTopologyContext(
  dataset: GraphDatasetView,
  selectedElementId?: ElementId,
): GitTopologyContext {
  const selectedCommitId = resolveCommitForElement(dataset, selectedElementId);
  const immediateParentIds = new Set<ElementId>();
  const immediateChildIds = new Set<ElementId>();
  const attachmentIds = new Set<ElementId>();
  const pathContextIds = new Set<ElementId>();
  const mergeIngressEdgeIds = new Set<ElementId>();
  const focusEdgeIds = new Set<ElementId>();
  const structuralAnchorIds = new Set(structuralAnchors(dataset));

  if (selectedCommitId) {
    for (const edge of historyEdges(dataset)) {
      if (edge.target === selectedCommitId) {
        immediateParentIds.add(edge.source);
        focusEdgeIds.add(edge.id);
        if (!firstParent(edge)) mergeIngressEdgeIds.add(edge.id);
      }
      if (edge.source === selectedCommitId) {
        immediateChildIds.add(edge.target);
        focusEdgeIds.add(edge.id);
      }
    }
    const attached = attachedSignals(dataset, selectedCommitId);
    for (const id of attached.nodeIds) attachmentIds.add(id);
    for (const id of attached.edgeIds) focusEdgeIds.add(id);
    addFirstParentPathContext(dataset, selectedCommitId, pathContextIds, focusEdgeIds);

    for (const candidateId of [selectedCommitId, ...immediateParentIds, ...immediateChildIds]) {
      const ingress = historyEdges(dataset).filter((edge) => edge.target === candidateId);
      if (ingress.length <= 1) continue;
      for (const edge of ingress) {
        pathContextIds.add(edge.source);
        focusEdgeIds.add(edge.id);
        if (!firstParent(edge)) mergeIngressEdgeIds.add(edge.id);
      }
    }
  }

  const focusNodeIds = new Set<ElementId>([
    ...(selectedElementId ? [selectedElementId] : []),
    ...(selectedCommitId ? [selectedCommitId] : []),
    ...immediateParentIds,
    ...immediateChildIds,
    ...attachmentIds,
    ...pathContextIds,
  ]);
  const base = {
    selectedElementId,
    selectedCommitId,
    immediateParentIds,
    immediateChildIds,
    attachmentIds,
    pathContextIds,
    mergeIngressEdgeIds,
    focusNodeIds,
    focusEdgeIds,
    structuralAnchorIds,
  };
  return Object.freeze({ ...base, labelPriorityById: topologyPriority(dataset, base) });
}

export function gitTopologyPromotionIds(
  dataset: GraphDataset,
  selectedIds: ReadonlySet<ElementId> = new Set(),
): ReadonlySet<ElementId> {
  const promoted = new Set(structuralAnchors(dataset));
  for (const selectedId of selectedIds) {
    const context = buildGitTopologyContext(dataset, selectedId);
    for (const id of context.focusNodeIds) promoted.add(id);
  }
  return promoted;
}

export function gitTopologyFocusLevel(
  context: GitTopologyContext,
  id: ElementId,
): GitTopologyFocusLevel | undefined {
  if (id === context.selectedElementId || id === context.selectedCommitId) return "selected";
  if (context.immediateParentIds.has(id) || context.immediateChildIds.has(id)) return "neighbor";
  if (context.attachmentIds.has(id)) return "attachment";
  if (context.pathContextIds.has(id)) return "path";
  if (context.structuralAnchorIds.has(id)) return "anchor";
  return undefined;
}
