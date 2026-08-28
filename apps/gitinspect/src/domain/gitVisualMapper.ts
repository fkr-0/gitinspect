import type { GitCommitFileChange } from "@gitinspect/contracts";
import type {
  DataMapper,
  EdgeVisualDescriptor,
  ElementId,
  GraphDatasetView,
  GraphEdgeRecord,
  GraphNodeRecord,
  NodeVisualDescriptor,
  SelectionState,
  VisualElementDescriptor,
} from "@gitinspect/graph-elements";

import { gitGraphIds } from "./graphAdapter";
import {
  gitTopologyFocusLevel,
  type GitTopologyContext,
} from "./gitTopology";
import { DEFAULT_GIT_VISUAL_THEME, type GitVisualTheme } from "./gitVisualTheme";

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function fileChanges(value: unknown): readonly GitCommitFileChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is GitCommitFileChange => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Partial<GitCommitFileChange>;
    return (
      typeof candidate.path === "string" &&
      (candidate.kind === "text" || candidate.kind === "binary") &&
      typeof candidate.additions === "number" &&
      typeof candidate.deletions === "number"
    );
  });
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function commitFileOffset(index: number): readonly [number, number, number] {
  const columns = 7;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return [-1.25 + column * 0.42, 0.36 + row * 0.12, -0.52 + (row % 3) * 0.52];
}

function fileScale(file: GitCommitFileChange): readonly [number, number, number] {
  if (file.kind === "binary") {
    const size = clamp(Math.log1p(file.bytes ?? 0) / 11, 0.18, 0.72);
    return [size, size, size];
  }
  const churn = file.additions + file.deletions;
  const volume = clamp(Math.log1p(churn) / 8, 0.15, 0.8);
  return [0.2 + volume * 0.34, 0.16 + volume * 0.7, 0.2 + volume * 0.34];
}

