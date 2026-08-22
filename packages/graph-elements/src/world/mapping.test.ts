import type { GraphNodeRecord } from "@gitinspect/contracts";
import { describe, expect, it } from "vitest";
import { resolveNodePositions } from "./mapping";

const node = (id: string, positionHint?: readonly [number, number, number]): GraphNodeRecord => ({
  id,
  kind: "generic",
  properties: {},
  ...(positionHint === undefined ? {} : { positionHint }),
});

describe("resolveNodePositions", () => {
  it("prefers layout positions, then immutable record hints, then origin", () => {
    const result = resolveNodePositions(
      [node("layout", [1, 1, 1]), node("hint", [2, 2, 2]), node("origin")],
      new Map([["layout", [9, 8, 7] as const]]),
    );

    expect(result.get("layout")).toEqual([9, 8, 7]);
    expect(result.get("hint")).toEqual([2, 2, 2]);
    expect(result.get("origin")).toEqual([0, 0, 0]);
  });
});
