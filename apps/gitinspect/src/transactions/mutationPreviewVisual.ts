import type {
  DataMapper,
  EdgeVisualDescriptor,
  ElementId,
  GraphDataset,
  GraphEdgeRecord,
  GraphNodeRecord,
  MappingContext,
  NodeVisualDescriptor,
  SelectionState,
} from "@gitinspect/graph-elements";

import type { GitMutationPreview } from "./gitMutationPreview";

export interface MutationPreviewVisualStyle {
  readonly emissive?: string;
  readonly minimumOpacity?: number;
  readonly scaleMultiplier?: number;
}

const DEFAULT_STYLE: Required<MutationPreviewVisualStyle> = Object.freeze({
  emissive: "#ff4fd8",
  minimumOpacity: 0.94,
  scaleMultiplier: 1.08,
});

function addOidIds(ids: Set<ElementId>, oid: string | undefined): void {
  if (!oid) return;
  ids.add(`commit:${oid}`);
  ids.add(`commit-boundary:${oid}`);
  ids.add(`object:${oid}`);
}

/**
 * Map bounded backend preview evidence onto identities that can already exist in the live graph.
 * New rewritten objects are not invented here; if they are absent from the authoritative dataset,
 * the textual preview remains the source of truth until a post-preview graph delta is available.
 */
export function gitMutationPreviewAffectedIds(
  preview: GitMutationPreview | undefined,
): ReadonlySet<ElementId> {
  const ids = new Set<ElementId>();
  if (!preview) return ids;

  for (const change of preview.changedRefs) {
    ids.add(`ref:${change.name}`);
    addOidIds(ids, change.beforeOid);
    addOidIds(ids, change.afterOid);
  }
  for (const rewrite of preview.rewrittenCommits) {
    addOidIds(ids, rewrite.oldOid);
    addOidIds(ids, rewrite.newOid);
  }
  for (const entry of preview.hashCascade) {
    addOidIds(ids, entry.oldOid);
    addOidIds(ids, entry.newOid);
    addOidIds(ids, entry.newParentOid);
  }
  for (const entry of preview.droppedCommits) addOidIds(ids, entry.oldOid);
  for (const commit of preview.graphDelta.commits) addOidIds(ids, commit.oid);
  for (const reference of preview.graphDelta.refs) {
    ids.add(`ref:${reference.name}`);
    addOidIds(ids, reference.targetOid);
  }
  return ids;
}

function firstLine(message: string): string {
  return message.split("\n", 1)[0]?.trim() || "(no commit message)";
}