function commitDescriptor(node: GraphNodeRecord, theme: GitVisualTheme): NodeVisualDescriptor {
  const oid = text(node.properties.oid, node.id.replace(/^commit:/, ""));
  const message = text(node.properties.message, node.label ?? "");
  const author = text(node.properties.authorName, "unknown author");
  const committedAtMs = number(node.properties.committedAtMs);
  const files = fileChanges(node.properties.files);
  const tags = strings(node.properties.tags);
  const localBranches = strings(node.properties.localBranches);
  const remoteBranches = strings(node.properties.remoteBranches);
  const parents = strings(node.properties.parents);
  const isMerge = node.properties.isMerge === true;
  const signature = text(
    node.properties.signatureStatus,
    "unknown",
  ) as keyof GitVisualTheme["commit"]["signature"];
  const plateThickness = 0.18 + clamp(Math.log1p(message.length) / 20, 0, 0.32);
  const plateWidth = isMerge ? 3.4 : 2.8;
  const elements: VisualElementDescriptor[] = [
    {
      id: `${node.id}:plate`,
      primitive: "box",
      scale: [plateWidth, plateThickness, 1.55],
      color: isMerge ? theme.commit.mergePlate : theme.commit.plate,
      emissive: isMerge ? "#242a31" : "#171b20",
      interactionKey: node.id,
      metadata: { role: "commit-plate", oid, messageLength: message.length, isMerge },
    },
    {
      id: `${node.id}:station-core`,
      primitive: "cylinder",
      position: [0, plateThickness / 2 + 0.15, 0],
      scale: [0.38, 0.24, 0.38],
      color: theme.commit.stationCore,
      emissive: "#26333a",
      interactionKey: node.id,
      metadata: { role: "history-station-core", isMerge },
    },
    {
      id: `${node.id}:child-port`,
      primitive: "sphere",
      position: [plateWidth / 2 + 0.08, plateThickness / 2 + 0.12, 0],
      scale: [0.2, 0.2, 0.2],
      color: theme.commit.historyPort,
      emissive: "#1d2a33",
      interactionKey: node.id,
      metadata: { role: "history-port", direction: "newer" },
    },
  ];

  if (parents.length > 0) {
    elements.push({
      id: `${node.id}:parent-port`,
      primitive: "sphere",
      position: [-plateWidth / 2 - 0.08, plateThickness / 2 + 0.12, 0],
      scale: [0.2, 0.2, 0.2],
      color: theme.commit.historyPort,
      emissive: "#1d2a33",
      interactionKey: node.id,
      metadata: { role: "history-port", direction: "older", parentIndex: 0 },
    });
  }

  files.forEach((file, index) => {
    const [x, y, z] = commitFileOffset(index);
    elements.push({
      id: `${node.id}:file:${file.path}`,
      primitive: file.kind === "binary" ? "sphere" : "box",
      position: [x, plateThickness / 2 + y, z],
      scale: fileScale(file),
      color: file.kind === "binary" ? theme.commit.binaryChange : theme.commit.textChange,
      emissive: file.kind === "binary" ? "#21112d" : "#30280f",
      interactionKey: `file:${oid}:${file.path}`,
      metadata: {
        role: "changed-file",
        path: file.path,
        kind: file.kind,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        bytes: file.bytes,
      },
    });
  });

  if (tags.length > 0) {
    elements.push({
      id: `${node.id}:tag-shell`,
      primitive: "box",
      position: [0, 0.1, 0],
      scale: [plateWidth + 0.42, plateThickness + 0.72, 1.97],
      color: theme.commit.tagShell,
      opacity: 0.17,
      interactionKey: tags.length === 1 && tags[0] ? gitGraphIds.ref(tags[0]) : node.id,
      metadata: { role: "tag-enclosure", tags, count: tags.length },
    });
  }

  localBranches.forEach((branch, index) => {
    elements.push({
      id: `${node.id}:local-branch:${branch}`,
      primitive: "cylinder",
      position: [-plateWidth / 2 - 0.28, 0.35 + index * 0.22, -0.5],
      scale: [0.1, 0.32, 0.1],
      color: theme.commit.localBranchIndicator,
      emissive: "#173526",
      interactionKey: gitGraphIds.ref(branch),
      metadata: { role: "branch-indicator", branch, scope: "local" },
    });
  });

  remoteBranches.forEach((branch, index) => {
    elements.push({
      id: `${node.id}:remote-branch:${branch}`,
      primitive: "cylinder",
      position: [plateWidth / 2 + 0.28, 0.35 + index * 0.22, -0.5],
      scale: [0.1, 0.32, 0.1],
      color: theme.commit.remoteBranchIndicator,
      opacity: 0.72,
      interactionKey: gitGraphIds.ref(branch),
      metadata: { role: "branch-indicator", branch, scope: "remote", pulsing: true },
    });
  });

  if (isMerge) {
    elements.push(
      {
        id: `${node.id}:merge-port`,
        primitive: "sphere",
        position: [-plateWidth / 2 - 0.08, plateThickness / 2 + 0.12, 0.5],
        scale: [0.24, 0.24, 0.24],
        color: theme.commit.mergePort,
        emissive: "#30273c",
        interactionKey: node.id,
        metadata: { role: "merge-parent-port", parentIndex: 1 },
      },
      {
        id: `${node.id}:merge-notch`,
        primitive: "octahedron",
        position: [0, plateThickness / 2 + 0.34, -0.7],
        scale: [0.24, 0.24, 0.24],
        color: theme.commit.mergePlate,
        emissive: "#303844",
        interactionKey: node.id,
        metadata: { role: "merge-indicator" },
      },
    );
  }

  elements.push({
    id: `${node.id}:signature`,
    primitive: "octahedron",
    position: [plateWidth / 2 - 0.23, plateThickness / 2 + 0.28, 0.57],
    scale: [0.16, 0.21, 0.16],
    color: theme.commit.signature[signature] ?? theme.commit.signature.unknown,
    interactionKey: node.id,
    metadata: { role: "signature", status: signature },
  });

  const date =
    committedAtMs > 0 ? new Date(committedAtMs).toISOString().slice(0, 10) : "date unavailable";
  const labelLines = [
    oid.slice(0, 10),
    author,
    date,
    node.label ?? message.split("\n", 1)[0] ?? "",
  ];
  labelLines.forEach((label, index) => {
    elements.push({
      id: `${node.id}:label:${index}`,
      primitive: "label",
      position: [0, 0.66 + index * 0.28, 1.05],
      label,
      interactionKey: node.id,
      metadata: { role: "commit-label", line: index },
    });
  });

  return { nodeId: node.id, elements };
}

