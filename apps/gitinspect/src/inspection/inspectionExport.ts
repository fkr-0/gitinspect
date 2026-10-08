import {
  type GitCommitDiff,
  type GitCommitFileDetail,
  type GitPluginReport,
  parseInspectionJson,
} from "@gitinspect/contracts";
import type { GraphNodeRecord } from "@gitinspect/graph-elements";
import { sanitizeRepositoryDisplay } from "../domain/displaySanitization";

export const GITINSPECT_INSPECTION_EXPORT_SCHEMA = "gitinspect-inspection/v1";
export const MAX_INSPECTION_EXPORT_BYTES = 1024 * 1024;
export const MAX_INSPECTION_NAVIGATION_DEPTH = 2;

export class InspectionLimitError extends Error {
  override name = "InspectionLimitError";
}

/** Reject unexpected envelope fields before treating externally supplied JSON as an inspection. */
export function parseInspectionExport(json: string): ReturnType<typeof createInspectionExport> {
  if (new TextEncoder().encode(json).byteLength > MAX_INSPECTION_EXPORT_BYTES) {
    throw new InspectionLimitError("Inspection JSON exceeds the 1 MiB import limit.");
  }
  /* Legacy envelope checks retained below for stable public error types. */
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const keys = (value: unknown, required: readonly string[], optional: readonly string[] = []) => {
    if (
      !isRecord(value) ||
      required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
    ) {
      throw new InspectionLimitError("Invalid inspection JSON schema.");
    }
    return value;
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InspectionLimitError("Malformed inspection JSON.");
  }
  const root = keys(
    parsed,
    ["schema", "repository", "selection", "element"],
    ["commitDiff", "fileDetail", "pluginReport"],
  );
  if (root.schema !== GITINSPECT_INSPECTION_EXPORT_SCHEMA)
    throw new InspectionLimitError("Unsupported inspection schema.");
  const repository = keys(root.repository, ["path", "revision"]);
  const selection = keys(root.selection, ["rootElementId", "activeElementId", "navigationDepth"]);
  const element = keys(root.element, ["id", "kind", "label", "group", "weight", "properties"]);
  const bounded = (value: unknown) => typeof value === "string" && value.length <= 4096;
  if (
    !bounded(repository.path) ||
    !bounded(repository.revision) ||
    !bounded(selection.activeElementId) ||
    (selection.rootElementId !== null && !bounded(selection.rootElementId)) ||
    !Number.isInteger(selection.navigationDepth) ||
    (selection.navigationDepth as number) < 0 ||
    (selection.navigationDepth as number) > MAX_INSPECTION_NAVIGATION_DEPTH ||
    !bounded(element.id) ||
    !bounded(element.kind) ||
    (element.label !== null && !bounded(element.label)) ||
    (element.group !== null && !bounded(element.group)) ||
    (element.weight !== null &&
      (typeof element.weight !== "number" || !Number.isFinite(element.weight))) ||
    !isRecord(element.properties)
  )
    throw new InspectionLimitError("Invalid inspection field type or bound.");
  try {
    return parseInspectionJson(json) as ReturnType<typeof createInspectionExport>;
  } catch {
    throw new InspectionLimitError("Invalid or unsafe inspection JSON.");
  }
}

export interface InspectionExportInput {
  readonly repositoryPath: string;
  readonly repositoryRevision: string;
  readonly rootSelectionId?: string;
  readonly navigationDepth: number;
  readonly node: GraphNodeRecord;
  readonly commitDiff?: GitCommitDiff;
  readonly fileDetail?: GitCommitFileDetail;
  readonly pluginReport?: GitPluginReport;
}

/**
 * Build a deterministic, bounded inspection payload from information that is
 * already loaded in the UI. This deliberately does not trigger extra repository
 * reads, so exporting cannot silently broaden inspection authority.
 */
export function createInspectionExport(input: InspectionExportInput) {
  if (
    !Number.isInteger(input.navigationDepth) ||
    input.navigationDepth < 0 ||
    input.navigationDepth > MAX_INSPECTION_NAVIGATION_DEPTH
  ) {
    throw new InspectionLimitError("Inspection navigation exceeds the maximum depth of 2.");
  }
  return {
    schema: GITINSPECT_INSPECTION_EXPORT_SCHEMA,
    repository: {
      path: input.repositoryPath,
      revision: input.repositoryRevision,
    },
    selection: {
      rootElementId: input.rootSelectionId ?? null,
      activeElementId: input.node.id,
      navigationDepth: input.navigationDepth,
    },
    element: {
      id: input.node.id,
      kind: input.node.kind,
      label: input.node.label == null ? null : sanitizeRepositoryDisplay(input.node.label),
      group: input.node.group == null ? null : sanitizeRepositoryDisplay(input.node.group),
      weight: input.node.weight ?? null,
      properties: input.node.properties,
    },
    ...(input.commitDiff === undefined ? {} : { commitDiff: input.commitDiff }),
    ...(input.fileDetail === undefined ? {} : { fileDetail: input.fileDetail }),
    ...(input.pluginReport === undefined ? {} : { pluginReport: input.pluginReport }),
  };
}

export function serializeInspectionExport(input: InspectionExportInput): string {
  const serialized = `${JSON.stringify(createInspectionExport(input), null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")}\n`;
  if (new TextEncoder().encode(serialized).byteLength > MAX_INSPECTION_EXPORT_BYTES) {
    throw new InspectionLimitError("Inspection JSON exceeds the 1 MiB export limit.");
  }
  // Exports must satisfy exactly the same recursive schema as imported inspections.
  try {
    parseInspectionJson(serialized);
  } catch {
    throw new InspectionLimitError("Inspection export contains invalid or unsafe data.");
  }
  return serialized;
}
