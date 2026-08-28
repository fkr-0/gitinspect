import { describe, expect, it } from "vitest";

import {
  childNavigationFromHref,
  childNavigationHistoryDepth,
  childNavigationHistoryState,
  hrefWithChildNavigation,
  hrefWithSelection,
  selectionFromHref,
} from "./selectionUrl";

describe("selection URL state", () => {
  it("round-trips logical Git element IDs without changing unrelated interaction state", () => {
    const href = hrefWithSelection(
      "https://gitinspect.local/studio?mode=cursor#world",
      "ref:refs/heads/feature/a+b",
    );

    expect(selectionFromHref(href)).toBe("ref:refs/heads/feature/a+b");
    expect(new URL(href).searchParams.get("mode")).toBe("cursor");
    expect(new URL(href).hash).toBe("#world");
  });

  it("removes selection cleanly and ignores malformed URLs", () => {
    const href = hrefWithSelection(
      "https://gitinspect.local/studio?selection=commit%3Aabc&mode=camera",
      undefined,
    );

    expect(selectionFromHref(href)).toBeUndefined();
    expect(new URL(href).searchParams.get("mode")).toBe("camera");
    expect(selectionFromHref("not a url")).toBeUndefined();
  });

  it("round-trips bounded commit/file child worlds while preserving root selection and unrelated state", () => {
    const root = hrefWithSelection(
      "https://gitinspect.local/studio?mode=cursor#world",
      "commit:abc",
    );
    const commitHref = hrefWithChildNavigation(root, {
      depth: 1,
      localSelectionId: "commit-file:abc:src%2Fmain.ts",
    });
    expect(childNavigationFromHref(commitHref)).toEqual({
      status: "valid",
      state: {
        depth: 1,
        localSelectionId: "commit-file:abc:src%2Fmain.ts",
      },
    });

    const fileHref = hrefWithChildNavigation(commitHref, {
      depth: 2,
      fileElementId: "commit-file:abc:src%2Fmain.ts",
      localSelectionId: "file-hunk:abc:src%2Fmain.ts:0",
    });
    expect(childNavigationFromHref(fileHref)).toEqual({
      status: "valid",
      state: {
        depth: 2,
        fileElementId: "commit-file:abc:src%2Fmain.ts",
        localSelectionId: "file-hunk:abc:src%2Fmain.ts:0",
      },
    });
    expect(selectionFromHref(fileHref)).toBe("commit:abc");
    expect(new URL(fileHref).searchParams.get("mode")).toBe("cursor");
    expect(new URL(fileHref).hash).toBe("#world");
    expect(childNavigationFromHref(hrefWithChildNavigation(fileHref, undefined))).toEqual({
      status: "none",
    });
  });

  it("rejects malformed, orphaned, unsupported, and oversized child-world state", () => {
    expect(
      childNavigationFromHref("https://gitinspect.local/studio?worldTarget=commit-file%3Aabc%3Ax"),
    ).toMatchObject({ status: "invalid" });
    expect(childNavigationFromHref("https://gitinspect.local/studio?world=file")).toMatchObject({
      status: "invalid",
    });
    expect(childNavigationFromHref("https://gitinspect.local/studio?world=")).toMatchObject({
      status: "invalid",
    });
    expect(childNavigationFromHref("https://gitinspect.local/studio?world=tree")).toMatchObject({
      status: "invalid",
    });
    expect(
      childNavigationFromHref(
        `https://gitinspect.local/studio?world=commit&worldSelection=${"x".repeat(4_097)}`,
      ),
    ).toMatchObject({ status: "invalid" });
    expect(childNavigationFromHref("not a url")).toMatchObject({ status: "invalid" });

    const oversizedSerialized = hrefWithChildNavigation("https://gitinspect.local/studio", {
      depth: 1,
      localSelectionId: "x".repeat(4_097),
    });
    expect(childNavigationFromHref(oversizedSerialized)).toEqual({ status: "none" });
  });

  it("recognizes only bounded gitinspect-owned child navigation history entries", () => {
    expect(childNavigationHistoryDepth(childNavigationHistoryState(1))).toBe(1);
    expect(childNavigationHistoryDepth(childNavigationHistoryState(2))).toBe(2);
    expect(childNavigationHistoryDepth(null)).toBeUndefined();
    expect(
      childNavigationHistoryDepth({ gitinspectChildNavigation: { version: 2, depth: 1 } }),
    ).toBe(undefined);
    expect(
      childNavigationHistoryDepth({ gitinspectChildNavigation: { version: 1, depth: 3 } }),
    ).toBe(undefined);
    expect(childNavigationHistoryDepth({ unrelated: true })).toBeUndefined();
  });
});