function simpleNodeDescriptor(node: GraphNodeRecord, theme: GitVisualTheme): NodeVisualDescriptor {
  const elements: VisualElementDescriptor[] = [];
  const interactionKey = node.id;

  switch (node.kind) {
    case "local-branch":
    case "remote-branch": {
      const remote = node.kind === "remote-branch";
      const color = remote ? theme.ref.remote : theme.ref.local;
      elements.push(
        {
          id: `${node.id}:stem`,
          primitive: "cylinder",
          position: [0, -0.72, 0],
          scale: [0.08, 1, 0.08],
          color,
          emissive: remote ? "#0b1a29" : "#0c2419",
          opacity: remote ? 0.64 : 0.82,
          interactionKey,
          metadata: { role: "ref-stem", remote },
        },
        {
          id: `${node.id}:body`,
          primitive: "cylinder",
          scale: [0.48, 1.25, 0.48],
          color,
          emissive: remote ? "#102644" : "#123324",
          opacity: remote ? 0.82 : 1,
          interactionKey,
          metadata: { role: "branch-prism", remote },
        },
        {
          id: `${node.id}:stripe`,
          primitive: "box",
          position: [0.5, 0, 0],
          scale: [0.09, 1.05, 0.16],
          color: remote ? theme.ref.tracking : "#d7ffe8",
          opacity: remote ? 0.62 : 0.95,
          interactionKey,
          metadata: { role: "branch-stripe", dashedOrPulsing: remote },
        },
      );
      break;
    }
    case "tag":
      elements.push(
        {
          id: `${node.id}:stem`,
          primitive: "cylinder",
          position: [0, -0.55, 0],
          scale: [0.07, 0.8, 0.07],
          color: theme.ref.tag,
          emissive: "#102c2b",
          opacity: 0.82,
          interactionKey,
          metadata: { role: "ref-stem", refKind: "tag" },
        },
        {
          id: `${node.id}:tag`,
          primitive: "octahedron",
          scale: [0.72, 0.72, 0.72],
          color: theme.ref.tag,
          emissive: "#123b39",
          interactionKey,
          metadata: {
            role: "tag",
            annotationDetailsAvailable: node.properties.annotationDetailsAvailable === true,
          },
        },
        {
          id: `${node.id}:tag-tab`,
          primitive: "box",
          position: [0.58, 0.08, 0],
          scale: [0.62, 0.16, 0.32],
          color: theme.ref.tag,
          opacity: 0.72,
          interactionKey,
          metadata: { role: "tag-tab" },
        },
      );
      break;
    case "stash":
      elements.push({
        id: `${node.id}:stash`,
        primitive: "torus",
        scale: [0.84, 0.84, 0.84],
        color: theme.ref.stash,
        emissive: "#241934",
        opacity: 0.67,
        interactionKey,
        metadata: { role: "stash", index: node.label },
      });
      break;
    case "remote":
      elements.push(
        {
          id: `${node.id}:platform`,
          primitive: "cylinder",
          scale: [2.5, 0.34, 2.5],
          color: theme.remote.platform,
          emissive: "#101820",
          interactionKey,
          metadata: { role: "remote-platform" },
        },
        {
          id: `${node.id}:beacon`,
          primitive: "cylinder",
          position: [0, 1.05, 0],
          scale: [0.13, 1.25, 0.13],
          color: theme.remote.beacon,
          emissive: theme.remote.beacon,
          interactionKey,
          metadata: { role: "remote-beacon" },
        },
      );
      break;
    case "head":
      elements.push(
        {
          id: `${node.id}:stem`,
          primitive: "cylinder",
          position: [0, -0.52, 0],
          scale: [0.07, 0.72, 0.07],
          color: theme.head,
          emissive: "#4d461c",
          interactionKey,
          metadata: { role: "head-stem" },
        },
        {
          id: `${node.id}:halo`,
          primitive: "torus",
          scale: [0.88, 0.88, 0.88],
          color: theme.head,
          emissive: "#5c5320",
          opacity: 0.72,
          interactionKey,
          metadata: { role: "head-route-halo" },
        },
        {
          id: `${node.id}:focus`,
          primitive: "octahedron",
          scale: [0.42, 0.58, 0.42],
          color: theme.head,
          emissive: "#5c5320",
          interactionKey,
          metadata: { role: "head-focus" },
        },
      );
      break;
    case "commit-boundary":
    case "git-object":
      elements.push({
        id: `${node.id}:unresolved`,
        primitive: "sphere",
        scale: [0.32, 0.32, 0.32],
        color: theme.unresolved,
        opacity: 0.55,
        interactionKey,
        metadata: { role: node.kind },
      });
      break;
    default:
      elements.push({
        id: `${node.id}:generic`,
        primitive: "sphere",
        scale: [0.38, 0.38, 0.38],
        color: theme.unresolved,
        interactionKey,
        metadata: { role: "generic", kind: node.kind },
      });
  }

  elements.push({
    id: `${node.id}:label`,
    primitive: "label",
    position: [0, 1.05, 0],
    label: node.label ?? node.id,
    interactionKey,
    metadata: { role: "node-label", kind: node.kind },
  });
  return { nodeId: node.id, elements };
}

