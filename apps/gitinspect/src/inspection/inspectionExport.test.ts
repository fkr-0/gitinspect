import { describe, expect, it } from "vitest";

import {
  GITINSPECT_INSPECTION_EXPORT_SCHEMA,
  createInspectionExport,
  serializeInspectionExport,
  InspectionLimitError,
  parseInspectionExport,
} from "./inspectionExport";

describe("inspection export", () => {
  it("rejects unknown envelope and nested identity fields", () => {
    const serialized = serializeInspectionExport({repositoryPath:"/repo",repositoryRevision:"rev",navigationDepth:0,node:{id:"commit:a",kind:"commit",properties:{}}});
    expect(parseInspectionExport(serialized).schema).toBe(GITINSPECT_INSPECTION_EXPORT_SCHEMA);
    const payload = JSON.parse(serialized);
    expect(() => parseInspectionExport(JSON.stringify({...payload, execute:"danger"}))).toThrow(InspectionLimitError);
    expect(() => parseInspectionExport(JSON.stringify({...payload, repository:{...payload.repository, execute:true}}))).toThrow(InspectionLimitError);
    expect(() => parseInspectionExport(JSON.stringify({...payload, selection:{...payload.selection, navigationDepth:99}}))).toThrow(InspectionLimitError);
  });
  it("escapes HTML-breaking strings during JSON serialization", () => {
    const output=serializeInspectionExport({repositoryPath:"/repo",repositoryRevision:"rev",navigationDepth:0,node:{id:"x",kind:"commit",label:"<script>\u202e",properties:{}}});
    expect(output).not.toContain("<script>");
    expect(output).toContain("\\u003cscript\\u003e");
    expect(output).toContain("\\u{202E}");
  });
  it("rejects excessive navigation depth and oversized Unicode JSON rather than truncating", () => {
    const base = {
      repositoryPath: "/repo",
      repositoryRevision: "rev",
      navigationDepth: 0,
      node: { id: "test", kind: "commit", properties: {} },
    };
    expect(() => serializeInspectionExport({ ...base, navigationDepth: 3 })).toThrow(
      InspectionLimitError,
    );
    expect(() =>
      serializeInspectionExport({
        ...base,
        node: { ...base.node, properties: { text: "é".repeat(600_000) } },
      }),
    ).toThrow(InspectionLimitError);
  });

  it("serializes the active semantic element with repository and navigation identity", () => {
    const payload = createInspectionExport({
      repositoryPath: "/repo",
      repositoryRevision: "rev-7",
      rootSelectionId: "commit:abc",
      navigationDepth: 1,
      node: {
        id: "commit-file:abc:src%2Fmain.ts",
        kind: "changed-file-text",
        label: "src/main.ts",
        group: "status:modified",
        weight: 2,
        properties: { path: "src/main.ts", additions: 4, deletions: 1 },
      },
    });

    expect(payload.schema).toBe(GITINSPECT_INSPECTION_EXPORT_SCHEMA);
    expect(payload.repository).toEqual({ path: "/repo", revision: "rev-7" });
    expect(payload.selection).toEqual({
      rootElementId: "commit:abc",
      activeElementId: "commit-file:abc:src%2Fmain.ts",
      navigationDepth: 1,
    });
    expect(payload.element.properties).toEqual({
      path: "src/main.ts",
      additions: 4,
      deletions: 1,
    });
    expect(payload).not.toHaveProperty("commitDiff");
    expect(payload).not.toHaveProperty("fileDetail");
  });

  it("includes only already-loaded bounded diff and file detail data", () => {
    const serialized = serializeInspectionExport({
      repositoryPath: "/repo",
      repositoryRevision: "rev-8",
      navigationDepth: 2,
      node: {
        id: "file-hunk:abc:src%2Fmain.ts:0",
        kind: "diff-hunk",
        properties: { hunkIndex: 0 },
      },
      commitDiff: {
        oid: "abc",
        parentOid: "parent",
        truncated: false,
        files: [
          {
            path: "src/main.ts",
            kind: "text",
            status: "modified",
            additions: 1,
            deletions: 0,
          },
        ],
      },
      pluginReport: {
        schemaVersion: 1,
        apiVersion: 1,
        repositoryRevision: "rev-8",
        plugins: [
          {
            id: "license-check",
            name: "License check",
            source: "builtin",
            status: "warning",
            findings: [
              {
                ruleId: "license-file-required",
                severity: "warning",
                message: "No LICENSE file found",
              },
            ],
            metrics: [{ name: "licenseFiles", value: 0 }],
            truncated: false,
          },
        ],
        summary: {
          enabledPlugins: 1,
          disabledPlugins: 0,
          infoFindings: 0,
          warningFindings: 1,
          errorFindings: 0,
        },
        diagnostics: [],
        truncated: false,
      },
      fileDetail: {
        oid: "abc",
        path: "src/main.ts",
        status: "modified",
        kind: "text",
        contentStatus: "text",
        truncated: false,
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            lines: [{ kind: "addition", content: "hello\n" }],
          },
        ],
      },
    });

    expect(serialized.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(serialized);
    expect(parsed.commitDiff.files[0].path).toBe("src/main.ts");
    expect(parsed.pluginReport.plugins[0].id).toBe("license-check");
    expect(parsed.fileDetail.hunks[0].lines[0]).toEqual({
      kind: "addition",
      content: "hello\n",
    });
  });
});
