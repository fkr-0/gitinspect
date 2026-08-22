import type { GitCommitFileChange } from "@gitinspect/contracts";
import type {
  DataMapper,
  EdgeVisualDescriptor,
  GraphEdgeRecord,
  GraphNodeRecord,
  NodeVisualDescriptor,
  VisualElementDescriptor,
} from "@gitinspect/graph-elements";

import {
  DEFAULT_GIT_VISUAL_THEME,
  type GitVisualTheme,
} from "./gitVisualTheme";

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function fileChanges(value: unknown): readonly GitCommitFileChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is GitCommitFileChange => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Partial<GitCommitFileChange>;
    return typeof candidate.path === "string" &&
      (candidate.kind === "text" || candidate.kind === "binary") &&
      typeof candidate.additions === "number" &&
      typeof candidate.deletions === "number";
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
  return [
    -1.25 + column * 0.42,
    0.36 + row * 0.12,
    -0.52 + (row % 3) * 0.52,
  ];
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
  const isMerge = node.properties.isMerge === true;
  const signature = text(node.properties.signatureStatus, "unknown") as keyof GitVisualTheme["commit"]["signature"];
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
  ];

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
      interactionKey: node.id,
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
      interactionKey: node.id,
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
      interactionKey: node.id,
      metadata: { role: "branch-indicator", branch, scope: "remote", pulsing: true },
    });
  });

  if (isMerge) {
    elements.push({
      id: `${node.id}:merge-notch`,
      primitive: "octahedron",
      position: [0, plateThickness / 2 + 0.34, -0.7],
      scale: [0.24, 0.24, 0.24],
      color: theme.commit.mergePlate,
      emissive: "#303844",
      interactionKey: node.id,
      metadata: { role: "merge-indicator" },
    });
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

  const date = committedAtMs > 0 ? new Date(committedAtMs).toISOString().slice(0, 10) : "date unavailable";
  const labelLines = [oid.slice(0, 10), author, date, node.label ?? message.split("\n", 1)[0] ?? ""];
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
      elements.push({
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
      });
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
      elements.push({
        id: `${node.id}:focus`,
        primitive: "octahedron",
        scale: [0.52, 0.74, 0.52],
        color: theme.head,
        emissive: "#5c5320",
        interactionKey,
        metadata: { role: "head-focus" },
      });
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

function edgeDescriptor(edge: GraphEdgeRecord, theme: GitVisualTheme): EdgeVisualDescriptor {
  switch (edge.kind) {
    case "history":
      return {
        edgeId: edge.id,
        style: "git-history",
        color: theme.edge.history,
        width: 0.82,
        opacity: 0.7,
        head: "arrow",
      };
    case "merge-parent":
      return {
        edgeId: edge.id,
        style: "git-merge",
        color: theme.edge.merge,
        width: 1.2,
        opacity: 0.88,
        head: "arrow",
      };
    case "tag-target":
      return {
        edgeId: edge.id,
        style: "git-tag-pointer",
        color: theme.edge.tag,
        width: 0.72,
        opacity: 0.8,
        head: "diamond",
      };
    case "stash-base":
      return {
        edgeId: edge.id,
        style: "git-stash",
        color: theme.edge.stash,
        width: 0.76,
        opacity: 0.58,
        head: "arrow",
      };
    case "remote-tracking":
      return {
        edgeId: edge.id,
        style: "git-tracking",
        color: theme.edge.tracking,
        width: 0.55,
        opacity: 0.72,
        animated: true,
        head: "none",
      };
    case "remote-membership":
      return {
        edgeId: edge.id,
        style: "git-remote-membership",
        color: theme.edge.remoteMembership,
        width: 0.48,
        opacity: 0.46,
        head: "arrow",
      };
    case "head-symbolic":
    case "head-resolved":
      return {
        edgeId: edge.id,
        style: "git-head",
        color: theme.edge.head,
        width: 1.1,
        opacity: 0.94,
        animated: true,
        head: "arrow",
      };
    case "ref-target":
    default:
      return {
        edgeId: edge.id,
        style: "git-branch-pointer",
        color: theme.edge.branch,
        width: 0.65,
        opacity: 0.68,
        head: "arrow",
      };
  }
}

export function createGitVisualMapper(
  theme: GitVisualTheme = DEFAULT_GIT_VISUAL_THEME,
): DataMapper {
  return {
    mapNode(node) {
      return node.kind === "commit"
        ? commitDescriptor(node, theme)
        : simpleNodeDescriptor(node, theme);
    },
    mapEdge(edge) {
      return edgeDescriptor(edge, theme);
    },
  };
}

export const gitVisualMapper = createGitVisualMapper();