function edgeDescriptor(
  edge: GraphEdgeRecord,
  theme: GitVisualTheme,
  topology?: GitTopologyContext,
): EdgeVisualDescriptor {
  const activeHistory = edge.properties.headPath === true;
  let descriptor: EdgeVisualDescriptor;
  switch (edge.kind) {
    case "history":
      descriptor = {
        edgeId: edge.id,
        style: activeHistory ? "git-active-history" : "git-history",
        color: activeHistory ? theme.edge.activeHistory : theme.edge.history,
        width: activeHistory ? 2.45 : 1.4,
        opacity: activeHistory ? 0.99 : 0.78,
        head: activeHistory ? "arrow" : "none",
      };
      break;
    case "merge-parent":
      descriptor = {
        edgeId: edge.id,
        style: activeHistory ? "git-active-history" : "git-merge",
        color: activeHistory ? theme.edge.activeHistory : theme.edge.merge,
        width: activeHistory ? 2.45 : 1.7,
        opacity: activeHistory ? 0.99 : 0.86,
        head: "arrow",
      };
      break;
    case "tag-target":
      descriptor = {
        edgeId: edge.id,
        style: "git-tag-pointer",
        color: theme.edge.tag,
        width: 0.72,
        opacity: 0.8,
        head: "diamond",
      };
      break;
    case "stash-base":
      descriptor = {
        edgeId: edge.id,
        style: "git-stash",
        color: theme.edge.stash,
        width: 0.76,
        opacity: 0.58,
        head: "arrow",
      };
      break;
    case "remote-tracking":
      descriptor = {
        edgeId: edge.id,
        style: "git-tracking",
        color: theme.edge.tracking,
        width: 0.55,
        opacity: 0.72,
        animated: true,
        head: "none",
      };
      break;
    case "remote-membership":
      descriptor = {
        edgeId: edge.id,
        style: "git-remote-membership",
        color: theme.edge.remoteMembership,
        width: 0.48,
        opacity: 0.46,
        head: "arrow",
      };
      break;
    case "head-symbolic":
    case "head-resolved":
      descriptor = {
        edgeId: edge.id,
        style: "git-head",
        color: theme.edge.head,
        width: 1.1,
        opacity: 0.94,
        animated: true,
        head: "arrow",
      };
      break;
    default:
      descriptor = {
        edgeId: edge.id,
        style: "git-branch-pointer",
        color: theme.edge.branch,
        width: 0.65,
        opacity: 0.68,
        head: "arrow",
      };
  }

  if (!topology?.focusEdgeIds.has(edge.id)) return descriptor;
  const ancestry = edge.kind === "history" || edge.kind === "merge-parent";
  const mergeIngress = topology.mergeIngressEdgeIds.has(edge.id);
  return {
    ...descriptor,
    width: Math.max(descriptor.width, ancestry ? (mergeIngress ? 1.95 : 1.85) : 0.92),
    opacity: Math.max(descriptor.opacity ?? 1, ancestry ? 0.95 : 0.82),
  };
}