function refLabel(name: string): string {
  return name.replace(/^refs\/(heads|remotes|tags)\//, "");
}

interface MutationPreviewContinuity {
  readonly complete: boolean;
  readonly successorsByOldOid: ReadonlyMap<string, readonly string[]>;
  readonly oldOidsByNewOid: ReadonlyMap<string, readonly string[]>;
  readonly droppedOldOids: ReadonlySet<string>;
}

function mutationPreviewContinuity(
  datasetRevision: string,
  preview: GitMutationPreview | undefined,
): MutationPreviewContinuity {
  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();
  const dropped = new Set<string>();
  if (!preview?.success || preview.baseRevision !== datasetRevision) {
    return {
      complete: false,
      successorsByOldOid: new Map(),
      oldOidsByNewOid: new Map(),
      droppedOldOids: dropped,
    };
  }

  const authoritativeNewOids = new Set(preview.graphDelta.commits.map((commit) => commit.oid));
  for (const rewrite of preview.rewrittenCommits) {
    if (!authoritativeNewOids.has(rewrite.newOid) || rewrite.oldOid === rewrite.newOid) continue;
    const oldSuccessors = successors.get(rewrite.oldOid) ?? new Set<string>();
    oldSuccessors.add(rewrite.newOid);
    successors.set(rewrite.oldOid, oldSuccessors);
    const newPredecessors = predecessors.get(rewrite.newOid) ?? new Set<string>();
    newPredecessors.add(rewrite.oldOid);
    predecessors.set(rewrite.newOid, newPredecessors);
  }
  for (const entry of preview.droppedCommits) dropped.add(entry.oldOid);

  const freezeMap = (source: ReadonlyMap<string, Set<string>>) =>
    new Map(
      [...source].map(([oid, values]) => [oid, [...values].sort((left, right) => left.localeCompare(right))] as const),
    );
  return {
    complete: !preview.graphDelta.truncated,
    successorsByOldOid: freezeMap(successors),
    oldOidsByNewOid: freezeMap(predecessors),
    droppedOldOids: dropped,
  };
}

/**
 * Resolve only an unambiguous, complete authoritative rewrite successor for temporary preview
 * selection. Split (1->N), drop, conflicts, stale previews, and truncated deltas deliberately clear
 * or retain selection rather than guessing a target. The caller's durable selection is not mutated.
 */
export function mutationPreviewSelectionId(
  datasetRevision: string | undefined,
  selectedElementId: ElementId | undefined,
  preview: GitMutationPreview | undefined,
): ElementId | undefined {
  if (!datasetRevision || !selectedElementId || !preview) return selectedElementId;
  const prefix = "commit:";
  if (!selectedElementId.startsWith(prefix)) return selectedElementId;
  const continuity = mutationPreviewContinuity(datasetRevision, preview);
  if (!continuity.complete) return selectedElementId;
  const oldOid = selectedElementId.slice(prefix.length);
  if (continuity.droppedOldOids.has(oldOid)) return undefined;
  const successors = continuity.successorsByOldOid.get(oldOid);
  if (!successors) return selectedElementId;
  return successors.length === 1 ? `commit:${successors[0]}` : undefined;
}

/**
 * Merge only backend-authored preview graph evidence into the live graph. Missing objects remain
 * untouched and continue to use the Phase-36 highlight fallback; no guessed commit/ref is created.
 */
export function mutationPreviewGraphDataset(
  dataset: GraphDataset | undefined,
  preview: GitMutationPreview | undefined,
): GraphDataset | undefined {
  if (!dataset || !preview) return dataset;
  if (!preview.success || preview.baseRevision !== dataset.revision) return dataset;

  const continuity = mutationPreviewContinuity(dataset.revision, preview);
  const deletedRefNames = continuity.complete
    ? preview.changedRefs
        .filter((change) => change.beforeOid !== undefined && change.afterOid === undefined)
        .map((change) => change.name)
    : [];
  const hasRetiredObjects =
    continuity.complete &&
    (continuity.successorsByOldOid.size > 0 || continuity.droppedOldOids.size > 0);
  if (
    preview.graphDelta.commits.length === 0 &&
    preview.graphDelta.refs.length === 0 &&
    deletedRefNames.length === 0 &&
    !hasRetiredObjects
  ) {
    return dataset;
  }

  const nodes = new Map(dataset.nodes.map((node) => [node.id, node] as const));
  const edges = new Map(dataset.edges.map((edge) => [edge.id, edge] as const));
  const authoritativeCommitOids = new Set(preview.graphDelta.commits.map((commit) => commit.oid));

  if (continuity.complete) {
    const retiredOids = new Set([
      ...continuity.successorsByOldOid.keys(),
      ...continuity.droppedOldOids,
    ]);
    for (const oid of retiredOids) {
      for (const id of [`commit:${oid}`, `commit-boundary:${oid}`, `object:${oid}`]) {
        if (!nodes.delete(id)) continue;
        for (const [edgeId, edge] of edges) {
          if (edge.source === id || edge.target === id) edges.delete(edgeId);
        }
      }
    }
  }

  for (const name of deletedRefNames) {
    const refId = `ref:${name}`;
    nodes.delete(refId);
    for (const [edgeId, edge] of edges) {
      if (edge.source === refId || edge.target === refId) edges.delete(edgeId);
    }
  }

  const targetId = (oid: string): string | undefined => {
    for (const id of [`commit:${oid}`, `commit-boundary:${oid}`, `object:${oid}`]) {
      if (nodes.has(id)) return id;
    }
    return undefined;
  };

  for (const commit of preview.graphDelta.commits) {
    const id = `commit:${commit.oid}`;
    const existing = nodes.get(id);
    nodes.set(id, {
      ...(existing ?? {
        id,
        kind: "commit",
        group: commit.parents.length > 1 ? "merge" : "history",
        weight: 1,
      }),
      id,
      kind: "commit",
      label: firstLine(commit.message),
      properties: {
        ...(existing?.properties ?? {
          files: [],
          tags: [],
          localBranches: [],
          remoteBranches: [],
          isHead: false,
        }),
        oid: commit.oid,
        parents: commit.parents,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        authoredAtMs: commit.authoredAtMs,
        committedAtMs: commit.committedAtMs,
        message: commit.message,
        isMerge: commit.parents.length > 1,
        mutationPreviewAuthoritative: true,
        ...(continuity.oldOidsByNewOid.get(commit.oid)
          ? { mutationPreviewLineageOldOids: continuity.oldOidsByNewOid.get(commit.oid) }
          : {}),
      },
    });
  }

  for (const commit of preview.graphDelta.commits) {
    commit.parents.forEach((parentOid, parentIndex) => {
      let source = targetId(parentOid);
      if (!source && authoritativeCommitOids.has(parentOid)) source = `commit:${parentOid}`;
      if (!source) return;
      const id = `history:${parentOid}:${commit.oid}:${parentIndex}`;
      edges.set(id, {
        id,
        source,
        target: `commit:${commit.oid}`,
        kind: commit.parents.length > 1 ? "merge-parent" : "history",
        directed: true,
        weight: parentIndex === 0 ? 1.2 : 1,
        properties: {
          parentIndex,
          firstParent: parentIndex === 0,
          headPath: false,
          mutationPreviewAuthoritative: true,
        },
      });
    });
  }

  for (const reference of preview.graphDelta.refs) {
    const target = targetId(reference.targetOid);
    if (!target) continue;
    const id = `ref:${reference.name}`;
    const existing = nodes.get(id);
    nodes.set(id, {
      ...(existing ?? {
        id,
        kind: reference.kind,
        label: refLabel(reference.name),
        group: "refs",
      }),
      kind: reference.kind,
      properties: {
        ...(existing?.properties ?? {}),
        name: reference.name,
        targetOid: reference.targetOid,
        mutationPreviewAuthoritative: true,
      },
    });
    const edgeId = `ref-target:${reference.name}`;
    edges.set(edgeId, {
      id: edgeId,
      source: id,
      target,
      kind: reference.kind === "tag" ? "tag-target" : "ref-target",
      directed: true,
      properties: {
        refKind: reference.kind,
        targetOid: reference.targetOid,
        mutationPreviewAuthoritative: true,
      },
    });
  }

  return {
    revision: `${dataset.revision}:preview:${preview.operationDigest}`,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/** Decorate existing 3D node descriptors while preserving all semantic IDs and selection hooks. */
export function createMutationPreviewMapper<
  TNode extends GraphNodeRecord = GraphNodeRecord,
  TEdge extends GraphEdgeRecord = GraphEdgeRecord,
>(
  base: DataMapper<TNode, TEdge>,
  affectedIds: ReadonlySet<ElementId>,
  style: MutationPreviewVisualStyle = {},
): DataMapper<TNode, TEdge> {
  const resolved = {
    emissive: style.emissive ?? DEFAULT_STYLE.emissive,
    minimumOpacity: style.minimumOpacity ?? DEFAULT_STYLE.minimumOpacity,
    scaleMultiplier: style.scaleMultiplier ?? DEFAULT_STYLE.scaleMultiplier,
  };
  return {
    mapNode(node: TNode, context: MappingContext<TNode, TEdge>): NodeVisualDescriptor {
      const descriptor = base.mapNode(node, context);
      if (!affectedIds.has(node.id)) return descriptor;
      return {
        nodeId: descriptor.nodeId,
        elements: descriptor.elements.map((element) => ({
          ...element,
          ...(element.scale === undefined
            ? {}
            : {
                scale: element.scale.map((value) => value * resolved.scaleMultiplier) as [
                  number,
                  number,
                  number,
                ],
              }),
          emissive: resolved.emissive,
          opacity: Math.max(element.opacity ?? 1, resolved.minimumOpacity),
          metadata: { ...element.metadata, mutationPreviewAffected: true },
        })),
      };
    },
    mapEdge(edge: TEdge, context: MappingContext<TNode, TEdge>): EdgeVisualDescriptor {
      return base.mapEdge(edge, context);
    },
    ...(base.relatedSelectionIds
      ? {
          relatedSelectionIds(
            selection: SelectionState,
            dataset: Parameters<NonNullable<typeof base.relatedSelectionIds>>[1],
          ) {
            // biome-ignore lint/style/noNonNullAssertion: guarded by truthy check above.
            return base.relatedSelectionIds!(selection, dataset);
          },
        }
      : {}),
    ...(base.childWorld
      ? {
          childWorld(node: TNode, context: MappingContext<TNode, TEdge>) {
            // biome-ignore lint/style/noNonNullAssertion: guarded by truthy check above.
            return base.childWorld!(node, context);
          },
        }
      : {}),
  };
}
