import type { GitCommitDiff, GitCommitFileDetail, GitPluginReport } from "@gitinspect/contracts";
import type { GraphNodeRecord } from "@gitinspect/graph-elements";

export const GITINSPECT_INSPECTION_EXPORT_SCHEMA = "gitinspect-inspection/v1";

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
      label: input.node.label ?? null,
      group: input.node.group ?? null,
      weight: input.node.weight ?? null,
      properties: input.node.properties,
    },
    ...(input.commitDiff === undefined ? {} : { commitDiff: input.commitDiff }),
    ...(input.fileDetail === undefined ? {} : { fileDetail: input.fileDetail }),
    ...(input.pluginReport === undefined ? {} : { pluginReport: input.pluginReport }),
  };
}

export function serializeInspectionExport(input: InspectionExportInput): string {
  return `${JSON.stringify(createInspectionExport(input), null, 2)}\n`;
}