function withTopologyFocus(
  descriptor: NodeVisualDescriptor,
  node: GraphNodeRecord,
  theme: GitVisualTheme,
  topology?: GitTopologyContext,
): NodeVisualDescriptor {
  if (!topology) return descriptor;
  const level = gitTopologyFocusLevel(topology, node.id);
  if (level !== "selected" && level !== "neighbor") return descriptor;
  return {
    ...descriptor,
    elements: [
      ...descriptor.elements,
      {
        id: `${node.id}:topology-focus`,
        primitive: "torus",
        position: [0, 0.12, 0],
        scale: level === "selected" ? [1.85, 1.85, 1.85] : [1.48, 1.48, 1.48],
        color: level === "selected" ? theme.focus.selected : theme.focus.neighbor,
        emissive: level === "selected" ? "#4a4522" : "#17342b",
        opacity: level === "selected" ? 0.76 : 0.42,
        interactionKey: node.id,
        metadata: { role: "topology-focus", level },
      },
    ],
  };
}

function uniqueOrdered(ids: readonly ElementId[]): readonly ElementId[] {
  const seen = new Set<ElementId>();
  const result: ElementId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function effectiveSelectionElementId(
  selection: SelectionState,
  dataset: GraphDatasetView,
): ElementId | undefined {
  if (
    selection.interactionKey &&
    dataset.nodes.some((node) => node.id === selection.interactionKey)
  ) {
    return selection.interactionKey;
  }
  return selection.elementId;
}

function connectedEdgeIds(elementId: ElementId, dataset: GraphDatasetView): readonly ElementId[] {
  const selectedEdge = dataset.edges.find((edge) => edge.id === elementId);
  if (selectedEdge) {
    const endpoints = new Set([selectedEdge.source, selectedEdge.target]);
    return dataset.edges
      .filter((edge) => endpoints.has(edge.source) || endpoints.has(edge.target))
      .map((edge) => edge.id)
      .sort((left, right) => left.localeCompare(right));
  }
  return dataset.edges
    .filter((edge) => edge.source === elementId || edge.target === elementId)
    .map((edge) => edge.id)
    .sort((left, right) => left.localeCompare(right));
}

function resolveChainStart(
  elementId: ElementId,
  dataset: GraphDatasetView,
): { readonly prefix: readonly ElementId[]; readonly nodeId?: ElementId } {
  const edge = dataset.edges.find((candidate) => candidate.id === elementId);
  if (edge) return { prefix: [edge.id, edge.target], nodeId: edge.target };

  const node = dataset.nodes.find((candidate) => candidate.id === elementId);
  if (!node) return { prefix: [elementId] };
  if (["local-branch", "remote-branch", "tag", "stash"].includes(node.kind)) {
    const targetEdge = dataset.edges.find(
      (candidate) =>
        candidate.source === node.id &&
        ["ref-target", "tag-target", "stash-base"].includes(candidate.kind),
    );
    if (targetEdge) {
      return {
        prefix: [node.id, targetEdge.id, targetEdge.target],
        nodeId: targetEdge.target,
      };
    }
  }
  if (node.kind === "head") {
    const headEdge = dataset.edges.find((candidate) => candidate.source === node.id);
    if (headEdge) {
      const headTarget = dataset.nodes.find((candidate) => candidate.id === headEdge.target);
      if (
        headTarget &&
        ["local-branch", "remote-branch", "tag", "stash"].includes(headTarget.kind)
      ) {
        const resolved = resolveChainStart(headTarget.id, dataset);
        const result: { readonly prefix: readonly ElementId[]; readonly nodeId?: ElementId } = {
          prefix: [node.id, headEdge.id, ...resolved.prefix],
        };
        if (resolved.nodeId !== undefined) {
          return { ...result, nodeId: resolved.nodeId };
        }
        return result;
      }
      return { prefix: [node.id, headEdge.id, headEdge.target], nodeId: headEdge.target };
    }
  }
  return { prefix: [node.id], nodeId: node.id };
}

function firstParentChainIds(
  elementId: ElementId,
  dataset: GraphDatasetView,
): readonly ElementId[] {
  const start = resolveChainStart(elementId, dataset);
  const ids: ElementId[] = [...start.prefix];
  let current = start.nodeId;
  const visited = new Set<ElementId>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const parentEdge = dataset.edges.find(
      (edge) =>
        edge.target === current &&
        (edge.kind === "history" || edge.kind === "merge-parent") &&
        edge.properties.firstParent === true,
    );
    if (!parentEdge) break;
    ids.push(parentEdge.id, parentEdge.source);
    current = parentEdge.source;
  }
  return uniqueOrdered(ids);
}

