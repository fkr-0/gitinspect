import { describe, expect, it } from "vitest";

import {
  GITINSPECT_INSPECTION_EXPORT_SCHEMA,
  createInspectionExport,
  serializeInspectionExport,
} from "./inspectionExport";

describe("inspection export", () => {
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
    expect(parsed.fileDetail.hunks[0].lines[0]).toEqual({
      kind: "addition",
      content: "hello\n",
    });
  });
});
