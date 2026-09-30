export type ElementId = string;

export type Vec3 = readonly [x: number, y: number, z: number];

export interface GraphElementMetadata {
  readonly kind: string;
  readonly label?: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface GraphNodeRecord extends GraphElementMetadata {
  readonly id: ElementId;
  readonly positionHint?: Vec3;
  readonly group?: string;
  readonly weight?: number;
}

export interface GraphEdgeRecord extends GraphElementMetadata {
  readonly id: ElementId;
  readonly source: ElementId;
  readonly target: ElementId;
  readonly directed: boolean;
  readonly weight?: number;
}

export interface GraphDataset {
  readonly revision: string;
  readonly nodes: readonly GraphNodeRecord[];
  readonly edges: readonly GraphEdgeRecord[];
}

export type VisualPrimitive =
  | "box"
  | "sphere"
  | "plane"
  | "cylinder"
  | "octahedron"
  | "torus"
  | "line"
  | "particles"
  | "label";

export interface VisualElementDescriptor {
  readonly id: string;
  readonly primitive: VisualPrimitive;
  readonly position?: Vec3;
  readonly scale?: Vec3;
  readonly color?: string;
  readonly opacity?: number;
  readonly emissive?: string;
  readonly label?: string;
  readonly interactionKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NodeVisualDescriptor {
  readonly nodeId: ElementId;
  readonly elements: readonly VisualElementDescriptor[];
}

export interface EdgeVisualDescriptor {
  readonly edgeId: ElementId;
  readonly style: string;
  readonly color: string;
  readonly width: number;
  readonly dashed?: boolean;
  readonly animated?: boolean;
  readonly opacity?: number;
  readonly head?: "arrow" | "diamond" | "none";
}

export type SelectionGranularity = "sub-element" | "node" | "edge-group" | "chain" | "cluster";

export interface SelectionState {
  readonly elementId?: ElementId;
  readonly interactionKey?: string;
  readonly granularity: SelectionGranularity;
  readonly relatedIds: readonly ElementId[];
}

export type CameraMode = "attached" | "free-flight";

export interface CameraState {
  readonly mode: CameraMode;
  readonly position: Vec3;
  readonly target: Vec3;
  readonly attachedNodeId?: ElementId;
  readonly zoom: number;
}

export interface LodBucket {
  readonly id: string;
  readonly memberIds: readonly ElementId[];
  readonly centroid: Vec3;
  readonly count: number;
  readonly dominantKind: string;
}

export interface GitCommitFileChange {
  readonly path: string;
  readonly kind: "text" | "binary";
  readonly additions: number;
  readonly deletions: number;
  readonly bytes?: number;
  readonly status:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "typechange"
    | "unknown";
}

export interface GitCommitRecord {
  readonly oid: string;
  readonly treeOid: string;
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail?: string;
  readonly authoredAtMs: number;
  readonly committedAtMs: number;
  readonly message: string;
  readonly signatureStatus: "valid" | "invalid" | "unknown" | "unsigned";
  readonly files: readonly GitCommitFileChange[];
}

export interface GitRefRecord {
  readonly name: string;
  readonly targetOid: string;
  readonly kind: "local-branch" | "remote-branch" | "tag" | "stash" | "other";
  readonly symbolicTarget?: string;
  readonly upstream?: string;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface GitRemoteRecord {
  readonly name: string;
  readonly fetchUrls: readonly string[];
  readonly pushUrls: readonly string[];
}

export interface GitRepositorySnapshot {
  readonly schemaVersion: 1;
  readonly repositoryPath: string;
  readonly gitDir: string;
  /** Resolved object ID currently selected by HEAD, when HEAD resolves to an object. */
  readonly head?: string;
  /** Authoritative symbolic HEAD referent (for example refs/heads/main); present for attached/unborn branches, absent when detached. */
  readonly headRef?: string;
  readonly revision: string;
  readonly commits: readonly GitCommitRecord[];
  readonly refs: readonly GitRefRecord[];
  readonly remotes: readonly GitRemoteRecord[];
  readonly hooks: readonly string[];
  readonly truncated: boolean;
}

export interface GitDiffOptions {
  readonly maxBlobBytes: number;
  readonly binaryProbeBytes: number;
  readonly maxFiles: number;
}

export interface GitCommitDiff {
  readonly oid: string;
  readonly parentOid?: string;
  readonly files: readonly GitCommitFileChange[];
  readonly truncated: boolean;
}

export interface GitFileDetailOptions {
  readonly maxBlobBytes: number;
  readonly maxPatchLines: number;
  readonly contextLines: number;
}

export type GitPatchLineKind = "context" | "addition" | "deletion";

export interface GitPatchLine {
  readonly kind: GitPatchLineKind;
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly content: string;
}

export interface GitPatchHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly GitPatchLine[];
}

export type GitFileContentStatus = "text" | "binary" | "too-large" | "opaque" | "unavailable";

export interface GitCommitFileDetail {
  readonly oid: string;
  readonly parentOid?: string;
  readonly path: string;
  readonly status: GitCommitFileChange["status"];
  readonly kind: GitCommitFileChange["kind"];
  readonly oldOid?: string;
  readonly newOid?: string;
  readonly oldBytes?: number;
  readonly newBytes?: number;
  readonly contentStatus: GitFileContentStatus;
  readonly hunks: readonly GitPatchHunk[];
  readonly truncated: boolean;
}

export type GitPluginSeverity = "info" | "warning" | "error";
export type GitPluginStatus = "passed" | "warning" | "failed" | "disabled";
export type GitPluginSource = "builtin" | "manifest";

export interface GitPluginFinding {
  readonly ruleId: string;
  readonly severity: GitPluginSeverity;
  readonly message: string;
  readonly path?: string;
  readonly commitOid?: string;
}

export interface GitPluginMetric {
  readonly name: string;
  readonly value: number;
}

export interface GitPluginResult {
  readonly id: string;
  readonly name: string;
  readonly source: GitPluginSource;
  readonly status: GitPluginStatus;
  readonly findings: readonly GitPluginFinding[];
  readonly metrics: readonly GitPluginMetric[];
  readonly truncated: boolean;
}

export interface GitPluginReportSummary {
  readonly enabledPlugins: number;
  readonly disabledPlugins: number;
  readonly infoFindings: number;
  readonly warningFindings: number;
  readonly errorFindings: number;
}

export interface GitPluginReport {
  readonly schemaVersion: 1;
  readonly apiVersion: 1;
  readonly repositoryRevision: string;
  readonly configPath?: string;
  readonly plugins: readonly GitPluginResult[];
  readonly summary: GitPluginReportSummary;
  readonly diagnostics: readonly string[];
  readonly truncated: boolean;
}

export type MutationKind =
  | "branch-create"
  | "branch-delete"
  | "branch-rename"
  | "tag-create"
  | "tag-delete"
  | "tag-move"
  | "cherry-pick"
  | "rebase-reorder"
  | "squash"
  | "fixup"
  | "reword"
  | "drop"
  | "split";

export interface MutationOperation {
  readonly id: string;
  readonly kind: MutationKind;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface MutationPreview {
  readonly transactionId: string;
  readonly baseRevision: string;
  readonly targetMode: "copy" | "original";
  readonly operations: readonly MutationOperation[];
  readonly affectedRefs: readonly string[];
  readonly rewrittenCommits: readonly { readonly oldOid: string; readonly predictedOid?: string }[];
  readonly warnings: readonly string[];
  readonly confirmToken?: string;
}