function clusterAnchorId(elementId: ElementId, dataset: GraphDatasetView): ElementId | undefined {
  const edge = dataset.edges.find((candidate) => candidate.id === elementId);
  if (edge) return edge.target;
  const node = dataset.nodes.find((candidate) => candidate.id === elementId);
  if (!node) return undefined;
  if (["local-branch", "remote-branch", "tag", "stash"].includes(node.kind)) {
    return dataset.edges.find(
      (candidate) =>
        candidate.source === node.id &&
        ["ref-target", "tag-target", "stash-base"].includes(candidate.kind),
    )?.target;
  }
  return node.id;
}

function branchTagClusterIds(
  elementId: ElementId,
  dataset: GraphDatasetView,
): readonly ElementId[] {
  const anchor = clusterAnchorId(elementId, dataset);
  if (!anchor) return [elementId];
  const refEdges = dataset.edges
    .filter(
      (edge) =>
        edge.target === anchor &&
        ["ref-target", "tag-target", "stash-base", "head-resolved"].includes(edge.kind),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  return uniqueOrdered([elementId, anchor, ...refEdges.flatMap((edge) => [edge.id, edge.source])]);
}

export function relatedGitSelectionIds(
  selection: SelectionState,
  dataset: GraphDatasetView,
): readonly ElementId[] {
  const elementId = effectiveSelectionElementId(selection, dataset);
  if (!elementId) return [];
  switch (selection.granularity) {
    case "sub-element":
      return [selection.interactionKey ?? elementId];
    case "node":
      return [selection.elementId ?? elementId];
    case "edge-group":
      return connectedEdgeIds(elementId, dataset);
    case "chain":
      return firstParentChainIds(elementId, dataset);
    case "cluster":
      return branchTagClusterIds(elementId, dataset);
  }
}

export function changedFilePathForGitSelection(
  selection: Pick<SelectionState, "elementId" | "interactionKey" | "granularity">,
  dataset: GraphDatasetView,
): string | undefined {
  if (
    selection.granularity !== "sub-element" ||
    !selection.elementId ||
    !selection.interactionKey
  ) {
    return undefined;
  }
  const node = dataset.nodes.find(
    (candidate) => candidate.id === selection.elementId && candidate.kind === "commit",
  );
  if (!node) return undefined;
  const oid = text(node.properties.oid, node.id.replace(/^commit:/, ""));
  const prefix = `file:${oid}:`;
  if (!selection.interactionKey.startsWith(prefix)) return undefined;
  const path = selection.interactionKey.slice(prefix.length);
  return fileChanges(node.properties.files).some((file) => file.path === path) ? path : undefined;
}

export function createGitVisualMapper(
  theme: GitVisualTheme = DEFAULT_GIT_VISUAL_THEME,
  topology?: GitTopologyContext,
): DataMapper {
  return {
    mapNode(node) {
      const descriptor =
        node.kind === "commit" ? commitDescriptor(node, theme) : simpleNodeDescriptor(node, theme);
      return withTopologyFocus(descriptor, node, theme, topology);
    },
    mapEdge(edge) {
      return edgeDescriptor(edge, theme, topology);
    },
    relatedSelectionIds(selection, dataset) {
      return relatedGitSelectionIds(selection, dataset);
    },
  };
}

export const gitVisualMapper = createGitVisualMapper();
