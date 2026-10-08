import { describe, expect, it } from "vitest";
import { parseInspectionJson } from "./inspectionValidation";

const valid = () => ({
  schema: "gitinspect-inspection/v1",
  repository: { path: "repo", revision: "rev" },
  selection: { rootElementId: null, activeElementId: "commit:abc", navigationDepth: 0 },
  element: {
    id: "commit:abc",
    kind: "commit",
    label: "\u202e<script>",
    group: null,
    weight: null,
    properties: { message: "\u001b[31m" },
  },
});

describe("untrusted inspection JSON", () => {
  it("retains hostile text as inert data", () => {
    expect(parseInspectionJson(JSON.stringify(valid())).element.label).toBe("\u202e<script>");
  });
  it("rejects unknown top-level and nested fields", () => {
    expect(() => parseInspectionJson(JSON.stringify({ ...valid(), execute: true }))).toThrow();
    expect(() =>
      parseInspectionJson(
        JSON.stringify({ ...valid(), repository: { ...valid().repository, extra: 1 } }),
      ),
    ).toThrow();
  });
  it("rejects prototype pollution keys", () => {
    expect(() =>
      parseInspectionJson(JSON.stringify(valid()).replace('"message":', '"__proto__":')),
    ).toThrow();
  });
  it("rejects mismatched selection and unsafe navigation depth", () => {
    expect(() =>
      parseInspectionJson(
        JSON.stringify({ ...valid(), selection: { ...valid().selection, navigationDepth: 3 } }),
      ),
    ).toThrow();
    expect(() =>
      parseInspectionJson(
        JSON.stringify({ ...valid(), element: { ...valid().element, id: "other" } }),
      ),
    ).toThrow();
  });
  it("rejects oversized payloads and nested value trees", () => {
    expect(() => parseInspectionJson(" ".repeat(1024 * 1024 + 1))).toThrow();
    const source = valid();
    let item: Record<string, unknown> = source.element.properties;
    for (let n = 0; n < 30; n++) {
      item.child = {};
      item = item.child as Record<string, unknown>;
    }
    expect(() => parseInspectionJson(JSON.stringify(source))).toThrow();
  });
});
